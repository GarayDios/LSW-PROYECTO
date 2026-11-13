import { clamp, density, normalCdf, proximity } from './math.ts';
import type { OptionInputs, OptionValue, ScreeningCore } from './types.ts';

/** BSM sensitivities for positive time and volatility, per underlying share. */
export function calculateGreeks(input: OptionInputs, terms: {
  T: number; dq: number; dr: number; rootT: number; d1: number; d2: number;
}): Omit<OptionValue, 'price'> {
  const { spot: S, strike: K, volatility: sigma, rate: r, type } = input;
  const q = input.dividendYield ?? 0;
  const { T, dq, dr, rootT, d1, d2 } = terms;
  const gamma = dq * density(d1) / (S * sigma * rootT);
  const vega = S * dq * density(d1) * rootT / 100;
  const diffusion = -S * dq * density(d1) * sigma / (2 * rootT);
  if (type === 'call') {
    return {
      delta: dq * normalCdf(d1), gamma, vega,
      theta: (diffusion - r * K * dr * normalCdf(d2) + q * S * dq * normalCdf(d1)) / 365,
      rho: K * T * dr * normalCdf(d2) / 100,
    };
  }
  return {
    delta: dq * (normalCdf(d1) - 1), gamma, vega,
    theta: (diffusion + r * K * dr * normalCdf(-d2) - q * S * dq * normalCdf(-d1)) / 365,
    rho: -K * T * dr * normalCdf(-d2) / 100,
  };
}

export const greeksCore: ScreeningCore = {
  score({ value, company, settings, strategy, liquidity, tenor }) {
    const deltaFit = proximity(Math.abs(value.delta), settings.targetDelta, .30);
    const scaledGamma = clamp(value.gamma * company.price / 5);
    return .48 * (strategy === 'gamma' ? scaledGamma : deltaFit) + .38 * liquidity + .14 * tenor;
  },
  reason: ({ value, company }) => `Δ ${value.delta.toFixed(2)} · liquidez ${company.liquidity}/100`,
};
