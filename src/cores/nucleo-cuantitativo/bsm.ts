import { calculateGreeks } from './greeks.ts';
import { normalCdf } from './math.ts';
import type { OptionInputs, OptionValue } from '../compartido/types.ts';
import { validateOptionInputs } from './validation.ts';

/** European BSM with continuous dividends. Values are per underlying share, not contract. */
export function blackScholes(input: OptionInputs): OptionValue {
  validateOptionInputs(input);
  const { spot: S, strike: K, days, volatility: sigma, rate: r, type } = input;
  const q = input.dividendYield ?? 0;
  const T = days / 365;
  const isCall = type === 'call';
  if (T === 0) {
    const callDelta = S > K ? 1 : S < K ? 0 : 0.5;
    return { price: Math.max(0, isCall ? S - K : K - S), delta: isCall ? callDelta : callDelta - 1, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const dq = Math.exp(-q * T);
  const dr = Math.exp(-r * T);
  if (sigma === 0) {
    const excess = S * dq - K * dr;
    const callWeight = excess > 0 ? 1 : excess < 0 ? 0 : 0.5;
    const weight = isCall ? callWeight : 1 - callWeight;
    return {
      price: Math.max(0, isCall ? excess : -excess),
      delta: (isCall ? weight : -weight) * dq,
      gamma: 0,
      theta: weight * (isCall ? q * S * dq - r * K * dr : r * K * dr - q * S * dq) / 365,
      vega: 0,
      rho: (isCall ? 1 : -1) * weight * K * T * dr / 100,
    };
  }
  const rootT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + sigma * sigma / 2) * T) / (sigma * rootT);
  const d2 = d1 - sigma * rootT;
  const greeks = calculateGreeks(input, { T, dq, dr, rootT, d1, d2 });
  const price = isCall
    ? Math.max(0, S * dq * normalCdf(d1) - K * dr * normalCdf(d2))
    : Math.max(0, K * dr * normalCdf(-d2) - S * dq * normalCdf(-d1));
  return { price, ...greeks };
}
