import test from 'node:test';
import assert from 'node:assert/strict';
import { createComparisonHandler } from '../../src/api/analysis/comparison.ts';
import { compareStockRules, periodStart, type ComparisonResult } from '../../src/features/analysis/comparison.ts';
import { analyzeHistory } from '../../src/features/analysis/signals.ts';
import type { fetchAlpacaHistory } from '../../src/api/market/alpaca-history.ts';

const now = Date.parse('2026-11-13T16:00:00Z');
const bars = Array.from({ length: 1850 }, (_, index) => {
  const close = 250 - index * .06 + 12 * Math.sin(index / 8);
  return { time: Date.parse('2026-11-12T05:00:00Z') - (1849 - index) * 86400000, open: close + .2, high: close + 1, low: close - 1, close, volume: 1000 };
});
const environment = { ALPACA_API_KEY: 'secret-key', ALPACA_SECRET_KEY: 'secret-value', BROKER_OWNER_USER_ID: 'owner' };
const input = { symbols: ['AAPL', 'MSFT', 'AAPL'], years: [1, 3, 5], end: '2026-11-13', feeBps: 10, slippageBps: 5 };
const request = (body: unknown = input, origin = 'https://terminal.test') => new Request('https://terminal.test/api/research/comparison', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const history: typeof fetchAlpacaHistory = async (_config, query) => ({ ...query, source: 'alpaca', feed: 'iex', adjustment: 'split', asOf: new Date(now).toISOString(), bars, warnings: [], coverage: { requestedStart: query.start, requestedEnd: query.end, firstBar: '', lastBar: '' } });

test('comparison fetches each company once, bounds parallelism and preserves negative returns and both fixed rules', async () => {
  let calls = 0, active = 0, peak = 0;
  const handler = createComparisonHandler({ environment: () => environment, owner: async () => ({ userId: 'owner' }), now: () => now,
    history: async (...args) => { calls++; active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return history(...args); } });
  const response = await handler(request()); assert.equal(response.status, 200);
  const result = await response.json() as ComparisonResult;
  assert.equal(calls, 2); assert.ok(peak <= 2); assert.equal(result.rows.length, 12); assert.equal(result.excluded.length, 0);
  assert.deepEqual(result.rows.slice(0, 2).map(row => row.rule), ['sma-rsi', 'sma-cross']);
  assert.ok(result.rows.some(row => row.returnPct < 0), 'losses must remain in the table');
  assert.ok(result.rows.some(row => row.buyHoldReturnPct < 0));
  assert.ok(result.rows.every(row => row.lastBar === '2026-11-12' && row.stability.feeBps === 10));
  assert.doesNotMatch(JSON.stringify(result), /secret-key|secret-value/);
});

test('comparison rejects untrusted ownership, forged parameters, cross-origin writes and future dates before network requests', async () => {
  let calls = 0;
  for (const user of [null, { userId: 'other' }]) {
    const handler = createComparisonHandler({ environment: () => environment, owner: async () => user, history: async (...args) => { calls++; return history(...args); } });
    assert.equal((await handler(request())).status, user ? 403 : 401);
  }
  const handler = createComparisonHandler({ environment: () => environment, owner: async () => ({ userId: 'owner' }), now: () => now, history: async (...args) => { calls++; return history(...args); } });
  for (const value of [{ ...input, years: [2] }, { ...input, feeBps: -1 }, { ...input, end: '2026-02-30' }, { ...input, end: '2027-01-01' }, { ...input, ownerId: 'other' }, { ...input, symbols: Array(7).fill('AAPL') }]) assert.equal((await handler(request(value))).status, 400);
  assert.equal((await handler(request(input, 'https://other.test'))).status, 403); assert.equal(calls, 0);
});

test('provider faults and short coverage are explicit exclusions without fallback to demo', async () => {
  const handler = createComparisonHandler({ environment: () => environment, owner: async () => ({ userId: 'owner' }), now: () => now,
    history: async (...args) => { if (args[1].symbol === 'MSFT') throw Error('secret diagnostic'); return { ...await history(...args), bars: bars.slice(-120) }; } });
  const result = await (await handler(request())).json() as ComparisonResult;
  assert.equal(result.rows.length, 0); assert.equal(result.excluded.length, 6); assert.doesNotMatch(JSON.stringify(result), /secret diagnostic/);
});

test('alternative rule remains causal, costs apply equally, and leap-year starts retain the month', () => {
  assert.equal(periodStart('2024-02-29', 3), '2021-02-28');
  const prefix = analyzeHistory(bars.slice(0, 500), { rule: 'sma-cross' });
  const full = analyzeHistory(bars, { rule: 'sma-cross' });
  assert.deepEqual(full.signals.filter(signal => signal.time <= bars[499].time), prefix.signals);
  const rows = compareStockRules('AAPL', bars, 5, { asOf: bars[499].time, feeBps: 0, slippageBps: 0 });
  assert.ok(rows.every(row => row.observations === 500 && row.stability.folds.every(fold => fold.endTime <= bars[499].time)));
  const costly = compareStockRules('AAPL', bars, 5, { asOf: bars[499].time, feeBps: 50, slippageBps: 50 });
  for (let index = 0; index < rows.length; index++) assert.ok(costly[index].returnPct <= rows[index].returnPct);
});
