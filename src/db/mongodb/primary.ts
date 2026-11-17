import { z } from 'zod';
import { terminalStateSchema, type TerminalState } from '../state.ts';
import { PersistenceError, type PersistenceOwner, type ArchiveRecord } from '../supabase/client.ts';

export type MongoPrimaryConfig = { url: string; token: string };
export class MongoPrimaryRepository {
  private config: MongoPrimaryConfig;
  private fetcher: typeof fetch;
  constructor(config: MongoPrimaryConfig, fetcher: typeof fetch = fetch) { this.config = config; this.fetcher = fetcher; }
  private async request(path: string, init?: RequestInit) {
    try {
      const response = await this.fetcher(`${this.config.url}${path}`, {
        ...init, headers: { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' },
        redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new PersistenceError(response.status === 409 ? 'revision_conflict' : 'persistence_unavailable');
      return await response.json();
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceError('persistence_unavailable');
    }
  }
  async load(ownerId: string) {
    const result = z.object({ revision: z.number().int().nonnegative().safe(), state: terminalStateSchema.nullable(), pendingArchives: z.literal(0) })
      .safeParse(await this.request(`/state?ownerId=${encodeURIComponent(ownerId)}`));
    if (!result.success) throw new PersistenceError('persistence_unavailable');
    return result.data;
  }
  async save(owner: PersistenceOwner, expectedRevision: number, state: TerminalState) {
    const result = z.object({ revision: z.number().int().positive().safe() }).safeParse(await this.request('/state', {
      method: 'PUT', body: JSON.stringify({ ownerId: owner.id, expectedRevision, state }),
    }));
    if (!result.success) throw new PersistenceError('persistence_unavailable');
    return result.data.revision;
  }
  async pending(): Promise<ArchiveRecord[]> { return []; }
  async acknowledge(): Promise<void> {}
}
