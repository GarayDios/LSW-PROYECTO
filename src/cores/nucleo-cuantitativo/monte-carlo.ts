import { blackScholes } from './bsm.ts';
import type { OptionType } from '../compartido/types.ts';

export type MonteCarloLeg = {
  type: OptionType; strike: number; quantity: number;
  /** Shares delivered by one contract; premium is USD per delivered share. */
  units: number; premium: number;
  /** Optional diagonal maturity, measured from the initial valuation cutoff. */
  daysToExpiry?: number;
  /** Frozen mark volatility for this leg; the underlying still has one sigma. */
  volatility?: number;
};
export type MonteCarloRequest = {
  spot: number; days: number; volatility: number; rate: number; dividendYield: number;
  legs: MonteCarloLeg[]; paths: number; steps: number; seed: number;
  mode: 'terminal' | 'delta-hedged'; feePerContract: number;
  hedgeFeePerShare: number; hedgeSpreadBps: number; stockBorrowRate: number;
};
export type MonteCarloSummary = {
  mean: number; standardError: number; meanInterval95: [number, number];
  probabilityOfProfit: number; probabilityOfLoss: number; profitInterval95: [number, number];
  p05: number; median: number; p95: number; lossVaR95: number; expectedShortfall95: number;
};
export type MonteCarloResult = {
  model: 'risk-neutral-gbm'; paths: number; steps: number; seed: number;
  initialDebit: number; bsmValue: number;
  fairValue: { mean: number; standardError: number; interval95: [number, number] };
  pnl: MonteCarloSummary; unhedgedPnl: MonteCarloSummary;
  meanHedgeCosts: number; meanHedgeTrades: number; drawdownP95: number | null;
  fan: { day: number; p05: number; median: number; p95: number }[];
  samplePaths: number[][];
  histogram: { from: number; to: number; count: number }[];
};

/** Bounded work also protects the browser worker from oversized requests. */
export function validateMonteCarlo(request: MonteCarloRequest): void {
  const bounded = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;
  if (!bounded(request.spot, 1e-8, 1e7) || !bounded(request.days, 0, 3650)
    || !bounded(request.volatility, 0, 3) || !bounded(request.rate, -.2, 1)
    || !bounded(request.dividendYield, 0, 1)
    || !['terminal', 'delta-hedged'].includes(request.mode)) {
    throw new RangeError('Revisa precio, plazo, volatilidad, tasa, dividendos y modo de simulación.');
  }
  if (!Number.isInteger(request.paths) || !bounded(request.paths, 100, 50000)
    || !Number.isInteger(request.steps) || !bounded(request.steps, 1, 128)
    || !Number.isInteger(request.seed) || !bounded(request.seed, 0, 0xffffffff)) {
    throw new RangeError('Usa 100–50000 trayectorias, 1–128 pasos y una semilla entera entre 0 y 4294967295.');
  }
  if (!Array.isArray(request.legs) || request.legs.length < 1 || request.legs.length > 8
    || request.legs.some(leg => !['call', 'put'].includes(leg.type)
      || !bounded(leg.strike, 1e-8, 1e7) || !Number.isInteger(leg.quantity)
      || leg.quantity === 0 || Math.abs(leg.quantity) > 100
      || !Number.isInteger(leg.units) || !bounded(leg.units, 1, 10000)
      || !bounded(leg.premium, 0, 1e7)
      || (leg.daysToExpiry !== undefined && !bounded(leg.daysToExpiry, request.days, 7300))
      || (leg.volatility !== undefined && !bounded(leg.volatility, 0, 3)))) {
    throw new RangeError('Se requieren piernas válidas con cantidades enteras, entregables y primas explícitas.');
  }
  if (request.paths * request.steps * request.legs.length > 2_000_000) {
    throw new RangeError('Reduce trayectorias o pasos: la simulación supera el límite de trabajo.');
  }
  if (!bounded(request.feePerContract, 0, 100) || !bounded(request.hedgeFeePerShare, 0, 10)
    || !bounded(request.hedgeSpreadBps, 0, 1000) || !bounded(request.stockBorrowRate, 0, 1)) {
    throw new RangeError('Las comisiones, el spread y el préstamo de acciones deben ser válidos y no negativos.');
  }
}

/** Mulberry32 + Box–Muller; no global random state and identical results for a seed. */
function normalGenerator(seed: number): () => number {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return (((value ^ (value >>> 14)) >>> 0) + .5) / 4294967296;
  };
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const value = spare; spare = null; return value; }
    const radius = Math.sqrt(-2 * Math.log(uniform())), angle = 2 * Math.PI * uniform();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

function moments(values: readonly number[]) {
  let mean = 0, m2 = 0;
  for (let i = 0; i < values.length; i++) {
    const delta = values[i] - mean;
    mean += delta / (i + 1);
    m2 += delta * (values[i] - mean);
  }
  const standardError = Math.sqrt(Math.max(0, m2) / (values.length - 1) / values.length);
  return { mean, standardError, interval95: [mean - 1.959963984540054 * standardError, mean + 1.959963984540054 * standardError] as [number, number] };
}

/** Linear interpolation on a sorted empirical distribution. */
function quantile(sorted: readonly number[], p: number): number {
  const at = (sorted.length - 1) * p, lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

function summarize(values: readonly number[]): MonteCarloSummary {
  const stats = moments(values), sorted = [...values].sort((a, b) => a - b);
  const wins = values.filter(value => value > 0).length, p = wins / values.length;
  const z = 1.959963984540054, denominator = 1 + z * z / values.length;
  const center = (p + z * z / (2 * values.length)) / denominator;
  const width = z * Math.sqrt(p * (1 - p) / values.length + z * z / (4 * values.length ** 2)) / denominator;
  const tail = sorted.slice(0, Math.ceil(sorted.length * .05));
  return {
    mean: stats.mean, standardError: stats.standardError, meanInterval95: stats.interval95,
    probabilityOfProfit: p, probabilityOfLoss: values.filter(value => value < 0).length / values.length,
    profitInterval95: [Math.max(0, center - width), Math.min(1, center + width)],
    p05: quantile(sorted, .05), median: quantile(sorted, .5), p95: quantile(sorted, .95),
    lossVaR95: Math.max(0, -quantile(sorted, .05)),
    expectedShortfall95: Math.max(0, -tail.reduce((sum, value) => sum + value, 0) / tail.length),
  };
}

/** Exact GBM transitions under Q: exp((r-q-σ²/2)dt + σ√dt Z).
 * All legs share one underlying. Diagonals are valued at the first expiry:
 * surviving legs retain their own remaining maturity and frozen mark IV.
 * European cash payoff only; no assignment, early exercise or discrete dividends.
 * Cash earns/pays r, stock pays continuous q (left-step approximation).
 * Delta hedges use whole shares, unrestricted financing/shorts and explicit costs.
 * Intervals measure sampling error under this model, not real-world forecast error.
 */
export function simulateMonteCarlo(request: MonteCarloRequest): MonteCarloResult {
  validateMonteCarlo(request);
  const { spot, days, volatility, rate, dividendYield, paths, steps, legs } = request;
  const T = days / 365, dt = T / steps, drift = (rate - dividendYield - volatility ** 2 / 2) * dt;
  const diffusion = volatility * Math.sqrt(dt), accrual = Math.exp(rate * dt), normal = normalGenerator(request.seed);
  const hedged = request.mode === 'delta-hedged';
  const initialDebit = legs.reduce((sum, leg) => sum + leg.quantity * leg.units * leg.premium
    + Math.abs(leg.quantity) * request.feePerContract, 0);
  const model = (price: number, elapsed: number) => {
    let value = 0, delta = 0;
    for (const leg of legs) {
      const result = blackScholes({ spot: price, strike: leg.strike, days: Math.max(0, (leg.daysToExpiry ?? days) - elapsed), volatility: leg.volatility ?? volatility, rate, dividendYield, type: leg.type });
      value += leg.quantity * leg.units * result.price;
      delta += leg.quantity * leg.units * result.delta;
    }
    return { value, delta };
  };
  const initial = model(spot, 0), pnl: number[] = [], unhedged: number[] = [], payoffs: number[] = [], drawdowns: number[] = [];
  const checkpoints = [...new Set(Array.from({ length: Math.min(steps, 32) + 1 }, (_, i) => Math.round(i * steps / Math.min(steps, 32))))];
  const checkpointIndex = new Map(checkpoints.map((step, i) => [step, i]));
  const buckets = checkpoints.map(() => [] as number[]), samplePaths: number[][] = [];
  let totalCosts = 0, totalTrades = 0;
  for (let path = 0; path < paths; path++) {
    let price = spot, cash = -initialDebit, shares = 0, costs = 0, trades = 0;
    let peak = initial.value - initialDebit, drawdown = 0;
    const sample: number[] | null = path < 12 ? [spot] : null;
    const trade = (desired: number) => {
      const change = desired - shares;
      if (!change) return;
      const cost = Math.abs(change) * (request.hedgeFeePerShare + price * request.hedgeSpreadBps / 20000);
      cash -= change * price + cost; shares = desired; costs += cost; trades++;
    };
    if (hedged && T > 0) trade(Math.round(-initial.delta));
    drawdown = Math.max(0, peak - (initial.value + cash + shares * price));
    buckets[0].push(spot);
    for (let step = 1; step <= steps; step++) {
      // Finance signed cash; receive/pay stock dividends and short-stock borrow.
      cash = cash * accrual + shares * price * dividendYield * dt;
      const borrow = Math.max(0, -shares) * price * request.stockBorrowRate * dt;
      cash -= borrow; costs += borrow;
      price *= Math.exp(drift + diffusion * normal());
      if (!Number.isFinite(price) || price <= 0) throw new RangeError('Trayectoria fuera del rango numérico; reduce volatilidad o plazo.');
      if (hedged) {
        const mark = model(price, days * step / steps);
        trade(step === steps ? 0 : Math.round(-mark.delta));
        const equity = cash + shares * price + mark.value;
        peak = Math.max(peak, equity); drawdown = Math.max(drawdown, peak - equity);
      }
      const bucket = checkpointIndex.get(step);
      if (bucket !== undefined) buckets[bucket].push(price);
      sample?.push(price);
    }
    const payoff = model(price, days).value;
    // Decimal premiums/strikes must not turn exact breakeven into fictitious wins.
    const exposureScale = legs.reduce((sum, leg) => sum + Math.abs(leg.quantity) * leg.units * Math.max(leg.strike, price), 0);
    const tolerance = Number.EPSILON * Math.max(1, exposureScale, Math.abs(payoff), Math.abs(initialDebit * Math.exp(rate * T))) * 16;
    const baselineRaw = payoff - initialDebit * Math.exp(rate * T);
    const baseline = Math.abs(baselineRaw) <= tolerance ? 0 : baselineRaw;
    const outcomeRaw = hedged ? cash + payoff : baseline;
    const outcome = Math.abs(outcomeRaw) <= tolerance ? 0 : outcomeRaw;
    if (![outcome, baseline, payoff, costs, drawdown].every(Number.isFinite)) throw new RangeError('Resultado no finito; revisa las entradas del escenario.');
    pnl.push(outcome); unhedged.push(baseline); payoffs.push(Math.exp(-rate * T) * payoff);
    drawdowns.push(drawdown); totalCosts += costs; totalTrades += trades;
    if (sample) samplePaths.push(sample);
  }
  const fairValue = moments(payoffs), sorted = [...pnl].sort((a, b) => a - b);
  const lo = sorted[0], hi = sorted.at(-1)!, width = hi === lo ? 1 : (hi - lo) / 24;
  const histogram = Array.from({ length: hi === lo ? 1 : 24 }, (_, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count: 0 }));
  for (const value of pnl) histogram[Math.min(histogram.length - 1, Math.floor((value - lo) / width))].count++;
  return {
    model: 'risk-neutral-gbm', paths, steps, seed: request.seed, initialDebit, bsmValue: initial.value, fairValue,
    pnl: summarize(pnl), unhedgedPnl: summarize(unhedged), meanHedgeCosts: totalCosts / paths,
    meanHedgeTrades: totalTrades / paths, drawdownP95: hedged ? quantile(drawdowns.sort((a, b) => a - b), .95) : null,
    fan: buckets.map((bucket, i) => { bucket.sort((a, b) => a - b); return { day: days * checkpoints[i] / steps, p05: quantile(bucket, .05), median: quantile(bucket, .5), p95: quantile(bucket, .95) }; }),
    samplePaths, histogram,
  };
}
