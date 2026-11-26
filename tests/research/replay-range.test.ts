import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReplayRange } from '../../src/features/research/replay-range.ts';
import type { Candle } from '../../src/features/market/chart-history.ts';
const bars: Candle[] = ['2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25'].map(date => ({ time: Date.parse(date), open: 100, close: 101, low: 99, high: 102, volume: 100 }));

test('historical range is inclusive, preserves both requested dates and starts with the first available session', () => {
  const range = resolveReplayRange(bars, '2026-11-20', '2026-11-24', '2026-11-19');
  assert.equal(range.from, '2026-11-20'); assert.equal(range.to, '2026-11-24'); assert.equal(range.decision, '2026-11-20');
  assert.equal(range.sessions, 3); assert.equal(range.lastTime, Date.parse('2026-11-24'));
  const weekend = resolveReplayRange(bars, '2026-11-21', '2026-11-24', '2026-11-19');
  assert.equal(weekend.from, '2026-11-21'); assert.equal(weekend.decision, '2026-11-23'); assert.equal(weekend.sessions, 2);
});

test('range validation rejects reversed, invalid, unavailable and empty ranges rather than silently broadening them', () => {
  for (const [from, to] of [['2026-11-24', '2026-11-20'], ['2026-02-30', '2026-11-24'], ['2026-11-18', '2026-11-24'], ['2026-11-20', '2026-11-26'], ['2026-11-21', '2026-11-22']]) {
    assert.throws(() => resolveReplayRange(bars, from, to, '2026-11-19'));
  }
  assert.throws(() => resolveReplayRange([], '2026-11-20', '2026-11-24', '2026-11-19'));
});
