import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateMonteCarlo, validateMonteCarlo, type MonteCarloRequest } from '../../src/cores/nucleo-cuantitativo/monte-carlo.ts';
import { blackScholes } from '../../src/cores/nucleo-cuantitativo/bsm.ts';
import { profitMetrics } from '../../src/cores/nucleo-cuantitativo/probability.ts';

const base: MonteCarloRequest = { spot: 100, days: 365, volatility: .2, rate: .05, dividendYield: 0,
  legs: [{ type: 'call', strike: 100, quantity: 1, units: 1, premium: 10 }],
  paths: 10000, steps: 1, seed: 42, mode: 'terminal', feePerContract: 0,
  hedgeFeePerShare: 0, hedgeSpreadBps: 0, stockBorrowRate: 0 };
const optionInput = (r: MonteCarloRequest) => ({ spot: r.spot, days: r.days, volatility: r.volatility, rate: r.rate,
  dividendYield: r.dividendYield, type: r.legs[0].type, strike: r.legs[0].strike });

test('Monte Carlo prices calls and puts consistently with BSM, dividends and negative rates', () => {
  for (const type of ['call', 'put'] as const) for (const rate of [-.02, .05]) {
    const request = { ...base, rate, dividendYield: .03, paths: 40000, legs: [{ ...base.legs[0], type }] };
    const result = simulateMonteCarlo(request), exact = blackScholes(optionInput(request)).price;
    assert.ok(Math.abs(result.fairValue.mean - exact) < 4 * result.fairValue.standardError, `${type}: MC ${result.fairValue.mean} vs BSM ${exact}`);
    assert.equal(result.bsmValue, exact);
  }
});

test('simulated profit probability matches the analytical funded breakeven for long/short calls and puts', () => {
  for (const type of ['call', 'put'] as const) for (const quantity of [1, -1]) {
    const request = { ...base, paths: 40000, feePerContract: .2, legs: [{ ...base.legs[0], type, quantity }] };
    const result = simulateMonteCarlo(request);
    const premium = (10 + quantity * .2) * Math.exp(request.rate * request.days / 365);
    const analytical = profitMetrics({ ...optionInput(request), premium, side: quantity > 0 ? 'buy' : 'sell' }).probabilityOfProfit;
    assert.ok(Math.abs(result.pnl.probabilityOfProfit - analytical) < .012);
    assert.equal(result.histogram.reduce((sum, bin) => sum + bin.count, 0), request.paths);
    assert.ok(result.pnl.p05 <= result.pnl.median && result.pnl.median <= result.pnl.p95);
  }
});

test('same seed reproduces all paths and summaries, and a new seed changes the experiment', () => {
  const request = { ...base, paths: 1000, steps: 12, seed: 0 };
  const first = simulateMonteCarlo(request);
  assert.deepEqual(simulateMonteCarlo(request), first);
  assert.notDeepEqual(simulateMonteCarlo({ ...request, seed: 1 }).samplePaths, first.samplePaths);
  assert.ok(first.samplePaths.every(path => path.length === 13 && path[0] === 100));
  assert.equal(first.fan[0].median, 100); assert.equal(first.fan.at(-1)!.day, 365);
});

test('portfolio uses one shared underlying: opposite legs cancel and ratios/deliverables scale exactly', () => {
  const cancelled = simulateMonteCarlo({ ...base, feePerContract: .65, legs: [base.legs[0], { ...base.legs[0], quantity: -1 }] });
  assert.equal(cancelled.bsmValue, 0); assert.equal(cancelled.fairValue.mean, 0);
  assert.equal(cancelled.fairValue.standardError, 0);
  assert.ok(Math.abs(cancelled.pnl.mean + 1.3 * Math.exp(.05)) < 1e-12);
  assert.equal(cancelled.pnl.probabilityOfLoss, 1);
  const single = simulateMonteCarlo(base);
  const scaled = simulateMonteCarlo({ ...base, legs: [{ ...base.legs[0], quantity: 2, units: 150 }] });
  assert.ok(Math.abs(scaled.pnl.mean - single.pnl.mean * 300) < 1e-9);
  assert.ok(Math.abs(scaled.fairValue.mean - single.fairValue.mean * 300) < 1e-9);
});

test('expiry and zero volatility give deterministic finite outcomes including negative rates', () => {
  const expiry = simulateMonteCarlo({ ...base, days: 0, spot: 110 });
  assert.equal(expiry.pnl.mean, 0); assert.equal(expiry.pnl.probabilityOfProfit, 0); assert.equal(expiry.pnl.probabilityOfLoss, 0);
  assert.equal(expiry.fairValue.mean, 10); assert.equal(expiry.pnl.standardError, 0);
  const decimalBreakeven = simulateMonteCarlo({ ...base, days: 0, spot: 100.1, legs: [{ ...base.legs[0], premium: .1 }] });
  assert.equal(decimalBreakeven.pnl.probabilityOfProfit, 0); assert.equal(decimalBreakeven.pnl.probabilityOfLoss, 0);
  const deterministic = simulateMonteCarlo({ ...base, volatility: 0, rate: -.01, spot: 120, steps: 8, mode: 'delta-hedged' });
  assert.ok(deterministic.pnl.standardError < 1e-10);
  assert.equal(deterministic.pnl.probabilityOfProfit, 1);
  assert.ok(deterministic.drawdownP95! >= 0);
});

test('integer-share delta hedging reduces straddle PnL variance and charges actual turnover', () => {
  const call = { ...base.legs[0], units: 100 }, put = { ...call, type: 'put' as const };
  const request: MonteCarloRequest = { ...base, days: 30, paths: 3000, steps: 64, mode: 'delta-hedged', legs: [call, put] };
  const free = simulateMonteCarlo(request);
  assert.ok(free.pnl.standardError < free.unhedgedPnl.standardError * .4);
  assert.ok(free.meanHedgeTrades > 2);
  const costly = simulateMonteCarlo({ ...request, hedgeFeePerShare: .01, hedgeSpreadBps: 10, stockBorrowRate: .05 });
  assert.ok(costly.meanHedgeCosts > 0);
  assert.ok(costly.pnl.mean < free.pnl.mean);
  assert.deepEqual(costly.unhedgedPnl, free.unhedgedPnl);
  assert.deepEqual(costly.samplePaths, free.samplePaths);
  assert.ok(costly.drawdownP95! > 0);
});

test('rejects invalid numbers, empty positions, malformed legs and oversized work', () => {
  for (const patch of [
    { spot: NaN }, { volatility: Infinity }, { dividendYield: -1 }, { paths: 0 }, { paths: 100.5 }, { paths: 50001 },
    { steps: 0 }, { seed: -1 }, { seed: 2 ** 32 }, { rate: 2 }, { days: -1 }, { hedgeFeePerShare: -1 },
    { hedgeSpreadBps: NaN }, { stockBorrowRate: -1 }, { legs: [] }, { paths: 50000, steps: 128 },
    { legs: [{ ...base.legs[0], units: 0 }] }, { legs: [{ ...base.legs[0], premium: -1 }] },
    { legs: [{ ...base.legs[0], quantity: .5 }] },
  ]) assert.throws(() => validateMonteCarlo({ ...base, ...patch }), RangeError);
});
