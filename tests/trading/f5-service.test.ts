import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrokerError } from '../../src/api/brokers/alpaca/client.ts';
import { createF5Service, type F5Broker } from '../../services/trading-runner/f5-service.ts';
import { openF5Store } from '../../services/trading-runner/f5-store.ts';
import { openRunnerStore } from '../../services/trading-runner/store.ts';
import { createRunnerService } from '../../services/trading-runner/server.ts';
import type { F5Account, F5Activity, F5BrokerOrder, F5Contract, F5OpenRequest, F5Operation, F5OrderInput, F5Position, F5Request, F5Status } from '../../src/features/f5/types.ts';

const NOW = Date.parse('2026-11-16T16:00:00Z');
const owner = 'owner-a';
const put = 'AAPL261218P00180000', call = 'AAPL261218C00180000', callHigh = 'AAPL261218C00190000', longCall = 'AAPL270618C00170000';
function contract(symbol: string, time = NOW): F5Contract {
  const match = symbol.match(/(\d{6})([CP])(\d{8})$/)!;
  return { symbol, underlying: 'AAPL', type: match[2] === 'C' ? 'call' : 'put', expiry: `20${match[1].slice(0, 2)}-${match[1].slice(2, 4)}-${match[1].slice(4, 6)}`, strike: Number(match[3]) / 1000, size: 100, style: 'american', tradable: true, bid: 2, ask: 2.2, quoteTime: new Date(time).toISOString(), delta: match[2] === 'C' ? 0.45 : -0.55 };
}
const position = (symbol: string, quantity: number): F5Position => ({ symbol, quantity, assetClass: symbol.length > 15 ? 'us_option' : 'us_equity', marketValue: null, averagePrice: null, unrealizedPnl: null });
const wheel = (patch: Partial<F5OpenRequest> = {}): F5OpenRequest => ({ action: 'open', strategy: 'wheel', underlying: 'AAPL', quantity: 1, contracts: [put], wheelPhase: 'put', limitPrice: 2, maxCapitalUsd: 20000, ...patch });
const pmcc = (): F5OpenRequest => ({ action: 'open', strategy: 'pmcc', underlying: 'AAPL', quantity: 1, contracts: [longCall, callHigh], limitPrice: 5, maxCapitalUsd: 20000 });
const gamma = (): F5OpenRequest => ({ action: 'open', strategy: 'gamma', underlying: 'AAPL', quantity: 1, contracts: [call, put], limitPrice: 4.2, maxCapitalUsd: 1000 });
function reply(input: F5OrderInput, state = 'new', filled = 0): F5BrokerOrder {
  return { id: `broker_${input.client_order_id}`, client_order_id: input.client_order_id, status: state, qty: input.qty, filled_qty: String(filled), filled_avg_price: filled ? input.limit_price : null,
    symbol: input.symbol, side: input.side, limit_price: input.limit_price, order_class: input.order_class ?? 'simple', type: input.type, time_in_force: input.time_in_force, position_intent: input.position_intent,
    ...(input.legs ? { legs: input.legs.map(leg => ({ id: `leg_${input.client_order_id}_${leg.symbol}`, client_order_id: 'child_' + leg.symbol, status: state, qty: String(Number(input.qty) * Number(leg.ratio_qty)), filled_qty: String(filled * Number(leg.ratio_qty)), symbol: leg.symbol, side: leg.side, position_intent: leg.position_intent, ratio_qty: leg.ratio_qty })) } : {}),
  };
}
function setup(extra: { enabled?: boolean; filename?: string; reservedShares?: (underlying: string) => number } = {}) {
  const store = openF5Store(extra.filename ?? ':memory:');
  let time = NOW, open = true, enabled = extra.enabled ?? true, sends = 0, cancellations = 0;
  let account: F5Account = { status: 'ACTIVE', cash: 100000, buyingPower: 100000, optionsBuyingPower: 100000, equity: 100000, optionsLevel: 3, blocked: false };
  let positions: F5Position[] = [], orders: F5BrokerOrder[] = [], activities: F5Activity[] = [];
  const metadata = new Map<string, F5Contract>([put, call, callHigh, longCall].map(symbol => [symbol, contract(symbol)]));
  const remote = new Map<string, F5BrokerOrder>();
  let send: (input: F5OrderInput) => Promise<F5BrokerOrder> = async input => {
    const received = reply(input); remote.set(input.client_order_id, received); return received;
  };
  const broker: F5Broker = {
    account: async () => account, clock: async () => open,
    contracts: async () => ({ contracts: [...metadata.values()], complete: true, feed: 'indicative' }),
    contract: async symbol => metadata.get(symbol) ?? contract(symbol),
    positions: async () => positions, orders: async () => orders, activities: async () => activities,
    orderByClientId: async id => remote.get(id) ?? null,
    submit: async input => { sends++; return send(input); },
    cancel: async () => { cancellations++; },
  };
  const service = () => createF5Service({ store, broker, ownerId: owner, enabled, now: () => time, reservedShares: extra.reservedShares });
  let api = service();
  const take = (method: string, route: string, body?: unknown, user = owner) => api.handle(method, '/f5/' + route, user, body);
  const preview = async (request: F5Request = wheel()) => {
    const result = await take('POST', 'preview', request);
    assert.equal(result.status, 201, JSON.stringify(result.value));
    return (result.value as { operation: F5Operation }).operation;
  };
  const submit = async (operation: F5Operation) => {
    const result = await take('POST', 'submit', { previewId: operation.id });
    assert.equal(result.status, 200, JSON.stringify(result.value));
    return (result.value as { operation: F5Operation }).operation;
  };
  const fill = (operation: F5Operation, status = 'filled', count = operation.quantity) => remote.set(operation.clientOrderId, reply(operation.input, status, count));
  return { store, remote, metadata, take, preview, submit, fill, broker, sends: () => sends, cancellations: () => cancellations,
    setTime: (value: number) => { time = value; }, setMarket: (value: boolean) => { open = value; },
    setAccount: (patch: Partial<F5Account>) => { account = { ...account, ...patch }; }, setPositions: (value: F5Position[]) => { positions = value; }, setOrders: (value: F5BrokerOrder[]) => { orders = value; },
    setActivities: (value: F5Activity[]) => { activities = value; }, setSend: (fn: typeof send) => { send = fn; },
    restart: (value = enabled) => { enabled = value; api = service(); },
  };
}
function errorCode(result: { value: unknown }) { return (result.value as { error: { code: string } }).error.code; }

test('a Gamma equity hedge with inferred intent reconciles after restart without another order', async t => {
  const s = setup(); t.after(() => s.store.close());
  const opening = await s.preview(gamma()); await s.submit(opening); s.fill(opening);
  s.setPositions([position(call, 1), position(put, 1)]);
  const hedge = await s.preview({ action: 'hedge', operationId: opening.id, side: 'buy', quantity: 1, limitPrice: 180, maxCapitalUsd: 200 });
  s.setSend(async input => {
    const received = { ...reply(input), position_intent: 'buy_to_open' };
    s.remote.set(input.client_order_id, received); return received;
  });
  assert.equal((await s.submit(hedge)).state, 'submitted');
  s.remote.set(hedge.clientOrderId, { ...reply(hedge.input, 'filled', 1), position_intent: 'buy_to_open' });
  s.restart();
  const status = (await s.take('GET', 'status')).value as F5Status;
  assert.equal(status.operations.find(operation => operation.id === hedge.id)?.state, 'filled');
  assert.equal(s.sends(), 2, 'only the option opening and hedge were posted');
});

test('preview uses real contracts, cash collateral and stable server identifiers without sending', async t => {
  const s = setup(); t.after(() => s.store.close());
  const operation = await s.preview();
  assert.equal(operation.reservedCapitalUsd, 18000);
  assert.equal(operation.input.symbol, put);
  assert.equal(operation.input.position_intent, 'sell_to_open');
  assert.equal(operation.input.limit_price, '2.00');
  assert.match(operation.clientOrderId, /^f5_[a-f0-9]{32}$/);
  assert.equal(Date.parse(operation.expiresAt) - NOW, 60000);
  assert.equal(s.sends(), 0);
});

test('disabled mode still provides a review and account status but never sends', async t => {
  const s = setup({ enabled: false }); t.after(() => s.store.close());
  const operation = await s.preview();
  assert.equal(errorCode(await s.take('POST', 'submit', { previewId: operation.id })), 'f5_disabled');
  const status = await s.take('GET', 'status');
  assert.equal((status.value as F5Status).enabled, false);
  assert.equal((status.value as F5Status).operations[0].state, 'preview');
  assert.equal(s.sends(), 0);
});

test('owner isolation rejects every resource before broker calls or ledger mutation', async t => {
  const s = setup(); t.after(() => s.store.close());
  for (const [method, route, body] of [['GET', 'status', undefined], ['GET', 'contracts?underlying=AAPL', undefined], ['POST', 'preview', wheel()]] as const) {
    assert.equal((await s.take(method, route, body, 'other-user')).status, 403);
  }
  assert.equal(s.store.list('other-user').length, 0);
  assert.equal(s.store.list(owner).length, 0);
});

test('expiry, stale quotes and unavailable option permissions block execution', async t => {
  const s = setup(); t.after(() => s.store.close());
  s.setAccount({ optionsLevel: 0 });
  assert.equal(errorCode(await s.take('POST', 'preview', wheel())), 'f5_options_permission');
  s.setAccount({ optionsLevel: 3 });
  s.metadata.set(put, { ...contract(put), quoteTime: new Date(NOW - 21 * 60000).toISOString() });
  assert.equal(errorCode(await s.take('POST', 'preview', wheel())), 'f5_quote_unavailable');
  s.metadata.set(put, contract(put));
  const operation = await s.preview(); s.setTime(NOW + 60000);
  assert.equal(errorCode(await s.take('POST', 'submit', { previewId: operation.id })), 'f5_preview_expired');
  assert.equal(s.store.get(owner, operation.id)?.state, 'expired');
  assert.equal(s.sends(), 0);
});

test('revalidation catches changed funds, market and quote after review without posting', async t => {
  const s = setup(); t.after(() => s.store.close());
  const operation = await s.preview();
  s.setAccount({ cash: 100 });
  assert.equal(errorCode(await s.take('POST', 'submit', { previewId: operation.id })), 'f5_insufficient_funds');
  s.setAccount({ cash: 100000 }); s.setMarket(false);
  assert.equal(errorCode(await s.take('POST', 'submit', { previewId: operation.id })), 'f5_market_closed');
  s.setMarket(true); s.metadata.set(put, { ...contract(put), bid: null });
  assert.equal(errorCode(await s.take('POST', 'submit', { previewId: operation.id })), 'f5_quote_unavailable');
  assert.equal(s.sends(), 0);
});

test('all pending broker orders including unrelated manual equity block new allocation', async t => {
  const s = setup(); t.after(() => s.store.close());
  s.setOrders([{ id: 'manual', client_order_id: 'manual', status: 'new', symbol: 'MSFT', side: 'buy', qty: '2', filled_qty: '0', limit_price: '400' }]);
  assert.equal(errorCode(await s.take('POST', 'preview', wheel())), 'f5_pending_broker_orders');
  assert.equal(s.sends(), 0);
});

test('covered calls require unallocated actual shares, puts and PMCC use conservative reserves', async t => {
  const s = setup(); t.after(() => s.store.close());
  const covered = wheel({ contracts: [call], wheelPhase: 'call' });
  assert.equal(errorCode(await s.take('POST', 'preview', covered)), 'f5_uncovered_call');
  s.setPositions([position('AAPL', 100), position(callHigh, -1)]);
  assert.equal(errorCode(await s.take('POST', 'preview', covered)), 'f5_existing_option_position');
  s.setPositions([position('AAPL', 100)]);
  assert.equal((await s.preview(covered)).reservedCapitalUsd, 0);
  const diagonal = await s.preview(pmcc());
  assert.equal(diagonal.reservedCapitalUsd, 19500);
  assert.equal(diagonal.input.order_class, 'mleg');
  assert.equal(errorCode(await s.take('POST', 'preview', wheel({ maxCapitalUsd: 100 }))), 'f5_budget_exceeded');
});

test('backspread preserves the 1:2 ratio, signed credit and risk between strikes', async t => {
  const s = setup(); t.after(() => s.store.close());
  const operation = await s.preview({ action: 'open', strategy: 'backspread', underlying: 'AAPL', quantity: 2, contracts: [call, callHigh], limitPrice: -1.25, maxCapitalUsd: 2000 });
  assert.deepEqual(operation.input.legs?.map(leg => [leg.side, leg.ratio_qty]), [['sell', '1'], ['buy', '2']]);
  assert.equal(operation.input.limit_price, '-1.25');
  assert.equal(operation.reservedCapitalUsd, 1750);
});

test('concurrent confirmations consume a preview once and subsequent confirmation only reconciles', async t => {
  const s = setup(); t.after(() => s.store.close());
  const operation = await s.preview();
  const results = await Promise.all([s.take('POST', 'submit', { previewId: operation.id }), s.take('POST', 'submit', { previewId: operation.id })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(s.sends(), 1);
  const again = await s.submit(operation);
  assert.equal(again.state, 'submitted'); assert.equal(s.sends(), 1);
});

test('an ambiguous order survives restart and can never issue a second POST', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'tepic-f5-'));
  const filename = path.join(directory, 'runner.sqlite');
  const s = setup({ filename });
  t.after(() => { s.store.close(); rmSync(directory, { recursive: true, force: true }); });
  s.setSend(async () => { throw new Error('network may have inserted this order'); });
  const operation = await s.preview();
  const uncertain = await s.take('POST', 'submit', { previewId: operation.id });
  assert.equal(uncertain.status, 202);
  assert.equal((uncertain.value as { operation: F5Operation }).operation.state, 'ambiguous');
  s.restart();
  assert.equal((await s.take('POST', 'submit', { previewId: operation.id })).status, 409);
  assert.equal(s.sends(), 1);
  const disk = openF5Store(filename); assert.equal(disk.get(owner, operation.id)?.state, 'ambiguous'); disk.close();
  s.fill(operation);
  const recovered = await s.take('POST', 'submit', { previewId: operation.id });
  assert.equal((recovered.value as { operation: F5Operation }).operation.state, 'filled');
  assert.equal(s.sends(), 1);
});

test('a crash after reserving and before a response is recovered without posting', async t => {
  const s = setup(); t.after(() => s.store.close());
  const operation = await s.preview();
  const lease = s.store.acquire(owner, NOW)!;
  assert.equal(s.store.reserve(owner, operation.id, lease, NOW), true);
  s.store.release(owner, lease);
  s.restart();
  assert.equal((await s.take('POST', 'submit', { previewId: operation.id })).status, 409);
  assert.equal(s.sends(), 0);
  assert.equal(s.store.get(owner, operation.id)?.state, 'ambiguous');
});

test('a mismatched multi-leg response remains uncertain and cannot be resent', async t => {
  const s = setup(); t.after(() => s.store.close());
  s.setSend(async input => {
    const response = reply(input, 'filled', Number(input.qty)); response.legs![1].ratio_qty = '2';
    s.remote.set(input.client_order_id, response); return response;
  });
  const operation = await s.preview(pmcc());
  const response = await s.take('POST', 'submit', { previewId: operation.id });
  assert.equal((response.value as { operation: F5Operation }).operation.state, 'ambiguous');
  assert.equal((await s.take('POST', 'submit', { previewId: operation.id })).status, 409);
  assert.equal(s.sends(), 1);
});

test('only confirmed fills create closing availability and closing reverses every leg atomically', async t => {
  const s = setup(); t.after(() => s.store.close());
  let operation = await s.preview(pmcc()); operation = await s.submit(operation);
  assert.equal(errorCode(await s.take('POST', 'preview', { action: 'close', operationId: operation.id, limitPrice: -4, maxCapitalUsd: 1000 })), 'f5_pending_operations');
  s.fill(operation); s.setPositions([position(longCall, 1), position(callHigh, -1)]);
  const close = await s.preview({ action: 'close', operationId: operation.id, limitPrice: -4, maxCapitalUsd: 1000 });
  assert.deepEqual(close.input.legs?.map(leg => [leg.side, leg.position_intent]), [['sell', 'sell_to_close'], ['buy', 'buy_to_close']]);
  assert.equal(close.parentId, operation.id); assert.equal(close.reservedCapitalUsd, 0);
  await s.submit(close); s.fill(close);
  await s.take('GET', 'status');
  assert.equal(errorCode(await s.take('POST', 'preview', { action: 'close', operationId: operation.id, limitPrice: -4, maxCapitalUsd: 1000 })), 'f5_child_operation_exists');
});

test('partial canceled opens and partial closes never become fictitious complete cycles', async t => {
  const s = setup(); t.after(() => s.store.close());
  let operation = await s.preview(wheel({ quantity: 2, maxCapitalUsd: 40000 })); operation = await s.submit(operation);
  s.fill(operation, 'canceled', 1);
  const status = await s.take('GET', 'status');
  assert.equal((status.value as F5Status).operations[0].state, 'canceled');
  assert.equal((status.value as F5Status).operations[0].brokerOrder?.filled_qty, '1');
  assert.equal(errorCode(await s.take('POST', 'preview', { action: 'close', operationId: operation.id, limitPrice: 2, maxCapitalUsd: 1000 })), 'f5_open_not_filled');
});

test('closing refuses expired, assigned or externally changed option positions', async t => {
  const s = setup(); t.after(() => s.store.close());
  const operation = await s.preview(); await s.submit(operation); s.fill(operation);
  assert.equal(errorCode(await s.take('POST', 'preview', { action: 'close', operationId: operation.id, limitPrice: 2, maxCapitalUsd: 1000 })), 'f5_position_missing');
  assert.equal(s.sends(), 1);
});

test('Wheel advances only from actual available shares and shows provider activities unchanged', async t => {
  const s = setup(); t.after(() => s.store.close());
  const operation = await s.preview(); await s.submit(operation); s.fill(operation);
  s.setPositions([position('AAPL', 100)]);
  s.setActivities([{ id: 'assignment', type: 'OPASN', symbol: put, date: '2026-12-19', quantity: '1', description: 'assignment reported by provider' }]);
  const status = await s.take('GET', 'status');
  assert.equal((status.value as F5Status).positions[0].quantity, 100);
  assert.equal((status.value as F5Status).activities[0].type, 'OPASN');
  const covered = await s.preview(wheel({ contracts: [call], wheelPhase: 'call' }));
  assert.equal(covered.input.position_intent, 'sell_to_open');
  assert.equal(covered.reservedCapitalUsd, 0);
});

test('Gamma share hedges require actual straddle fills and reduce observed delta', async t => {
  const s = setup(); t.after(() => s.store.close());
  const operation = await s.preview(gamma()); await s.submit(operation); s.fill(operation);
  s.setPositions([position(call, 1), position(put, 1)]);
  const hedge = await s.preview({ action: 'hedge', operationId: operation.id, side: 'buy', quantity: 10, limitPrice: 180, maxCapitalUsd: 2000 });
  assert.equal(hedge.reservedCapitalUsd, 1800); assert.equal(hedge.input.position_intent, undefined);
  await s.submit(hedge); s.fill(hedge); s.setPositions([position(call, 1), position(put, 1), position('AAPL', 10)]);
  assert.equal(errorCode(await s.take('POST', 'preview', { action: 'close', operationId: operation.id, limitPrice: -4, maxCapitalUsd: 1000 })), 'f5_hedge_not_flat');
  const unwind = await s.preview({ action: 'hedge', operationId: operation.id, side: 'sell', quantity: 10, limitPrice: 180, maxCapitalUsd: 2000 });
  await s.submit(unwind); s.fill(unwind);
  s.setPositions([position(call, 1), position(put, 1)]);
  const close = await s.preview({ action: 'close', operationId: operation.id, limitPrice: -4, maxCapitalUsd: 1000 });
  assert.equal(close.input.order_class, 'mleg');
});

test('Gamma rejects short-stock, manual-stock sales and increasing-delta buys', async t => {
  const s = setup(); t.after(() => s.store.close());
  const operation = await s.preview(gamma()); await s.submit(operation); s.fill(operation);
  s.setPositions([position(call, 1), position(put, 1), position('AAPL', 1000)]);
  assert.equal(errorCode(await s.take('POST', 'preview', { action: 'hedge', operationId: operation.id, side: 'sell', quantity: 10, limitPrice: 180, maxCapitalUsd: 2000 })), 'f5_short_hedge_disabled');
  assert.equal(errorCode(await s.take('POST', 'preview', { action: 'hedge', operationId: operation.id, side: 'buy', quantity: 100, limitPrice: 180, maxCapitalUsd: 20000 })), 'f5_hedge_increases_delta');
});

test('cancellation stays pending until the broker actually confirms cancellation', async t => {
  const s = setup(); t.after(() => s.store.close());
  const operation = await s.preview(); await s.submit(operation);
  const result = await s.take('POST', 'cancel', { operationId: operation.id });
  assert.equal(result.status, 200); assert.equal(s.cancellations(), 1);
  assert.equal((result.value as { operation: F5Operation }).operation.state, 'submitted');
  s.fill(operation, 'canceled', 0);
  const status = await s.take('GET', 'status');
  assert.equal((status.value as F5Status).operations[0].state, 'canceled');
  assert.equal(s.sends(), 1);
});

test('unexpected provider diagnostics are sanitized and do not mutate the ledger', async t => {
  const s = setup(); t.after(() => s.store.close());
  s.broker.account = async () => { throw Error('private uri token secret'); };
  const result = await s.take('POST', 'preview', wheel());
  assert.equal(result.status, 503); assert.doesNotMatch(JSON.stringify(result.value), /private uri|token secret/);
  assert.equal(s.store.list(owner).length, 0);
});

test('a new opening cannot consume manual options or terminal partial fills', async t => {
  const s = setup(); t.after(() => s.store.close());
  const original = await s.preview(wheel({ quantity: 2, maxCapitalUsd: 40000 }));
  await s.submit(original); s.fill(original, 'canceled', 1); s.setPositions([position(put, -1)]);
  assert.equal(errorCode(await s.take('POST', 'preview', wheel())), 'f5_existing_option_position');
  s.setPositions([position(longCall, 1)]);
  assert.equal(errorCode(await s.take('POST', 'preview', wheel())), 'f5_existing_option_position');
  assert.equal(s.sends(), 1);
});

test('shares owned by automated stock plans cannot cover a Wheel call', async t => {
  const s = setup({ reservedShares: () => 100 }); t.after(() => s.store.close());
  s.setPositions([position('AAPL', 100)]);
  const covered = wheel({ contracts: [call], wheelPhase: 'call' });
  assert.equal(errorCode(await s.take('POST', 'preview', covered)), 'f5_uncovered_call');
  s.setPositions([position('AAPL', 200)]);
  assert.equal((await s.preview(covered)).reservedCapitalUsd, 0);
});

test('a preview that expires during network revalidation is never reserved or posted', async t => {
  const s = setup(); t.after(() => s.store.close());
  const original = await s.preview();
  s.broker.account = async () => {
    s.setTime(NOW + 60001);
    return { status: 'ACTIVE', cash: 100000, buyingPower: 100000, optionsBuyingPower: 100000, equity: 100000, optionsLevel: 3, blocked: false };
  };
  assert.equal(errorCode(await s.take('POST', 'submit', { previewId: original.id })), 'f5_preview_expired');
  assert.equal(s.store.get(owner, original.id)?.state, 'expired');
  assert.equal(s.sends(), 0);
});

test('an explicit broker rejection remains terminal and a duplicate confirmation cannot resend', async t => {
  const s = setup(); t.after(() => s.store.close());
  s.setSend(async () => { throw new BrokerError('broker_order_rejected', 422, 'Alpaca rechazó los contratos de la operación.', false); });
  const original = await s.preview();
  const response = await s.take('POST', 'submit', { previewId: original.id });
  assert.equal(response.status, 200);
  assert.equal((response.value as { operation: F5Operation }).operation.state, 'rejected');
  assert.equal((await s.take('POST', 'submit', { previewId: original.id })).status, 200);
  assert.equal(s.sends(), 1);
});

test('expired leases and another unresolved reservation cannot consume a second preview', async t => {
  const s = setup(); t.after(() => s.store.close());
  const first = await s.preview(), second = await s.preview();
  const expired = s.store.acquire(owner, NOW)!;
  const active = s.store.acquire(owner, NOW + 300001)!;
  assert.ok(active); assert.notEqual(active, expired);
  assert.equal(s.store.reserve(owner, first.id, expired, NOW + 300001), false);
  assert.equal(s.store.reserve(owner, first.id, active, NOW + 300001), true);
  assert.equal(s.store.reserve(owner, second.id, active, NOW + 300001), false);
  s.store.release(owner, expired);
  assert.equal(s.store.acquire(owner, NOW + 300002), null, 'a stale release cannot remove the active lease');
  s.store.release(owner, active);
});

test('HTTP integration preserves token and owner gates, strips owner and shares the stock-runner account lease', async t => {
  const s = setup(), stockStore = openRunnerStore(':memory:');
  const token = 'private-runner-test-token-longer-than-32';
  const f5 = createF5Service({ store: s.store, broker: s.broker, ownerId: owner, enabled: true, now: () => NOW });
  const service = createRunnerService({ store: stockStore, broker: null, ownerId: owner, enabled: false, maxOrderUsd: 1000, token, history: async () => [], now: () => NOW, f5 });
  await new Promise<void>(resolve => service.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    service.stopLoop(); service.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => service.server.close(error => error ? reject(error) : resolve()));
    s.store.close(); stockStore.close();
  });
  const address = service.server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/f5/status?ownerId=' + owner)).status, 401);
  assert.equal((await fetch(base + '/f5/status?ownerId=other', { headers })).status, 403);
  const key = 'tick:' + owner;
  assert.equal(stockStore.acquireLease(key, NOW, NOW + 60000), true);
  const blocked = await fetch(base + '/f5/preview', { method: 'POST', headers, body: JSON.stringify({ ...wheel(), ownerId: owner }) });
  assert.equal(blocked.status, 409);
  stockStore.releaseLease(key);
  const valid = await fetch(base + '/f5/preview', { method: 'POST', headers, body: JSON.stringify({ ...wheel(), ownerId: owner }) });
  assert.equal(valid.status, 201);
  const result = await valid.json() as { operation: F5Operation };
  assert.equal(result.operation.request.action, 'open');
  assert.equal('ownerId' in result.operation.request, false);
  assert.equal(stockStore.acquireLease(key, NOW, NOW + 60000), true, 'F5 releases the shared lease after completing the request');
  stockStore.releaseLease(key);
  assert.equal(s.sends(), 0);
});

test('reconciliation after restart requires complete option intent and ratios', async t => {
  const s = setup(); t.after(() => s.store.close());
  const original = await s.preview(pmcc()); await s.submit(original);
  const received = reply(original.input, 'filled', 1);
  delete received.legs![0].ratio_qty; delete received.legs![0].position_intent;
  s.remote.set(original.clientOrderId, received); s.restart();
  const result = await s.take('GET', 'status');
  assert.equal((result.value as F5Status).operations[0].state, 'ambiguous');
  assert.equal(s.sends(), 1);
});

test('manual increases or decreases in an option leg block a recorded whole-cycle close', async t => {
  const s = setup(); t.after(() => s.store.close());
  const original = await s.preview(pmcc()); await s.submit(original); s.fill(original);
  for (const count of [0, 2]) {
    s.setPositions([position(longCall, count), position(callHigh, -1)]);
    const result = await s.take('POST', 'preview', { action: 'close', operationId: original.id, limitPrice: -4, maxCapitalUsd: 1000 });
    assert.equal(errorCode(result), 'f5_position_missing');
  }
  assert.equal(s.sends(), 1);
});
