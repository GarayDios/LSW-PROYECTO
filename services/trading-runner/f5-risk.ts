import { BrokerError } from '../../src/api/brokers/alpaca/client.ts';
import type { F5Account, F5Contract, F5Operation, F5Position, F5RiskSettings, F5RiskState } from '../../src/features/f5/types.ts';
import { f5Pending, f5Today } from './f5-model.ts';

export async function measureF5Risk(input: { account: F5Account; positions: F5Position[]; operations: F5Operation[]; settings: F5RiskSettings; previous: F5RiskState | null; time: number; feed: 'indicative' | 'opra'; contract(symbol: string): Promise<F5Contract> }): Promise<F5RiskState> {
  const { account, settings, previous, time } = input, date = f5Today(time);
  let uncertain = !Number.isFinite(account.equity), grossExposureUsd = 0, premiumExposureUsd = 0, delta = 0;
  for (const position of input.positions) {
    if (!Number.isFinite(position.quantity) || position.marketValue === null || !Number.isFinite(position.marketValue)) { uncertain = true; continue; }
    grossExposureUsd += Math.abs(position.marketValue);
    if (position.assetClass === 'us_equity') delta += position.quantity;
    else if (position.assetClass === 'us_option') {
      premiumExposureUsd += Math.abs(position.marketValue);
      try {
        const contract = await input.contract(position.symbol), stamp = contract.quoteTime ? Date.parse(contract.quoteTime) : NaN;
        if (contract.delta === null || !Number.isFinite(contract.delta) || !Number.isFinite(stamp) || stamp > time + 5000 || time - stamp > (input.feed === 'indicative' ? 1200000 : 60000)) uncertain = true;
        else delta += position.quantity * contract.size * contract.delta;
      } catch { uncertain = true; }
    } else uncertain = true;
  }
  for (const operation of input.operations.filter(f5Pending)) {
    const pending = Math.max(0, operation.quantity - Number(operation.brokerOrder?.filled_qty ?? 0));
    const premium = pending * Math.abs(operation.limitPrice) * (operation.action === 'hedge' ? 1 : 100);
    grossExposureUsd += premium;
    if (operation.action !== 'hedge') premiumExposureUsd += premium;
    if (operation.state === 'ambiguous' || operation.state === 'reserved') uncertain = true;
  }
  const baselineEquity = previous?.date === date ? previous.baselineEquity : account.equity;
  const dailyPnlUsd = account.equity - baselineEquity;
  const dailyLossBlocked = (previous?.date === date && previous.dailyLossBlocked) || dailyPnlUsd <= -settings.maxDailyLossUsd;
  const blockedReasons: string[] = [];
  if (settings.paused) blockedReasons.push('Entradas nuevas pausadas manualmente.');
  if (dailyLossBlocked) blockedReasons.push('Se alcanzó el límite de pérdida diaria; permanece bloqueado hasta el siguiente día de Nueva York.');
  if (grossExposureUsd >= settings.maxGrossExposureUsd) blockedReasons.push('Se alcanzó el límite de exposición bruta.');
  if (premiumExposureUsd >= settings.maxPremiumExposureUsd) blockedReasons.push('Se alcanzó el límite de exposición en primas.');
  if (!uncertain && Math.abs(delta) >= settings.maxAbsDelta) blockedReasons.push('Se alcanzó el límite de delta absoluta.');
  if (uncertain) blockedReasons.push('La exposición o delta de la cuenta no se pudo verificar con datos recientes.');
  return { date, baselineEquity, equity: account.equity, dailyPnlUsd, dailyLossBlocked, grossExposureUsd, premiumExposureUsd, netDelta: uncertain ? null : delta, uncertain, blockedReasons, updatedAt: new Date(time).toISOString() };
}

export function enforceF5Risk(settings: F5RiskSettings, risk: F5RiskState, operation: F5Operation, deltaChange: number | null, cycleAllocation: number): void {
  const reducing = operation.action === 'close' || operation.action === 'hedge' && deltaChange !== null && risk.netDelta !== null && Math.abs(risk.netDelta + deltaChange) <= Math.abs(risk.netDelta) + 0.5;
  if (reducing) return;
  const reject = (message: string): never => { throw new BrokerError('f5_risk_blocked', 409, message, false); };
  if (settings.paused) reject('Las entradas F5 están pausadas. Los cierres y las coberturas que reducen delta siguen disponibles.');
  if (risk.dailyLossBlocked) reject('Se alcanzó el límite de pérdida diaria de F5.');
  if (risk.uncertain || deltaChange === null || risk.netDelta === null) reject('No se pudo verificar la exposición y delta de la cuenta.');
  if (cycleAllocation > settings.maxCycleCapitalUsd + 0.001) reject('La asignación acumulada del ciclo supera el límite de capital por ciclo.');
  if (risk.grossExposureUsd + operation.reservedCapitalUsd > settings.maxGrossExposureUsd + 0.001) reject('La operación superaría el límite de exposición bruta.');
  if (risk.premiumExposureUsd + Math.abs(operation.limitPrice) * operation.quantity * (operation.action === 'hedge' ? 0 : 100) > settings.maxPremiumExposureUsd + 0.001) reject('La operación superaría el límite de exposición en primas.');
  if (Math.abs(risk.netDelta! + deltaChange!) > settings.maxAbsDelta + 0.001) reject('La operación superaría el límite de delta absoluta.');
}
