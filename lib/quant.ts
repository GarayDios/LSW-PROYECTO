import type { Company } from './market-data';

export type CoreId = 'bsm' | 'greeks' | 'probability' | 'volatility' | 'trend' | 'liquidity' | 'risk';
export const CORE_IDS: readonly CoreId[] = ['bsm', 'greeks', 'probability', 'volatility', 'trend', 'liquidity', 'risk'];
export type StrategyId = 'wheel' | 'pmcc' | 'backspread' | 'gamma';
export type OptionType = 'call' | 'put';
export interface OptionInputs {
  spot: number;
  strike: number;
  /** Calendar days to expiration. */
  days: number;
  /** Annualized volatility as a decimal, e.g. 0.30. */
  volatility: number;
  /** Continuously compounded annual risk-free rate, as a decimal. */
  rate: number;
  dividendYield?: number;
  type: OptionType;
}
export interface OptionValue {
  price: number;
  delta: number;
  gamma: number;
  /** Price change per calendar day passing. */
  theta: number;
  /** Price change per +1 percentage point of volatility. */
  vega: number;
  /** Price change per +1 percentage point of the interest rate. */
  rho: number;
}

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const density = (x: number) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);

/** Standard normal CDF; absolute approximation error below 8e-8. */
export function normalCdf(x: number): number {
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const tail = density(x) * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return clamp(x >= 0 ? 1 - tail : tail);
}

function validate(input: OptionInputs) {
  const values = [input.spot, input.strike, input.days, input.volatility, input.rate, input.dividendYield ?? 0];
  if (!values.every(Number.isFinite) || input.spot <= 0 || input.strike <= 0 || input.days < 0 || input.volatility < 0 || !['call', 'put'].includes(input.type)) {
    throw new RangeError('Revisa precio, strike, días, volatilidad y tasa: deben ser valores finitos y válidos.');
  }
}

/** European BSM with continuous dividends. Values are per underlying share, not contract. */
export function blackScholes(input: OptionInputs): OptionValue {
  validate(input);
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
  const gamma = dq * density(d1) / (S * sigma * rootT);
  const vega = S * dq * density(d1) * rootT / 100;
  const diffusion = -S * dq * density(d1) * sigma / (2 * rootT);
  if (isCall) {
    return {
      price: Math.max(0, S * dq * normalCdf(d1) - K * dr * normalCdf(d2)),
      delta: dq * normalCdf(d1), gamma, vega,
      theta: (diffusion - r * K * dr * normalCdf(d2) + q * S * dq * normalCdf(d1)) / 365,
      rho: K * T * dr * normalCdf(d2) / 100,
    };
  }
  return {
    price: Math.max(0, K * dr * normalCdf(-d2) - S * dq * normalCdf(-d1)),
    delta: dq * (normalCdf(d1) - 1), gamma, vega,
    theta: (diffusion + r * K * dr * normalCdf(-d2) - q * S * dq * normalCdf(-d1)) / 365,
    rho: -K * T * dr * normalCdf(-d2) / 100,
  };
}

export interface ProfitInputs extends OptionInputs { premium: number; side: 'buy' | 'sell' }

/**
 * Single-leg terminal profit probability under the BSM risk-neutral measure.
 * Excludes fees, early exercise, financing of premium, and physical-measure forecasts.
 * An outcome exactly at breakeven is not a profit. Returns probability as 0..1.
 */
export function profitMetrics(input: ProfitInputs): { breakeven: number; probabilityOfProfit: number } {
  validate(input);
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

export type RankedCompany = Company & { score: number; reason: string };

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
  const proximity = (value: number, target: number, tolerance: number) => Math.exp(-Math.abs(value - target) / tolerance);
  return universe.map(company => {
    const input: OptionInputs = { spot: company.price, strike: company.price * settings.strike, days, volatility: company.iv, rate, dividendYield: company.dividendYield, type: settings.type };
    const value = blackScholes(input);
    const terminal = profitMetrics({ ...input, premium: value.price, side: settings.side });
    const tenor = proximity(days, settings.targetDays, settings.targetDays * 1.5);
    const liquidity = clamp(company.liquidity / 100);
    const ivFit = proximity(company.iv, settings.targetIv, .20);
    const premiumFit = proximity(value.price / company.price, settings.targetYield * Math.sqrt(days / settings.targetDays), .06);
    const deltaFit = proximity(Math.abs(value.delta), settings.targetDelta, .30);
    const scaledGamma = clamp(value.gamma * company.price / 5);
    const components: Record<CoreId, number> = {
      bsm: .46 * premiumFit + .34 * ivFit + .20 * tenor,
      greeks: .48 * (strategy === 'gamma' ? scaledGamma : deltaFit) + .38 * liquidity + .14 * tenor,
      probability: .5 * terminal.probabilityOfProfit + .30 * liquidity + .20 * ivFit,
      volatility: .8 * ivFit + .2 * tenor,
      // Daily sample change is a proxy, not a measured historical trend.
      trend: .8 * proximity(company.change, strategy === 'backspread' ? 2.5 : strategy === 'gamma' ? 0 : 1, 2.5) + .2 * tenor,
      liquidity: .65 * liquidity + .25 * clamp(company.volume / 250000) + .10 * tenor,
      // Relative spot exposure over the tenor; not broker margin or strategy VaR.
      risk: .6 / (1 + company.iv * Math.sqrt(days / 365) * 4) + .25 * liquidity + .15 * tenor,
    };
    const score = Math.round(clamp(chosen.reduce((sum, core) => sum + components[core], 0) / chosen.length) * 100);
    const reasonParts: string[] = [];
    if (chosen.includes('bsm')) reasonParts.push(`IV ${(company.iv * 100).toFixed(0)}% · prima BSM ${(value.price / company.price * 100).toFixed(1)}%`);
    if (chosen.includes('greeks')) reasonParts.push(`Δ ${value.delta.toFixed(2)} · liquidez ${company.liquidity}/100`);
    if (chosen.includes('probability')) reasonParts.push(`Prob. teórica de la pierna ${(terminal.probabilityOfProfit * 100).toFixed(0)}%`);
    if (chosen.includes('volatility')) reasonParts.push(`Volatilidad IV ${(company.iv * 100).toFixed(1)}%, objetivo ${(settings.targetIv * 100).toFixed(0)}%`);
    if (chosen.includes('trend')) reasonParts.push(`Tendencia proxy: cambio demo ${company.change.toFixed(2)}%`);
    if (chosen.includes('liquidity')) reasonParts.push(`Liquidez demo ${company.liquidity}/100, volumen ${company.volume}`);
    if (chosen.includes('risk')) reasonParts.push(`Riesgo: movimiento 1σ ${(company.iv * Math.sqrt(days / 365) * 100).toFixed(1)}% a ${days} días`);
    return { ...company, score, reason: reasonParts.join(' · ') };
  }).sort((a, b) => b.score - a.score || b.liquidity - a.liquidity || a.symbol.localeCompare(b.symbol));
}
