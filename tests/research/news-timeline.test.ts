import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsHandler } from '../../src/api/analysis/news.ts';
import { fetchAlpacaNews } from '../../src/api/research/alpaca.ts';
import { normalizeFinancialNews } from '../../src/cores/03-noticias-financieras/normalize-news.ts';
import type { NewsTimelinePage } from '../../src/cores/compartido/research-model.ts';

const environment = { ALPACA_API_KEY: 'PRIVATE-TEST-KEY', ALPACA_SECRET_KEY: 'PRIVATE-TEST-SECRET', BROKER_OWNER_USER_ID: 'owner' };
const now = Date.parse('2026-11-13T17:00:00Z');
const owner = async () => ({ userId: 'owner' });
const config = { apiKey: environment.ALPACA_API_KEY, secretKey: environment.ALPACA_SECRET_KEY };
const get = (extra = '') => new Request(`https://terminal.test/api/research/news?symbol=AAPL&start=2026-01-01&end=2026-11-13${extra}`);
const news = (id: number, created_at = '2026-07-01T14:00:00Z') => ({ id, created_at, updated_at: created_at, symbols: ['AAPL'], headline: `News ${id}`, source: 'TEST', url: 'https://example.org/story' });
const json = (body: unknown) => Response.json(body);

test('news range query paginates beyond seven days, filters symbol/dates/revisions and preserves a continuation', async () => {
  const urls: URL[] = [];
  const result = await fetchAlpacaNews({ ...config, maxPages: 2 }, 'AAPL', new Date(now).toISOString(), async (input, init) => {
    const url = new URL(String(input)); urls.push(url);
    assert.equal(init?.redirect, 'manual');
    assert.equal((init?.headers as Record<string, string>)['APCA-API-KEY-ID'], config.apiKey);
    return json({ news: urls.length === 1 ? [news(1), news(2, '2025-12-31T14:00:00Z'), { ...news(3), symbols: ['MSFT'] }, { ...news(4), updated_at: '2026-11-14T14:00:00Z' }] : [news(1), news(5)], next_page_token: `page${urls.length + 1}` });
  }, { start: '2026-01-01T05:00:00Z' });
  assert.equal(urls.length, 2); assert.equal(urls[0].searchParams.get('start'), '2026-01-01T05:00:00Z');
  assert.equal(urls[1].searchParams.get('page_token'), 'page2');
  assert.deepEqual(result.articles.map(a => a.id), ['1', '5']);
  assert.equal(result.complete, false); assert.equal(result.nextPageToken, 'page3');
});

test('new endpoint authenticates before using credentials and never invokes other research sources', async () => {
  let calls = 0;
  for (const user of [null, { userId: 'other' }]) {
    const api = createNewsHandler({ environment: () => environment, owner: async () => user, fetcher: async () => { calls++; return json({}); } });
    assert.equal((await api(get())).status, user ? 403 : 401);
  }
  assert.equal(calls, 0);
  const api = createNewsHandler({ environment: () => environment, owner, now: () => now, fetcher: async input => {
    assert.equal(new URL(String(input)).pathname, '/v1beta1/news'); calls++; return json({ news: [news(1)], next_page_token: null });
  } });
  const response = await api(get()), text = await response.text();
  assert.equal(response.status, 200); assert.doesNotMatch(text, /PRIVATE-TEST|apiKey|secretKey/);
  assert.match(response.headers.get('cache-control')!, /private, no-store/);
  assert.equal(JSON.parse(text).news.articles[0].id, '1'); assert.equal(calls, 1);
});

test('news dates use full New York days through DST and clamp all requests to the knowledge cutoff', async () => {
  const urls: URL[] = [];
  const api = createNewsHandler({ environment: () => environment, owner, now: () => now, fetcher: async input => { urls.push(new URL(String(input))); return json({ news: [] }); } });
  await api(new Request('https://terminal.test/api/research/news?symbol=AAPL&start=2026-03-08&end=2026-03-08'));
  assert.equal(urls[0].searchParams.get('start'), '2026-03-08T05:00:00.000Z');
  assert.equal(urls[0].searchParams.get('end'), '2026-03-09T03:59:59.999Z');
  const current = await (await api(get())).json() as NewsTimelinePage;
  assert.equal(current.asOf, new Date(now).toISOString());
  await api(get('&cutoff=2026-08-01T16%3A00%3A00Z&pageToken=old-page'));
  assert.equal(urls.at(-1)!.searchParams.get('end'), '2026-08-01T16:00:00.000Z');
  assert.equal(urls.at(-1)!.searchParams.get('page_token'), 'old-page');
});

test('invalid/future ranges and unbounded or unpinned pagination are rejected before network access', async () => {
  let calls = 0;
  const api = createNewsHandler({ environment: () => environment, owner, now: () => now, fetcher: async () => { calls++; return json({}); } });
  for (const query of [
    'symbol=AAPL&start=2026-02-30&end=2026-11-13', 'symbol=AAPL&start=2026-11-14&end=2026-11-15',
    'symbol=AAPL&start=2000-01-01&end=2026-11-13', 'symbol=AAPL&start=2026-11-13&end=2026-11-12',
    'symbol=AAPL&start=2026-01-01&end=2026-11-13&pageToken=abc',
    'symbol=AAPL&start=2026-01-01&end=2026-11-13&pageToken=' + 'x'.repeat(8001),
  ]) assert.equal((await api(new Request('https://terminal.test/api/research/news?' + query))).status, 400);
  assert.equal(calls, 0);
});

test('pagination and transient failures preserve received stories and offer the failed page again', async () => {
  let calls = 0;
  const result = await fetchAlpacaNews(config, 'AAPL', new Date(now).toISOString(), async () => {
    calls++; if (calls === 2) throw Error('PRIVATE provider diagnostic');
    return json({ news: [news(1, '2026-11-12T14:00:00Z')], next_page_token: 'page2' });
  });
  assert.equal(result.status.status, 'partial'); assert.equal(result.articles.length, 1); assert.equal(result.nextPageToken, 'page2');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  const repeated = await fetchAlpacaNews(config, 'AAPL', new Date(now).toISOString(), async () => json({ news: [news(1)], next_page_token: 'same' }), { start: '2026-01-01T05:00:00Z', pageToken: 'same' });
  assert.equal(repeated.status.status, 'error'); assert.equal(repeated.complete, false);
});

test('provider denial is visible and same-owner requests reuse a bounded in-flight batch', async () => {
  let calls = 0;
  const api = createNewsHandler({ environment: () => environment, owner, now: () => now, fetcher: async () => { calls++; return json({ news: [] }); } });
  await Promise.all([api(get()), api(get())]); assert.equal(calls, 1);
  const denied = createNewsHandler({ environment: () => environment, owner, now: () => now, fetcher: async () => new Response('PRIVATE diagnostic', { status: 403 }) });
  const response = await denied(get()); assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /PRIVATE/);
});

test('normalization requires identities and sensible dates and only retains HTTPS article links', () => {
  const input = [news(1), { ...news(2), headline: ' ' }, { ...news(3), id: undefined }, { ...news(4), updated_at: '2026-06-30T14:00:00Z' }, { ...news(5), url: 'javascript:alert(1)' }];
  const normalized = normalizeFinancialNews(input, new Date(now).toISOString());
  assert.deepEqual(normalized.map(a => a.id), ['1', '5']); assert.equal(normalized[1].url, null);
});
