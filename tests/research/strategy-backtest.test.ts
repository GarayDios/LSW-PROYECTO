import test from 'node:test';
import assert from 'node:assert/strict';
import { backtestStrategy, strategyBacktestTerms, type StrategyBacktestInput } from '../../src/cores/evaluacion/strategy-backtest.ts';
import { blackScholes } from '../../src/cores/nucleo-cuantitativo/bsm.ts';
import type { Candle } from '../../src/features/market/chart-history.ts';

function fixture(length = 240): Candle[] {
  const bars: Candle[] = [];
  for (let time = Date.parse('2024-01-02T15:00:00Z'); bars.length < length; time += 86400000) {
    if ([0, 6].includes(new Date(time).getUTCDay())) continue;
    const index = bars.length, close = 100 + 4 * Math.sin(index * .7) + index * .01, open = close + Math.sin(index * .3);
    bars.push({ time, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, volume: 10000 });
  }
  return bars;
}
const date = (time: number) => new Date(time).toISOString().slice(0, 10);
function input(strategy: StrategyBacktestInput['strategy'], overrides: Partial<StrategyBacktestInput> = {}): StrategyBacktestInput {
  const bars = fixture();
  return { strategy, bars, from: date(bars[70].time), to: date(bars[210].time), capital: 100000, contracts: 1, days: 14, longDays: 90,
    ...strategyBacktestTerms(strategy), feePerContract: .65, feePerShare: .005, slippageBps: 5, rate: .04, dividendYield: 0, ...overrides };
}
const close = (actual: number, expected: number, tolerance = .001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('selected strategy builds its own option structure and produces a distinct historical result', () => {
  const outcomes = [];
  for (const strategy of ['wheel', 'pmcc', 'backspread', 'gamma'] as const) {
    const result = backtestStrategy(input(strategy));
    assert.equal(result.strategy, strategy); assert.ok(result.trades.length > 0, strategy);
    const legs = result.trades[0].legs;
    if (strategy === 'wheel') assert.deepEqual([legs[0].type, legs[0].quantity], ['put', -1]);
    if (strategy === 'pmcc') { assert.deepEqual(legs.slice(0, 2).map(leg => [leg.type, leg.quantity]), [['call', 1], ['call', -1]]); assert.ok(legs[0].expiry > legs[1].expiry); }
    if (strategy === 'backspread') assert.deepEqual(legs.slice(0, 2).map(leg => [leg.type, leg.quantity]), [['call', -1], ['call', 2]]);
    if (strategy === 'gamma') { assert.deepEqual(legs.slice(0, 2).map(leg => [leg.type, leg.quantity]), [['call', 1], ['put', 1]]); assert.ok(result.operations.some(op => op.kind === 'hedge')); }
    outcomes.push(result.finalEquity);
  }
  assert.equal(new Set(outcomes).size, 4);
});

test('daily snapshots reconcile cash, shares and options and the final liquidation reconciles cycles and ledger', () => {
  const bars = fixture();
  for (const strategy of ['wheel', 'pmcc', 'backspread', 'gamma'] as const) {
    const result = backtestStrategy(input(strategy));
    for (const point of result.snapshots) {
      const bar = bars.find(bar => bar.time === point.time)!;
      close(point.equity, point.cash + point.shares * bar.close + point.optionsValue);
    }
    close(result.initialCapital + result.operations.reduce((sum, op) => sum + op.cashFlow, 0), result.finalEquity);
    close(result.initialCapital + result.trades.reduce((sum, trade) => sum + trade.netPnl, 0), result.finalEquity);
    close(result.totalFees, result.operations.reduce((sum, op) => sum + op.fee, 0));
    assert.deepEqual(result.snapshots.at(-1)!.legs, []); assert.equal(result.snapshots.at(-1)!.shares, 0);
    assert.equal(result.equityCurve.at(-1)!.equity, result.finalEquity);
    assert.equal(result.maxDrawdownPct, Math.max(...result.equityCurve.map(row => row.drawdownPct)));
  }
});

test('Wheel receives assigned stock before selling a covered call and delivers those shares at its strike', () => {
  const bars = fixture(170);
  for (let index = 70; index < bars.length; index++) {
    const close = index === 70 ? 100 : index < 87 ? 80 : 110;
    bars[index] = { ...bars[index], open: close, close, high: close + 1, low: close - 1 };
  }
  const result = backtestStrategy(input('wheel', { bars, to: date(bars[140].time) }));
  const receive = result.operations.find(op => op.kind === 'assignment' && op.quantity === 100)!;
  assert.ok(receive);
  const call = result.operations.find(op => op.kind === 'option-open' && op.cycle === receive.cycle && op.detail.includes('CALL'))!;
  assert.ok(call.time > receive.time);
  assert.ok(result.operations.some(op => op.kind === 'assignment' && op.quantity === -100 && op.cycle === receive.cycle));
  assert.ok(result.snapshots.some(point => point.shares === 100 && point.legs.every(leg => leg.type === 'call')));
});

test('PMCC renews short calls while preserving the original long until there is insufficient remaining term', () => {
  const result = backtestStrategy(input('pmcc', { days: 7, longDays: 60, shortPercent: 102 }));
  const first = result.trades[0];
  const long = first.legs[0], shorts = first.legs.filter(leg => leg.quantity < 0);
  assert.ok(shorts.length > 2);
  assert.ok(shorts.every(leg => leg.expiry < long.expiry));
  assert.ok(result.operations.some(op => op.kind === 'settlement' && op.cycle === first.id));
});

test('Gamma hedge targets use the prior close and fill at the next open with share costs', () => {
  const args = input('gamma'), result = backtestStrategy(args);
  const entry = result.trades[0].entryTime;
  const hedge = result.operations.find(op => op.kind === 'hedge' && op.time > entry)!;
  assert.ok(hedge);
  const index = args.bars.findIndex(bar => bar.time === hedge.time), previous = result.snapshots.find(point => point.time === args.bars[index - 1].time)!;
  const desired = Math.round(-previous.legs.reduce((sum, leg) => sum + leg.quantity * 100 * blackScholes({ spot: args.bars[index - 1].close, strike: leg.strike, days: leg.remainingDays, volatility: leg.volatility, rate: args.rate, dividendYield: args.dividendYield, type: leg.type }).delta, 0));
  assert.equal(hedge.quantity, desired - previous.shares);
  close(hedge.price, args.bars[index].open * (1 + Math.sign(hedge.quantity) * args.slippageBps / 10000));
  close(hedge.fee, Math.abs(hedge.quantity) * args.feePerShare);
});

test('future changes cannot alter historical entries, marks or hedges before that date', () => {
  for (const strategy of ['wheel', 'pmcc', 'backspread', 'gamma'] as const) {
    const args = input(strategy), cutoff = args.bars[130].time;
    const changed = args.bars.map(bar => bar.time <= cutoff ? bar : { ...bar, open: 500, close: 501, low: 499, high: 502 });
    const before = backtestStrategy(args), after = backtestStrategy({ ...args, bars: changed });
    assert.deepEqual(before.snapshots.filter(point => point.time <= cutoff), after.snapshots.filter(point => point.time <= cutoff));
    assert.deepEqual(before.operations.filter(op => op.time <= cutoff), after.operations.filter(op => op.time <= cutoff));
  }
});

test('insufficient capital skips actual entries, and invalid terms do not silently substitute stock rules', () => {
  for (const strategy of ['wheel', 'pmcc', 'backspread', 'gamma'] as const) {
    const result = backtestStrategy(input(strategy, { capital: 1 }));
    assert.equal(result.trades.length, 0); assert.equal(result.operations.length, 0); assert.equal(result.finalEquity, 1); assert.ok(result.skipped.length > 0);
  }
  assert.throws(() => backtestStrategy(input('pmcc', { longDays: 5 })), /PMCC/);
  assert.throws(() => backtestStrategy(input('backspread', { longPercent: 90 })), /Backspread/);
  assert.throws(() => backtestStrategy(input('wheel', { contracts: 1.5 })));
  assert.throws(() => backtestStrategy(input('wheel', { from: '2024-02-30' })), /Fechas/);
  const args = input('gamma');
  assert.throws(() => backtestStrategy({ ...args, bars: [args.bars[0], ...args.bars] }), /diaria/);
  assert.throws(() => backtestStrategy({ ...args, from: date(args.bars[10].time) }), /31/);
});

test('execution costs lower the result for the same option structure and no future sessions gives an explicit error', () => {
  const args = input('backspread');
  const withCosts = backtestStrategy(args), free = backtestStrategy({ ...args, feePerContract: 0, feePerShare: 0, slippageBps: 0 });
  assert.ok(free.finalEquity > withCosts.finalEquity);
  const bars = fixture();
  assert.throws(() => backtestStrategy(input('wheel', { bars, from: date(bars.at(-1)!.time), to: date(bars.at(-1)!.time) })), /dos sesiones/);
});
