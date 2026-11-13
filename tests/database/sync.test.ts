import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState, LOCAL_STORAGE_KEY, type TerminalState } from '../../src/db/state.ts';
import { TerminalSyncController } from '../../src/features/persistence/sync-controller.ts';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const json = (value: unknown, status = 200) => Response.json(value, { status });
const remote = (state: TerminalState | null, revision = 1, ownerId = 'user-a') => ({ mode: 'remote', owner: { id: ownerId, displayName: ownerId }, revision, state, archive: { enabled: true, pending: 0 } });
const saved = (revision: number, pending: number | null = 0) => json({ revision, archive: { enabled: true, pending } });
const stateWithRate = (rate: number): TerminalState => ({ ...createDefaultState(), rate });
const cacheKey = (ownerId: string) => `${LOCAL_STORAGE_KEY}:user:${encodeURIComponent(ownerId)}`;
function setup(t: TestContext, fetcher: (input: string, init?: RequestInit) => Promise<Response>, storage = new MemoryStorage()) {
  const controller = new TerminalSyncController({ storage, fetcher, debounceMs: 60_000 });
  t.after(() => controller.stop());
  return { controller, storage };
}

test('local-only mode preserves legacy records and writes changes without a cloud request', async t => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateWithRate(.07)));
  let requests = 0;
  const { controller } = setup(t, async (_input, init) => { requests++; assert.equal(init?.method, undefined); return json({ mode: 'local' }); }, storage);
  await controller.start();
  assert.equal(controller.getSnapshot().phase, 'local');
  assert.equal(controller.getSnapshot().state.rate, .07);
  controller.updateField('rate', .08);
  assert.equal(JSON.parse(storage.getItem(LOCAL_STORAGE_KEY)!).rate, .08);
  await controller.flush();
  assert.equal(requests, 1);
});

test('recoverable legacy data is backed up before incompatible records are removed', async t => {
  const storage = new MemoryStorage();
  const original = JSON.stringify({ ...stateWithRate(.06), orders: [{ id: 'invalid' }] });
  storage.setItem(LOCAL_STORAGE_KEY, original);
  const { controller } = setup(t, async () => json({ mode: 'local' }), storage);
  await controller.start();
  assert.equal(controller.getSnapshot().state.rate, .06);
  assert.equal(controller.getSnapshot().state.lists.length, 2);
  assert.deepEqual(controller.getSnapshot().state.orders, []);
  const backup = [...storage.values].find(([key]) => key.startsWith(`${LOCAL_STORAGE_KEY}:recovery:`));
  assert.equal(backup?.[1], original);
  assert.match(controller.getSnapshot().message, /copia/);
});

test('existing cloud state takes precedence without importing or changing unscoped browser data', async t => {
  const storage = new MemoryStorage();
  const legacy = JSON.stringify(stateWithRate(.12));
  storage.setItem(LOCAL_STORAGE_KEY, legacy);
  let writes = 0;
  const { controller } = setup(t, async (_input, init) => { if (init?.method) writes++; return json(remote(stateWithRate(.02), 4)); }, storage);
  await controller.start();
  assert.equal(controller.getSnapshot().state.rate, .02);
  assert.equal(controller.getSnapshot().phase, 'synced');
  await controller.flush();
  assert.equal(writes, 0);
  assert.equal(storage.getItem(LOCAL_STORAGE_KEY), legacy);
  const cache = JSON.parse(storage.getItem(cacheKey('user-a'))!);
  assert.equal(cache.ownerId, 'user-a');
  assert.equal(cache.baseRevision, 4);
  assert.equal(cache.pending, false);
});

test('a new cloud account never uploads browser records until import is explicitly chosen', async t => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateWithRate(.12)));
  const writes: { expectedRevision: number; state: TerminalState }[] = [];
  const { controller } = setup(t, async (_input, init) => {
    if (!init?.method) return json(remote(null, 0));
    writes.push(JSON.parse(init.body as string));
    return saved(1);
  }, storage);
  await controller.start();
  assert.equal(controller.getSnapshot().phase, 'needs-import');
  assert.equal(controller.getSnapshot().state.rate, .04);
  await controller.flush();
  assert.equal(writes.length, 0);
  controller.chooseInitialState(true);
  await controller.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expectedRevision, 0);
  assert.equal(writes[0].state.rate, .12);
  assert.equal(controller.getSnapshot().phase, 'synced');
  assert.equal(JSON.parse(storage.getItem(LOCAL_STORAGE_KEY)!).rate, .12);
});

test('starting without import preserves legacy records while saving a fresh cloud state', async t => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateWithRate(.12)));
  let uploaded: TerminalState | undefined;
  const { controller } = setup(t, async (_input, init) => {
    if (!init?.method) return json(remote(null, 0));
    uploaded = JSON.parse(init.body as string).state;
    return saved(1);
  }, storage);
  await controller.start();
  controller.chooseInitialState(false);
  await controller.flush();
  assert.equal(uploaded?.rate, .04);
  assert.equal(JSON.parse(storage.getItem(LOCAL_STORAGE_KEY)!).rate, .12);
});

test('edits during an in-flight save are queued using the next revision and never overwritten by its response', async t => {
  let completeFirst: (response: Response) => void = () => {};
  const firstResponse = new Promise<Response>(resolve => { completeFirst = resolve; });
  const writes: { expectedRevision: number; state: TerminalState }[] = [];
  const { controller, storage } = setup(t, async (_input, init) => {
    if (!init?.method) return json(remote(stateWithRate(.04), 8));
    writes.push(JSON.parse(init.body as string));
    if (writes.length === 1) return firstResponse;
    return saved(10);
  });
  await controller.start();
  controller.updateField('rate', .05);
  const firstSave = controller.flush();
  controller.updateField('rate', .06);
  await controller.flush();
  assert.equal(writes.length, 1, 'only one writer may be active');
  assert.equal(controller.getSnapshot().state.rate, .06);
  completeFirst(saved(9, null));
  await firstSave;
  assert.equal(controller.getSnapshot().state.rate, .06, 'an older successful response must not replace a newer edit');
  assert.equal(controller.getSnapshot().phase, 'saving');
  assert.equal(JSON.parse(storage.getItem(cacheKey('user-a'))!).state.rate, .06);
  await controller.flush();
  assert.deepEqual(writes.map(write => [write.expectedRevision, write.state.rate]), [[8, .05], [9, .06]]);
  assert.equal(controller.getSnapshot().phase, 'synced');
  assert.equal(JSON.parse(storage.getItem(cacheKey('user-a'))!).pending, false);
});

test('a stale cloud revision pauses writes and preserves the latest downloadable draft', async t => {
  let writes = 0;
  let currentRemote = stateWithRate(.04);
  const { controller, storage } = setup(t, async (_input, init) => {
    if (!init?.method) return json(remote(currentRemote, 5));
    writes++;
    return json({ error: { code: 'revision_conflict', message: 'conflict' } }, 409);
  });
  await controller.start();
  controller.updateField('rate', .06);
  await controller.flush();
  assert.equal(controller.getSnapshot().phase, 'conflict');
  controller.updateField('rate', .07);
  await controller.flush();
  assert.equal(writes, 1);
  assert.equal(JSON.parse(storage.getItem(cacheKey('user-a'))!).state.rate, .07);
  assert.equal(JSON.parse(controller.draftForDownload()).state.rate, .07);
  currentRemote = stateWithRate(.02);
  controller.reloadRemote();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(controller.getSnapshot().state.rate, .02);
  assert.equal(controller.getSnapshot().hasDraft, true);
});

test('network errors retain edits and require retry before another upload', async t => {
  let writes = 0;
  const { controller } = setup(t, async (_input, init) => {
    if (!init?.method) return json(remote(stateWithRate(.04), 2));
    writes++;
    if (writes === 1) throw Error('offline');
    const payload = JSON.parse(init.body as string);
    assert.equal(payload.expectedRevision, 2);
    assert.equal(payload.state.rate, .07);
    return saved(3);
  });
  await controller.start();
  controller.updateField('rate', .06);
  await controller.flush();
  assert.equal(controller.getSnapshot().phase, 'error');
  controller.updateField('rate', .07);
  await controller.flush();
  assert.equal(writes, 1);
  controller.retry();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(writes, 2);
  assert.equal(controller.getSnapshot().phase, 'synced');
});

test('changing users does not load or upload another owner’s unsaved draft', async t => {
  let owner = 'user-a';
  let writes = 0;
  const { controller, storage } = setup(t, async (_input, init) => {
    if (!init?.method) return json(remote(stateWithRate(owner === 'user-a' ? .02 : .03), 1, owner));
    writes++;
    throw Error('offline');
  });
  await controller.start();
  controller.updateField('rate', .09);
  await controller.flush();
  assert.equal(JSON.parse(storage.getItem(cacheKey('user-a'))!).pending, true);
  controller.stop();
  owner = 'user-b';
  await controller.start();
  assert.equal(controller.getSnapshot().owner?.id, 'user-b');
  assert.equal(controller.getSnapshot().state.rate, .03);
  assert.equal(controller.getSnapshot().hasDraft, false);
  await controller.flush();
  assert.equal(writes, 1);
  assert.equal(JSON.parse(storage.getItem(cacheKey('user-a'))!).state.rate, .09);
});

test('draft recovery is opt-in and only available against the same cloud revision', async t => {
  const storage = new MemoryStorage();
  storage.setItem(cacheKey('user-a'), JSON.stringify({ ownerId: 'user-a', baseRevision: 3, state: stateWithRate(.08), pending: true }));
  const writes: TerminalState[] = [];
  const { controller } = setup(t, async (_input, init) => {
    if (!init?.method) return json(remote(stateWithRate(.04), 3));
    writes.push(JSON.parse(init.body as string).state);
    return saved(4);
  }, storage);
  await controller.start();
  assert.equal(controller.getSnapshot().state.rate, .04);
  assert.equal(controller.getSnapshot().canRestoreDraft, true);
  await controller.flush();
  assert.equal(writes.length, 0);
  controller.restoreDraft();
  await controller.flush();
  assert.equal(writes[0].rate, .08);
});

test('unknown-account offline edits cannot become an implicit cloud overwrite on reconnect', async t => {
  let available = false;
  let writes = 0;
  const { controller, storage } = setup(t, async (_input, init) => {
    if (init?.method) { writes++; return saved(6); }
    if (!available) throw Error('offline');
    return json(remote(stateWithRate(.03), 5));
  });
  await controller.start();
  controller.updateField('rate', .08);
  assert.equal(JSON.parse(storage.getItem(LOCAL_STORAGE_KEY)!).rate, .08);
  available = true;
  controller.retry();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(controller.getSnapshot().phase, 'conflict');
  assert.equal(controller.getSnapshot().state.rate, .08);
  await controller.flush();
  assert.equal(writes, 0);
  controller.reloadRemote();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(controller.getSnapshot().state.rate, .03);
  assert.equal(JSON.parse(storage.getItem(LOCAL_STORAGE_KEY)!).rate, .08);
});

test('an expired session keeps browser practice available without uploading or replacing unseen legacy records', async t => {
  const storage = new MemoryStorage();
  const browserState = stateWithRate(.06);
  browserState.lists.push({ id: 'browser-list', name: 'Lista del navegador', symbols: ['NVDA'] });
  storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(browserState));
  let writes = 0;
  const { controller } = setup(t, async (_input, init) => {
    if (init?.method) writes++;
    return json({ error: { code: 'auth_required', message: 'sign in' } }, 401);
  }, storage);
  await controller.start();
  assert.equal(controller.getSnapshot().phase, 'auth-required');
  assert.equal(controller.getSnapshot().state.rate, .06);
  controller.updateField('rate', .07);
  await controller.flush();
  assert.equal(writes, 0);
  assert.equal(JSON.parse(storage.getItem(LOCAL_STORAGE_KEY)!).lists[2].id, 'browser-list');
});

test('failed recovery backup never overwrites the original malformed browser data', async t => {
  const storage = new MemoryStorage();
  const original = '{a damaged legacy value';
  storage.setItem(LOCAL_STORAGE_KEY, original);
  const write = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key.startsWith(`${LOCAL_STORAGE_KEY}:recovery:`)) throw Error('quota exceeded');
    write(key, value);
  };
  const { controller } = setup(t, async () => json({ mode: 'local' }), storage);
  await controller.start();
  controller.updateField('rate', .06);
  assert.equal(controller.getSnapshot().storageAvailable, false);
  assert.equal(storage.getItem(LOCAL_STORAGE_KEY), original);
});
