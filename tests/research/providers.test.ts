import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAlpacaNews, fetchAlpacaOptions } from '../../src/api/research/alpaca.ts';
import { deriveSecFundamentals, fetchSecFundamentals } from '../../src/api/research/sec.ts';
import { fetchFredMacro } from '../../src/api/research/fred.ts';
import { fetchCompanyResearch } from '../../src/api/research/company.ts';
import type { ResearchFetch } from '../../src/api/research/http.ts';

const asOf = '2026-11-13T16:00:00.000Z';
const now = new Date(asOf);
const config = { apiKey: 'test-key-never-output', secretKey: 'test-secret-never-output', optionsFeed: 'indicative' as const };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const contract = (symbol: string) => ({ symbol, underlying_symbol: 'AAPL', type: 'call', expiration_date: '2026-12-18', style: 'american', strike_price: '100', open_interest: '500', open_interest_date: '2026-11-12' });
const snapshot = () => ({ impliedVolatility: .25, latestQuote: { t: asOf, bp: 4, ap: 6 }, greeks: { delta: .5, gamma: .02, theta: -.01, vega: .1 } });

test('Alpaca joins actual contracts to snapshots, follows both page tokens, labels indicative estimates', async () => {
  const requests: URL[] = [];
  const fetcher: ResearchFetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(init?.redirect, 'manual');
    if (url.pathname.includes('/snapshots/')) return json({ snapshots: { [url.searchParams.has('page_token') ? 'second' : 'first']: snapshot() }, next_page_token: url.searchParams.has('page_token') ? null : 'chain-next' });
    return json({ option_contracts: [contract(url.searchParams.has('page_token') ? 'second' : 'first')], next_page_token: url.searchParams.has('page_token') ? null : 'contracts-next' });
  };
  const result = await fetchAlpacaOptions(config, 'AAPL', asOf, fetcher, now);
  assert.equal(result.contracts.length, 2);
  assert.equal(result.complete, true);
  assert.ok(requests.some(url => url.searchParams.get('page_token') === 'chain-next'));
  assert.ok(requests.some(url => url.searchParams.get('page_token') === 'contracts-next'));
  assert.equal(requests.find(url => url.pathname.includes('snapshots'))!.searchParams.get('feed'), 'indicative');
  assert.equal(result.contracts[0].premium.value, 5);
  assert.equal(result.contracts[0].impliedVolatility.value, .25);
  assert.equal(result.contracts[0].impliedVolatility.kind, 'estimated');
  assert.equal(result.contracts[0].strike.kind, 'observed');
  assert.equal(result.contracts[0].premium.availableAt, asOf);
});

test('a page bound is visible and a provider denial cannot trigger an undocumented feed fallback', async () => {
  let calls = 0;
  const bounded = await fetchAlpacaOptions({ ...config, maxPages: 1 }, 'AAPL', asOf, async input => {
    calls++;
    return String(input).includes('/snapshots/') ? json({ snapshots: { first: snapshot() }, next_page_token: 'more' })
      : json({ option_contracts: [contract('first')], next_page_token: 'more' });
  }, now);
  assert.equal(calls, 2);
  assert.equal(bounded.complete, false);
  assert.equal(bounded.status.status, 'partial');
  assert.ok(bounded.warnings.some(text => /límite/.test(text)));
  const deniedFeeds: string[] = [];
  const denied = await fetchAlpacaOptions({ ...config, optionsFeed: 'opra' }, 'AAPL', asOf, async input => {
    const url = new URL(String(input)); if (url.searchParams.has('feed')) deniedFeeds.push(url.searchParams.get('feed')!);
    return json({ message: config.secretKey }, 403);
  }, now);
  assert.equal(denied.status.status, 'error');
  assert.deepEqual(deniedFeeds, ['opra']);
  assert.equal(denied.contracts.length, 0);
  assert.ok(!JSON.stringify(denied).includes(config.secretKey));
});

test('historical cuts never query a latest chain and stale option quotes do not produce IV inputs', async () => {
  let called = false;
  const past = await fetchAlpacaOptions(config, 'AAPL', '2025-01-01T00:00:00Z', async () => { called = true; return json({}); }, now);
  assert.equal(called, false);
  assert.equal(past.status.status, 'unavailable');
  const stale = await fetchAlpacaOptions(config, 'AAPL', asOf, async input => String(input).includes('/snapshots/')
    ? json({ snapshots: { first: { ...snapshot(), latestQuote: { t: '2026-11-12T16:00:00Z', bp: 4, ap: 6 } } } })
    : json({ option_contracts: [contract('first')] }), now);
  assert.equal(stale.contracts[0].premium.value, null);
  assert.equal(stale.contracts[0].premium.lastReceived?.value, 5);
  assert.equal(stale.contracts[0].impliedVolatility.lastReceived?.value, .25);
  assert.equal(stale.contracts[0].premium.lastReceived?.observedAt, "2026-11-12T16:00:00.000Z");
  assert.equal(stale.contracts[0].impliedVolatility.value, null);
});

test('redirects are rejected without following credentials and errors contain no provider body', async () => {
  let calls = 0;
  const result = await fetchAlpacaOptions(config, 'AAPL', asOf, async (_input, init) => {
    calls++; assert.equal(init?.redirect, 'manual');
    return new Response(config.secretKey, { status: 302, headers: { Location: 'https://untrusted.invalid/' } });
  }, now);
  assert.equal(calls, 2);
  assert.equal(result.status.status, 'error');
  assert.match(result.status.message, /redirigir/);
  assert.ok(!JSON.stringify(result).includes(config.secretKey));
});

test('SEC uses acceptance publication date, ignores future amendments, and preserves comparable accounting periods', () => {
  const annual = { start: '2024-10-01', end: '2025-09-30', filed: '2025-11-01', form: '10-K', accn: 'known' };
  const facts = { entityName: 'Test', facts: { 'us-gaap': {
    Revenues: { units: { USD: [{ ...annual, val: 100 }, { ...annual, filed: '2026-12-01', accn: 'future-amendment', val: 9999 }] } },
    NetIncomeLoss: { units: { USD: [{ ...annual, val: 20 }] } },
    Assets: { units: { USD: [{ end: '2026-09-30', filed: '2026-11-13', accn: 'today', form: '10-K', val: 500 }] } },
    Liabilities: { units: { USD: [{ end: '2025-09-30', filed: '2025-11-01', form: '10-K', val: 200 }] } },
  } } };
  const submissions = { name: 'Current name', filings: { recent: { accessionNumber: ['known', 'today'], acceptanceDateTime: ['2025-11-01T21:00:00Z', '2026-11-13T17:00:00Z'] } } };
  const result = deriveSecFundamentals(facts, submissions, asOf, '0000000001');
  assert.equal(result.annualRevenue.value, 100);
  assert.equal(result.annualRevenue.availableAt, '2025-11-01T21:00:00.000Z');
  assert.equal(result.netMargin.value, .2);
  assert.equal(result.assets.value, null);
  assert.equal(result.liabilitiesToAssets.value, null);
  assert.equal(result.dividendYield.value, null);
});

test('SEC filed-only facts conservatively wait until the Eastern filing day has ended', () => {
  const facts = { facts: { 'us-gaap': { Assets: { units: { USD: [{ end: '2026-09-30', filed: '2026-11-13', form: '10-K', val: 500 }] } } } } };
  assert.equal(deriveSecFundamentals(facts, {}, asOf, '1').assets.value, null);
  assert.equal(deriveSecFundamentals(facts, {}, '2026-11-14T05:00:00Z', '1').assets.value, 500);
});

test('optional SEC/FRED config missing is explicit and never invokes fetch', async () => {
  const forbidden: ResearchFetch = async () => { assert.fail('Must not fetch without configuration'); };
  assert.equal((await fetchSecFundamentals(undefined, 'AAPL', asOf, forbidden)).status.status, 'missing_config');
  assert.equal((await fetchFredMacro(undefined, asOf, forbidden)).riskFreeRate.value, null);
  const result = await fetchCompanyResearch({ symbol: 'AAPL', bars: [], asOf }, forbidden, now);
  assert.equal(result.market.spot.value, null);
  assert.equal(result.options.contracts.length, 0);
  assert.ok(result.quality.missing.includes('macro.riskFreeRate'));
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('concurrent SEC research shares the ticker cache and spaces provider requests', async () => {
  const calls: { url: string; at: number }[] = [];
  const fetcher: ResearchFetch = async input => {
    const url = String(input); calls.push({ url, at: Date.now() });
    if (url.includes('company_tickers')) return json({ 0: { ticker: 'AAPL', cik_str: 1 }, 1: { ticker: 'MSFT', cik_str: 2 } });
    if (url.includes('companyfacts')) return json({ facts: { 'us-gaap': { Assets: { units: { USD: [{ val: 5, end: '2025-09-30', filed: '2025-11-01', form: '10-K' }] } } } } });
    return json({ name: 'Test', filings: { recent: {} } });
  };
  const [one, two] = await Promise.all([
    fetchSecFundamentals({ userAgent: 'Tepic test contact@example.invalid' }, 'AAPL', asOf, fetcher),
    fetchSecFundamentals({ userAgent: 'Tepic test contact@example.invalid' }, 'MSFT', asOf, fetcher),
  ]);
  assert.equal(one.assets.value, 5);
  assert.equal(two.assets.value, 5);
  assert.equal(calls.filter(call => call.url.includes('company_tickers')).length, 1);
  assert.equal(calls.length, 5);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].at - calls[i - 1].at >= 180, 'SEC request starts should be spaced');
});

test('FRED requests historical vintage and converts rate/inflation/GDP units explicitly', async () => {
  const requests: URL[] = [];
  const result = await fetchFredMacro({ apiKey: 'fred-test-key' }, asOf, async (input, init) => {
    assert.equal(init?.redirect, 'manual');
    const url = new URL(String(input)); requests.push(url);
    const id = url.searchParams.get('series_id');
    return json({ observations: id === 'DGS3MO' ? [{ date: '2026-11-11', value: '4.0' }, { date: '2026-11-10', value: '.' }]
      : id === 'CPIAUCSL' ? [{ date: '2026-09-01', value: '103' }, { date: '2025-09-01', value: '100' }]
        : [{ date: '2026-07-01', value: '2.5' }] });
  });
  assert.equal(requests.length, 3);
  for (const url of requests) {
    assert.equal(url.searchParams.get('realtime_start'), '2026-11-12');
    assert.equal(url.searchParams.get('realtime_end'), '2026-11-12');
    assert.equal(url.searchParams.get('observation_end'), '2026-11-12');
  }
  assert.equal(result.treasury3MonthPercent.value, 4);
  assert.ok(Math.abs(result.riskFreeRate.value! - Math.log1p(.04)) < 1e-12);
  assert.ok(Math.abs(result.inflationYearOverYear.value! - .03) < 1e-12);
  assert.equal(result.realGdpGrowth.value, .025);
  assert.equal(result.riskFreeRate.kind, 'estimated');
  assert.ok(Date.parse(result.riskFreeRate.availableAt!) <= Date.parse(asOf));
});

test('news excludes headlines updated after decision cutoff and unsafe links', async () => {
  const news = await fetchAlpacaNews(config, 'AAPL', asOf, async () => json({ news: [
    { id: 1, headline: 'Known headline', created_at: '2026-11-13T12:00:00Z', updated_at: '2026-11-13T13:00:00Z', url: 'javascript:alert(1)' },
    { id: 2, headline: 'Future revision', created_at: '2026-11-13T12:00:00Z', updated_at: '2026-11-13T18:00:00Z', url: 'https://example.org' },
  ] }));
  assert.equal(news.articles.length, 1);
  assert.equal(news.articles[0].headline, 'Known headline');
  assert.equal(news.articles[0].url, null);
});

test('quote failures explain missing, invalid, future and stale prices separately', async () => {
  for (const [quote, reason] of [
    [{}, /fecha verificable/],
    [{ t: asOf, bp: 7, ap: 6 }, /no forman/],
    [{ t: '2026-11-14T16:00:00Z', bp: 4, ap: 6 }, /posterior/],
    [{ t: '2026-11-12T16:00:00Z', bp: 4, ap: 6 }, /una hora/],
  ] as const) {
    const result = await fetchAlpacaOptions(config, 'AAPL', asOf, async input => String(input).includes('/snapshots/')
      ? json({ snapshots: { first: { ...snapshot(), latestQuote: quote } } })
      : json({ option_contracts: [contract('first')] }), now);
    assert.equal(result.contracts[0].premium.value, null);
    assert.equal(result.contracts[0].delta.value, null);
    assert.match(result.contracts[0].bid.reason!, reason);
    if (!("t" in quote) || quote.t !== "2026-11-12T16:00:00Z") assert.equal(result.contracts[0].bid.lastReceived, undefined);
    assert.match(result.status.message, /0 con cotización válida/);
  }
});

test('inflation uses the newest complete same-month annual pair with its actual period', async () => {
  const result = await fetchFredMacro({ apiKey: 'test' }, asOf, async input => {
    const id = new URL(String(input)).searchParams.get('series_id');
    return json({ observations: id === 'CPIAUCSL' ? [
      { date: '2026-10-01', value: '110' }, { date: '2025-10-01', value: '.' },
      { date: '2026-09-01', value: '103' }, { date: '2025-09-01', value: '100' },
      { date: '2026-12-01', value: '999' },
    ] : [] });
  });
  assert.ok(Math.abs(result.inflationYearOverYear.value! - .03) < 1e-12);
  assert.equal(result.inflationYearOverYear.observedAt, '2026-09-01T00:00:00.000Z');
  assert.match(result.inflationYearOverYear.source, /2026-09/);
  assert.match(result.inflationYearOverYear.reason!, /comparación anual completa/);
});
