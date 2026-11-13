import { z } from 'zod';
import { terminalStateSchema } from '../../src/db/state.ts';

// Leave room for the immutable archive's id/owner/revision/date envelope; the
// shared terminal API keeps the state itself below this transport ceiling.
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const ownerIdSchema = z.string().min(1).max(256);
export const snapshotIdSchema = z.string().uuid();

// Reuse the API's model validation; this has no React runtime dependency.
export const snapshotInputSchema = z.object({
  id: snapshotIdSchema,
  ownerId: ownerIdSchema,
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  state: terminalStateSchema,
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export type SnapshotInput = z.infer<typeof snapshotInputSchema>;
export type SnapshotMetadata = Pick<SnapshotInput, 'id' | 'ownerId' | 'revision' | 'createdAt'> & { schemaVersion: 1 };
export type Snapshot = SnapshotInput & { schemaVersion: 1 };
export interface SnapshotRepository {
  put(snapshot: SnapshotInput): Promise<'created' | 'existing'>;
  list(ownerId: string, limit: number): Promise<SnapshotMetadata[]>;
  get(ownerId: string, id: string): Promise<Snapshot | null>;
}

export class SnapshotConflictError extends Error {
  constructor() {
    super('Snapshot already exists with different contents.');
    this.name = 'SnapshotConflictError';
  }
}

/** JSON object key order must not change retry idempotency. Array order matters. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function sameSnapshot(a: SnapshotInput, b: SnapshotInput): boolean {
  return a.id === b.id && a.ownerId === b.ownerId && a.revision === b.revision
    && new Date(a.createdAt).getTime() === new Date(b.createdAt).getTime()
    && canonicalJson(a.state) === canonicalJson(b.state);
}
