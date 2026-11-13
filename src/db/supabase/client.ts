import { z } from 'zod';
import { terminalStateSchema, type TerminalState } from '../state.ts';
import type { DatabaseConfig } from '../config.ts';

export class PersistenceError extends Error {
  constructor(publicCode: 'revision_conflict' | 'persistence_unavailable') {
    super(publicCode === 'revision_conflict' ? 'Los datos cambiaron en otra pestaña o dispositivo.' : 'No se pudieron consultar los datos guardados.');
    this.code = publicCode;
  }
  readonly code: 'revision_conflict' | 'persistence_unavailable';
}
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const loadedSchema = z.object({ revision, state: terminalStateSchema.nullable(), pendingArchives: z.number().int().nonnegative() });
const archivedSchema = z.array(z.object({
  id: z.string().uuid(), ownerId: z.string().min(1), revision: revision.min(1),
  state: terminalStateSchema, createdAt: z.string(),
}));
export type ArchiveRecord = z.infer<typeof archivedSchema>[number];
export type PersistenceOwner = { id: string; displayName: string; email: string };

/** Uses Supabase's HTTP RPC API; keys never enter browser modules. */
export class SupabaseRepository {
  private readonly config: DatabaseConfig;
  private readonly fetcher: typeof fetch;
  constructor(config: DatabaseConfig, fetcher: typeof fetch = fetch) { this.config = config; this.fetcher = (input, init) => fetcher(input, init); }

  private async rpc(name: string, body: Record<string, unknown>, allowEmpty = false): Promise<unknown> {
    const headers: Record<string, string> = { apikey: this.config.supabaseKey, 'Content-Type': 'application/json' };
    if (!this.config.supabaseKey.startsWith('sb_secret_')) headers.Authorization = `Bearer ${this.config.supabaseKey}`;
    try {
      const response = await this.fetcher(`${this.config.supabaseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000), cache: 'no-store', redirect: 'manual',
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { code?: string } | null;
        throw new PersistenceError(error?.code === 'PT409' ? 'revision_conflict' : 'persistence_unavailable');
      }
      const content = await response.text();
      if (!content.trim() && allowEmpty) return null;
      return JSON.parse(content);
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceError('persistence_unavailable');
    }
  }

  async load(ownerId: string) {
    const result = loadedSchema.safeParse(await this.rpc('load_terminal_state', { p_owner_id: ownerId }));
    if (!result.success) throw new PersistenceError('persistence_unavailable');
    return result.data;
  }
  async save(owner: PersistenceOwner, expectedRevision: number, state: TerminalState): Promise<number> {
    const result = z.object({ revision }).safeParse(await this.rpc('save_terminal_state', {
      p_owner_id: owner.id, p_display_name: owner.displayName, p_email: owner.email,
      p_expected_revision: expectedRevision, p_state: state,
    }));
    if (!result.success) throw new PersistenceError('persistence_unavailable');
    return result.data.revision;
  }
  async pending(ownerId: string): Promise<ArchiveRecord[]> {
    const parsed = archivedSchema.safeParse(await this.rpc('list_analysis_outbox', { p_owner_id: ownerId, p_limit: 5 }));
    if (!parsed.success) throw new PersistenceError('persistence_unavailable');
    return parsed.data;
  }
  async acknowledge(ownerId: string, ids: string[]): Promise<void> {
    if (ids.length) await this.rpc('mark_analysis_delivered', { p_owner_id: ownerId, p_ids: ids }, true);
  }
}
