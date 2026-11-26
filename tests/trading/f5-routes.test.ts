import test from 'node:test';
import assert from 'node:assert/strict';
import { createF5Handlers } from '../../src/api/f5/handlers.ts';
import { f5RiskMessages } from '../../src/features/f5/risk-messages.ts';

const environment = { ALPACA_API_KEY: 'test-key', ALPACA_SECRET_KEY: 'test-secret', BROKER_OWNER_USER_ID: 'owner',
  TRADING_RUNNER_URL: 'http://127.0.0.1:8790', TRADING_RUNNER_TOKEN: 'test-internal-token-at-least-32-characters', ALPACA_F5_ENABLED: 'true' };
const id = 'ab05651c-e1c0-4c5c-a61e-3c70bd40628c';
const request = (value: unknown, origin = 'https://terminal.test') => new Request('https://terminal.test/api/f5', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value),
});

test('F5 identity gates reads and mutations before service calls', async () => {
  let calls = 0;
  for (const user of [null, { userId: 'another-owner' }]) {
    const api = createF5Handlers({ environment: () => environment, owner: async () => user, fetcher: async () => { calls++; throw Error(); } });
    const expected = user ? 403 : 401;
    assert.equal((await api.get(new Request('https://terminal.test/api/f5'))).status, expected);
    assert.equal((await api.post(request({ action: 'submit', previewId: id }))).status, expected);
  }
  assert.equal(calls, 0);
});

test('F5 proxy fixes owner, isolates service credentials and does not follow redirects', async () => {
  const forwarded: { url: URL; init?: RequestInit }[] = [];
  const api = createF5Handlers({ environment: () => environment, owner: async () => ({ userId: 'owner' }), fetcher: async (input, init) => {
    forwarded.push({ url: new URL(String(input)), init });
    return Response.json({ operation: { id } });
  } });
  const get = await api.get(new Request('https://terminal.test/api/f5?resource=contracts&underlying=AAPL&expiry=2027-01-15&ownerId=someone-else'));
  assert.equal(get.status, 200);
  assert.equal(forwarded[0].url.pathname, '/f5/contracts');
  assert.equal(forwarded[0].url.searchParams.get('ownerId'), 'owner');
  assert.equal(forwarded[0].url.searchParams.get('expiry'), '2027-01-15');
  assert.equal(forwarded[0].init?.redirect, 'manual');
  assert.equal(new Headers(forwarded[0].init?.headers).get('Authorization'), 'Bearer ' + environment.TRADING_RUNNER_TOKEN);
  assert.match(get.headers.get('Cache-Control') ?? '', /private, no-store/);
  assert.doesNotMatch(await get.text(), /test-secret|test-internal-token/);
  await api.post(request({ action: 'submit', previewId: id }));
  assert.deepEqual(JSON.parse(String(forwarded[1].init?.body)), { previewId: id, ownerId: 'owner' });
  assert.equal((await api.post(request({ action: 'submit', previewId: id, ownerId: 'attacker' }))).status, 400);
});

test('F5 server switch blocks submissions while preview and cancel remain available', async () => {
  const actions: string[] = [];
  const api = createF5Handlers({ environment: () => ({ ...environment, ALPACA_F5_ENABLED: 'false' }), owner: async () => ({ userId: 'owner' }), fetcher: async input => { actions.push(new URL(String(input)).pathname); return Response.json({}); } });
  assert.equal((await api.post(request({ action: 'submit', previewId: id }))).status, 409);
  assert.equal((await api.post(request({ action: 'preview', request: { action: 'open', strategy: 'wheel' } }))).status, 200);
  assert.equal((await api.post(request({ action: 'cancel', operationId: id }))).status, 200);
  assert.deepEqual(actions, ['/f5/preview', '/f5/cancel']);
});

test('F5 rejects cross-site writes, arbitrary paths and nonprivate service targets', async () => {
  let calls = 0;
  const options = { environment: () => environment, owner: async () => ({ userId: 'owner' }), fetcher: async () => { calls++; return Response.json({}); } };
  const api = createF5Handlers(options);
  assert.equal((await api.post(request({ action: 'submit', previewId: id }, 'https://other.test'))).status, 403);
  assert.equal((await api.get(new Request('https://terminal.test/api/f5?resource=../../healthz'))).status, 400);
  assert.equal((await api.get(new Request('https://terminal.test/api/f5?resource=contracts&underlying=AAPL%26ownerId%3Dother'))).status, 400);
  for (const url of ['http://remote.test', 'https://name:password@runner.test', 'https://runner.test/private']) {
    const invalid = createF5Handlers({ ...options, environment: () => ({ ...environment, TRADING_RUNNER_URL: url }) });
    assert.equal((await invalid.get(new Request('https://terminal.test/api/f5'))).status, 503);
  }
  assert.equal(calls, 0);
});

test('F5 sanitizes unexpected service errors and ambiguous network responses', async () => {
  for (const mode of ['secret', 'redirect', 'network']) {
    const api = createF5Handlers({ environment: () => environment, owner: async () => ({ userId: 'owner' }), fetcher: async () => {
      if (mode === 'network') throw Error('private password');
      if (mode === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://elsewhere.test' } });
      return Response.json({ error: { code: 'internal_stack', message: 'private password secret token' } }, { status: 500 });
    } });
    const response = await api.post(request({ action: 'submit', previewId: id }));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private password|secret token|internal_stack/);
  }
});

test('F5 status combines both enable switches and preserves specific safe validation errors', async () => {
  const dependencies = { environment: () => ({ ...environment, ALPACA_F5_ENABLED: 'false' }), owner: async () => ({ userId: 'owner' }), fetcher: async () => Response.json({ enabled: true, configured: true }) };
  const response = await createF5Handlers(dependencies).get(new Request('https://terminal.test/api/f5'));
  assert.equal((await response.json() as { enabled: boolean }).enabled, false);
  for (const code of ['f5_options_permission', 'f5_quote_unavailable', 'f5_uncovered_call', 'f5_existing_option_position']) {
    const api = createF5Handlers({ ...dependencies, fetcher: async () => Response.json({ error: { code, message: 'private service diagnostic' } }, { status: 409 }) });
    const result = await api.post(request({ action: 'preview', request: {} }));
    const body = await result.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, code);
    assert.doesNotMatch(body.error.message, /private service diagnostic/);
  }
});

test('F5 preview preserves each public risk reason for Alpaca and Webull', async () => {
  for (const provider of ['alpaca', 'webull'] as const) {
    for (const message of Object.values(f5RiskMessages)) {
      const api = createF5Handlers({ provider, environment: () => environment, owner: async () => ({ userId: 'owner' }),
        fetcher: async () => Response.json({ error: { code: 'f5_risk_blocked', message } }, { status: 409 }) });
      const result = await api.post(request({ action: 'preview', request: {} }));
      const body = await result.json() as { error: { code: string; message: string } };
      assert.equal(result.status, 409);
      assert.equal(body.error.code, 'f5_risk_blocked');
      assert(body.error.message.startsWith(message));
      assert.doesNotMatch(body.error.message, /F5 rechazó la solicitud/);
      if (message === f5RiskMessages.uncertain) assert.match(body.error.message, /delta vigente para cada contrato sugerido/);
    }
  }
});

test('F5 does not expose arbitrary diagnostics even for known risk codes or prototype names', async () => {
  for (const code of ['f5_risk_blocked', 'toString', '__proto__', 'constructor']) {
    const api = createF5Handlers({ environment: () => environment, owner: async () => ({ userId: 'owner' }),
      fetcher: async () => Response.json({ error: { code, message: 'private password secret token' } }, { status: 409 }) });
    const result = await api.post(request({ action: 'preview', request: {} }));
    assert.equal(result.status, 409);
    const body = await result.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, code === 'f5_risk_blocked' ? code : 'f5_request_rejected');
    assert.doesNotMatch(body.error.message, /private password|secret token/);
  }
});

test('F5 translates runner string errors and incomplete broker evidence during preview', async () => {
  for (const code of ['account_busy', 'owner_not_allowed', 'unauthorized', 'runner_unavailable', 'broker_exposure_uncertain', 'broker_activities_incomplete', 'f5_roll_invalid', 'f5_roll_unavailable']) {
    const api = createF5Handlers({ environment: () => environment, owner: async () => ({ userId: 'owner' }),
      fetcher: async () => Response.json({ error: code.startsWith('broker_') || code.startsWith('f5_') ? { code, message: 'private diagnostic' } : code }, { status: 409 }) });
    const result = await api.post(request({ action: 'preview', request: {} }));
    const body = await result.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, code);
    assert.doesNotMatch(body.error.message, /F5 rechazó la solicitud|private diagnostic/);
  }
});

test('Paper risk reset requires explicit confirmation and same-origin ownership before forwarding', async () => {
  const forwarded: Record<string, unknown>[] = [];
  const body = { action: 'reset-daily-risk', confirmed: true, reference: { date: '2026-11-25', baselineEquity: 100000, maxDailyLossUsd: 1000, resetId: null } };
  const options = { environment: () => environment, owner: async () => ({ userId: 'owner' }), fetcher: async (_url: string | URL | Request, init?: RequestInit) => {
    forwarded.push(JSON.parse(String(init?.body))); return Response.json({ risk: { dailyLossBlocked: false } });
  } };
  const api = createF5Handlers(options);
  assert.equal((await api.post(request({ ...body, confirmed: false }))).status, 400);
  assert.equal((await api.post(request({ ...body, ownerId: 'attacker' }))).status, 400);
  assert.equal((await api.post(request(body, 'https://other.test'))).status, 403);
  assert.equal((await createF5Handlers({ ...options, owner: async () => ({ userId: 'other' }) }).post(request(body))).status, 403);
  assert.equal((await createF5Handlers({ ...options, provider: 'webull' }).post(request(body))).status, 409);
  assert.equal(forwarded.length, 0);
  assert.equal((await api.post(request(body))).status, 200);
  assert.deepEqual(forwarded, [{ confirmed: true, reference: body.reference, ownerId: 'owner' }]);
});
