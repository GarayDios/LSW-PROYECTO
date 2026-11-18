import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchHandlers } from '../../src/api/analysis/handlers.ts';
import { fetchCompanyResearch } from '../../src/api/research/company.ts';
import type { MarketHistory } from '../../src/api/market/alpaca-history.ts';

const environment = { ALPACA_API_KEY: 'private-test-key', ALPACA_SECRET_KEY: 'private-test-secret', BROKER_OWNER_USER_ID: 'owner' };
const now = Date.parse('2026-11-13T16:00:00Z');
const owner = async () => ({ userId: 'owner' });
const noNetwork: typeof fetch = async () => { throw new Error('A test attempted a network request'); };
const research: typeof fetchCompanyResearch = (input, _fetcher, time) => fetchCompanyResearch({ ...input, alpaca: undefined, fred: undefined, sec: undefined }, noNetwork, time);
const history: typeof import('../../src/api/market/alpaca-history.ts').fetchAlpacaHistory = async (_config, query) => ({
  ...query, source: 'alpaca', feed: 'iex', adjustment: 'split', asOf: new Date(now).toISOString(), warnings: [],
  bars: Array.from({ length: 90 }, (_, index) => ({ time: Date.parse('2026-07-01T04:00:00Z') + index * 86400000, open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 1000 })),
  coverage: { firstBar: '2026-07-01', lastBar: '2026-09-28', requestedStart: query.start, requestedEnd: query.end },
}) satisfies MarketHistory;
const get = (query = 'symbol=AAPL&start=2023-11-13&end=2026-11-13') => new Request('https://terminal.test/api/research/company?' + query);
const body = { symbols: ['AAPL', 'MSFT'], selectedCores: ['trend'], strategy: 'wheel', days: 30, start: '2023-11-13', end: '2026-11-13' };
const post = (value: unknown = body, origin = 'https://terminal.test') => new Request('https://terminal.test/api/research/ranking', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });

test('ranking validates per-company assumptions and retains their provenance without changing provider facts', async()=>{
  const api=createResearchHandlers({environment:()=>environment,owner,history,research,now:()=>now});
  const analysis={capital:20000,feePerContract:.65,maxSpreadPercent:30,longDays:365,dividendPercentBySymbol:{AAPL:0}};
  const response=await api.ranking(post({...body,analysis}));
  assert.equal(response.status,200);
  const result=await response.json() as {snapshots:Record<string,Awaited<ReturnType<typeof fetchCompanyResearch>>>;ranked:{symbol:string;strategyAnalysis:{warnings:string[]}}[]};
  assert.equal(result.snapshots.AAPL.fundamentals.dividendYield.value,null);
  assert.ok(result.ranked.find(r=>r.symbol==='AAPL')!.strategyAnalysis.warnings.some(w=>w.includes('supuesto explícitamente')));
  assert.equal((await api.ranking(post({...body,analysis:{...analysis,capital:-1}}))).status,400);
  assert.equal((await api.ranking(post({...body,analysis:{...analysis,dividendPercentBySymbol:{AAPL:-2}}}))).status,400);
  assert.equal((await api.ranking(post({...body,analysis:{...analysis,tuning:{coreWeights:{trend:0}}}}))).status,400);
  assert.equal((await api.ranking(post({...body,analysis:{...analysis,tuning:{binomialSteps:1000000}}}))).status,400);
});

test('research boundary rejects anonymous and other-owner access before consulting providers', async () => {
  let calls = 0;
  for (const user of [null, { userId: 'other' }]) {
    const api = createResearchHandlers({ environment: () => environment, owner: async () => user, history: async (...args) => { calls++; return history(...args); }, research });
    assert.equal((await api.company(get())).status, user ? 403 : 401);
    assert.equal((await api.ranking(post())).status, user ? 403 : 401);
  }
  assert.equal(calls, 0);
});
test('research snapshots cap knowledge to range end and now, preserving missing inputs and hiding credentials', async () => {
  const api = createResearchHandlers({ environment: () => environment, owner, history, research, now: () => now });
  const response = await api.company(get('symbol=AAPL&start=2023-11-13&end=2026-08-01&cutoff=2030-01-01T00%3A00%3A00Z'));
  assert.equal(response.status, 200);
  const raw = await response.text(), value = JSON.parse(raw);
  assert.doesNotMatch(raw, /private-test|apiKey|secretKey/);
  assert.equal(value.research.asOf, '2026-08-01T23:59:59.999Z');
  assert.ok(value.research.market.bars.every((bar: { time: number }) => bar.time <= Date.parse(value.research.asOf)));
  assert.equal(value.research.fundamentals.dividendYield.value, null);
  assert.equal(value.research.macro.riskFreeRate.value, null);
  assert.match(response.headers.get('Cache-Control')!, /private, no-store/);
  const current = await (await api.company(get())).json() as { research: { asOf: string } };
  assert.equal(current.research.asOf, new Date(now).toISOString());
});
test('research validates calendar dates and rejects cross-origin ranking and unbounded universes', async () => {
  const api = createResearchHandlers({ environment: () => environment, owner, history, research, now: () => now });
  for (const query of ['symbol=AAPL&start=2026-02-30&end=2026-11-13', 'symbol=AAPL&start=2026-11-13&end=2023-11-13', 'symbol=AAPL&start=2023-11-13&end=2026-11-13&cutoff=2020-01-01T00%3A00%3A00Z']) assert.equal((await api.company(get(query))).status, 400);
  assert.equal((await api.ranking(post(body, 'https://other.test'))).status, 403);
  assert.equal((await api.ranking(post({ ...body, symbols: Array(15).fill('AAPL') }))).status, 400);
});
test('ranking reports excluded companies without demo fallback and reuses one in-flight snapshot per symbol', async () => {
  let calls = 0;
  const api = createResearchHandlers({ environment: () => environment, owner, now: () => now, research,
    history: async (...args) => { calls++; if (args[1].symbol === 'MSFT') throw new Error('private diagnostic'); return history(...args); } });
  const [a, b] = await Promise.all([api.company(get()), api.company(get())]);
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(calls, 1);
  const response = await api.ranking(post()), value = await response.json() as { ranked: { symbol: string }[]; snapshots: Record<string, unknown>; excluded: { symbol: string }[] };
  assert.equal(response.status, 200);
  assert.equal(value.ranked.length, 1);
  assert.deepEqual(Object.keys(value.snapshots), ['AAPL']);
  assert.equal(value.excluded[0].symbol, 'MSFT');
  assert.doesNotMatch(JSON.stringify(value), /private diagnostic|private-test/);
});
