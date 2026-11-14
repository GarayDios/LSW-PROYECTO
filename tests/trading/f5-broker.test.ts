import test from 'node:test';
import assert from 'node:assert/strict';
import { AlpacaOptionsClient } from '../../src/api/brokers/alpaca/options.ts';
import { BrokerError } from '../../src/api/brokers/alpaca/client.ts';
import type { F5OrderInput } from '../../src/features/f5/types.ts';

const config = { apiKey: 'test-private-key', secretKey: 'test-private-secret', ownerUserId: 'owner', dataFeed: 'iex' as const };
const now = Date.parse('2026-11-16T15:00:00Z');
const first = 'AAPL261218C00150000', second = 'AAPL261218C00160000';
const request: F5OrderInput = { client_order_id: 'tepic-f5-test', qty: '2', type: 'limit', time_in_force: 'day', limit_price: '-0.25', order_class: 'mleg', legs: [
  { symbol: first, side: 'sell', ratio_qty: '1', position_intent: 'sell_to_open' },
  { symbol: second, side: 'buy', ratio_qty: '2', position_intent: 'buy_to_open' },
] };
const responseOrder = (input: F5OrderInput = request) => ({ ...input, id: 'order-id', status: 'new', filled_qty: '0', legs: input.legs?.map((leg, i) => ({ ...leg, id: 'leg-' + i, client_order_id: 'child-' + i, qty: String(Number(input.qty) * Number(leg.ratio_qty)), status: 'new', filled_qty: '0' })) });
const metadata = (symbol: string, overrides: Record<string, unknown> = {}) => ({ symbol, underlying_symbol: 'AAPL', root_symbol: 'AAPL', type: symbol.includes('P00') ? 'put' : 'call', expiration_date: '2026-12-18', strike_price: symbol === first ? '150' : '160', size: '100', style: 'american', status: 'active', tradable: true, ...overrides });
type Call = { url: URL; init?: RequestInit; body?: F5OrderInput };
function setup(options: { lookup?: (calls: Call[]) => Response; post?: () => Response | Promise<Response>; account?: object; contracts?: (symbol: string) => object; route?: (call: Call) => Response | undefined; now?: () => number } = {}) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const call = { url: new URL(String(url)), init, body: init?.body ? JSON.parse(String(init.body)) as F5OrderInput : undefined }; calls.push(call);
    const custom = options.route?.(call); if (custom) return custom;
    const path = call.url.pathname;
    if (path === '/v2/account') return Response.json(options.account ?? { status: 'ACTIVE', cash: '100000', buying_power: '100000', options_buying_power: '100000', equity: '100000', options_trading_level: 3, options_approved_level: 3, trading_blocked: false, account_blocked: false });
    if (path === '/v2/clock') return Response.json({ is_open: true });
    if (path === '/v2/assets/AAPL') return Response.json({ symbol: 'AAPL', class: 'us_equity', status: 'active', tradable: true });
    if (path.startsWith('/v2/options/contracts/')) { const symbol = decodeURIComponent(path.split('/').at(-1)!); return Response.json(options.contracts?.(symbol) ?? metadata(symbol)); }
    if (path === '/v2/options/contracts') return Response.json({ option_contracts: [metadata(first), metadata(second)], next_page_token: null });
    if (path.startsWith('/v1beta1/options/snapshots')) {
      const symbols = call.url.searchParams.get('symbols')?.split(',') ?? [first, second];
      return Response.json({ snapshots: Object.fromEntries(symbols.map(symbol => [symbol, { latestQuote: { bp: 1, ap: 1.2, t: '2026-11-16T15:00:00Z' }, greeks: { delta: .4 } }])) });
    }
    if (path === '/v2/orders:by_client_order_id') return options.lookup?.(calls) ?? new Response('', { status: 404 });
    if (path === '/v2/orders' && init?.method === 'POST') return options.post?.() ?? Response.json(responseOrder(call.body));
    if (path === '/v2/orders') return Response.json([]);
    if (path === '/v2/positions') return Response.json([]);
    if (path === '/v2/account/activities') return Response.json([]);
    if (path === '/v2/orders/order-id' && init?.method === 'DELETE') return new Response(null, { status: 204 });
    throw Error('unexpected mock path');
  };
  return { client: new AlpacaOptionsClient(config, { fetcher, feed: 'opra', now: options.now ?? (() => now) }), calls };
}
const errorCode = (code: string) => (error: unknown) => error instanceof BrokerError && error.code === code;

test('equity hedge accepts a coherent inferred intent and refuses an inferred short position', async () => {
  const hedge: F5OrderInput = { client_order_id: 'f5_equity_test', symbol: 'AAPL', qty: '1', type: 'limit', time_in_force: 'day', limit_price: '100', side: 'buy' };
  for (const position_intent of [undefined, null, 'buy_to_open']) {
    const s = setup({ post: () => Response.json({ ...responseOrder(hedge), position_intent }) });
    assert.equal((await s.client.submit(hedge)).status, 'new');
    assert.equal(s.calls.filter(call => call.init?.method === 'POST').length, 1);
  }
  const invalid = setup({ post: () => Response.json({ ...responseOrder(hedge), position_intent: 'buy_to_close' }) });
  await assert.rejects(invalid.client.submit(hedge), errorCode('broker_order_conflict'));
  assert.equal(invalid.calls.filter(call => call.init?.method === 'POST').length, 1);
});

test('F5 uses hardcoded Paper, explicit OPRA, OCC metadata and observed quote with no model substitution', async () => {
  const { client, calls } = setup();
  const chain = await client.contracts('AAPL'); assert.equal(chain.complete, true); assert.equal(chain.feed, 'opra'); assert.equal(chain.contracts[0].bid, 1); assert.equal(chain.contracts[0].delta, .4);
  assert.equal((await client.contract(first)).symbol, first);
  assert.equal((await client.account()).optionsLevel, 3);
  assert.equal((await client.account()).optionsBuyingPower, 100000);
  for (const call of calls) { assert.ok(['https://paper-api.alpaca.markets', 'https://data.alpaca.markets'].includes(call.url.origin)); assert.equal(call.init?.redirect, 'manual'); assert.equal(new Headers(call.init?.headers).get('APCA-API-SECRET-KEY'), config.secretKey); }
  assert.ok(calls.filter(call => call.url.pathname.includes('snapshots')).every(call => call.url.searchParams.get('feed') === 'opra'));
  assert.match(calls.find(call => call.url.pathname === '/v2/options/contracts')!.url.searchParams.get('expiration_date_lte')!, /^2029-/);
});

test('F5 filters adjusted/inactive contracts and rejects wrong underlying and OCC metadata mismatch', async () => {
  for (const overrides of [{ size: '10' }, { root_symbol: 'AAPL1' }, { style: 'european' }, { tradable: false }]) {
    const { client } = setup({ contracts: symbol => metadata(symbol, overrides) });
    await assert.rejects(client.contract(first), errorCode('broker_contract_invalid'));
  }
  await assert.rejects(setup({ contracts: symbol => metadata(symbol, { strike_price: '999' }) }).client.contract(first), errorCode('broker_response_invalid'));
  const wrong = setup({ route: call => call.url.pathname === '/v2/options/contracts' ? Response.json({ option_contracts: [metadata(first, { underlying_symbol: 'MSFT' })] }) : undefined });
  await assert.rejects(wrong.client.contracts('AAPL'), errorCode('broker_response_invalid'));
});

test('single-contract detail accepts the standard physical 100-share deliverable and rejects adjusted deliveries', async () => {
  const ordinary = { type: 'equity', symbol: 'AAPL', asset_id: 'test-equity-asset', amount: '100', allocation_percentage: '100', settlement_type: 'T+1', settlement_method: 'CCC', delayed_settlement: false };
  const valid = setup({ contracts: symbol => metadata(symbol, { deliverables: [ordinary] }) });
  assert.equal((await valid.client.contract(first)).size, 100);
  for (const deliverables of [[], [{ ...ordinary, amount: '150' }], [{ ...ordinary, symbol: 'MSFT' }], [{ ...ordinary, type: 'cash' }], [{ ...ordinary, allocation_percentage: '90' }], [{ ...ordinary, delayed_settlement: true }], [ordinary, { type: 'cash', amount: '1' }]]) {
    const { client } = setup({ contracts: symbol => metadata(symbol, { deliverables }) });
    await assert.rejects(client.contract(first), errorCode('broker_contract_invalid'));
  }
});

test('F5 mleg sends simplified 1:2 and credit sign intact, and validates the complete broker identity', async () => {
  const { client, calls } = setup();
  const order = await client.submit(request); assert.equal(order.limit_price, '-0.25');
  assert.deepEqual(calls.find(call => call.init?.method === 'POST')!.body, request);
  assert.equal(calls.filter(call => call.init?.method === 'POST').length, 1);
  const invalidRatios = { ...request, legs: request.legs!.map(leg => ({ ...leg, ratio_qty: String(Number(leg.ratio_qty) * 2) })) };
  await assert.rejects(client.submit(invalidRatios), errorCode('broker_order_invalid'));
  const duplicate = { ...request, legs: [request.legs![0], request.legs![0]] };
  await assert.rejects(client.submit(duplicate), errorCode('broker_order_invalid'));
});

test('F5 idempotency accepts reordered existing legs but rejects ratio, credit sign and intent mismatches', async () => {
  const existing = responseOrder(); existing.legs!.reverse();
  const valid = setup({ lookup: () => Response.json(existing) });
  await valid.client.submit(request); assert.equal(valid.calls.length, 1);
  for (const change of [(order: ReturnType<typeof responseOrder>) => { order.limit_price = '0.25'; }, (order: ReturnType<typeof responseOrder>) => { order.legs![0].ratio_qty = '2'; }, (order: ReturnType<typeof responseOrder>) => { order.legs![0].position_intent = 'buy_to_close'; }, (order: ReturnType<typeof responseOrder>) => { order.legs = []; }]) {
    const order = responseOrder(); change(order); const { client, calls } = setup({ lookup: () => Response.json(order) });
    await assert.rejects(client.submit(request), errorCode('broker_order_conflict')); assert.equal(calls.some(call => call.init?.method === 'POST'), false);
  }
});

test('ambiguous mleg POST reconciles stable ID once and never retries a lost write', async () => {
  const recovered = setup({ post: () => { throw Error('private upstream URL'); }, lookup: calls => calls.some(call => call.init?.method === 'POST') ? Response.json(responseOrder()) : new Response('', { status: 404 }) });
  assert.equal((await recovered.client.submit(request)).id, 'order-id'); assert.equal(recovered.calls.filter(call => call.init?.method === 'POST').length, 1);
  const lost = setup({ post: () => Response.json({ private: 'secret' }) });
  await assert.rejects(lost.client.submit(request), errorCode('broker_order_ambiguous'));
  await assert.rejects(lost.client.submit(request), errorCode('broker_order_ambiguous'));
  assert.equal(lost.calls.filter(call => call.init?.method === 'POST').length, 1);
  const missingLegs = setup({ post: () => Response.json({ ...responseOrder(), legs: undefined }) });
  await assert.rejects(missingLegs.client.submit(request), errorCode('broker_order_conflict'));
  assert.equal(missingLegs.calls.filter(call => call.init?.method === 'POST').length, 1);
});

test('F5 errors sanitize provider messages, do not follow redirects and never expose credentials', async () => {
  for (const status of [302, 401, 403, 429, 500]) {
    const client = new AlpacaOptionsClient(config, { fetcher: async () => Response.json({ message: config.secretKey }, { status }) });
    await assert.rejects(client.account(), (error: unknown) => error instanceof BrokerError && !error.message.includes(config.secretKey));
  }
  const { client, calls } = setup(); await assert.rejects(client.contract('../account'), errorCode('broker_order_invalid')); assert.equal(calls.length, 0);
});

test('effective options level is mandatory and cannot be inferred from approved level', async () => {
  const { client, calls } = setup({ account: { status: 'ACTIVE', cash: '100000', buying_power: '100000', options_buying_power: '100000', equity: '100000', options_trading_level: 1, options_approved_level: 3, trading_blocked: false, account_blocked: false } });
  await assert.rejects(client.submit(request), errorCode('broker_options_level_required')); assert.equal(calls.some(call => call.init?.method === 'POST'), false);
});

test('orders paginate by ID including equity without dropping equal-timestamp entries', async () => {
  const equity = (id: string) => ({ id, client_order_id: id, symbol: 'AAPL', side: 'sell', qty: '1', filled_qty: '0', status: 'new', type: 'limit', time_in_force: 'day', limit_price: '100' });
  const { client, calls } = setup({ route: call => call.url.pathname === '/v2/orders' ? Response.json(call.url.searchParams.has('before_order_id') ? [equity('last')] : Array.from({ length: 500 }, (_, i) => equity('eq-' + i))) : undefined });
  assert.equal((await client.orders()).length, 501);
  assert.equal(calls.at(-1)!.url.searchParams.get('before_order_id'), 'eq-499');
  assert.equal(calls[0].url.searchParams.get('nested'), 'true'); assert.equal(calls[0].url.searchParams.has('asset_class'), false);
});

test('positions and paper option activities preserve real quantities; cancel returns no fabricated fill', async () => {
  const { client } = setup({ route: call => call.url.pathname === '/v2/account/activities' ? Response.json([{ id: 'activity::1', activity_type: 'OPASN', symbol: first, date: '2026-11-16', qty: '1' }]) : call.url.pathname === '/v2/positions' ? Response.json([{ symbol: first, qty: '-1', asset_class: 'us_option', avg_entry_price: '1.5' }, { symbol: 'AAPL', qty: '100', asset_class: 'us_equity' }]) : undefined });
  assert.equal((await client.positions())[0].quantity, -1); assert.equal((await client.activities())[0].type, 'OPASN'); await client.cancel('order-id');
});

test('a review expiring during broker checks cannot reach POST but existing orders still reconcile', async () => {
  let current = now;
  const expired = setup({ now: () => current, route: call => { if (call.url.pathname.startsWith('/v1beta1/options/snapshots')) current = now + 2000; return undefined; } });
  await assert.rejects(expired.client.submit(request, now + 1000), errorCode('f5_preview_expired'));
  assert.equal(expired.calls.some(call => call.init?.method === 'POST'), false);
  const existing = setup({ lookup: () => Response.json(responseOrder()) });
  assert.equal((await existing.client.submit(request, now - 1000)).id, 'order-id');
  assert.equal(existing.calls.length, 1);
});
