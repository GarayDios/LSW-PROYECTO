import { createDefaultState, LOCAL_STORAGE_KEY, terminalStateSchema, type TerminalState } from '../../db/state.ts';

export type PersistencePhase = 'loading' | 'local' | 'needs-import' | 'saving' | 'synced' | 'error' | 'conflict' | 'auth-required';
export type StorageOwner = { id: string; displayName: string };
export type PersistenceSnapshot = {
  state: TerminalState;
  ready: boolean;
  phase: PersistencePhase;
  owner: StorageOwner | null;
  message: string;
  storageAvailable: boolean;
  hasLocalImport: boolean;
  hasDraft: boolean;
  canRestoreDraft: boolean;
  archiveEnabled: boolean;
  pendingArchives: number;
};

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type Draft = { ownerId: string; baseRevision: number; state: TerminalState; pending: boolean };
type RemoteResponse = { mode: 'remote'; owner: StorageOwner; revision: number; state: TerminalState | null; archive: { enabled: boolean; pending: number } };

const cacheKey = (ownerId: string) => `${LOCAL_STORAGE_KEY}:user:${encodeURIComponent(ownerId)}`;
const serialize = (state: TerminalState) => JSON.stringify(state);

/** Coordinates one writer at a time; a stale revision never triggers an automatic overwrite. */
export class TerminalSyncController {
  private snapshot: PersistenceSnapshot;
  private readonly serverSnapshot: PersistenceSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly storage: Storage;
  private readonly fetcher: Fetcher;
  private readonly debounceMs: number;
  private revision = 0;
  private initialized = false;
  private localCandidate: TerminalState | null = null;
  private remote = false;
  private running = false;
  private epoch = 0;
  private inFlight = false;
  private loaded = false;
  private dirtyWithoutOwner = false;
  private acknowledged = '';
  private protectLegacy = false;
  private localRecoveryMessage = '';
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: { storage: Storage; fetcher: Fetcher; debounceMs?: number }) {
    this.storage = options.storage;
    this.fetcher = options.fetcher;
    this.debounceMs = options.debounceMs ?? 600;
    this.snapshot = {
      state: createDefaultState(), ready: false, phase: 'loading', owner: null, message: '',
      storageAvailable: true, hasLocalImport: false, hasDraft: false, canRestoreDraft: false,
      archiveEnabled: false, pendingArchives: 0,
    };
    this.serverSnapshot = this.snapshot;
  }

  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => this.serverSnapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private emit(update: Partial<PersistenceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }

  private readLocal(): TerminalState | null {
    try {
      const raw = this.storage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return null;
      let value: unknown;
      try { value = JSON.parse(raw); } catch { value = null; }
      const parsed = terminalStateSchema.safeParse(value);
      if (parsed.success) return parsed.data;
      // Keep the original text before recovering valid individual records. This
      // also preserves data created by a newer version that this client cannot read.
      this.protectLegacy = true;
      this.storage.setItem(`${LOCAL_STORAGE_KEY}:recovery:${Date.now()}`, raw);
      this.protectLegacy = false;
      this.localRecoveryMessage = 'Recuperamos los registros compatibles y conservamos una copia de los datos originales en este navegador.';
      const recovered = createDefaultState();
      if (!value || typeof value !== 'object') return recovered;
      const object = value as Partial<TerminalState>;
      for (const field of ['lists', 'orders', 'cycles'] as const) {
        const records = object[field];
        if (!Array.isArray(records)) continue;
        const valid = records.filter((record, index) => records.findIndex(other => other?.id === record?.id) === index && terminalStateSchema.safeParse({ ...recovered, [field]: [record] }).success);
        if (field === 'lists') {
          const defaults = createDefaultState().lists;
          recovered.lists = [...defaults, ...valid.filter(record => !defaults.some(list => list.id === record.id))] as TerminalState['lists'];
        } else if (field === 'orders') recovered.orders = valid as TerminalState['orders'];
        else recovered.cycles = valid as TerminalState['cycles'];
      }
      if (terminalStateSchema.safeParse({ ...recovered, rate: object.rate }).success) recovered.rate = object.rate!;
      return recovered;
    } catch { this.emit({ storageAvailable: false }); return null; }
  }

  private readDraft(ownerId: string): Draft | null {
    try {
      const raw = this.storage.getItem(cacheKey(ownerId));
      if (!raw) return null;
      const value = JSON.parse(raw) as Draft;
      const parsed = terminalStateSchema.safeParse(value.state);
      if (value.ownerId !== ownerId || !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0 || typeof value.pending !== 'boolean' || !parsed.success) return null;
      return { ...value, state: parsed.data };
    } catch { this.emit({ storageAvailable: false }); return null; }
  }

  private saveLocal() {
    if (this.protectLegacy) return;
    try { this.storage.setItem(LOCAL_STORAGE_KEY, serialize(this.snapshot.state)); }
    catch { this.emit({ storageAvailable: false }); }
  }

  private saveDraft(pending: boolean) {
    const owner = this.snapshot.owner;
    if (!owner) return;
    try {
      this.storage.setItem(cacheKey(owner.id), JSON.stringify({
        ownerId: owner.id, baseRevision: this.revision, state: this.snapshot.state, pending,
      } satisfies Draft));
      this.emit({ hasDraft: pending, canRestoreDraft: false });
    } catch { this.emit({ storageAvailable: false }); }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    if (!this.loaded) this.localCandidate = this.readLocal();
    await this.load(false);
  }

  stop() {
    this.running = false;
    this.epoch++;
    this.inFlight = false;
    if (this.timer) clearTimeout(this.timer);
  }

  private async request(init?: RequestInit) {
    return this.fetcher('/api/persistence', {
      credentials: 'same-origin', cache: 'no-store', ...init,
      // A committed write may also finish a bounded archive batch and status read.
      // Stay above the server's combined RPC deadlines to avoid false timeouts.
      signal: AbortSignal.timeout(45_000),
    });
  }

  private parseRemote(value: unknown): RemoteResponse {
    const result = value as RemoteResponse;
    if (!result || result.mode !== 'remote' || !result.owner || typeof result.owner.id !== 'string' || !result.owner.id || typeof result.owner.displayName !== 'string' || !Number.isSafeInteger(result.revision) || result.revision < 0 || !result.archive || typeof result.archive.enabled !== 'boolean' || !Number.isSafeInteger(result.archive.pending) || result.archive.pending < 0) throw Error('invalid_response');
    const state = result.state === null ? null : terminalStateSchema.parse(result.state);
    return { ...result, state };
  }

  private async load(discardCurrent: boolean) {
    const currentEpoch = ++this.epoch;
    if (this.timer) clearTimeout(this.timer);
    this.inFlight = false;
    try {
      const response = await this.request();
      if (!this.running || this.epoch !== currentEpoch) return;
      if (response.status === 401) {
        this.remote = true;
        this.emit({ ready: true, phase: 'auth-required', state: this.loaded ? this.snapshot.state : this.localCandidate ?? createDefaultState(), message: 'Puedes practicar en este navegador. Inicia sesión para cargar y guardar los datos de tu cuenta.' });
        this.loaded = true;
        return;
      }
      if (!response.ok) throw Error('unavailable');
      const value = await response.json();
      if (!this.running || this.epoch !== currentEpoch) return;
      if (value && typeof value === 'object' && 'mode' in value && value.mode === 'local') {
        this.remote = false;
        this.initialized = false;
        this.loaded = true;
        this.emit({ ready: true, phase: 'local', owner: null, state: this.dirtyWithoutOwner ? this.snapshot.state : this.localCandidate ?? createDefaultState(), message: this.localRecoveryMessage, archiveEnabled: false, pendingArchives: 0 });
        this.saveLocal();
        return;
      }
      const result = this.parseRemote(value);
      const changedOwner = this.snapshot.owner !== null && this.snapshot.owner.id !== result.owner.id;
      this.remote = true;
      this.revision = result.revision;
      this.initialized = result.state !== null;
      const draft = this.readDraft(result.owner.id);
      const archive = { archiveEnabled: result.archive.enabled, pendingArchives: result.archive.pending };
      // Changes made while the initial connection was unavailable remain on this
      // device until the user explicitly chooses to replace them with cloud data.
      if (this.dirtyWithoutOwner && !discardCurrent && !changedOwner) {
        this.loaded = true;
        this.emit({ ready: true, owner: result.owner, phase: 'conflict', message: 'Hay cambios de este navegador sin subir. Descarga una copia antes de cargar los datos guardados.', hasDraft: true, canRestoreDraft: false, ...archive });
        return;
      }
      this.dirtyWithoutOwner = false;
      this.loaded = true;
      if (result.state === null) {
        this.acknowledged = '';
        this.emit({ ready: true, phase: 'needs-import', owner: result.owner, state: createDefaultState(), message: '', hasLocalImport: this.localCandidate !== null, hasDraft: !!draft?.pending, canRestoreDraft: !!draft?.pending && draft.baseRevision === result.revision, ...archive });
        return;
      }
      this.acknowledged = serialize(result.state);
      const differentDraft = !!draft?.pending && serialize(draft.state) !== this.acknowledged;
      this.emit({ ready: true, phase: 'synced', owner: result.owner, state: result.state, message: '', hasLocalImport: false, hasDraft: differentDraft, canRestoreDraft: differentDraft && draft!.baseRevision === result.revision, ...archive });
      if (!differentDraft) this.saveDraft(false);
    } catch {
      if (!this.running || this.epoch !== currentEpoch) return;
      this.remote = true;
      this.emit({ ready: true, phase: 'error', state: this.loaded ? this.snapshot.state : this.localCandidate ?? createDefaultState(), message: 'No se pudo conectar. Tus cambios permanecen en este navegador.' });
      this.loaded = true;
    }
  }

  updateField<K extends keyof TerminalState>(field: K, value: TerminalState[K] | ((previous: TerminalState[K]) => TerminalState[K])) {
    if (!this.snapshot.ready) return;
    const next = typeof value === 'function' ? value(this.snapshot.state[field]) : value;
    if (Object.is(next, this.snapshot.state[field])) return;
    this.emit({ state: { ...this.snapshot.state, [field]: next } });
    if (!this.remote) { this.saveLocal(); return; }
    if (!this.snapshot.owner) {
      this.dirtyWithoutOwner = true;
      this.saveLocal();
      return;
    }
    // While import is pending, displaying and editing a fresh practice state
    // does not implicitly authorize uploading old browser records.
    if (!this.initialized) { this.saveDraft(true); return; }
    this.saveDraft(true);
    if (this.snapshot.phase === 'synced' || this.snapshot.phase === 'saving') {
      this.emit({ phase: 'saving', message: '' });
      this.schedule();
    }
  }

  chooseInitialState(importLocal: boolean) {
    if (this.snapshot.phase !== 'needs-import' || !this.snapshot.owner) return;
    this.initialized = true;
    this.emit({ state: importLocal && this.localCandidate ? this.localCandidate : this.snapshot.state, phase: 'saving', message: '', hasLocalImport: false });
    this.saveDraft(true);
    this.schedule();
  }

  private schedule() {
    if (!this.running || this.inFlight) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.debounceMs);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    if (!this.running || !this.remote || !this.initialized || !this.snapshot.owner || this.inFlight || !['saving', 'synced'].includes(this.snapshot.phase)) return;
    const candidate = this.snapshot.state;
    const fingerprint = serialize(candidate);
    if (fingerprint === this.acknowledged) {
      this.emit({ phase: 'synced' });
      const draft = this.readDraft(this.snapshot.owner.id);
      if (!draft?.pending || serialize(draft.state) === fingerprint) this.saveDraft(false);
      return;
    }
    const currentEpoch = this.epoch;
    this.inFlight = true;
    this.emit({ phase: 'saving', message: '' });
    try {
      const response = await this.request({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: this.revision, state: candidate }) });
      if (!this.running || this.epoch !== currentEpoch) return;
      if (response.status === 409) {
        this.emit({ phase: 'conflict', message: 'Los datos cambiaron en otra sesión. Conservamos tu borrador en este navegador.', canRestoreDraft: false });
        return;
      }
      if (response.status === 401) { this.emit({ phase: 'auth-required', message: 'Tu sesión terminó. El borrador permanece en este navegador.' }); return; }
      if (!response.ok) throw Error('save_failed');
      const result = await response.json() as { revision?: unknown; archive?: { enabled?: unknown; pending?: unknown } };
      if (!this.running || this.epoch !== currentEpoch) return;
      if (typeof result.revision !== 'number' || !Number.isSafeInteger(result.revision) || result.revision !== this.revision + 1 || !result.archive || typeof result.archive.enabled !== 'boolean' || !(result.archive.pending === null || typeof result.archive.pending === 'number' && Number.isSafeInteger(result.archive.pending) && result.archive.pending >= 0)) throw Error('invalid_response');
      this.revision = result.revision;
      this.acknowledged = fingerprint;
      const pending = serialize(this.snapshot.state) !== fingerprint;
      this.emit({ phase: pending ? 'saving' : 'synced', archiveEnabled: result.archive.enabled, pendingArchives: typeof result.archive.pending === 'number' ? result.archive.pending : this.snapshot.pendingArchives });
      this.saveDraft(pending);
    } catch {
      if (this.running && this.epoch === currentEpoch) this.emit({ phase: 'error', message: 'No se pudo guardar. Conservamos tu borrador en este navegador.' });
    } finally {
      if (this.running && this.epoch === currentEpoch) {
        this.inFlight = false;
        if (this.snapshot.phase === 'saving') this.schedule();
      }
    }
  }

  retry = () => {
    if (this.snapshot.owner && this.initialized && this.snapshot.phase === 'error') {
      this.emit({ phase: 'saving', message: '' });
      void this.flush();
    } else { void this.load(false); }
  };

  reloadRemote = () => { void this.load(true); };

  restoreDraft = () => {
    const owner = this.snapshot.owner;
    if (!owner || !this.snapshot.canRestoreDraft) return;
    const draft = this.readDraft(owner.id);
    if (!draft || !draft.pending || draft.baseRevision !== this.revision) return;
    this.initialized = true;
    this.emit({ state: draft.state, phase: 'saving', message: '', canRestoreDraft: false });
    this.saveDraft(true);
    this.schedule();
  };

  draftForDownload = () => {
    const owner = this.snapshot.owner;
    const draft = owner && !this.dirtyWithoutOwner ? this.readDraft(owner.id) : null;
    return JSON.stringify({ savedAt: new Date().toISOString(), state: draft?.state ?? this.snapshot.state }, null, 2);
  };
}
