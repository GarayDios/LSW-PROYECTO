import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoClient, MongoServerError, type Db } from 'mongodb';
import { createSnapshotServer } from '../../services/mongo-api/server.ts';
import { createMongoRepository } from '../../services/mongo-api/repository.ts';
import { setupSnapshotCollection } from '../../services/mongo-api/indexes.ts';
import { MAX_BODY_BYTES, sameSnapshot, SnapshotConflictError, snapshotInputSchema, type Snapshot, type SnapshotInput, type SnapshotMetadata, type SnapshotRepository } from '../../services/mongo-api/model.ts';

const TOKEN = 'test-bridge-token-at-least-thirty-two-bytes';
const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

function fixture(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return { id: randomUUID(), ownerId: 'user-a', revision: 1, state: { lists: [{ id: 'favorites', name: 'Favoritos', symbols: ['AAPL'] }], orders: [], cycles: [], rate: 0.04 }, createdAt: '2026-11-13T19:00:00.000Z', ...overrides };
}

function memoryRepository(): SnapshotRepository {
  const snapshots = new Map<string, Snapshot>();
  return {
    async put(value) {
      const existing = snapshots.get(value.id);
      if (existing) {
        if (!sameSnapshot(existing, value)) throw new SnapshotConflictError();
        return 'existing';
      }
      if ([...snapshots.values()].some(snapshot => snapshot.ownerId === value.ownerId && snapshot.revision === value.revision)) throw new SnapshotConflictError();
      snapshots.set(value.id, structuredClone({ ...value, schemaVersion: 1 }));
      return 'created';
    },
    async list(ownerId, limit) {
      return [...snapshots.values()].filter(snapshot => snapshot.ownerId === ownerId).sort((a, b) => b.revision - a.revision).slice(0, limit).map(({ id, ownerId: owner, revision, schemaVersion, createdAt }) => ({ id, ownerId: owner, revision, schemaVersion, createdAt }));
    },
    async get(ownerId, id) {
      const snapshot = snapshots.get(id);
      return snapshot?.ownerId === ownerId ? structuredClone(snapshot) : null;
    },
  };
}

async function withServer(t: { after(fn: () => void | Promise<void>): void }, repository = memoryRepository()) {
  const server = createSnapshotServer({ token: TOKEN, repository });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('Mongo bridge requires a bounded strong service token and exposes only liveness anonymously', async t => {
  assert.throws(() => createSnapshotServer({ token: 'short', repository: memoryRepository() }), /32/);
  assert.throws(() => createSnapshotServer({ token: 'x'.repeat(513), repository: memoryRepository() }), /512/);
  const base = await withServer(t);
  const health = await fetch(base + '/healthz');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  for (const authorization of [undefined, 'Bearer wrong-token', `bearer ${TOKEN}`]) {
    const response = await fetch(base + '/snapshots?ownerId=user-a', { headers: authorization ? { authorization } : {} });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
});

test('Mongo snapshot transport validates strict JSON, root fields, ownership, ids and size', async t => {
  const base = await withServer(t);
  for (const value of [fixture({ revision: 0 }), fixture({ id: 'invalid' }), fixture({ ownerId: '' }), { ...fixture(), unrecognized: true }, { ...fixture(), state: { rate: 0.04, lists: null, cycles: [], orders: [] } }, fixture({ createdAt: 'today' })]) {
    assert.equal((await fetch(base + '/snapshots', { method: 'PUT', headers, body: JSON.stringify(value) })).status, 400);
  }
  assert.equal((await fetch(base + '/snapshots', { method: 'PUT', headers, body: '{"broken":' })).status, 400);
  const invalidUtf8 = Buffer.concat([Buffer.from('{"id":"'), Buffer.from([0xff]), Buffer.from('"}')]);
  const utf8Response = await fetch(base + '/snapshots', { method: 'PUT', headers, body: invalidUtf8 });
  assert.equal(utf8Response.status, 400);
  assert.deepEqual(await utf8Response.json(), { error: 'invalid_json' });
  assert.equal((await fetch(base + '/snapshots', { method: 'PUT', headers: { authorization: headers.authorization, 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(base + '/snapshots', { method: 'PUT', headers, body: ' '.repeat(MAX_BODY_BYTES + 1) })).status, 413);
  assert.equal((await fetch(base + '/snapshots?ownerId=user-a&limit=101', { headers })).status, 400);
  assert.equal((await fetch(base + '/snapshots?ownerId=user-a&limit=2x', { headers })).status, 400);
  assert.equal((await fetch(base + '/snapshots', { headers })).status, 400);
  assert.equal((await fetch(base + '/snapshots/invalid?ownerId=user-a', { headers })).status, 400);
});

test('Mongo bridge also enforces body size when content-length is absent', async t => {
  const base = await withServer(t);
  const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const req = request(base + '/snapshots', { method: 'PUT', headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(' '.repeat(MAX_BODY_BYTES));
    req.end(' ');
  });
  assert.equal(response.status, 413);
  assert.deepEqual(JSON.parse(response.body), { error: 'payload_too_large' });
});

test('Mongo snapshots preserve contents, list metadata and scope individual lookups by owner', async t => {
  const base = await withServer(t);
  const a = fixture();
  const b = fixture({ ownerId: 'user-b' });
  const a2 = fixture({ revision: 2 });
  for (const snapshot of [a, b, a2]) assert.equal((await fetch(base + '/snapshots', { method: 'PUT', headers, body: JSON.stringify(snapshot) })).status, 201);
  const get = await fetch(`${base}/snapshots/${a.id}?ownerId=user-a`, { headers });
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), { snapshot: { ...a, schemaVersion: 1 } });
  assert.equal((await fetch(`${base}/snapshots/${a.id}?ownerId=user-b`, { headers })).status, 404);
  const list = await (await fetch(base + '/snapshots?ownerId=user-a&limit=1', { headers })).json() as { snapshots: SnapshotMetadata[] };
  assert.equal(list.snapshots.length, 1);
  assert.equal(list.snapshots[0].id, a2.id);
  assert.equal(Object.hasOwn(list.snapshots[0], 'state'), false);
});

test('Mongo retry is idempotent and a conflicting id or owner revision cannot replace an archive', async t => {
  const base = await withServer(t);
  const original = fixture();
  const put = (value: unknown) => fetch(base + '/snapshots', { method: 'PUT', headers, body: JSON.stringify(value) });
  assert.equal((await put(original)).status, 201);
  assert.equal((await put(original)).status, 200);
  const reordered = { ...original, state: { rate: original.state.rate, cycles: [], orders: [], lists: [{ symbols: ['AAPL'], name: 'Favoritos', id: 'favorites' }] } };
  assert.equal((await put(reordered)).status, 200);
  for (const changed of [{ ...original, ownerId: 'user-b' }, { ...original, revision: 2 }, { ...original, state: { ...original.state, rate: 0.05 } }, { ...original, id: randomUUID() }]) {
    const response = await put(changed);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'snapshot_conflict' });
  }
  const after = await (await fetch(`${base}/snapshots/${original.id}?ownerId=user-a`, { headers })).json() as { snapshot: Snapshot };
  assert.deepEqual(after.snapshot, { ...original, schemaVersion: 1 });
});

test('Mongo bridge sanitizes database errors and does not expose connection strings', async t => {
  const unavailable = async (): Promise<never> => { throw new Error('mongodb://private:password@host secret-key stack'); };
  const base = await withServer(t, { put: unavailable, get: unavailable, list: unavailable });
  const response = await fetch(base + '/snapshots', { method: 'PUT', headers, body: JSON.stringify(fixture()) });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'archive_unavailable' });
});

test('Mongo snapshot document schema validates the shared terminal model and rejects unknown root fields', () => {
  const original = fixture();
  assert.deepEqual(snapshotInputSchema.parse(original), original);
  assert.equal(snapshotInputSchema.safeParse({ ...original, schemaVersion: 2 }).success, false);
  assert.equal(snapshotInputSchema.safeParse({ ...original, state: { ...original.state, rate: Infinity } }).success, false);
  assert.equal(snapshotInputSchema.safeParse({ ...original, state: { ...original.state, orders: [{ id: 'incomplete-order' }] } }).success, false);
});

test('Mongo driver adapter uses immutable inserts and scopes reads without replacing conflicts', async () => {
  type Document = Omit<Snapshot, 'id' | 'createdAt'> & { _id: string; createdAt: Date };
  const documents = new Map<string, Document>();
  let duplicateOnNextWrite = false;
  const collection = {
    async updateOne(filter: { _id: string }, update: { $setOnInsert: Document }, options: { upsert: boolean }) {
      assert.equal(options.upsert, true);
      assert.deepEqual(Object.keys(update), ['$setOnInsert']);
      if (duplicateOnNextWrite) {
        duplicateOnNextWrite = false;
        throw new MongoServerError({ message: 'duplicate', code: 11000 });
      }
      if (documents.has(filter._id)) return { upsertedCount: 0 };
      if ([...documents.values()].some(document => document.ownerId === update.$setOnInsert.ownerId && document.revision === update.$setOnInsert.revision)) throw new MongoServerError({ message: 'duplicate owner/revision', code: 11000 });
      documents.set(filter._id, structuredClone(update.$setOnInsert));
      return { upsertedCount: 1 };
    },
    async findOne(filter: { _id: string; ownerId?: string }) {
      const document = documents.get(filter._id);
      return document && (!filter.ownerId || filter.ownerId === document.ownerId) ? document : null;
    },
  };
  const repository = createMongoRepository({ collection: () => collection } as unknown as Db);
  const original = fixture();
  assert.equal(await repository.put(original), 'created');
  assert.equal(await repository.put(original), 'existing');
  duplicateOnNextWrite = true;
  assert.equal(await repository.put(original), 'existing', 'Concurrent insert duplicate is a successful idempotent retry.');
  await assert.rejects(repository.put({ ...original, ownerId: 'user-b' }), SnapshotConflictError);
  await assert.rejects(repository.put({ ...original, id: randomUUID() }), SnapshotConflictError);
  assert.equal(await repository.get('user-b', original.id), null);
  assert.deepEqual(await repository.get(original.ownerId, original.id), { ...original, schemaVersion: 1 });
  assert.equal(documents.size, 1);
});

test('Mongo real integration: collection validator, unique index, immutable upserts and owner lookups', { skip: !process.env.MONGODB_TEST_URI }, async t => {
  const client = new MongoClient(process.env.MONGODB_TEST_URI!, { serverSelectionTimeoutMS: 5000 });
  const database = client.db(process.env.MONGODB_TEST_DATABASE ?? 'tepic_test');
  const collectionName = 'analysis_snapshots_test_' + randomUUID().replaceAll('-', '');
  let connected = false;
  t.after(async () => {
    try {
      // This generated collection is the only resource the integration test owns.
      // Never delete a database or the application's analysis_snapshots collection.
      assert.match(collectionName, /^analysis_snapshots_test_[a-f0-9]{32}$/);
      if (connected) await database.collection(collectionName).drop().catch(error => {
          if (!(error instanceof MongoServerError) || error.code !== 26) throw error;
        });
    } finally { await client.close(); }
  });
  await client.connect();
  connected = true;
  await setupSnapshotCollection(database, collectionName);
  const repository = createMongoRepository(database, collectionName);
  const original = fixture();
  assert.equal(await repository.put(original), 'created');
  assert.equal(await repository.put(original), 'existing');
  await assert.rejects(repository.put({ ...original, state: { ...original.state, rate: 0.05 } }), SnapshotConflictError);
  await assert.rejects(repository.put({ ...original, id: randomUUID() }), SnapshotConflictError);
  assert.deepEqual(await repository.get('user-a', original.id), { ...original, schemaVersion: 1 });
  assert.equal(await repository.get('user-b', original.id), null);
  const metadata = await repository.list('user-a', 20);
  assert.equal(metadata.length, 1);
  assert.equal(metadata[0].id, original.id);
  assert.equal(Object.hasOwn(metadata[0], 'state'), false);
  assert.deepEqual(await repository.list('user-b', 20), []);
  const indexes = await database.collection(collectionName).indexes();
  assert.equal(indexes.find(index => index.name === 'owner_revision_unique')?.unique, true);
  const rawCollection = database.collection<Omit<Snapshot, 'id' | 'createdAt'> & { _id: string; createdAt: Date }>(collectionName);
  await assert.rejects(rawCollection.insertOne({ _id: randomUUID(), ownerId: original.ownerId, revision: 1.5, schemaVersion: 1, state: original.state, createdAt: new Date(original.createdAt) }), error => error instanceof MongoServerError && error.code === 121);
  await setupSnapshotCollection(database, collectionName);
  assert.deepEqual(await repository.get('user-a', original.id), { ...original, schemaVersion: 1 }, 'Applying setup again must preserve existing archives.');
});
