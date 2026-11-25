import { analyzeStrategy, type AnalysisPolicy } from './strategy-analysis.ts';
import { equityTerms, modelDividendYield, valuationExpiry } from '../../features/research/contract-terms.ts';
import { knownBy, type CompanyResearch } from '../compartido/research-model.ts';
import type { StrategyId } from '../compartido/types.ts';
import type { MonteCarloRequest } from '../nucleo-cuantitativo/monte-carlo.ts';

export type MonteCarloBasis = Pick<MonteCarloRequest, 'spot' | 'days' | 'volatility' | 'rate' | 'dividendYield' | 'legs' | 'feePerContract'>;
export type MonteCarloScenario = { basis: MonteCarloBasis; label: string; sources: string[]; warnings: string[] };
export type StrategyMonteCarloScenario = { scenario: MonteCarloScenario; error?: never } | { scenario: null; error: string };

/** Keep the strategy selector's bid/ask, signed ratios and verified deliverables.
 * A single underlying GBM requires a single scenario sigma, explicitly disclosed.
 * Do not silently collapse a PMCC into a payoff at one maturity.
 */
export function strategyMonteCarloScenario(snapshot: CompanyResearch, strategy: StrategyId, days: number, policy: AnalysisPolicy = {}): StrategyMonteCarloScenario {
  if (policy.dividendModel === 'declared-cash') return { scenario: null, error: 'Monte Carlo usa dividendos continuos. Cambia explícitamente ese supuesto para simular; no se sustituyen los pagos discretos.' };
  const analysis = analyzeStrategy(snapshot, strategy, days, policy);
  if (analysis.status !== 'available') {
    const quoteReason=snapshot.options.contracts.find(c=>c.premium.kind==='missing'&&c.premium.reason)?.premium.reason;
    return { scenario: null, error: `Faltan entradas de la estrategia: ${analysis.missing.join(', ')}. ${analysis.diagnostics ? `${analysis.diagnostics.eligibleContracts}/${analysis.diagnostics.totalContracts} contratos pasan los filtros. ${analysis.diagnostics.rejected.map(d=>`${d.label}: ${d.count}`).join('; ')}.` : ''} ${snapshot.options.status.message} ${quoteReason??''}` };
  }
  const expiries = analysis.legs.map(leg => valuationExpiry(leg.contract, snapshot.asOf).time);
  if (expiries.some(time => !Number.isFinite(time)) || strategy !== 'pmcc' && new Set(expiries).size !== 1) return { scenario: null, error: 'Los vencimientos no son compatibles con la estructura seleccionada.' };
  const horizon = Math.min(...expiries);
  const q = modelDividendYield(snapshot, policy), rate = policy.riskFreeRate ?? snapshot.macro.riskFreeRate;
  if (!knownBy(q, snapshot.asOf) || !knownBy(rate, snapshot.asOf)) return { scenario: null, error: 'Faltan tasa o dividendos conocidos en la fecha de corte.' };
  const contracts = analysis.legs.map(leg => leg.contract);
  const volatility = contracts[0].impliedVolatility.value!;
  const label = strategy === 'wheel' ? 'Wheel · put inicial, sin el ciclo posterior' : strategy === 'pmcc' ? 'PMCC · call corta al vencimiento / LEAPS a valor teórico remanente' : strategy === 'gamma' ? 'Gamma · straddle y cobertura delta opcional' : 'Backspread · −1 call inferior / +2 calls superiores';
  return { scenario: {
    label: `${snapshot.symbol} · ${label} · ${analysis.dataMode === 'estimated' ? 'entradas estimadas' : 'entradas del proveedor'} · corte ${snapshot.asOf}`,
    basis: {
      spot: snapshot.market.spot.value!, days: (horizon - Date.parse(snapshot.asOf)) / 86400000,
      volatility, rate: rate.value!, dividendYield: q.value!, feePerContract: policy.feePerContract ?? 0,
      legs: analysis.legs.map(leg => {
        const terms = equityTerms(leg.contract, snapshot.asOf)!;
        return { type: leg.contract.type, strike: terms.effectiveStrike, quantity: leg.quantity, units: terms.shares, premium: leg.entry * terms.multiplier / terms.shares,
          ...(strategy === 'pmcc' ? { daysToExpiry: (valuationExpiry(leg.contract, snapshot.asOf).time - Date.parse(snapshot.asOf)) / 86400000, volatility: leg.contract.impliedVolatility.value! } : {}) };
      }),
    },
    sources: [snapshot.market.spot.source, rate.source, q.source, ...contracts.flatMap(c => [c.symbol, c.impliedVolatility.source, c.bid.source, c.ask.source])],
    warnings: [...analysis.warnings,
      `Una sola volatilidad constante de ${(volatility * 100).toFixed(2)}% para el subyacente, tomada de ${contracts[0].symbol}. No representa la sonrisa de volatilidad.`,
      ...(strategy === 'pmcc' ? ['Horizonte: vencimiento de la call corta. La LEAPS conserva su vencimiento y se valora por BSM con su IV inicial constante. No se liquida a valor intrínseco ni se simulan renovaciones o asignación anticipada.'] : []),
      strategy === 'pmcc' ? 'La posición se marca al primer vencimiento; el precio teórico de la LEAPS no es una cotización ejecutable. No se modela asignación anticipada.' : 'Aproximación europea con liquidación por efectivo al vencimiento; no reproduce asignación ni ejercicio anticipado de contratos americanos.',
      ...(contracts.some(c => c.style !== 'european') ? ['Los contratos incluyen estilo americano o sin verificar; Monte Carlo no reproduce su prima de ejercicio anticipado.'] : []),
    ],
  } };
}
