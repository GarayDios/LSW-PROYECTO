import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { companies } from '../../src/features/market/data.ts';
import { createCycle, defaultCycleConfig } from '../../src/cores/07-gestion-de-portafolio/cycle-simulator.ts';

const db = new PGlite();
const nvda = companies.find(company => company.symbol === 'NVDA')!;
const tables = ['terminal_profiles', 'terminal_preferences', 'watchlists', 'watchlist_items', 'paper_orders', 'investment_cycles', 'analysis_outbox'];

function fixture() {
  return {
    lists: [
      { id: 'favorites', name: 'Mi seguimiento', symbols: ['NVDA', 'AAPL', 'MSFT'] },
      { id: 'analysis-1', name: 'PMCC guardado', symbols: ['MSFT', 'NVDA'], strategy: 'pmcc', scores: { MSFT: { score: 85, reason: 'Δ y liquidez' }, NVDA: { score: 72, reason: 'Prima teórica' } }, config: { cores: ['bsm', 'greeks'], operationStart: '2026-11-09', operationEnd: '2026-12-11', startTime: '09:30', endTime: '16:00', historyStart: '2026-10-09', historyEnd: '2026-11-09', interval: '1h', rate: .0475 } },
    ],
    orders: [{ id: 'paper-1', symbol: 'NVDA', side: 'buy', type: 'call', strike: 150, expiry: '2026-12-11', quantity: 2, premium: 8.37, total: 1674, createdAt: '2026-11-13T19:00:00.000Z', status: 'Simulada', operationStart: '2026-11-09', operationEnd: '2026-12-11', startTime: '09:30', endTime: '16:00' }],
    cycles: [createCycle({ ...defaultCycleConfig(nvda, 'wheel', .0475), id: 'cycle-wheel' }), createCycle({ ...defaultCycleConfig(nvda, 'pmcc', .0475), id: 'cycle-pmcc' })],
    rate: .0475,
  };
}
type State = ReturnType<typeof fixture>;
type ReadResult = { revision: number; state: State | null; pendingArchives: number };
type OutboxEntry = { id: string; ownerId: string; revision: number; state: State; createdAt: string };

async function save(owner: string, revision: number, state: unknown, display = 'Usuario de prueba') {
  const result = await db.query<{ result: { revision: number } }>(
    'select public.save_terminal_state($1, $2, $3, $4, $5::jsonb) as result',
    [owner, display, 'test@example.invalid', revision, JSON.stringify(state)],
  );
  return result.rows[0].result;
}
async function load(owner: string) {
  return (await db.query<{ result: ReadResult }>('select public.load_terminal_state($1) as result', [owner])).rows[0].result;
}
async function outbox(owner: string, limit = 10) {
  return (await db.query<{ result: OutboxEntry[] }>('select public.list_analysis_outbox($1, $2) as result', [owner, limit])).rows[0].result;
}
async function acknowledge(owner: string, ids: string[]) {
  await db.query('select public.mark_analysis_delivered($1, array(select jsonb_array_elements_text($2::jsonb)::uuid))', [owner, JSON.stringify(ids)]);
}

before(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  const sql = await readFile(new URL('../../supabase/migrations/202611130001_terminal_persistence.sql', import.meta.url), 'utf8');
  await db.exec(sql);
});
beforeEach(async () => { await db.exec('reset role; truncate public.terminal_profiles cascade;'); });
after(async () => { await db.close(); });

test('migration enables RLS on every table and exposes only server RPCs', async () => {
  const result = await db.query<{ relname: string; relrowsecurity: boolean }>('select relname, relrowsecurity from pg_class where relnamespace = \'public\'::regnamespace and relkind = \'r\' order by relname');
  assert.deepEqual(result.rows.map(row => row.relname), [...tables].sort());
  assert.ok(result.rows.every(row => row.relrowsecurity));
  for (const role of ['anon', 'authenticated']) {
    for (const table of tables) {
      const permission = await db.query<{ allowed: boolean }>('select has_table_privilege($1, $2, \'SELECT,INSERT,UPDATE,DELETE\') as allowed', [role, `public.${table}`]);
      assert.equal(permission.rows[0].allowed, false, `${role} can access ${table}`);
    }
  }
  const functions = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] }>('select proname, prosecdef, proconfig from pg_proc where pronamespace = \'public\'::regnamespace order by proname');
  assert.equal(functions.rows.length, 4);
  assert.ok(functions.rows.every(fn => fn.prosecdef && fn.proconfig.includes('search_path=""')));
  await db.exec('set role service_role');
  try {
    assert.deepEqual(await load('site:text-owner'), { revision: 0, state: null, pendingArchives: 0 });
    await assert.rejects(db.query('select * from public.terminal_profiles'), { code: '42501' });
  } finally { await db.exec('reset role'); }
});

test('anonymous and ordinary authenticated callers cannot impersonate an owner through RPCs', async () => {
  await save('site:owner-a', 0, fixture());
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(load('site:owner-a'), { code: '42501' });
      await assert.rejects(save('site:owner-a', 1, fixture()), { code: '42501' });
      await assert.rejects(outbox('site:owner-a'), { code: '42501' });
      await assert.rejects(acknowledge('site:owner-a', []), { code: '42501' });
    } finally { await db.exec('reset role'); }
  }
  assert.equal((await load('site:owner-a')).revision, 1);
});

test('uninitialized state is null and reads do not create profiles', async () => {
  assert.deepEqual(await load('new-sites-user'), { revision: 0, state: null, pendingArchives: 0 });
  const count = await db.query<{ count: number }>('select count(*)::integer as count from public.terminal_profiles');
  assert.equal(count.rows[0].count, 0);
});

test('state round trip preserves list order, scores, configuration, orders and complete simulated cycles', async () => {
  const state = fixture();
  assert.deepEqual(await save('site:owner-a', 0, state), { revision: 1 });
  assert.deepEqual(await load('site:owner-a'), { revision: 1, state, pendingArchives: 1 });
  const entries = await outbox('site:owner-a');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].ownerId, 'site:owner-a');
  assert.equal(entries[0].revision, 1);
  assert.deepEqual(entries[0].state, state);
  assert.match(entries[0].id, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(entries[0].createdAt)));
});

test('users can share logical IDs while updates and deletes remain owner scoped', async () => {
  const alice = fixture();
  const bob = fixture();
  bob.lists[0].name = 'Seguimiento de B';
  bob.rate = .12;
  await save('alice', 0, alice);
  await save('bob', 0, bob);
  const changed = { ...alice, lists: [alice.lists[1]], orders: [], cycles: [], rate: .01 };
  await save('alice', 1, changed);
  assert.deepEqual((await load('alice')).state, changed);
  assert.deepEqual((await load('bob')).state, bob);
  const items = await db.query<{ count: number }>('select count(*)::integer as count from public.watchlist_items where owner_id = $1 and list_id = $2', ['alice', 'favorites']);
  assert.equal(items.rows[0].count, 0);
});

test('empty arrays represent intentional deletion, preserve preferences and advance the revision once', async () => {
  await save('alice', 0, fixture());
  const emptied = { lists: [], orders: [], cycles: [], rate: 0 };
  assert.deepEqual(await save('alice', 1, emptied), { revision: 2 });
  assert.deepEqual(await load('alice'), { revision: 2, state: emptied, pendingArchives: 2 });
  const count = await db.query<{ count: number }>('select count(*)::integer as count from public.watchlist_items');
  assert.equal(count.rows[0].count, 0);
});

test('two clients reading one revision cannot overwrite each other, including the first write', async () => {
  const firstRead = await load('alice');
  const secondRead = await load('alice');
  await save('alice', firstRead.revision, fixture());
  await assert.rejects(save('alice', secondRead.revision, { ...fixture(), rate: .09 }), { code: 'PT409' });
  const stateAfterFirstWrite = await load('alice');
  const staleTab = await load('alice');
  const current = { ...fixture(), rate: .08 };
  await save('alice', stateAfterFirstWrite.revision, current);
  await assert.rejects(save('alice', staleTab.revision, fixture()), { code: 'PT409' });
  assert.deepEqual(await load('alice'), { revision: 2, state: current, pendingArchives: 2 });
});

test('a constraint failure after replacing data rolls back every aggregate, revision and outbox entry', async () => {
  const original = fixture();
  await save('alice', 0, original);
  const invalid = fixture();
  invalid.rate = .2;
  invalid.lists = [invalid.lists[1]];
  invalid.orders[0].quantity = 0;
  await assert.rejects(save('alice', 1, invalid), { code: '23514' });
  assert.deepEqual(await load('alice'), { revision: 1, state: original, pendingArchives: 1 });
  await assert.rejects(save('new-owner', 0, invalid), { code: '23514' });
  assert.deepEqual(await load('new-owner'), { revision: 0, state: null, pendingArchives: 0 });
});

test('duplicate list IDs and duplicate symbols fail atomically', async () => {
  const initial = fixture();
  await save('alice', 0, initial);
  const duplicateIds = fixture();
  duplicateIds.lists[1].id = duplicateIds.lists[0].id;
  await assert.rejects(save('alice', 1, duplicateIds), { code: '23505' });
  const duplicateSymbols = fixture();
  duplicateSymbols.lists[0].symbols.push('NVDA');
  await assert.rejects(save('alice', 1, duplicateSymbols), { code: '23505' });
  assert.deepEqual((await load('alice')).state, initial);
});

test('invalid shape, rates, owner IDs and revisions are rejected before mutation', async () => {
  for (const state of [null, {}, { ...fixture(), rate: -.01 }, { ...fixture(), rate: .3 }, { ...fixture(), orders: null }, { ...fixture(), lists: [{ id: 'x', name: 'Lista', symbols: [123] }] }]) {
    await assert.rejects(save('alice', 0, state), { code: '22023' });
  }
  await assert.rejects(save('', 0, fixture()), { code: '22023' });
  await assert.rejects(save('alice', -1, fixture()), { code: '22023' });
  assert.deepEqual(await load('alice'), { revision: 0, state: null, pendingArchives: 0 });
});

test('SQL enforces array, name and byte limits independently of API validation', async () => {
  const initial = fixture();
  await save('alice', 0, initial);
  const tooManyLists = { ...fixture(), lists: Array.from({ length: 201 }, (_, index) => ({ id: `list-${index}`, name: 'Lista', symbols: ['NVDA'] })) };
  const sampleOrder = fixture().orders[0];
  const tooManyOrders = { ...fixture(), orders: Array.from({ length: 5001 }, (_, index) => ({ ...sampleOrder, id: `order-${index}` })) };
  const sampleCycle = fixture().cycles[0];
  const tooManyCycles = { ...fixture(), cycles: Array.from({ length: 201 }, (_, index) => ({ ...sampleCycle, id: `cycle-${index}` })) };
  const tooLarge = { ...fixture(), lists: [{ id: 'large', name: 'Análisis extenso', symbols: ['NVDA'], scores: { NVDA: { score: 1, reason: 'á'.repeat(1024 * 1024) } } }] };
  for (const state of [tooManyLists, tooManyOrders, tooManyCycles, tooLarge]) {
    await assert.rejects(save('alice', 1, state), { code: '22023' });
  }
  const tooLongName = fixture();
  tooLongName.lists[0].name = 'x'.repeat(129);
  await assert.rejects(save('alice', 1, tooLongName), { code: '23514' });
  assert.deepEqual(await load('alice'), { revision: 1, state: initial, pendingArchives: 1 });
});

test('outbox acknowledgements are owner scoped and idempotent; failed deliveries remain pending', async () => {
  await save('alice', 0, fixture());
  await save('alice', 1, { ...fixture(), rate: .07 });
  await save('bob', 0, fixture());
  const aliceEntries = await outbox('alice');
  const bobEntries = await outbox('bob');
  assert.deepEqual(aliceEntries.map(entry => entry.revision), [1, 2]);
  assert.equal((await outbox('alice', 1)).length, 1);
  await acknowledge('alice', [bobEntries[0].id]);
  assert.equal((await load('bob')).pendingArchives, 1);
  await acknowledge('alice', [aliceEntries[0].id]);
  await acknowledge('alice', [aliceEntries[0].id]);
  assert.equal((await load('alice')).pendingArchives, 1);
  assert.deepEqual((await outbox('alice')).map(entry => entry.id), [aliceEntries[1].id]);
  await acknowledge('alice', [aliceEntries[1].id]);
  assert.equal((await load('alice')).pendingArchives, 0);
  assert.equal((await load('bob')).pendingArchives, 1);
  await assert.rejects(outbox('alice', 0), { code: '22023' });
  await assert.rejects(outbox('alice', 101), { code: '22023' });
});

test('deleting a profile cascades only its owned aggregates and outbox records', async () => {
  await save('alice', 0, fixture());
  const bob = fixture();
  await save('bob', 0, bob);
  await db.query('delete from public.terminal_profiles where owner_id = $1', ['alice']);
  for (const table of tables) {
    const count = await db.query<{ count: number }>(`select count(*)::integer as count from public.${table} where owner_id = $1`, ['alice']);
    assert.equal(count.rows[0].count, 0, table);
  }
  assert.deepEqual((await load('bob')).state, bob);
});
