import test from 'node:test';
import assert from 'node:assert/strict';
import { AlpacaPaperClient, BrokerConfigError, BrokerError, readBrokerConfig, type BrokerConfig, type BrokerOrder, type PaperOrderInput } from '../../src/api/brokers/index.ts';

const config: BrokerConfig = { apiKey: 'paper-test-key', secretKey: 'paper-test-secret', ownerUserId: 'owner-test', dataFeed: 'iex' };
const input: PaperOrderInput = { symbol: 'AAPL', qty: '2', side: 'buy', type: 'limit', time_in_force: 'day', limit_price: '100.00', client_order_id: 'tepic-signal-123' };
const account = { id: 'paper-account', status: 'ACTIVE', buying_power: '1000', cash: '1000', equity: '1000', trading_blocked: false, account_blocked: false };
const asset = { id: 'asset-aapl', symbol: 'AAPL', class: 'us_equity', name: 'Apple', exchange: 'NASDAQ', status: 'active', tradable: true };
const clock = { is_open: true, timestamp: '2026-11-13T15:00:00Z', next_open: '2026-11-16T14:30:00Z', next_close: '2026-11-13T21:00:00Z' };
const order = (request: PaperOrderInput = input): BrokerOrder => ({ ...request, id: 'order-one', filled_qty: '0', status: 'new' });
type Call = { url: URL; method: string; headers: Headers; body: unknown; init?: RequestInit };

function setup(options: {
  account?: object; asset?: object; clock?: object; position?: object | null; open?: object[];
  lookup?: (call: Call) => Response | Promise<Response>;
  post?: (call: Call) => Response | Promise<Response>;
} = {}) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (resource, init) => {
    const call: Call = { url: new URL(String(resource)), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body ? JSON.parse(init.body as string) : null, init };
    calls.push(call);
    if (call.url.pathname === '/v2/account') return Response.json(options.account ?? account);
    if (call.url.pathname === '/v2/assets/AAPL') return Response.json(options.asset ?? asset);
    if (call.url.pathname === '/v2/clock') return Response.json(options.clock ?? clock);
    if (call.url.pathname === '/v2/positions/AAPL') return options.position === null ? new Response('', { status: 404 }) : Response.json(options.position ?? { symbol: 'AAPL', qty: '10', asset_class: 'us_equity' });
    if (call.url.pathname === '/v2/orders:by_client_order_id') return options.lookup?.(call) ?? new Response('', { status: 404 });
    if (call.url.pathname === '/v2/orders' && call.method === 'POST') return options.post?.(call) ?? Response.json(order(call.body as PaperOrderInput));
    if (call.url.pathname === '/v2/orders') return Response.json(options.open ?? []);
    if (call.url.pathname === '/v2/stocks/AAPL/quotes/latest') return Response.json({ quote: { bp: 99.5, ap: 100, t: '2026-11-13T15:00:00.123456789Z' } });
    throw Error('Unexpected mocked broker endpoint');
  };
  return { client: new AlpacaPaperClient(config, fetcher), calls };
}
const isBrokerError = (code: string, status?: number) => (error: unknown) => error instanceof BrokerError && error.code === code && (status === undefined || error.status === status);

test('paper transport uses Worker-compatible manual redirects and never follows a new host', async () => {
  let calls = 0;
  const client = new AlpacaPaperClient(config, async (resource, init) => {
    calls++;
    assert.equal(init?.redirect, 'manual');
    assert.equal(new URL(String(resource)).origin, 'https://paper-api.alpaca.markets');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.test/credentials' } });
  });
  await assert.rejects(client.getAccount(), isBrokerError('broker_unavailable', 503));
  assert.equal(calls, 1);
});

test('brackets send whole-share GTC entries and two validated exit prices only to Paper', async () => {
  const bracket = { ...input, side: 'buy' as const, time_in_force: 'gtc' as const, order_class: 'bracket' as const, take_profit: { limit_price: '110.00' }, stop_loss: { stop_price: '95.00' } };
  const { client, calls } = setup();
  const result = await client.submitPaperOrder(bracket);
  assert.equal(result.order_class, 'bracket'); assert.deepEqual(calls.find(call => call.method === 'POST')!.body, bracket);
  const before = calls.length;
  for (const bad of [{ ...bracket, side: 'sell' }, { ...bracket, stop_loss: { stop_price: '101' } }, { ...bracket, take_profit: { limit_price: '99' } }, { ...bracket, extended_hours: true }]) await assert.rejects(client.submitPaperOrder(bad as PaperOrderInput), isBrokerError('broker_order_invalid'));
  assert.equal(calls.length, before);
  const conflict = setup({ lookup: () => Response.json({ ...order(bracket), order_class: 'simple' }) });
  await assert.rejects(conflict.client.submitPaperOrder(bracket), isBrokerError('broker_order_conflict'));
  assert.equal(conflict.calls.filter(call => call.method === 'POST').length, 0);
});

test('broker configuration is server-only opt-in, requires an owner and rejects live overrides', () => {
  assert.equal(readBrokerConfig({}), null);
  for (const values of [{ ALPACA_API_KEY: 'x' }, { ALPACA_API_KEY: 'x', ALPACA_SECRET_KEY: 'y' }, { BROKER_OWNER_USER_ID: 'owner' }]) assert.throws(() => readBrokerConfig(values), BrokerConfigError);
  const values = { ALPACA_API_KEY: 'x', ALPACA_SECRET_KEY: 'y', BROKER_OWNER_USER_ID: 'owner' };
  assert.deepEqual(readBrokerConfig(values), { apiKey: 'x', secretKey: 'y', ownerUserId: 'owner', dataFeed: 'iex' });
  assert.throws(() => readBrokerConfig({ ...values, ALPACA_DATA_FEED: 'untrusted' }), BrokerConfigError);
  assert.throws(() => readBrokerConfig({ ...values, APCA_API_BASE_URL: 'https://api.alpaca.markets' }), BrokerConfigError);
  assert.throws(() => readBrokerConfig({ ...values, ALPACA_SECRET_KEY: 'y\nAuthorization: injected' }), BrokerConfigError);
  assert.throws(() => new AlpacaPaperClient({ ...config, baseUrl: 'https://api.alpaca.markets' } as BrokerConfig), BrokerConfigError);
});

test('account, asset and clock requests use fixed Paper host and secret headers only on the server', async () => {
  const { client, calls } = setup();
  assert.deepEqual(await client.getAccount(), account);
  assert.deepEqual(await client.getAsset('AAPL'), asset);
  assert.deepEqual(await client.getClock(), clock);
  assert.deepEqual(calls.map(call => call.url.href), ['https://paper-api.alpaca.markets/v2/account', 'https://paper-api.alpaca.markets/v2/assets/AAPL', 'https://paper-api.alpaca.markets/v2/clock']);
  for (const call of calls) {
    assert.equal(call.headers.get('APCA-API-KEY-ID'), config.apiKey);
    assert.equal(call.headers.get('APCA-API-SECRET-KEY'), config.secretKey);
    assert.equal(call.init?.redirect, 'manual');
    assert.ok(call.init?.signal instanceof AbortSignal);
    assert.equal(call.url.searchParams.has('apiKey'), false);
  }
});

test('latest quote uses fixed data host, explicit feed and converts nanosecond RFC3339 to milliseconds', async () => {
  const { client, calls } = setup();
  assert.deepEqual(await client.getLatestQuote('AAPL'), { bidPrice: 99.5, askPrice: 100, time: Date.parse('2026-11-13T15:00:00.123Z') });
  assert.equal(calls[0].url.href, 'https://data.alpaca.markets/v2/stocks/AAPL/quotes/latest?feed=iex');
  const invalid = new AlpacaPaperClient(config, async () => Response.json({ quote: { bp: 101, ap: 100, t: clock.timestamp } }));
  await assert.rejects(invalid.getLatestQuote('AAPL'), isBrokerError('broker_response_invalid'));
});

test('provider permissions, rate limits, network faults and malformed data are sanitized', async () => {
  for (const [status, code] of [[401, 'broker_credentials_invalid'], [403, 'broker_access_denied'], [429, 'broker_rate_limited']] as const) {
    const client = new AlpacaPaperClient(config, async () => Response.json({ message: 'secret-key private-diagnostic' }, { status }));
    await assert.rejects(client.getAccount(), (error: unknown) => isBrokerError(code, status)(error) && error instanceof Error && !/secret-key|private-diagnostic/.test(error.message));
  }
  const disconnected = new AlpacaPaperClient(config, async () => { throw new Error('secret-key https://private-host'); });
  await assert.rejects(disconnected.getAccount(), (error: unknown) => isBrokerError('broker_unavailable')(error) && error instanceof Error && !/secret-key|private-host/.test(error.message));
  const malformed = new AlpacaPaperClient(config, async () => Response.json({ ...account, cash: 'Infinity' }));
  await assert.rejects(malformed.getAccount(), isBrokerError('broker_response_invalid'));
});

test('untrusted symbols and IDs cannot select arbitrary routes or send options', async () => {
  const { client, calls } = setup();
  await assert.rejects(client.getAsset('../account'), isBrokerError('broker_symbol_invalid'));
  await assert.rejects(client.getAsset('AAPL261225C00500000'), isBrokerError('broker_symbol_invalid'));
  await assert.rejects(client.getOrderByClientId('other&id=secret'), isBrokerError('broker_order_invalid'));
  assert.equal(calls.length, 0);
});

test('a valid whole-share limit order is sent once to Paper after account, asset and market checks', async () => {
  const { client, calls } = setup();
  assert.deepEqual(await client.submitPaperOrder(input), order());
  const writes = calls.filter(call => call.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url.href, 'https://paper-api.alpaca.markets/v2/orders');
  assert.deepEqual(writes[0].body, input);
  assert.equal(writes[0].headers.get('Content-Type'), 'application/json');
});

test('input validation rejects fractional, leveraged, extended-hour, options and live-URL fields before networking', async () => {
  const { client, calls } = setup();
  const bad = [{ ...input, qty: '0.5' }, { ...input, type: 'market' }, { ...input, extended_hours: true }, { ...input, baseUrl: 'https://api.alpaca.markets' }, { ...input, symbol: 'AAPL261225C00500000' }, { ...input, limit_price: '100.001' }, { ...input, notional: '100' }];
  for (const value of bad) await assert.rejects(client.submitPaperOrder(value as PaperOrderInput), isBrokerError('broker_order_invalid'));
  assert.equal(calls.length, 0);
});

test('blocked account, non-equity asset, closed market and cash shortage never create an order', async () => {
  for (const [options, code] of [
    [{ account: { ...account, trading_blocked: true } }, 'broker_account_blocked'],
    [{ account: { ...account, status: 'ACCOUNT_UPDATED' } }, 'broker_account_blocked'],
    [{ asset: { ...asset, class: 'us_option' } }, 'broker_asset_not_tradable'],
    [{ asset: { ...asset, tradable: false } }, 'broker_asset_not_tradable'],
    [{ clock: { ...clock, is_open: false } }, 'broker_market_closed'],
    [{ account: { ...account, buying_power: '10000', cash: '100' } }, 'broker_insufficient_funds'],
  ] as const) {
    const { client, calls } = setup(options);
    await assert.rejects(client.submitPaperOrder(input), isBrokerError(code));
    assert.equal(calls.some(call => call.method === 'POST'), false);
  }
});

test('sales require long stock after reserving other open sale quantities', async () => {
  const sale = { ...input, side: 'sell' as const };
  for (const options of [{ position: null }, { position: { symbol: 'AAPL', qty: '-1' } }, { position: { symbol: 'AAPL', qty: '3' }, open: [{ ...order(sale), qty: '3', filled_qty: '1' }] }]) {
    const { client, calls } = setup(options);
    await assert.rejects(client.submitPaperOrder(sale), isBrokerError('broker_insufficient_position'));
    assert.equal(calls.some(call => call.method === 'POST'), false);
  }
  const { client, calls } = setup({ position: { symbol: 'AAPL', qty: '4' }, open: [{ ...order(sale), qty: '3', filled_qty: '1' }] });
  assert.equal((await client.submitPaperOrder(sale)).side, 'sell');
  assert.match(calls.find(call => call.url.pathname === '/v2/orders' && call.method === 'GET')!.url.search, /symbols=AAPL/);
});

test('stable client IDs reconcile existing orders and reject a conflicting payload without another POST', async () => {
  const existing = setup({ lookup: () => Response.json(order()) });
  assert.deepEqual(await existing.client.submitPaperOrder(input), order());
  assert.equal(existing.calls.length, 1);
  const conflicting = setup({ lookup: () => Response.json({ ...order(), qty: '3' }) });
  await assert.rejects(conflicting.client.submitPaperOrder(input), isBrokerError('broker_order_conflict', 409));
  assert.equal(conflicting.calls.some(call => call.method === 'POST'), false);
});

test('an ambiguous POST reconciles by client ID and never repeats the write', async () => {
  let posted = false;
  const { client, calls } = setup({
    lookup: () => posted ? Response.json(order()) : new Response('', { status: 404 }),
    post: () => { posted = true; throw new Error('timeout after secret broker insert'); },
  });
  assert.deepEqual(await client.submitPaperOrder(input), order());
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(calls.filter(call => call.url.pathname === '/v2/orders:by_client_order_id').length, 2);
});

test('unresolved POST ambiguity blocks automatic retries and never pretends an order failed definitively', async () => {
  const { client, calls } = setup({ post: () => new Response('private server error', { status: 500 }) });
  await assert.rejects(client.submitPaperOrder(input), (error: unknown) => isBrokerError('broker_order_ambiguous', 503)(error) && error instanceof BrokerError && error.safeToRetry === false);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});
