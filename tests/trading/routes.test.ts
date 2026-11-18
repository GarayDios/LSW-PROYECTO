import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradingHandlers } from '../../src/api/trading/handlers.ts';

const environment = { ALPACA_API_KEY: 'test-key', ALPACA_SECRET_KEY: 'test-secret', BROKER_OWNER_USER_ID: 'owner-a', TRADING_RUNNER_URL: 'http://127.0.0.1:8790', TRADING_RUNNER_TOKEN: 'test-service-token-at-least-32-characters', ALPACA_AUTOMATION_ENABLED: 'true' };
const request = (body: unknown, origin = 'https://terminal.test') => new Request('https://terminal.test/api/automation', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const plan = { symbol: 'AAPL', historyYears: 3, startDate: '2026-11-13', endDate: '2026-12-13', maxOrderUsd: 500, maxPositionUsd: 1000 };

test('runner proxy refuses redirects and uses the fetch mode supported by Workers', async () => {
  let calls = 0;
  const api = createTradingHandlers({ environment: () => environment, owner: async () => ({ userId: 'owner-a' }), fetcher: async (_input, init) => {
    calls++;
    assert.equal(init?.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.test' } });
  } });
  assert.equal((await api.automationGet(new Request('https://terminal.test/api/automation?resource=status'))).status, 503);
  assert.equal(calls, 1);
});

test('broker status is truthful without credentials and exposes no secrets or account contents', async () => {
  const api = createTradingHandlers({ environment: () => ({}), owner: async () => ({ userId: 'viewer' }) });
  const response = await api.status(), value = await response.json() as { alpaca: { configured: boolean }; identity: { userId: string } };
  assert.equal(value.alpaca.configured, false);
  assert.equal(value.identity.userId, 'viewer');
  assert.equal((await api.account()).status, 503);
  assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
});
test('another visitor cannot query shared broker credentials, data or runner', async () => {
  let calls = 0;
  const api = createTradingHandlers({ environment: () => environment, owner: async () => ({ userId: 'other' }), fetcher: async () => { calls++; throw Error('should not fetch'); } });
  assert.equal((await api.account()).status, 403);
  assert.equal((await api.history(new Request('https://terminal.test/api/market/history?symbol=AAPL&start=2023-11-09&end=2026-11-09&interval=1d'))).status, 403);
  assert.equal((await api.automationGet(new Request('https://terminal.test/api/automation?resource=plans'))).status, 403);
  assert.equal(calls, 0);
});
test('runner proxy derives ownership from the request and creates disabled plans without leaking tokens', async () => {
  let forwarded: Record<string, unknown> | undefined;
  const api = createTradingHandlers({ manualOnly:false, environment: () => environment, owner: async () => ({ userId: 'owner-a' }), fetcher: async (input, init) => {
    assert.equal(String(input), 'http://127.0.0.1:8790/plans');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + environment.TRADING_RUNNER_TOKEN);
    forwarded = JSON.parse(init?.body as string);
    return Response.json({ plan: { ...forwarded, id: 'plan' } }, { status: 201 });
  } });
  const response = await api.automationPost(request({ action: 'create', plan }));
  assert.equal(response.status, 201);
  assert.equal(forwarded?.ownerId, 'owner-a');
  assert.equal(forwarded?.enabled, false);
  assert.doesNotMatch(await response.text(), /test-secret|test-service-token/);
  assert.equal((await api.automationPost(request({ action: 'create', plan, ownerId: 'other' }))).status, 400);
});
test('cross-origin actions and disabled automation cannot trigger a broker evaluation', async () => {
  let calls = 0;
  const api = createTradingHandlers({ environment: () => ({ ...environment, ALPACA_AUTOMATION_ENABLED: 'false' }), owner: async () => ({ userId: 'owner-a' }), fetcher: async () => { calls++; return Response.json({}); } });
  assert.equal((await api.automationPost(request({ action: 'tick' }, 'https://evil.test'))).status, 403);
  assert.equal((await api.automationPost(request({ action: 'tick' }))).status, 409);
  assert.equal((await api.automationPost(request({ action: 'enable', planId: 'd5ac1009-966c-46ef-bf2a-a467ad70ba46' }))).status, 409);
  assert.equal(calls, 0);
  assert.equal((await api.automationPost(request({ action: 'disable', planId: 'd5ac1009-966c-46ef-bf2a-a467ad70ba46' }))).status, 200);
  assert.equal(calls, 1, 'stopping a plan remains possible with the global switch off');
});
test('proxy restricts resources and sanitizes independent-service diagnostics', async () => {
  let lastUrl = '';
  const api = createTradingHandlers({ environment: () => environment, owner: async () => ({ userId: 'owner-a' }), fetcher: async input => {
    lastUrl = String(input);
    return Response.json({ error: 'secret URI diagnostic' }, { status: 500 });
  } });
  assert.equal((await api.automationGet(new Request('https://terminal.test/api/automation?resource=../../admin'))).status, 400);
  const failed = await api.automationGet(new Request('https://terminal.test/api/automation?resource=plans&ownerId=other'));
  assert.equal(new URL(lastUrl).searchParams.get('ownerId'), 'owner-a');
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /secret URI/);
});

test('risk controls and execution queries preserve server ownership and require an explicit exit policy', async () => {
  const forwarded: { url: string; body: Record<string, unknown> | null }[] = [];
  const api = createTradingHandlers({ manualOnly:false, environment: () => environment, owner: async () => ({ userId: 'owner-a' }), fetcher: async (url, init) => {
    forwarded.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ ok: true });
  } });
  for (const resource of ['executions', 'positions', 'risk']) {
    assert.equal((await api.automationGet(new Request('https://terminal.test/api/automation?resource=' + resource + '&ownerId=intruder'))).status, 200);
    assert.equal(new URL(forwarded.at(-1)!.url).searchParams.get('ownerId'), 'owner-a');
  }
  for (const action of ['pause', 'resume']) {
    assert.equal((await api.automationPost(request({ action }))).status, 200);
    assert.equal(forwarded.at(-1)!.body?.paused, action === 'pause');
    assert.equal(forwarded.at(-1)!.body?.ownerId, 'owner-a');
  }
  const exitPolicy = { stopLossPct: 3, takeProfitPct: 8, closeAtEnd: true, exitOnSignal: true };
  assert.equal((await api.automationPost(request({ action: 'create', plan: { ...plan, exitPolicy, maxDailyLossUsd: 50, maxTotalExposureUsd: 1500 } }))).status, 200);
  assert.deepEqual(forwarded.at(-1)!.body?.exitPolicy, exitPolicy);
  assert.equal(forwarded.at(-1)!.body?.enabled, false);
  assert.equal((await api.automationPost(request({ action: 'create', plan: { ...plan, exitPolicy: { ...exitPolicy, stopLossPct: -1 } } }))).status, 400);
  const bracket = { stopLossPct: 5, takeProfitPct: 10, execution: 'bracket' };
  assert.equal((await api.automationPost(request({ action: 'create', plan: { ...plan, exitPolicy: bracket } }))).status, 200);
  assert.deepEqual(forwarded.at(-1)!.body?.exitPolicy, bracket);
  const before = forwarded.length;
  assert.equal((await api.automationPost(request({ action: 'create', plan: { ...plan, exitPolicy: { ...bracket, closeAtEnd: true } } }))).status, 400);
  assert.equal(forwarded.length, before, 'brackets cannot quietly ignore an requested date exit');
});
