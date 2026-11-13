import type { DatabaseConfig } from '../config.ts';
import type { ArchiveRecord } from '../supabase/client.ts';

export interface ArchiveQueue {
  pending(ownerId: string): Promise<ArchiveRecord[]>;
  acknowledge(ownerId: string, ids: string[]): Promise<void>;
}

/** Supabase commits first. Mongo delivery is idempotent and can be retried later. */
export async function flushAnalysisArchive(queue: ArchiveQueue, ownerId: string, bridge: DatabaseConfig['mongoBridge'], fetcher: typeof fetch = fetch): Promise<void> {
  if (!bridge) return;
  try {
    const pending = await queue.pending(ownerId);
    const delivered = await Promise.all(pending.map(async item => {
      if (item.ownerId !== ownerId) return null;
      try {
        const response = await fetcher(`${bridge.url}/snapshots`, {
          method: 'PUT', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(item), signal: AbortSignal.timeout(4000), redirect: 'manual',
        });
        if (response.status !== 200 && response.status !== 201) return null;
        const result = await response.json() as { id?: unknown; status?: unknown };
        return result?.id === item.id && (result.status === 'created' || result.status === 'existing') ? item.id : null;
      } catch { return null; }
    }));
    await queue.acknowledge(ownerId, delivered.filter((id): id is string => id !== null));
  } catch {
    // The outbox is durable. An unavailable archive must not roll back a saved cycle.
  }
}
