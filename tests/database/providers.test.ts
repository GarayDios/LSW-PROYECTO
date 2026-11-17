import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { readSelectedDatabaseConfig } from '../../src/db/config.ts';
import { createPersistenceHandlers } from '../../src/api/persistence/handler.ts';
import { createSnapshotServer } from '../../services/mongo-api/server.ts';
import { createStateRepository } from '../../services/mongo-api/state-repository.ts';
import { createDefaultState } from '../../src/db/state.ts';
import { MongoServerError, type Db } from 'mongodb';

const token = 'test-only-mongo-primary-token-32-characters';
test('explicit provider selection is independent and missing remote configuration never falls back to local', () => {
  const mongo = { MONGO_BRIDGE_URL: 'http://127.0.0.1:8788', MONGO_BRIDGE_TOKEN: token, SUPABASE_URL: 'invalid' };
  assert.equal(readSelectedDatabaseConfig(mongo, 'mongodb')?.mongoBridge, null);
  assert.equal(readSelectedDatabaseConfig(mongo, 'local'), null);
  assert.throws(() => readSelectedDatabaseConfig({}, 'mongodb'));
  assert.throws(() => readSelectedDatabaseConfig({}, 'supabase'));
  assert.throws(() => readSelectedDatabaseConfig({}, 'unknown'));
  const supabase = readSelectedDatabaseConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test_server_only', MONGO_BRIDGE_URL: 'invalid' }, 'supabase');
  assert.equal(supabase?.mongoBridge, null);
});

test('Mongo primary API round trip, authenticated ownership, conflicts and malformed writes', async () => {
  // Driver double preserves Mongo's atomic filter/update and unique _id semantics.
  const documents = new Map<string, any>();
  const database = { collection: () => ({
    findOne: async ({ _id }: { _id: string }) => structuredClone(documents.get(_id) ?? null),
    updateOne: async (filter: { _id: string; revision: number }, update: any, options: { upsert: boolean }) => {
      const old = documents.get(filter._id);
      if (old && old.revision === filter.revision) {
        documents.set(filter._id, { ...old, ...structuredClone(update.$set) });
        return { matchedCount: 1, upsertedCount: 0 };
      }
      if (options.upsert) {
        if (old) throw new MongoServerError({ code: 11000, message: 'duplicate' });
        documents.set(filter._id, { _id: filter._id, ...structuredClone(update.$set) });
        return { matchedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, upsertedCount: 0 };
    },
  }) } as unknown as Db;
  const repository = createStateRepository(database);
  const server = createSnapshotServer({ token, stateRepository: repository,
    repository: { put: async () => 'created', list: async () => [], get: async () => null } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let owner: { id: string; displayName: string; email: string } | null = { id: 'a', displayName: 'A', email: 'a@example.test' };
  const handlers = createPersistenceHandlers({
    config: request => readSelectedDatabaseConfig({ MONGO_BRIDGE_URL: base, MONGO_BRIDGE_TOKEN: token }, new URL(request!.url).searchParams.get('provider')),
    owner: async () => owner,
  });
  const url = 'http://app.test/api/persistence?provider=mongodb';
  const put = (body: unknown, origin = 'http://app.test') => handlers.PUT(new Request(url, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  try {
    assert.equal((await fetch(`${base}/state?ownerId=a`)).status, 401);
    const read = async () => await (await handlers.GET(new Request(url))).json() as { state: ReturnType<typeof createDefaultState> | null };
    const initial = await read();
    assert.equal(initial.state, null);
    const state = createDefaultState(); state.rate = .07;
    const first = await put({ expectedRevision: 0, state });
    assert.equal(first.status, 200);
    assert.equal(((await first.json()) as { revision: number }).revision, 1);
    assert.equal((await put({ expectedRevision: 0, state })).status, 409);
    const parallel = await Promise.all([put({ expectedRevision: 1, state }), put({ expectedRevision: 1, state })]);
    assert.deepEqual(parallel.map(r => r.status).sort(), [200, 409]);
    assert.equal((await read()).state?.rate, .07);
    assert.equal((await put({ expectedRevision: 2, state, ownerId: 'b' })).status, 400);
    assert.equal((await put({ expectedRevision: 2, state }, 'http://foreign.test')).status, 403);
    owner = { id: 'b', displayName: 'B', email: 'b@example.test' };
    assert.equal((await read()).state, null);
    owner = null;
    assert.equal((await handlers.GET(new Request(url))).status, 401);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
