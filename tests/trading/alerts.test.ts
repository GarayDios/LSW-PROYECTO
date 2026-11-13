import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openRunnerStore } from '../../services/trading-runner/store.ts';
import { alertKey, createAlertDispatcher, readAlertConfig } from '../../services/trading-runner/alerts.ts';
import type { RunEvent } from '../../services/trading-runner/model.ts';

const now = Date.parse('2026-11-13T15:00:00Z');
const event: RunEvent = { id: 'event-1', ownerId: 'owner', planId: 'plan', time: new Date(now).toISOString(), status: 'filled', message: 'Alpaca Paper: filled; 2/2 acciones ejecutadas a precio medio $100.', clientOrderId: 'tepic-entry' };

test('alerts remain opt-in and reject URLs that could leak credentials through redirects or query strings', () => {
  assert.equal(readAlertConfig({}), null);
  for (const url of ['http://example.test/hook', 'https://u:p@example.test/', 'https://example.test/?token=x', 'https://example.test/#hook']) assert.throws(() => readAlertConfig({ TRADING_ALERT_WEBHOOK_URL: url }));
  assert.throws(() => readAlertConfig({ TRADING_ALERT_WEBHOOK_TOKEN: 'private-token' }));
  assert.deepEqual(readAlertConfig({ TRADING_ALERT_WEBHOOK_URL: 'https://example.test/hook' }), { url: 'https://example.test/hook' });
});

test('alert queue persists retry times, isolates owners, and only acknowledges successful delivery', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tepic-alerts-')), file = path.join(directory, 'runner.sqlite');
  let store = openRunnerStore(file), clock = now;
  try {
    store.addEvent(event); store.addEvent({ ...event, id: 'event-2' });
    assert.equal(store.pendingAlerts('owner', now).length, 1);
    assert.equal(store.pendingAlerts('other', now).length, 0);
    let calls = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      calls++; assert.equal(init?.redirect, 'manual'); assert.equal(new Headers(init?.headers).get('Idempotency-Key'), alertKey(event));
      const value = JSON.parse(String(init?.body)); assert.equal(value.event.ownerId, 'owner');
      return new Response(null, { status: calls === 1 ? 302 : 204, headers: calls === 1 ? { Location: 'https://elsewhere.test' } : {} });
    };
    const dispatch = () => createAlertDispatcher({ queue: store, ownerId: 'owner', config: { url: 'https://receiver.test/hook' }, now: () => clock, fetcher })();
    await dispatch(); assert.equal(calls, 1); assert.equal(store.pendingAlerts('owner', now).length, 0);
    store.close(); store = openRunnerStore(file);
    clock += 60000; const pending = store.pendingAlerts('owner', clock); assert.equal(pending.length, 1); assert.equal(pending[0].attempts, 1);
    await dispatch(); assert.equal(calls, 2); assert.equal(store.pendingAlerts('owner', clock + 3600000).length, 0);
    store.addEvent({ ...event, id: 'event-3' }); assert.equal(store.pendingAlerts('owner', clock).length, 0, 'delivered event cannot be queued again');
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('operational failures are throttled while distinct partial fills each produce evidence', async () => {
  const failure = { ...event, status: 'error' as const, message: 'No se pudo completar la evaluación.' };
  assert.equal(alertKey(failure), alertKey({ ...failure, time: new Date(now + 60000).toISOString() }));
  assert.notEqual(alertKey(failure), alertKey({ ...failure, time: new Date(now + 900000).toISOString() }));
  assert.notEqual(alertKey({ ...event, status: 'partial', message: '1/2 acciones ejecutadas' }), alertKey({ ...event, status: 'partial', message: '2/3 acciones ejecutadas' }));
  assert.equal(alertKey({ ...event, status: 'waiting' }), null);
  const store = openRunnerStore(':memory:');
  try {
    store.addEvent(event);
    let calls = 0;
    await createAlertDispatcher({ queue: store, ownerId: 'owner', config: null, fetcher: async () => { calls++; throw Error('network forbidden'); } })();
    assert.equal(calls, 0); assert.equal(store.pendingAlerts('owner', now).length, 1);
  } finally { store.close(); }
});
