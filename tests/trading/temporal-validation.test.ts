import test from 'node:test';
import assert from 'node:assert/strict';
import { walkForwardValidation, wilsonInterval } from '../../src/cores/05-indicadores-y-senales/validation.ts';
import type { Candle } from '../../src/features/market/chart-history.ts';

const bars: Candle[] = Array.from({ length: 1000 }, (_, i) => {
  const close = 100 + Math.sin(i / 22) * 12 + Math.sin(i * 1.7) * 3;
  return { time: Date.UTC(2020, 0, 1) + i * 86400000, open: close, close, high: close + 1, low: close - 1, volume: 1000 };
});
test('Wilson interval preserves uncertainty even with no losses and handles an empty sample', () => {
  assert.equal(wilsonInterval(0, 0), null);
  const ten = wilsonInterval(10, 10)!;
  assert.ok(ten.low < .8 && ten.high <= 1 && ten.high > .99);
  const a = wilsonInterval(5, 10)!, b = wilsonInterval(50, 100)!;
  assert.ok(a.low < b.low && a.high > b.high);
  assert.throws(() => wilsonInterval(2, 1), RangeError);
});
test('expanding validation blocks never overlap and reject future bars at the declared cutoff', () => {
  const result = walkForwardValidation(bars, { asOf: bars[799].time });
  assert.deepEqual(result, walkForwardValidation(bars.slice(0, 800)));
  assert.ok(result.folds.length >= 5);
  for (let i = 0; i < result.folds.length; i++) {
    const fold = result.folds[i];
    assert.equal(fold.startTime, bars[fold.contextBars].time);
    assert.ok(fold.endTime <= bars[799].time);
    if (i) assert.ok(fold.startTime > result.folds[i - 1].endTime);
  }
});
test('validation flags a small sample and execution costs lower strategy and benchmark results', () => {
  const free = walkForwardValidation(bars, { testBars: 250, feeBps: 0, slippageBps: 0 });
  const charged = walkForwardValidation(bars, { testBars: 250, feeBps: 20, slippageBps: 10 });
  assert.ok(free.completedTrades > 0);
  assert.equal(charged.sufficientSample, false);
  assert.ok(charged.folds.every((fold, i) => fold.returnPct < free.folds[i].returnPct && fold.buyHoldReturnPct < free.folds[i].buyHoldReturnPct));
  assert.equal(walkForwardValidation(bars.slice(0, 49)).folds.length, 0);
  assert.throws(() => walkForwardValidation(bars, { testBars: 1 }), RangeError);
});
