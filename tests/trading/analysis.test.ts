import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHistory } from '../../src/cores/05-indicadores-y-senales/signals.ts';
import type { Candle } from '../../src/features/market/chart-history.ts';

function history(count = 1000): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + Math.sin(i / 22) * 12 + Math.sin(i * 1.7) * 3;
    const open = close * (1 + .002 * Math.sin(i));
    return { time: Date.UTC(2023, 0, 1) + i * 86400000, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, volume: 1000 };
  });
}
test('signals are causal: appending future prices cannot change any earlier indicator or action', () => {
  const bars = history();
  const prefix = analyzeHistory(bars.slice(0, 300));
  const full = analyzeHistory(bars);
  assert.deepEqual(full.indicators.slice(0, 300), prefix.indicators);
  assert.deepEqual(full.signals.filter(signal => signal.time <= bars[299].time), prefix.signals);
  assert.deepEqual(analyzeHistory(bars, { asOf: bars[299].time }), prefix);
});
test('a signal needs the full SMA50 warmup and a new cross, rather than repeated trend entries', () => {
  const bars = history(350);
  const result = analyzeHistory(bars);
  assert.equal(analyzeHistory(bars.slice(0, 49)).latest, null);
  const buys = result.signals.filter(signal => signal.action === 'buy');
  assert.ok(buys.length >= 1);
  for (const signal of buys) {
    const i = result.indicators.findIndex(indicator => indicator.time === signal.time);
    const prior = result.indicators[i - 1];
    assert.ok(prior.smaFast! <= prior.smaSlow! && signal.smaFast > signal.smaSlow);
    assert.ok(signal.rsi <= 70);
    assert.equal(result.signals.find(value => value.time === bars[bars.findIndex(bar => bar.time === signal.time) + 1]?.time)?.action, 'hold');
  }
});
test('backtest only trades in the chronological validation segment and executes after the signal', () => {
  const bars = history();
  const result = analyzeHistory(bars, { feeBps: 0, slippageBps: 0 });
  assert.equal(result.validationStartTime, bars[700].time);
  assert.ok(result.backtest.completedTrades > 0);
  for (const trade of result.backtest.trades) {
    const executionIndex = bars.findIndex(bar => bar.time === trade.entryTime);
    assert.ok(executionIndex > 700);
    assert.equal(result.signals.find(signal => signal.time === bars[executionIndex - 1].time)?.action, 'buy');
    assert.equal(trade.entryPrice, Math.round(bars[executionIndex].open * 1e6) / 1e6);
    if (trade.exitTime !== null) {
      const exitIndex = bars.findIndex(bar => bar.time === trade.exitTime);
      assert.equal(result.signals.find(signal => signal.time === bars[exitIndex - 1].time)?.action, 'sell');
    }
  }
});
test('fees and slippage reduce net outcomes and preserve finite, bounded drawdown metrics', () => {
  const bars = history();
  const free = analyzeHistory(bars, { feeBps: 0, slippageBps: 0 });
  const charged = analyzeHistory(bars, { feeBps: 20, slippageBps: 10 });
  assert.ok(charged.backtest.finalEquity < free.backtest.finalEquity);
  assert.ok(charged.backtest.buyHoldReturnPct < free.backtest.buyHoldReturnPct);
  assert.ok(charged.backtest.maxDrawdownPct >= 0 && charged.backtest.maxDrawdownPct <= 100);
  assert.ok(charged.backtest.trades.every(trade => trade.quantity > 0 && Number.isFinite(trade.netPnl)));
  assert.equal(analyzeHistory([]).backtest.returnPct, 0);
});
test('invalid prices, unordered bars and impossible numerical options fail explicitly', () => {
  const bars = history(100);
  assert.throws(() => analyzeHistory([bars[1], bars[0]]), RangeError);
  assert.throws(() => analyzeHistory([bars[0], bars[0]]), RangeError);
  assert.throws(() => analyzeHistory([{ ...bars[0], close: Infinity }]), RangeError);
  assert.throws(() => analyzeHistory([{ ...bars[0], low: bars[0].high + 1 }]), RangeError);
  assert.throws(() => analyzeHistory(bars, { initialCapital: -1 }), RangeError);
  assert.throws(() => analyzeHistory(bars, { feeBps: Infinity }), RangeError);
});
