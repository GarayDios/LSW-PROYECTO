import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTechnicalIndicators } from '../../src/cores/01-analisis-tecnico/indicators.ts';
import { analyzeSupportResistance } from '../../src/cores/01-analisis-tecnico/support-resistance.ts';
import { analyzeHistory } from '../../src/cores/05-indicadores-y-senales/signals.ts';
import { detectTechnicalEvents } from '../../src/cores/05-indicadores-y-senales/technical-events.ts';
import type { Candle } from '../../src/features/market/chart-history.ts';

function history(length: number, price = (index: number) => 100 + 4 * Math.sin(index * Math.PI / 6)): Candle[] {
  return Array.from({ length }, (_, index) => { const close = price(index); return {
    time: Date.parse('2024-01-01T00:00:00Z') + index * 86400000, open: close, high: close + .5, low: close - .5, close, volume: 1000,
  }; });
}

test('MACD uses SMA-seeded EMA12/26/9, ATR Wilder14 and prior-volume baseline with explicit warmup', () => {
  const bars = history(61, () => 100);
  bars[60] = { ...bars[60], open: 100, high: 111, low: 99, close: 110, volume: 10000 };
  const indicators = calculateTechnicalIndicators(bars);
  assert.equal(indicators[24].macd, null); assert.equal(indicators[25].macd, 0);
  assert.equal(indicators[32].macdSignal, null); assert.equal(indicators[33].macdHistogram, 0);
  const expectedMacd = 110 * (2 / 13) + 100 * (11 / 13) - (110 * (2 / 27) + 100 * (25 / 27));
  assert.ok(Math.abs(indicators[60].macd! - expectedMacd) < 1e-12);
  assert.ok(Math.abs(indicators[60].macdSignal! - expectedMacd * .2) < 1e-12);
  assert.ok(Math.abs(indicators[60].macdHistogram! - expectedMacd * .8) < 1e-12);
  assert.equal(indicators[12].atr, null); assert.equal(indicators[13].atr, 1);
  assert.ok(Math.abs(indicators[60].atr! - (13 + 12) / 14) < 1e-12);
  assert.equal(indicators[19].relativeVolume, null); assert.equal(indicators[60].relativeVolume, 10);
});

test('support/resistance needs two confirmed pivots, does not move prices and cannot repaint an earlier decision', () => {
  const bars = history(90), full = analyzeSupportResistance(bars);
  const prefix = analyzeSupportResistance(bars.slice(0, 26));
  assert.deepEqual(full.points.slice(0, 26), prefix.points);
  assert.equal(full.points[22].support, null);
  assert.equal(full.points[23].support?.price, 95.5);
  assert.equal(full.points[23].support?.confirmedAt, bars[23].time);
  assert.equal(full.points[23].support?.pivotAt, bars[9].time);
  for (const point of full.points) {
    for (const level of [point.support, point.resistance]) if (level) {
      assert.ok(level.confirmedAt <= point.time); assert.ok(level.touches >= 2);
      assert.equal(level.price, level.kind === 'support' ? 95.5 : 104.5);
    }
  }
  assert.equal(analyzeSupportResistance(history(80, () => 100)).levels.length, 0, 'A flat series cannot invent pivots');
});

test('breakouts compare against a level already known before the breakout bar', () => {
  const bars = history(80); const last = bars.at(-1)!;
  bars.push({ ...last, time: last.time + 86400000, open: 102, low: 101, high: 111, close: 110 });
  const indicators = calculateTechnicalIndicators(bars), structure = analyzeSupportResistance(bars);
  const events = detectTechnicalEvents(bars, indicators, structure.points);
  assert.ok(events.some(event => event.time === bars[80].time && event.label === 'Ruptura resistencia'));
  assert.deepEqual(events.filter(event => event.time < bars[80].time), detectTechnicalEvents(bars.slice(0, 80), indicators.slice(0, 80), structure.points.slice(0, 80)));
});

test('technical cores reject invalid candles and misaligned event inputs instead of issuing false signals', () => {
  const bars = history(80);
  assert.throws(() => calculateTechnicalIndicators([...bars, bars[20]]), /ordenadas/);
  assert.throws(() => calculateTechnicalIndicators([{ ...bars[0], volume: -1 }]), /válidas/);
  assert.throws(() => analyzeSupportResistance([{ ...bars[0], close: bars[0].high + 1 }]), /válidas/);
  assert.throws(() => detectTechnicalEvents(bars, calculateTechnicalIndicators(bars), []), /alineados/);
});

test('confluence signals are causal and satisfy MACD/RSI/trend while executions remain on the next bar', () => {
  const bars = history(500, index => 100 + index * .03 + 5 * Math.sin(index / 12) + 2 * Math.sin(index * 2.3));
  const full = analyzeHistory(bars, { rule: 'technical-confluence' });
  const prefix = analyzeHistory(bars.slice(0, 300), { rule: 'technical-confluence' });
  assert.deepEqual(full.signals.filter(signal => signal.time <= bars[299].time), prefix.signals);
  assert.deepEqual(full.indicators.slice(0, 300), prefix.indicators);
  assert.deepEqual(full.structure.points.slice(0, 300), prefix.structure.points);
  const buys = full.signals.filter(signal => signal.action === 'buy');
  assert.ok(buys.length > 0);
  for (const signal of buys) {
    const indicator = full.indicators.find(point => point.time === signal.time)!;
    assert.ok(signal.rsi >= 35 && signal.rsi <= 70); assert.ok(signal.smaFast > signal.smaSlow);
    assert.ok(indicator.macdHistogram! > 0);
  }
  for (const trade of full.backtest.trades) {
    const index = bars.findIndex(bar => bar.time === trade.entryTime);
    assert.ok(full.signals.some(signal => signal.time === bars[index - 1].time && signal.action === 'buy'));
  }
});
