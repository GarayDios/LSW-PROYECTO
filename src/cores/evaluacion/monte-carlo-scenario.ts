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
  if (strategy === 'pmcc') return { scenario: null, error: 'PMCC tiene vencimientos distintos. Esta versión requiere un vencimiento común; utiliza el contrato individual para un ejercicio separado.' };
  if (policy.dividendModel === 'declared-cash') return { scenario: null, error: 'Monte Carlo usa dividendos continuos. Cambia explícitamente ese supuesto para simular; no se sustituyen los pagos discretos.' };
  const analysis = analyzeStrategy(snapshot, strategy, days, policy);
  if (analysis.status !== 'available') return { scenario: null, error: `Faltan entradas de la estrategia: ${analysis.missing.join(', ')}.` };
  const expiries = analysis.legs.map(leg => valuationExpiry(leg.contract, snapshot.asOf).time);
  if (new Set(expiries).size !== 1 || !Number.isFinite(expiries[0])) return { scenario: null, error: 'Se requiere un vencimiento común válido.' };
  const q = modelDividendYield(snapshot, policy), rate = policy.riskFreeRate ?? snapshot.macro.riskFreeRate;
  if (!knownBy(q, snapshot.asOf) || !knownBy(rate, snapshot.asOf)) return { scenario: null, error: 'Faltan tasa o dividendos conocidos en la fecha de corte.' };
  const contracts = analysis.legs.map(leg => leg.contract);
  const volatility = contracts[0].impliedVolatility.value!;
  const label = strategy === 'wheel' ? 'Wheel · put inicial, sin el ciclo posterior' : strategy === 'gamma' ? 'Gamma · straddle y cobertura delta opcional' : 'Backspread · −1 call inferior / +2 calls superiores';
  return { scenario: {
    label: `${snapshot.symbol} · ${label} · ${analysis.dataMode === 'estimated' ? 'entradas estimadas' : 'entradas del proveedor'} · corte ${snapshot.asOf}`,
    basis: {
      spot: snapshot.market.spot.value!, days: (expiries[0] - Date.parse(snapshot.asOf)) / 86400000,
      volatility, rate: rate.value!, dividendYield: q.value!, feePerContract: policy.feePerContract ?? 0,
      legs: analysis.legs.map(leg => {
        const terms = equityTerms(leg.contract, snapshot.asOf)!;
        return { type: leg.contract.type, strike: terms.effectiveStrike, quantity: leg.quantity, units: terms.shares, premium: leg.entry * terms.multiplier / terms.shares };
      }),
    },
    sources: [snapshot.market.spot.source, rate.source, q.source, ...contracts.flatMap(c => [c.symbol, c.impliedVolatility.source, c.bid.source, c.ask.source])],
    warnings: [...analysis.warnings,
      `Una sola volatilidad constante de ${(volatility * 100).toFixed(2)}% para todas las piernas, tomada de ${contracts[0].symbol}. No representa la sonrisa de volatilidad.`,
      'Aproximación europea con liquidación por efectivo al vencimiento; no reproduce asignación ni ejercicio anticipado de contratos americanos.',
      ...(contracts.some(c => c.style !== 'european') ? ['Los contratos incluyen estilo americano o sin verificar; Monte Carlo no reproduce su prima de ejercicio anticipado.'] : []),
    ],
  } };
}
