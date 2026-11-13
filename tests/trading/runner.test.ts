import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openRunnerStore } from '../../services/trading-runner/store.ts';
import { createRunner, orderIdForSignal, type RunnerBroker, type RunnerOrder } from '../../services/trading-runner/runner.ts';
import { createRunnerService } from '../../services/trading-runner/server.ts';
import { analyzeHistory } from '../../src/features/analysis/signals.ts';
import type { Candle } from '../../src/features/market/chart-history.ts';
import type { RunnerStore, TradingPlan } from '../../services/trading-runner/model.ts';

const NOW = Date.parse('2026-11-13T15:00:00Z');
const OWNER = 'local_seedy';
const TOKEN = 'test-private-token-at-least-32-bytes-long';
const input = { ownerId: OWNER, symbol: 'AAPL', historyYears: 3 as const, startDate: '2026-11-01', endDate: '2026-12-01', maxOrderUsd: 500, maxPositionUsd: 1000, enabled: false as const };
function history(): Candle[] {
  return Array.from({ length: 1100 }, (_, i) => ({ time: Date.parse('2026-11-12T05:00:00Z') - (1099 - i) * 86400000, open: 100, high: 101, low: 99, close: 100, volume: 1000 }));
}
function buyAnalysis(bars: readonly Candle[]) {
  const result = analyzeHistory(bars);
  return { ...result, latest: { time: bars.at(-1)!.time, action: 'buy' as const, price: 100, reason: 'Cruce cerrado de prueba.', smaFast: 101, smaSlow: 100, rsi: 55 } };
}
function broker() {
  const submitted: Parameters<RunnerBroker['submitPaperOrder']>[0][] = [];
  const orders = new Map<string, RunnerOrder>();
  const canceled: string[] = [];
  const client: RunnerBroker = {
    getClock: async () => ({ timestamp: new Date(NOW).toISOString(), is_open: true, next_close: '2026-11-13T21:00:00Z' }),
    getCalendar: async () => [{ date: '2026-11-12', open: '09:30', close: '16:00' }],
    getAccount: async () => ({ status: 'ACTIVE', buying_power: '10000', equity: '10000', trading_blocked: false }),
    getAsset: async symbol => ({ symbol, tradable: true, class: 'us_equity', status: 'active' }),
    getPosition: async () => null, listPositions: async () => [], listOpenOrders: async () => [],
    getLatestQuote: async () => ({ askPrice: 100, bidPrice: 99.9, time: NOW }),
    getOrderByClientId: async id => orders.get(id) ?? null,
    getOrder: async id => { const order = [...orders.values()].find(item => item.id === id); if (!order) throw Error('missing'); return order; },
    cancelOwnedOrder: async id => { canceled.push(id); },
    submitPaperOrder: async input => { submitted.push(input); const order: RunnerOrder = { ...input, id: 'paper-order-' + submitted.length, filled_qty: '0', filled_avg_price: null, status: 'accepted' }; orders.set(input.client_order_id, order); return order; },
  };
  return { client, submitted, orders, canceled };
}
const policy = { stopLossPct: 5, takeProfitPct: 10, exitOnSignal: false, closeAtEnd: false };
function seedOwnership(store: RunnerStore, plan: TradingPlan, qty: number, id = 'tepic-seeded-entry') {
  store.reserveExecution({ clientOrderId: id, ownerId: OWNER, planId: plan.id, signalTime: NOW - 1000, state: 'submitted', side: 'buy', symbol: plan.symbol, quantity: qty, limitPrice: 100 });
  store.reconcileExecution(id, { brokerOrderId: id + '-broker', symbol: plan.symbol, side: 'buy', quantity: qty, limitPrice: 100, filledQuantity: qty, filledAveragePrice: 100, brokerStatus: 'filled', state: 'filled', updatedAt: new Date(NOW).toISOString() });
}
function livePosition(client: RunnerBroker, qty: number, price = 100) {
  client.getPosition = async () => qty > 0 ? { qty: String(qty) } : null;
  client.listPositions = async () => qty > 0 ? [{ symbol: 'AAPL', qty: String(qty), market_value: String(qty * price), current_price: String(price), asset_class: 'us_equity' }] : [];
}
test('runner plans start disabled, remain owner-scoped and reject two active plans for one symbol', () => {
  const store = openRunnerStore(':memory:');
  try {
    const plan = store.createPlan(input, new Date(NOW).toISOString());
    assert.equal(plan.enabled, false);
    assert.equal(store.listPlans('other').length, 0);
    assert.equal(store.setEnabled('other', plan.id, true, new Date(NOW).toISOString()), null);
    store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    const second = store.createPlan(input, new Date(NOW).toISOString());
    assert.throws(() => store.setEnabled(OWNER, second.id, true, new Date(NOW).toISOString()));
    assert.equal(store.listPlans(OWNER).filter(value => value.enabled).length, 1);
  } finally { store.close(); }
});
test('a paper entry is bounded, buy-only, reserved durably and never sent twice for one signal', async () => {
  const store = openRunnerStore(':memory:');
  try {
    const plan = store.createPlan(input, new Date(NOW).toISOString());
    store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    const { client, submitted } = broker();
    const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: buyAnalysis });
    assert.equal((await runner.tick())[0].status, 'submitted');
    assert.equal((await runner.tick())[0].status, 'duplicate');
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].side, 'buy');
    assert.equal(submitted[0].type, 'limit');
    assert.ok(Number(submitted[0].qty) * Number(submitted[0].limit_price) <= 500);
    const expectedId = orderIdForSignal(plan, history().at(-1)!.time);
    assert.equal(submitted[0].client_order_id, expectedId);
    assert.equal(store.getExecution(expectedId)?.state, 'submitted');
    assert.equal(store.listEvents('other').length, 0);
  } finally { store.close(); }
});
test('disabled service, closed markets, stale quotes and pre-existing positions all prevent submission', async () => {
  for (const variant of ['disabled', 'closed', 'stale', 'position', 'open-order', 'blocked-account', 'budget', 'dates'] as const) {
    const store = openRunnerStore(':memory:');
    try {
      const plan = store.createPlan(variant === 'budget' ? { ...input, maxOrderUsd: 10 } : variant === 'dates' ? { ...input, startDate: '2027-01-01', endDate: '2027-02-01' } : input, new Date(NOW).toISOString());
      store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
      const { client, submitted } = broker();
      if (variant === 'closed') client.getClock = async () => ({ timestamp: new Date(NOW).toISOString(), is_open: false });
      if (variant === 'stale') client.getLatestQuote = async () => ({ askPrice: 100, bidPrice: 99.9, time: NOW - 61000 });
      if (variant === 'position') client.getPosition = async () => ({ qty: '1' });
      if (variant === 'open-order') client.listOpenOrders = async () => [{ id: 'manual-order', client_order_id: 'manual', symbol: 'AAPL', side: 'buy', type: 'limit', time_in_force: 'day', qty: '1', filled_qty: '0', limit_price: '100', status: 'new' }];
      if (variant === 'blocked-account') client.getAccount = async () => ({ status: 'ACTIVE', buying_power: '10000', equity: '10000', trading_blocked: true });
      const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: variant !== 'disabled', now: () => NOW, history: async () => history(), analyze: buyAnalysis });
      assert.ok(['blocked', 'waiting'].includes((await runner.tick())[0].status), variant);
      assert.equal(submitted.length, 0, variant);
    } finally { store.close(); }
  }
});
test('ambiguous submissions are reconciled by their client ID without a second POST', async () => {
  const store = openRunnerStore(':memory:');
  try {
    const plan = store.createPlan(input, new Date(NOW).toISOString());
    store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    const { client } = broker();
    let posts = 0, exists = false;
    client.submitPaperOrder = async () => { posts++; throw Error('ambiguous network result'); };
    client.getOrderByClientId = async id => exists ? { id: 'confirmed-paper-order', client_order_id: id, symbol: 'AAPL', side: 'buy', qty: '4', filled_qty: '0', limit_price: '100.50', type: 'limit', time_in_force: 'day', status: 'new' } : null;
    const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: buyAnalysis });
    assert.equal((await runner.tick())[0].status, 'ambiguous');
    assert.equal((await runner.tick())[0].status, 'ambiguous');
    exists = true;
    assert.equal((await runner.tick())[0].status, 'duplicate');
    assert.equal(posts, 1);
  } finally { store.close(); }
});
test('missing final session and incomplete years of data cannot trigger old signals', async () => {
  for (const variant of ['missing-session', 'short-history'] as const) {
    const store = openRunnerStore(':memory:');
    try {
      const plan = store.createPlan(input, new Date(NOW).toISOString());
      store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
      const { client, submitted } = broker();
      const bars = variant === 'missing-session' ? history().slice(0, -1) : history().slice(-150);
      const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => bars, analyze: buyAnalysis });
      assert.equal((await runner.tick())[0].status, 'blocked');
      assert.equal(submitted.length, 0);
    } finally { store.close(); }
  }
});
test('closed daily histories and calendar are reused within a session', async () => {
  const store = openRunnerStore(':memory:');
  try {
    const plan = store.createPlan(input, new Date(NOW).toISOString());
    store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    const { client } = broker();
    let histories = 0, calendars = 0;
    client.getCalendar = async () => { calendars++; return [{ date: '2026-11-12', open: '09:30', close: '16:00' }]; };
    const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => { histories++; return history(); }, analyze: buyAnalysis });
    await runner.tick(); await runner.tick();
    assert.equal(histories, 1);
    assert.equal(calendars, 1);
    assert.equal(runner.status().available, true);
    assert.equal(runner.status().running, false, 'idle is still an available service');
  } finally { store.close(); }
});
test('restarting from the same SQLite file preserves plans and execution reservations', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tepic-runner-test-'));
  const filename = path.join(directory, 'runner.sqlite');
  let store = openRunnerStore(filename);
  try {
    const plan = store.createPlan(input, new Date(NOW).toISOString());
    store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    const { client, submitted } = broker();
    const makeRunner = () => createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: buyAnalysis });
    assert.equal((await makeRunner().tick())[0].status, 'submitted');
    store.close(); store = openRunnerStore(filename);
    assert.equal(store.listPlans(OWNER)[0].enabled, true);
    assert.equal((await makeRunner().tick())[0].status, 'duplicate');
    assert.equal(submitted.length, 1);
    assert.ok(store.listEvents(OWNER).length >= 2);
  } finally {
    store.close();
    if (path.dirname(path.resolve(directory)) === path.resolve(tmpdir()) && path.basename(directory).startsWith('tepic-runner-test-')) await rm(directory, { recursive: true, force: true });
  }
});
test('concurrent ticks and a stopped plan cannot cause duplicate or delayed submissions', async () => {
  const store = openRunnerStore(':memory:');
  try {
    const plan = store.createPlan(input, new Date(NOW).toISOString());
    store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    const { client, submitted } = broker();
    const originalQuote = client.getLatestQuote;
    client.getLatestQuote = async symbol => { store.setEnabled(OWNER, plan.id, false, new Date(NOW).toISOString()); return originalQuote(symbol); };
    const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: buyAnalysis });
    const [first, second] = await Promise.all([runner.tick(), runner.tick()]);
    assert.equal(first[0].status, 'blocked');
    assert.deepEqual(second, []);
    assert.equal(submitted.length, 0);
    await assert.rejects(runner.tick('other'), /owner_not_allowed/);
  } finally { store.close(); }
});
test('HTTP runner requires a private token and trusted owner; activation needs the service switch', async () => {
  const store = openRunnerStore(':memory:');
  const service = createRunnerService({ store, broker: null, ownerId: OWNER, enabled: false, token: TOKEN, now: () => NOW, history: async () => [] });
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  const address = service.server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(url + '/healthz')).status, 200);
    assert.equal((await fetch(url + '/plans?ownerId=' + OWNER)).status, 401);
    assert.equal((await fetch(url + '/plans?ownerId=other', { headers })).status, 403);
    const created = await fetch(url + '/plans', { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(created.status, 201);
    const { plan } = await created.json() as { plan: { id: string; enabled: boolean } };
    assert.equal(plan.enabled, false);
    assert.equal((await fetch(url + '/plans/' + plan.id, { method: 'PATCH', headers, body: JSON.stringify({ ownerId: OWNER, enabled: true }) })).status, 409);
    assert.equal((await fetch(url + '/plans', { method: 'POST', headers, body: JSON.stringify({ ...input, enabled: true }) })).status, 400);
    assert.equal((await fetch(url + '/plans', { method: 'POST', headers, body: JSON.stringify({ ...input, ownerId: 'other' }) })).status, 403);
    for (const resource of ['executions', 'positions', 'risk']) {
      assert.equal((await fetch(url + '/' + resource + '?ownerId=' + OWNER, { headers })).status, 200);
      assert.equal((await fetch(url + '/' + resource + '?ownerId=other', { headers })).status, 403);
    }
    const pause = await fetch(url + '/pause', { method: 'PATCH', headers, body: JSON.stringify({ ownerId: OWNER, paused: true }) });
    assert.equal(pause.status, 200);
    assert.equal((await pause.json() as { risk: { paused: boolean } }).risk.paused, true);
    assert.equal((await fetch(url + '/pause', { method: 'POST', headers, body: JSON.stringify({ ownerId: 'other', paused: false }) })).status, 403);
    assert.equal((await fetch(url + '/pause', { method: 'POST', headers, body: JSON.stringify({ ownerId: OWNER, paused: false, cancelAll: true }) })).status, 400);
    assert.equal(store.getPortfolioStatus(OWNER).paused, true);
  } finally {
    service.stopLoop();
    await new Promise<void>((resolve, reject) => service.server.close(error => error ? reject(error) : resolve()));
    store.close();
  }
});

test('partial fills accumulate real quantities and weighted cost exactly once before terminal status', async () => {
  const store = openRunnerStore(':memory:');
  try {
    const plan = store.createPlan(input, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    const { client, submitted, orders } = broker();
    const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: buyAnalysis });
    await runner.tick();
    assert.equal(store.listOwnedPositions(OWNER).length, 0, 'acceptance never creates ownership');
    const entry = orders.get(submitted[0].client_order_id)!;
    orders.set(entry.client_order_id, { ...entry, status: 'partially_filled', filled_qty: '2', filled_avg_price: '98' }); livePosition(client, 2, 98);
    assert.equal((await runner.tick())[0].status, 'partial');
    assert.equal(store.listOwnedPositions(OWNER)[0].quantity, 2);
    await runner.tick(); assert.equal(store.listOwnedPositions(OWNER)[0].quantity, 2, 'replayed cumulative fill is idempotent');
    orders.set(entry.client_order_id, { ...entry, status: 'filled', filled_qty: entry.qty, filled_avg_price: '99' }); livePosition(client, Number(entry.qty), 99);
    assert.equal((await runner.tick())[0].status, 'filled');
    const owned = store.listOwnedPositions(OWNER)[0];
    assert.equal(owned.quantity, Number(entry.qty)); assert.equal(owned.averageEntryPrice, 99);
    assert.equal(store.listExecutions(OWNER)[0].filledAveragePrice, 99);
    assert.deepEqual(store.listOwnedPositions('other'), []);
  } finally { store.close(); }
});

test('automatic exits sell only this plan fills and reconcile partial, canceled and residual sales', async () => {
  const store = openRunnerStore(':memory:');
  try {
    const plan = store.createPlan({ ...input, exitPolicy: policy }, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    seedOwnership(store, plan, 4);
    const other = store.createPlan({ ...input, exitPolicy: policy }, new Date(NOW).toISOString()); seedOwnership(store, other, 3, 'tepic-other-plan');
    const { client, submitted, orders } = broker(); livePosition(client, 107, 90);
    client.getLatestQuote = async () => ({ bidPrice: 90, askPrice: 90.1, time: NOW });
    const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => { throw Error('history unavailable'); } });
    assert.equal((await runner.tick())[0].status, 'exit_pending');
    assert.equal(submitted[0].side, 'sell'); assert.equal(submitted[0].qty, '4');
    assert.equal(store.listOwnedPositions(OWNER).find(item => item.planId === plan.id)!.quantity, 4);
    const exit = orders.get(submitted[0].client_order_id)!;
    orders.set(exit.client_order_id, { ...exit, status: 'partially_filled', filled_qty: '2', filled_avg_price: '89' }); livePosition(client, 105, 90);
    assert.equal((await runner.tick())[0].status, 'partial');
    await runner.tick(); assert.equal(submitted.length, 1, 'an open exit reserves its remaining quantity');
    orders.set(exit.client_order_id, { ...exit, status: 'canceled', filled_qty: '2', filled_avg_price: '89' });
    const canceledEvents = await runner.tick(); assert.equal(canceledEvents[0].status, 'canceled');
    assert.equal(submitted.length, 2); assert.equal(submitted[1].qty, '2'); assert.notEqual(submitted[0].client_order_id, submitted[1].client_order_id);
    const residual = orders.get(submitted[1].client_order_id)!;
    orders.set(residual.client_order_id, { ...residual, status: 'filled', filled_qty: '2', filled_avg_price: '88' }); livePosition(client, 103, 90);
    assert.equal((await runner.tick())[0].status, 'exit_filled');
    const position = store.listOwnedPositions(OWNER).find(item => item.planId === plan.id)!;
    assert.equal(position.quantity, 0); assert.equal(position.realizedPnlUsd, -46);
    assert.equal(store.listOwnedPositions(OWNER).find(item => item.planId === other.id)!.quantity, 3);
    assert.equal(submitted.length, 2, 'manual stock and the other plan remain untouched');
  } finally { store.close(); }
});

test('partial entries are canceled by their own ID and confirmed terminal before an exit', async () => {
  const store = openRunnerStore(':memory:');
  try {
    const plan = store.createPlan({ ...input, exitPolicy: policy }, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    const { client, submitted, orders, canceled } = broker();
    const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: buyAnalysis });
    await runner.tick(); const entry = orders.get(submitted[0].client_order_id)!;
    orders.set(entry.client_order_id, { ...entry, status: 'partially_filled', filled_qty: '2', filled_avg_price: '100' }); livePosition(client, 2, 90);
    client.getLatestQuote = async () => ({ bidPrice: 90, askPrice: 90.1, time: NOW });
    await runner.tick(); assert.deepEqual(canceled, [entry.id]); assert.equal(submitted.length, 1);
    await runner.tick(); assert.equal(canceled.length, 1); assert.equal(submitted.length, 1);
    orders.set(entry.client_order_id, { ...entry, status: 'canceled', filled_qty: '2', filled_avg_price: '100' });
    await runner.tick(); assert.equal(submitted.length, 2); assert.equal(submitted[1].side, 'sell'); assert.equal(submitted[1].qty, '2');
  } finally { store.close(); }
});

test('legacy plans never exit, and mismatched live ownership blocks opt-in sales', async () => {
  for (const variant of ['legacy', 'missing-stock'] as const) {
    const store = openRunnerStore(':memory:');
    try {
      const plan = store.createPlan(variant === 'legacy' ? input : { ...input, exitPolicy: policy }, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString()); seedOwnership(store, plan, 4);
      const { client, submitted } = broker(); livePosition(client, variant === 'legacy' ? 4 : 3, 90);
      client.getLatestQuote = async () => ({ bidPrice: 90, askPrice: 90.1, time: NOW });
      const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: buyAnalysis });
      await runner.tick(); assert.equal(submitted.length, 0, variant);
      assert.equal(store.listOwnedPositions(OWNER)[0].quantity, 4);
      if (variant === 'missing-stock') assert.equal(runner.risk().uncertain, true);
    } finally { store.close(); }
  }
});

test('take profit and bearish closed-session signals trigger only explicitly enabled exits', async () => {
  for (const reason of ['take_profit', 'bearish_signal'] as const) {
    const store = openRunnerStore(':memory:');
    try {
      const plan = store.createPlan({ ...input, exitPolicy: { ...policy, exitOnSignal: reason === 'bearish_signal' } }, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString()); seedOwnership(store, plan, 3);
      const { client, submitted } = broker(); livePosition(client, 3, reason === 'take_profit' ? 112 : 100);
      client.getLatestQuote = async () => ({ bidPrice: reason === 'take_profit' ? 112 : 100, askPrice: reason === 'take_profit' ? 112.1 : 100.1, time: NOW });
      const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: bars => ({ ...buyAnalysis(bars), latest: { ...buyAnalysis(bars).latest, action: 'sell' } }) });
      assert.equal((await runner.tick())[0].status, 'exit_pending'); assert.equal(submitted[0].qty, '3');
      assert.equal(store.listExecutions(OWNER).find(item => item.side === 'sell')!.reason, reason);
    } finally { store.close(); }
  }
});

test('end-of-window opt-in exits near close today or after expiry even without historical data', async () => {
  for (const variant of ['today-near-close', 'expired', 'not-near-close', 'opt-out'] as const) {
    const store = openRunnerStore(':memory:');
    try {
      const endDate = variant === 'expired' ? '2026-11-12' : '2026-11-13';
      const plan = store.createPlan({ ...input, endDate, exitPolicy: { ...policy, closeAtEnd: variant !== 'opt-out' } }, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString()); seedOwnership(store, plan, 3);
      const { client, submitted } = broker(); livePosition(client, 3);
      client.getClock = async () => ({ timestamp: new Date(NOW).toISOString(), is_open: true, next_close: new Date(NOW + (variant === 'not-near-close' ? 60 : 10) * 60000).toISOString() });
      const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => { throw Error('no history'); } });
      await runner.tick(); assert.equal(submitted.length, ['today-near-close', 'expired'].includes(variant) ? 1 : 0, variant);
      if (submitted.length) assert.equal(store.listExecutions(OWNER).find(item => item.side === 'sell')!.reason, 'window_end');
    } finally { store.close(); }
  }
});

test('aggregate exposure includes manual positions and pending entries across symbols', async () => {
  const store = openRunnerStore(':memory:');
  try {
    for (const symbol of ['AAPL', 'MSFT']) { const plan = store.createPlan({ ...input, symbol, maxTotalExposureUsd: 1000 }, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString()); }
    const { client, submitted } = broker(); client.listPositions = async () => [{ symbol: 'GOOG', qty: '5', market_value: '500' }];
    const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: buyAnalysis });
    await runner.tick(); assert.equal(submitted.length, 1);
    assert.ok(runner.risk().totalExposureUsd <= 1000); assert.equal(runner.risk().reservedEntryUsd, Number(submitted[0].qty) * Number(submitted[0].limit_price));
    assert.equal(runner.risk().totalExposureUsd, 500 + runner.risk().reservedEntryUsd);
  } finally { store.close(); }
});

test('daily equity loss blocks entries for the whole date and resets on the next NY date', async () => {
  const store = openRunnerStore(':memory:'); let clock = NOW, equity = 10000;
  try {
    const plan = store.createPlan({ ...input, maxDailyLossUsd: 100 }, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString()); store.setPaused(OWNER, true);
    const { client, submitted } = broker(); client.getAccount = async () => ({ status: 'ACTIVE', buying_power: '10000', equity: String(equity), trading_blocked: false });
    client.getClock = async () => ({ timestamp: new Date(clock).toISOString(), is_open: true });
    const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => clock, history: async () => history(), analyze: buyAnalysis });
    await runner.tick(); assert.equal(runner.risk().equityStartUsd, 10000); store.setPaused(OWNER, false); equity = 9900;
    await runner.tick(); assert.equal(runner.risk().dailyPnlUsd, -100); assert.equal(runner.risk().dailyLossBlocked, true); assert.equal(submitted.length, 0);
    equity = 10010; await runner.tick(); assert.equal(runner.risk().dailyLossBlocked, true); assert.equal(submitted.length, 0);
    clock += 86400000; await runner.tick(); assert.equal(runner.risk().dailyLossBlocked, false); assert.equal(runner.risk().equityStartUsd, 10010);
  } finally { store.close(); }
});

test('reconciliation continues while paused, the plan is disabled and service execution is off', async () => {
  const store = openRunnerStore(':memory:');
  try {
    const plan = store.createPlan({ ...input, exitPolicy: policy }, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    const { client, submitted, orders } = broker(); const settings = { store, broker: client, ownerId: OWNER, now: () => NOW, history: async () => history(), analyze: buyAnalysis };
    await createRunner({ ...settings, enabled: true }).tick(); const entry = orders.get(submitted[0].client_order_id)!;
    orders.set(entry.client_order_id, { ...entry, status: 'filled', filled_qty: entry.qty, filled_avg_price: '99' }); livePosition(client, Number(entry.qty), 90);
    store.setPaused(OWNER, true); store.setEnabled(OWNER, plan.id, false, new Date(NOW).toISOString());
    client.getClock = async () => { throw Error('closed/offline clock'); };
    assert.equal((await createRunner({ ...settings, enabled: false }).tick())[0].status, 'filled');
    assert.equal(store.listOwnedPositions(OWNER)[0].quantity, Number(entry.qty)); assert.equal(submitted.length, 1);
  } finally { store.close(); }
});

test('rejected, canceled and expired unfilled entries never create owned stock or replay their POST', async () => {
  for (const status of ['rejected', 'canceled', 'expired'] as const) {
    const store = openRunnerStore(':memory:');
    try {
      const plan = store.createPlan(input, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString()); const { client, submitted, orders } = broker();
      const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: buyAnalysis });
      await runner.tick(); const entry = orders.get(submitted[0].client_order_id)!; orders.set(entry.client_order_id, { ...entry, status });
      assert.equal((await runner.tick())[0].status, status); await runner.tick();
      assert.equal(submitted.length, 1); assert.equal(store.listOwnedPositions(OWNER).length, 0);
    } finally { store.close(); }
  }
});

test('pausing blocks entries but preserves stop loss exits and the confirmation check before submission', async () => {
  for (const owns of [false, true]) {
    const store = openRunnerStore(':memory:');
    try {
      const plan = store.createPlan({ ...input, exitPolicy: policy }, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
      const { client, submitted } = broker();
      if (owns) { seedOwnership(store, plan, 3); livePosition(client, 3, 90); }
      store.setPaused(OWNER, true); client.getLatestQuote = async () => ({ bidPrice: 90, askPrice: 90.1, time: NOW });
      const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: buyAnalysis });
      await runner.tick(); assert.equal(submitted.length, owns ? 1 : 0);
      if (owns) assert.equal(submitted[0].side, 'sell');
    } finally { store.close(); }
  }
  const store = openRunnerStore(':memory:');
  try {
    const plan = store.createPlan(input, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    const { client, submitted } = broker();
    client.getLatestQuote = async () => { store.setPaused(OWNER, true); return { bidPrice: 99.9, askPrice: 100, time: NOW }; };
    await createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: buyAnalysis }).tick();
    assert.equal(submitted.length, 0, 'a pause arriving during market requests also blocks the POST');
  } finally { store.close(); }
});

function bracketBroker() {
  const context = broker(), original = context.client.submitPaperOrder;
  context.client.submitPaperOrder = async input => {
    const parent = await original(input);
    assert.ok('order_class' in input);
    const legs: RunnerOrder[] = [
      { id: 'take-profit', client_order_id: 'broker-tp', symbol: input.symbol, side: 'sell', type: 'limit', time_in_force: 'gtc', qty: input.qty, filled_qty: '0', status: 'held', limit_price: input.take_profit.limit_price },
      { id: 'stop-loss', client_order_id: 'broker-sl', symbol: input.symbol, side: 'sell', type: 'stop', time_in_force: 'gtc', qty: input.qty, filled_qty: '0', status: 'held', stop_price: input.stop_loss.stop_price },
    ];
    const bracket = { ...parent, order_class: 'bracket', legs };
    context.orders.set(parent.client_order_id, bracket);
    for (const leg of legs) context.orders.set(leg.client_order_id, leg);
    return bracket;
  };
  return context;
}

test('bracket parent and both exits survive restart and partial take profit plus resized stop reconcile once', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tepic-bracket-')), file = path.join(directory, 'runner.sqlite');
  let store = openRunnerStore(file);
  try {
    const plan = store.createPlan({ ...input, exitPolicy: { ...policy, execution: 'bracket' } }, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    const { client, submitted, orders } = bracketBroker();
    const settings = { broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: buyAnalysis };
    await createRunner({ ...settings, store }).tick();
    assert.equal(submitted.length, 1); assert.equal(submitted[0].time_in_force, 'gtc');
    assert.equal(store.listExecutions(OWNER).length, 3); assert.equal(store.listOwnedPositions(OWNER).length, 0);
    const entry = orders.get(submitted[0].client_order_id)!;
    orders.set(entry.client_order_id, { ...entry, status: 'filled', filled_qty: entry.qty, filled_avg_price: '100' }); livePosition(client, Number(entry.qty), 100);
    await createRunner({ ...settings, store }).tick(); assert.equal(store.listOwnedPositions(OWNER)[0].quantity, Number(entry.qty));
    store.close(); store = openRunnerStore(file); store.setPaused(OWNER, true);
    const tp = orders.get('broker-tp')!, sl = orders.get('broker-sl')!;
    orders.set(tp.client_order_id, { ...tp, status: 'partially_filled', filled_qty: '2', filled_avg_price: '111' });
    orders.set(sl.client_order_id, { ...sl, status: 'new', qty: String(Number(entry.qty) - 2) }); livePosition(client, Number(entry.qty) - 2, 100);
    await createRunner({ ...settings, store }).tick();
    assert.equal(store.listOwnedPositions(OWNER)[0].quantity, Number(entry.qty) - 2);
    assert.equal(store.listOwnedPositions(OWNER)[0].realizedPnlUsd, 22);
    const remaining = Number(entry.qty) - 2;
    orders.set(tp.client_order_id, { ...orders.get(tp.client_order_id)!, status: 'canceled' });
    orders.set(sl.client_order_id, { ...orders.get(sl.client_order_id)!, status: 'filled', filled_qty: String(remaining), filled_avg_price: '95' }); livePosition(client, 0);
    const restarted = createRunner({ ...settings, store }); await restarted.tick(); await restarted.tick();
    assert.equal(store.listOwnedPositions(OWNER)[0].quantity, 0);
    assert.equal(store.listOwnedPositions(OWNER)[0].realizedPnlUsd, 22 - remaining * 5);
    assert.equal(submitted.length, 1, 'all sales are native children; the runner never competes with them');
    assert.equal(store.getExecution('broker-sl')!.filledQuantity, remaining);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('unknown bracket children block further orders and a GTC done_for_day is not treated as expired', async () => {
  const store = openRunnerStore(':memory:');
  try {
    const plan = store.createPlan({ ...input, exitPolicy: { ...policy, execution: 'bracket' } }, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    const { client, submitted, orders } = bracketBroker();
    const original = client.submitPaperOrder;
    client.submitPaperOrder = async input => {
      const value = await original(input), changed = { ...value, legs: value.legs!.map(leg => ({ ...leg, symbol: 'MSFT' })) };
      orders.set(value.client_order_id, changed); return changed;
    };
    const settings = { store, broker: client, ownerId: OWNER, enabled: true, now: () => NOW, history: async () => history(), analyze: buyAnalysis };
    const runner = createRunner(settings);
    assert.equal((await runner.tick())[0].status, 'ambiguous'); assert.equal(store.listExecutions(OWNER).length, 1);
    await runner.tick(); assert.equal(submitted.length, 1); assert.equal(runner.risk().uncertain, true);
    const entry = orders.get(submitted[0].client_order_id)!;
    const tp = orders.get('broker-tp')!, sl = orders.get('broker-sl')!;
    orders.set(entry.client_order_id, { ...entry, status: 'done_for_day', legs: [tp, sl] });
    await runner.tick(); assert.equal(store.getExecution(entry.client_order_id)!.state, 'submitted');
    assert.equal(store.listExecutions(OWNER).length, 3);
  } finally { store.close(); }
});

test('pending GTC entries outside their window request only their own cancellation even while entries are paused', async () => {
  const store = openRunnerStore(':memory:'); let clock = NOW;
  try {
    const plan = store.createPlan({ ...input, endDate: '2026-11-13', exitPolicy: { ...policy, execution: 'bracket' } }, new Date(NOW).toISOString()); store.setEnabled(OWNER, plan.id, true, new Date(NOW).toISOString());
    const { client, submitted, canceled } = bracketBroker();
    client.getClock = async () => ({ timestamp: new Date(clock).toISOString(), is_open: true });
    const runner = createRunner({ store, broker: client, ownerId: OWNER, enabled: true, now: () => clock, history: async () => history(), analyze: buyAnalysis });
    await runner.tick(); clock += 3 * 86400000; store.setPaused(OWNER, true);
    await runner.tick(); assert.equal(submitted.length, 1); assert.equal(canceled.length, 1);
    assert.equal(canceled[0], store.getExecution(submitted[0].client_order_id)!.brokerOrderId);
    assert.equal(store.listOwnedPositions(OWNER).length, 0);
  } finally { store.close(); }
});

test('healthcheck reports a stalled evaluation loop without exposing account information', async () => {
  const store = openRunnerStore(':memory:'); let clock = NOW;
  const service = createRunnerService({ store, ownerId: OWNER, token: TOKEN, broker: null, enabled: false, now: () => clock, history: async () => [] });
  try {
    service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening'); service.startLoop();
    const address = service.server.address(); assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/healthz`;
    assert.equal((await fetch(url)).status, 200); clock += 240001;
    const stale = await fetch(url); assert.equal(stale.status, 503); assert.deepEqual(await stale.json(), { status: 'stalled' });
  } finally { service.stopLoop(); service.server.close(); service.server.closeAllConnections(); store.close(); }
});
