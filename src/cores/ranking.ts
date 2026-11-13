import type { Company } from '../features/market/data.ts';
import { blackScholes, bsmCore } from './bsm.ts';
import { greeksCore } from './greeks.ts';
import { liquidityCore } from './liquidity.ts';
import { clamp, proximity } from './math.ts';
import { probabilityCore, profitMetrics } from './probability.ts';
import { riskCore } from './risk.ts';
import { trendCore } from './trend.ts';
import { CORE_IDS, type CoreContext, type CoreId, type OptionInputs, type RankedCompany, type ScreeningCore, type StrategyId } from './types.ts';
import { volatilityCore } from './volatility.ts';

const screeningCores: Record<CoreId, ScreeningCore> = {
  bsm: bsmCore,
  greeks: greeksCore,
  probability: probabilityCore,
  volatility: volatilityCore,
  trend: trendCore,
  liquidity: liquidityCore,
  risk: riskCore,
};

/**
 * Transparent, deterministic demo screening heuristic, not a return forecast.
 * No observed option chain exists in the demo. F0 uses theoretical premium, Greek
 * profile and single-leg risk-neutral probability as proxies, not strategy P&L.
 * Each selected core has equal weight; deselected cores contribute nothing.
 */
export function rankCompanies(universe: readonly Company[], selectedCores: readonly CoreId[], strategy: StrategyId, days: number, rate = .045): RankedCompany[] {
  const chosen = [...new Set(selectedCores)];
  if (!chosen.length || chosen.some(core => !CORE_IDS.includes(core))) throw new RangeError('Selecciona al menos un núcleo F0 válido.');
  if (!['wheel', 'pmcc', 'backspread', 'gamma'].includes(strategy) || !Number.isFinite(days) || days <= 0 || days > 3650) throw new RangeError('Selecciona una estrategia y un plazo de 1 a 3650 días.');
  if (!Number.isFinite(rate)) throw new RangeError('La tasa libre de riesgo debe ser finita.');
  const settings = {
    wheel: { strike: .94, targetIv: .31, targetDays: 35, targetDelta: .28, targetYield: .017, type: 'put' as const, side: 'sell' as const },
    pmcc: { strike: .85, targetIv: .27, targetDays: 60, targetDelta: .80, targetYield: .18, type: 'call' as const, side: 'buy' as const },
    backspread: { strike: 1.05, targetIv: .50, targetDays: 60, targetDelta: .40, targetYield: .035, type: 'call' as const, side: 'buy' as const },
    gamma: { strike: 1, targetIv: .43, targetDays: 14, targetDelta: .52, targetYield: .045, type: 'call' as const, side: 'buy' as const },
  }[strategy];
  return universe.map(company => {
    const input: OptionInputs = { spot: company.price, strike: company.price * settings.strike, days, volatility: company.iv, rate, dividendYield: company.dividendYield, type: settings.type };
    const value = blackScholes(input);
    const terminal = profitMetrics({ ...input, premium: value.price, side: settings.side });
    const context: CoreContext = {
      company, strategy, days, settings, value,
      probabilityOfProfit: terminal.probabilityOfProfit,
      tenor: proximity(days, settings.targetDays, settings.targetDays * 1.5),
      liquidity: clamp(company.liquidity / 100),
      ivFit: proximity(company.iv, settings.targetIv, .20),
    };
    const components = Object.fromEntries(CORE_IDS.map(core => [core, screeningCores[core].score(context)])) as Record<CoreId, number>;
    const score = Math.round(clamp(chosen.reduce((sum, core) => sum + components[core], 0) / chosen.length) * 100);
    const reason = CORE_IDS.filter(core => chosen.includes(core)).map(core => screeningCores[core].reason(context)).join(' · ');
    return { ...company, score, reason };
  }).sort((a, b) => b.score - a.score || b.liquidity - a.liquidity || a.symbol.localeCompare(b.symbol));
}
