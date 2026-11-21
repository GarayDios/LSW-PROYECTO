import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTechnicalIndicators } from '../../src/cores/01-analisis-tecnico/indicators.ts';
import { detectOpeningGaps, detectTechnicalEvents } from '../../src/cores/05-indicadores-y-senales/technical-events.ts';
import type { Candle } from '../../src/features/market/chart-history.ts';

const candle = (date: string, open = 100, close = open): Candle => ({
  time: Date.parse(date), open, close, high: Math.max(open, close) + 1,
  low: Math.min(open, close) - 1, volume: 1000,
});

test('SMA crossover events respect warmup, equality, direction and one event per crossing', () => {
  const fast = [null, 100, 100, 101, 102, 100, 99, 98];
  const bars = fast.map((_, index) => candle(`2026-11-${String(2 + index).padStart(2, '0')}T14:30:00Z`));
  const indicators = calculateTechnicalIndicators(bars).map((point, index) => ({ ...point, smaFast: fast[index], smaSlow: 100 }));
  const structure = bars.map(bar => ({ time: bar.time, support: null, resistance: null }));
  const events = detectTechnicalEvents(bars, indicators, structure);
  assert.deepEqual(events.map(event => [event.kind, event.direction, event.time]), [
    ['average', 'up', bars[3].time], ['average', 'down', bars[6].time],
  ]);
  assert.deepEqual(detectTechnicalEvents(bars.slice(0, 5), indicators.slice(0, 5), structure.slice(0, 5)), events.slice(0, 1));
});

test('daily opening gaps use the prior close, both directions, and an inclusive configurable threshold', () => {
  const bars = [candle('2026-11-09T05:00:00Z'), candle('2026-11-10T05:00:00Z', 100.5, 100),
    candle('2026-11-11T05:00:00Z', 99.5, 100), candle('2026-11-12T05:00:00Z', 100.49, 101),
    candle('2026-11-13T05:00:00Z', 103.02)];
  const gaps = detectOpeningGaps(bars, '1d');
  assert.deepEqual(gaps.map(event => [event.kind, event.direction, event.label]), [
    ['gap', 'up', 'GAP +0.50%'], ['gap', 'down', 'GAP -0.50%'], ['gap', 'up', 'GAP +2.00%'],
  ]);
  assert.equal(gaps[0].price, 100.5);
  assert.equal(gaps[0].previousClose, 100);
  assert.equal(gaps[0].gapPercent, .5);
  assert.equal(gaps[2].previousClose, 101);
  assert.equal(detectOpeningGaps(bars, '1d', 1).length, 1);
  assert.deepEqual(detectOpeningGaps(bars.slice(0, 3), '1d'), gaps.slice(0, 2));
});

test('daily gaps allow weekends but omit missing weekdays, holidays and nonadjacent history', () => {
  assert.equal(detectOpeningGaps([candle('2026-11-06T05:00:00Z'), candle('2026-11-09T05:00:00Z', 102)], '1d').length, 1);
  for (const [previous, next] of [['09', '11'], ['09', '16'], ['25', '27']]) {
    assert.deepEqual(detectOpeningGaps([candle(`2026-11-${previous}T05:00:00Z`), candle(`2026-11-${next}T05:00:00Z`, 102)], '1d'), []);
  }
});

test('intraday gaps require the final prior session bar and 09:30 opening, never an internal-bar move', () => {
  for (const [interval, closeTime] of [['5m', '20:55'], ['15m', '20:45'], ['1h', '20:30']]) {
    const bars = [candle(`2026-11-09T${closeTime}:00Z`), candle('2026-11-10T14:30:00Z', 102, 103),
      candle('2026-11-10T15:30:00Z', 110)];
    const gaps = detectOpeningGaps(bars, interval);
    assert.equal(gaps.length, 1, interval);
    assert.equal(gaps[0].time, bars[1].time);
    assert.equal(gaps[0].gapPercent, 2);
    assert.deepEqual(detectOpeningGaps([bars[0], bars[2]], interval), [], 'A missing opening bar must not create a gap');
  }
});

test('intraday session matching respects New York DST and rejects shortened or incomplete closes', () => {
  const acrossDST = [candle('2026-10-30T19:55:00Z'), candle('2026-11-02T14:30:00Z', 102)];
  assert.equal(detectOpeningGaps(acrossDST, '5m').length, 1);
  assert.deepEqual(detectOpeningGaps([candle('2026-11-27T17:55:00Z'), candle('2026-11-30T14:30:00Z', 102)], '5m'), [],
    'No exchange calendar is provided, so shortened closes cannot be assumed');
  assert.deepEqual(detectOpeningGaps([candle('2026-11-09T20:50:00Z'), candle('2026-11-10T14:30:00Z', 102)], '5m'), []);
});

test('gap input validation rejects malformed, duplicate or unordered bars and invalid settings', () => {
  const first = candle('2026-11-09T05:00:00Z'), second = candle('2026-11-10T05:00:00Z');
  assert.throws(() => detectOpeningGaps([first, first], '1d'), /ordenadas/);
  assert.throws(() => detectOpeningGaps([second, first], '1d'), /ordenadas/);
  assert.throws(() => detectOpeningGaps([{ ...first, open: 0 }], '1d'), /válidas/);
  assert.throws(() => detectOpeningGaps([{ ...first, volume: -1 }], '1d'), /válidas/);
  assert.throws(() => detectOpeningGaps([{ ...first, high: 90 }], '1d'), /válidas/);
  assert.throws(() => detectOpeningGaps([first], '1w'), /inválido/);
  for (const threshold of [0, -1, Infinity, NaN]) assert.throws(() => detectOpeningGaps([first], '1d', threshold), /inválido/);
  assert.deepEqual(detectOpeningGaps([], '1d'), []);
});
