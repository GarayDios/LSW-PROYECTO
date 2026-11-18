import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistenceHandlers } from '../../src/api/persistence/handler.ts';
import { readDatabaseConfig, DatabaseConfigError, type DatabaseConfig } from '../../src/db/config.ts';
import { databaseEnvironment, runWithDatabaseEnvironment } from '../../src/db/runtime.ts';
import { createDefaultState, terminalStateSchema, MAX_STATE_BYTES, type TerminalState } from '../../src/db/state.ts';
import { SupabaseRepository, PersistenceError, type ArchiveRecord } from '../../src/db/supabase/client.ts';
import { flushAnalysisArchive } from '../../src/db/mongodb/archive.ts';

const config: DatabaseConfig = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'sb_secret_test_only_not_a_real_key', mongoBridge: null };
const alice = { id: 'site-user-a', displayName: 'Ana', email: 'ana@example.test' };

test('persistence HTTP transports reject redirects with Worker-compatible fetch options', async () => {
  const redirect: typeof fetch = async (_input, init) => {
    assert.equal(init?.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.test' } });
  };
  await assert.rejects(new SupabaseRepository(config, redirect).load(alice.id), PersistenceError);
  let acknowledged = false;
  await flushAnalysisArchive({
    pending: async () => [{ id: '3f88e1aa-7070-445e-a8bd-e30f13377144', ownerId: alice.id, revision: 1, state: createDefaultState(), createdAt: new Date().toISOString() }],
    acknowledge: async (_owner, ids) => { acknowledged = ids.length > 0; },
  }, alice.id, { url: 'https://archive.test', token: 'test-only-at-least-32-character-token' }, redirect);
  assert.equal(acknowledged, false);
});
function repository() {
  const states = new Map<string, { revision: number; state: TerminalState; pendingArchives: number }>();
  return {
    load: async (ownerId: string) => states.get(ownerId) ?? { revision: 0, state: null, pendingArchives: 0 },
    save: async (owner: typeof alice, expected: number, state: TerminalState) => {
      const prior = states.get(owner.id);
      if ((prior?.revision ?? 0) !== expected) throw new PersistenceError('revision_conflict');
      const revision = expected + 1;
      states.set(owner.id, { revision, state: structuredClone(state), pendingArchives: (prior?.pendingArchives ?? 0) + 1 });
      return revision;
    },
    pending: async () => [] as ArchiveRecord[], acknowledge: async () => {},
  };
}
function request(body: unknown, origin = 'https://terminal.test') {
  return new Request('https://terminal.test/api/persistence', {
    method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
test('database configuration is opt-in, rejects partial/public keys and enforces secure service URLs', () => {
  assert.equal(readDatabaseConfig({}), null);
  assert.throws(() => readDatabaseConfig({ SUPABASE_URL: config.supabaseUrl }), DatabaseConfigError);
  assert.throws(() => readDatabaseConfig({ SUPABASE_URL: config.supabaseUrl, SUPABASE_SECRET_KEY: 'sb_publishable_not_a_server_key' }), DatabaseConfigError);
  assert.throws(() => readDatabaseConfig({ SUPABASE_URL: 'http://external.test', SUPABASE_SECRET_KEY: config.supabaseKey }), DatabaseConfigError);
  assert.throws(() => readDatabaseConfig({ SUPABASE_URL: config.supabaseUrl, SUPABASE_SECRET_KEY: config.supabaseKey, MONGO_BRIDGE_URL: 'https://bridge.test' }), DatabaseConfigError);
  assert.equal(readDatabaseConfig({ SUPABASE_URL: 'http://127.0.0.1:54321/', SUPABASE_SECRET_KEY: config.supabaseKey })?.supabaseUrl, 'http://127.0.0.1:54321');
  const legacy = ['header', Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url'), 'signature'].join('.');
  assert.equal(readDatabaseConfig({ SUPABASE_URL: config.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: legacy })?.supabaseKey, legacy);
});
test('request environment bindings cannot leak between concurrent visitors', async () => {
  const values = await Promise.all(['a', 'b'].map(id => runWithDatabaseEnvironment({ SUPABASE_URL: id }, async () => {
    await new Promise(resolve => setTimeout(resolve, 2));
    return databaseEnvironment().SUPABASE_URL;
  })));
  assert.deepEqual(values, ['a', 'b']);
});
test('unconfigured API stays local; configured API requires a server-authenticated owner', async () => {
  let ownerReads = 0;
  const local = createPersistenceHandlers({ config: () => null, owner: async () => { ownerReads++; return null; } });
  const result = await local.GET();
  assert.deepEqual(await result.json(), { mode: 'local' });
  assert.equal(ownerReads, 0);
  assert.match(result.headers.get('Cache-Control') ?? '', /no-store/);
  const secured = createPersistenceHandlers({ config: () => config, owner: async () => null, repository });
  assert.equal((await secured.GET()).status, 401);
  assert.equal((await secured.PUT(request({ expectedRevision: 0, state: createDefaultState() }))).status, 401);
});
test('API scopes state to the trusted owner, rejects forged owner IDs and detects stale writes', async () => {
  const store = repository();
  let owner = alice;
  const api = createPersistenceHandlers({ config: () => config, owner: async () => owner, repository: () => store });
  const initial = await (await api.GET()).json() as { state: unknown };
  assert.equal(initial.state, null);
  const state = createDefaultState();
  state.lists.push({ id: 'custom', name: 'Ana', symbols: ['NVDA'] });
  assert.equal((await api.PUT(request({ expectedRevision: 0, state, ownerId: 'victim' }))).status, 400);
  const saved = await api.PUT(request({ expectedRevision: 0, state }));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json() as { revision: number }).revision, 1);
  assert.equal((await api.PUT(request({ expectedRevision: 0, state }))).status, 409);
  owner = { ...alice, id: 'site-user-b' };
  assert.equal((await (await api.GET()).json() as { state: unknown }).state, null);
  owner = alice;
  assert.deepEqual((await (await api.GET()).json() as { state: unknown }).state, state);
});
test('API rejects cross-origin writes, malformed JSON and invalid state before saving', async () => {
  const api = createPersistenceHandlers({ config: () => config, owner: async () => alice, repository });
  const body = { expectedRevision: 0, state: createDefaultState() };
  assert.equal((await api.PUT(request(body, 'https://other.test'))).status, 403);
  assert.equal((await api.PUT(new Request('https://terminal.test/api/persistence', { method: 'PUT', body: '{}', headers: { Origin: 'https://terminal.test' } }))).status, 415);
  assert.equal((await api.PUT(new Request('https://terminal.test/api/persistence', { method: 'PUT', body: '{', headers: { Origin: 'https://terminal.test', 'Content-Type': 'application/json' } }))).status, 400);
  assert.equal((await api.PUT(request({ ...body, state: { ...body.state, rate: -1 } }))).status, 400);
  assert.equal((await api.PUT(request({ ...body, state: { ...body.state, lists: [...body.state.lists, body.state.lists[0]] } }))).status, 400);
  const oversized = new Request('https://terminal.test/api/persistence', { method: 'PUT', body: 'x', headers: { Origin: 'https://terminal.test', 'Content-Type': 'application/json', 'Content-Length': String(MAX_STATE_BYTES + 10000) } });
  assert.equal((await api.PUT(oversized)).status, 413);
});
test('unexpected provider errors never expose credentials or server details', async () => {
  const store = repository();
  store.load = async () => { throw new Error('mongodb://password@secret-host'); };
  const api = createPersistenceHandlers({ config: () => config, owner: async () => alice, repository: () => store });
  const failed = await api.GET();
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /password|secret-host/);
});
test('a committed save remains successful if the archive-status lookup fails', async () => {
  const store = repository();
  store.load = async () => { throw new Error('status unavailable'); };
  const api = createPersistenceHandlers({ config: () => config, owner: async () => alice, repository: () => store });
  const saved = await api.PUT(request({ expectedRevision: 0, state: createDefaultState() }));
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { revision: 1, archive: { enabled: false, pending: null } });
});
test('Supabase HTTP adapter keeps secret keys on the server and maps PT409 safely', async () => {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const client = new SupabaseRepository(config, async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(init?.body as string), headers: new Headers(init?.headers) });
    return Response.json({ revision: 0, state: null, pendingArchives: 0 });
  });
  assert.equal((await client.load(alice.id)).state, null);
  assert.equal(calls[0].url, config.supabaseUrl + '/rest/v1/rpc/load_terminal_state');
  assert.deepEqual(calls[0].body, { p_owner_id: alice.id });
  assert.equal(calls[0].headers.get('apikey'), config.supabaseKey);
  assert.equal(calls[0].headers.get('Authorization'), null, 'new secret keys are not JWT bearer tokens');
  const stale = new SupabaseRepository(config, async () => Response.json({ code: 'PT409', message: 'private diagnostic' }, { status: 409 }));
  await assert.rejects(stale.save(alice, 0, createDefaultState()), (error: unknown) => error instanceof PersistenceError && error.code === 'revision_conflict' && !error.message.includes('diagnostic'));
  const voidClient = new SupabaseRepository(config, async () => new Response('', { status: 200 }));
  await voidClient.acknowledge(alice.id, ['3f88e1aa-7070-445e-a8bd-e30f13377144']);
  await assert.rejects(voidClient.load(alice.id), PersistenceError, 'state responses still require valid JSON');
});
test('archive delivery only acknowledges successful owner-scoped writes and retries failed entries', async () => {
  const state = createDefaultState();
  const records: ArchiveRecord[] = [
    { id: '3f88e1aa-7070-445e-a8bd-e30f13377144', ownerId: alice.id, revision: 1, state, createdAt: new Date().toISOString() },
    { id: '56755d28-c07f-44a3-a578-7ddf57220d53', ownerId: alice.id, revision: 2, state, createdAt: new Date().toISOString() },
    { id: '601d33a2-4c46-4b79-8cad-e76c80306a5b', ownerId: 'other', revision: 3, state, createdAt: new Date().toISOString() },
  ];
  const ack: string[][] = [];
  const queue = { pending: async () => records, acknowledge: async (ownerId: string, ids: string[]) => { assert.equal(ownerId, alice.id); ack.push(ids); } };
  const bridge = { url: 'https://archive.test', token: 'test-bridge-token-with-at-least-32-characters' };
  let sent = 0;
  await flushAnalysisArchive(queue, alice.id, bridge, async (_input, init) => {
    const entry = JSON.parse(init?.body as string) as ArchiveRecord;
    assert.equal(entry.ownerId, alice.id);
    sent++;
    return Response.json({ id: entry.id, status: 'created' }, { status: entry.revision === 1 ? 201 : 503 });
  });
  assert.equal(sent, 2);
  assert.deepEqual(ack, [[records[0].id]]);
  await flushAnalysisArchive(queue, alice.id, bridge, async () => { throw new Error('network down'); });
  assert.deepEqual(ack[1], []);
  await flushAnalysisArchive(queue, alice.id, bridge, async () => Response.json({ status: 'queued' }, { status: 202 }));
  assert.deepEqual(ack[2], [], 'acceptance without a durable insertion is not acknowledged');
  await flushAnalysisArchive(queue, alice.id, bridge, async () => Response.json({ id: 'unrelated', status: 'created' }, { status: 201 }));
  assert.deepEqual(ack[3], [], 'unrelated success responses are not acknowledged');
});
test('shared model rejects malformed financial records and keeps valid defaults', () => {
  assert.deepEqual(terminalStateSchema.parse(createDefaultState()), createDefaultState());
  assert.equal(terminalStateSchema.safeParse({ ...createDefaultState(), orders: [{ id: 'x', quantity: 0 }] }).success, false);
  assert.equal(terminalStateSchema.safeParse({ ...createDefaultState(), cycles: [{ version: 1 }] }).success, false);
});

test('saved analysis policies retain tuning and old policies remain readable',()=>{
  const state=createDefaultState();
  const config={cores:['trend'],operationStart:'2026-11-17',operationEnd:'2026-12-17',startTime:'09:30',endTime:'16:00',historyStart:'2023-11-17',historyEnd:'2026-11-17',interval:'1d',rate:.04,
    analysis:{capital:20000,feePerContract:.65,maxSpreadPercent:30,longDays:365,dividendPercentBySymbol:{AAPL:0},tuning:{coreWeights:{trend:3},scenarioChanges:[-.5,0,.5],riskDrawdownWeight:.8}}};
  const input={...state,lists:[{...state.lists[0],config}]};
  const parsed=terminalStateSchema.parse(input);
  assert.equal(parsed.lists[0].config?.analysis?.tuning?.coreWeights.trend,3);
  assert.deepEqual(parsed.lists[0].config?.analysis?.tuning?.scenarioChanges,[-.5,0,.5]);
  assert.equal(parsed.lists[0].config?.analysis?.tuning?.binomialSteps,100);
  const legacy={...input,lists:[{...input.lists[0],config:{...config,analysis:{...config.analysis,tuning:undefined}}}]};
  assert.equal(terminalStateSchema.parse(legacy).lists[0].config?.analysis?.tuning,undefined);
});

test('order provenance, model inputs and contract units survive persistence validation',()=>{
  const state=createDefaultState();
  const order={id:'source-order',symbol:'AAPL',side:'buy',type:'call',strike:100,expiry:'2026-12-18',quantity:1,premium:2,total:20,createdAt:'2026-11-17T16:00:00Z',status:'Simulada',operationStart:'2026-11-17',operationEnd:'2026-12-18',startTime:'09:30',endTime:'16:00',multiplier:10,shares:15,
    provenance:{mode:'estimated',asOf:'2026-11-17T16:00:00Z',contractSymbol:null,spotSource:'quote fixture',volatilitySource:'HV assumed',rateSource:'FRED fixture',dividendSource:'explicit q=0',warnings:['scenario'],inputs:{spot:100,strike:100*10/15,days:30,volatility:.3,rate:.04,dividendYield:0,type:'call'}}};
  const parsed=terminalStateSchema.parse({...state,orders:[order]});
  assert.equal(parsed.orders[0].multiplier,10);assert.equal(parsed.orders[0].shares,15);assert.equal(parsed.orders[0].provenance?.inputs?.volatility,.3);
  assert.equal(terminalStateSchema.safeParse({...state,orders:[{...order,multiplier:-1}]}).success,false);
});
