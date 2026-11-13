import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAlpacaHistory, MarketDataError, newYorkDate } from '../../src/api/market/alpaca-history.ts';
import type { BrokerConfig } from '../../src/api/brokers/config.ts';

const config: BrokerConfig = { apiKey: 'test-key', secretKey: 'test-secret', ownerUserId: 'owner', dataFeed: 'iex' };
const now = Date.parse('2026-11-13T19:00:00Z');
const bar = (t: string, price = 100, volume = 1000) => ({ t, o: price, h: price + 2, l: price - 1, c: price + 1, v: volume });

test('history uses manual redirects without forwarding data credentials to another host', async () => {
  let calls = 0;
  await assert.rejects(fetchAlpacaHistory(config, { symbol: 'AAPL', start: '2026-11-09', end: '2026-11-09', interval: '1d' }, async (_input, init) => {
    calls++;
    assert.equal(init?.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.test' } });
  }, now), MarketDataError);
  assert.equal(calls, 1);
});

test('real history paginates even short pages, sorts and deduplicates without replacing source data', async () => {
  const urls: URL[] = [];
  const result = await fetchAlpacaHistory(config, { symbol: 'NVDA', start: '2023-11-09', end: '2026-11-09', interval: '1d' }, async (input, init) => {
    const url = new URL(String(input)); urls.push(url);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('APCA-API-KEY-ID'), config.apiKey);
    assert.equal(headers.get('APCA-API-SECRET-KEY'), config.secretKey);
    assert.equal(url.origin, 'https://data.alpaca.markets');
    assert.equal(url.searchParams.get('adjustment'), 'split');
    assert.equal(url.searchParams.get('timeframe'), '1Day');
    assert.equal(url.searchParams.get('feed'), 'iex');
    return url.searchParams.has('page_token')
      ? Response.json({ symbol: 'NVDA', bars: [bar('2026-11-09T05:00:00Z', 150), bar('2023-11-09T05:00:00Z')], next_page_token: null })
      : Response.json({ symbol: 'NVDA', bars: [bar('2023-11-09T05:00:00Z')], next_page_token: 'more-data' });
  }, now);
  assert.equal(urls.length, 2);
  assert.equal(urls[1].searchParams.get('page_token'), 'more-data');
  assert.equal(result.source, 'alpaca');
  assert.equal(result.bars.length, 2);
  assert.equal(newYorkDate(result.bars[0].time), '2023-11-09');
  assert.equal(newYorkDate(result.bars[1].time), '2026-11-09');
  assert.equal(result.bars[1].close, 151);
  assert.match(result.warnings.join(' '), /IEX/);
});
test('at least three years of daily dates are accepted, while impractical intraday ranges are explicit', async () => {
  const result = await fetchAlpacaHistory(config, { symbol: 'AAPL', start: '2023-11-09', end: '2026-11-09', interval: '1d' }, async () => Response.json({ bars: [], next_page_token: null }), now);
  assert.equal(result.coverage.requestedStart, '2023-11-09');
  assert.equal(result.bars.length, 0);
  assert.match(result.warnings.join(' '), /No hay velas/);
  for (const interval of ['5m', '15m', '1h'] as const) await assert.rejects(fetchAlpacaHistory(config, { symbol: 'AAPL', start: '2023-11-09', end: '2026-11-09', interval }, async () => { throw Error('should not fetch'); }, now), (error: unknown) => error instanceof MarketDataError && error.code === 'interval_range_exceeded');
});
test('daily date filtering includes the selected end in New York and excludes today and future bars', async () => {
  const result = await fetchAlpacaHistory(config, { symbol: 'AAPL', start: '2026-11-09', end: '2026-11-15', interval: '1d' }, async input => {
    assert.ok(Date.parse(new URL(String(input)).searchParams.get('end')!) <= now - 16 * 60000);
    return Response.json({ bars: [bar('2026-11-09T05:00:00Z'), bar('2026-11-12T05:00:00Z'), bar('2026-11-13T05:00:00Z'), bar('2026-11-14T05:00:00Z')] });
  }, now);
  assert.deepEqual(result.bars.map(candle => newYorkDate(candle.time)), ['2026-11-09', '2026-11-12']);
});
test('regular-session intraday bars follow calendar DST and shortened sessions', async () => {
  const result = await fetchAlpacaHistory(config, { symbol: 'AAPL', start: '2026-10-30', end: '2026-11-02', interval: '5m' }, async input => {
    const url = new URL(String(input));
    if (url.pathname === '/v2/calendar') return Response.json([{ date: '2026-10-30', open: '09:30', close: '16:00' }, { date: '2026-11-02', open: '09:30', close: '13:00' }]);
    return Response.json({ bars: [bar('2026-10-30T13:25:00Z'), bar('2026-10-30T13:30:00Z'), bar('2026-11-02T14:30:00Z'), bar('2026-11-02T17:55:00Z'), bar('2026-11-02T18:00:00Z')] });
  }, now);
  assert.deepEqual(result.bars.map(candle => new Date(candle.time).toISOString()), ['2026-10-30T13:30:00.000Z', '2026-11-02T14:30:00.000Z', '2026-11-02T17:55:00.000Z']);
});
test('hourly buckets stay anchored to 09:30 when the provider omits a half-hour', async () => {
  const result = await fetchAlpacaHistory(config, { symbol: 'AAPL', start: '2026-11-09', end: '2026-11-09', interval: '1h' }, async input => {
    const url = new URL(String(input));
    if (url.pathname === '/v2/calendar') return Response.json([{ date: '2026-11-09', open: '09:30', close: '16:00' }]);
    assert.equal(url.searchParams.get('timeframe'), '30Min');
    return Response.json({ bars: [bar('2026-11-09T15:00:00Z', 100, 100), bar('2026-11-09T15:30:00Z', 110, 200), bar('2026-11-09T16:00:00Z', 120, 300)] });
  }, now);
  assert.equal(result.bars.length, 2);
  assert.equal(new Date(result.bars[0].time).toISOString(), '2026-11-09T14:30:00.000Z');
  assert.equal(result.bars[0].volume, 100);
  assert.equal(new Date(result.bars[1].time).toISOString(), '2026-11-09T15:30:00.000Z');
  assert.equal(result.bars[1].volume, 500);
  assert.equal(result.bars[1].open, 110);
  assert.equal(result.bars[1].close, 121);
});
test('invalid OHLC, repeated pagination and provider denial never produce a silent synthetic fallback', async () => {
  const query = { symbol: 'AAPL', start: '2026-11-09', end: '2026-11-09', interval: '1d' as const };
  await assert.rejects(fetchAlpacaHistory(config, query, async () => Response.json({ bars: [{ ...bar('2026-11-09T05:00:00Z'), h: 10 }] }), now), MarketDataError);
  await assert.rejects(fetchAlpacaHistory(config, query, async () => Response.json({ bars: [], next_page_token: 'same' }), now), (error: unknown) => error instanceof MarketDataError && error.code === 'invalid_market_response');
  await assert.rejects(fetchAlpacaHistory(config, query, async () => Response.json({ message: 'private-key diagnostic' }, { status: 403 }), now), (error: unknown) => error instanceof MarketDataError && error.code === 'market_access_denied' && !error.message.includes('private-key'));
  await assert.rejects(fetchAlpacaHistory(config, query, async () => new Response('', { status: 429 }), now), (error: unknown) => error instanceof MarketDataError && error.status === 429);
});
