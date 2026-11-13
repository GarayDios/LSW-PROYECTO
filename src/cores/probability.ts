import { clamp, normalCdf } from './math.ts';
import type { ProfitInputs, ScreeningCore } from './types.ts';
import { validateOptionInputs } from './validation.ts';

/**
 * Single-leg terminal profit probability under the BSM risk-neutral measure.
 * Excludes fees, early exercise, financing of premium, and physical-measure forecasts.
 * An outcome exactly at breakeven is not a profit. Returns probability as 0..1.
 */
export function profitMetrics(input: ProfitInputs): { breakeven: number; probabilityOfProfit: number } {
  validateOptionInputs(input);
  if (!Number.isFinite(input.premium) || input.premium < 0 || !['buy', 'sell'].includes(input.side)) {
    throw new RangeError('La prima debe ser finita y no negativa; el lado debe ser compra o venta.');
  }
  const { spot: S, strike: K, premium, type, side, volatility: sigma, days, rate: r } = input;
  const T = days / 365;
  const q = input.dividendYield ?? 0;
  const breakeven = type === 'call' ? K + premium : K - premium;
  const sign = side === 'buy' ? 1 : -1;
  if (T === 0 || sigma === 0) {
    const terminal = S * Math.exp((r - q) * T);
    const payoff = Math.max(0, type === 'call' ? terminal - K : K - terminal);
    // Decimal prices such as 100.10 - 100 are not exact binary floats. Keep an
    // exactly break-even cent-denominated trade from appearing profitable.
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(terminal), K, premium) * 8;
    return { breakeven, probabilityOfProfit: sign * (payoff - premium) > tolerance ? 1 : 0 };
  }
  // A short option receiving no premium cannot produce a strictly positive payoff.
  if (side === 'sell' && premium === 0) return { breakeven, probabilityOfProfit: 0 };
  if (breakeven <= 0) return { breakeven, probabilityOfProfit: side === 'buy' ? 0 : 1 };
  const d = (Math.log(S / breakeven) + (r - q - sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const longProfit = type === 'call' ? normalCdf(d) : normalCdf(-d);
  return { breakeven, probabilityOfProfit: clamp(side === 'buy' ? longProfit : 1 - longProfit) };
}

export const probabilityCore: ScreeningCore = {
  score: ({ probabilityOfProfit, liquidity, ivFit }) => .5 * probabilityOfProfit + .30 * liquidity + .20 * ivFit,
  reason: ({ probabilityOfProfit }) => `Prob. teórica de la pierna ${(probabilityOfProfit * 100).toFixed(0)}%`,
};
