import { MongoServerError, type Db } from 'mongodb';
import { z } from 'zod';
import { terminalStateSchema, type TerminalState } from '../../src/db/state.ts';
import { PersistenceError } from '../../src/db/supabase/client.ts';
import { ownerIdSchema } from './model.ts';

export const stateInputSchema = z.object({ ownerId: ownerIdSchema,
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1), state: terminalStateSchema }).strict();
export interface StateRepository {
  load(ownerId: string): Promise<{ revision: number; state: TerminalState | null; pendingArchives: 0 }>;
  save(ownerId: string, expectedRevision: number, state: TerminalState): Promise<number>;
}
export function createStateRepository(db: Db): StateRepository {
  const collection = db.collection<{ _id: string; revision: number; state: TerminalState; updatedAt: Date }>('terminal_states');
  return {
    async load(ownerId) {
      ownerIdSchema.parse(ownerId);
      const record = await collection.findOne({ _id: ownerId });
      return { revision: record?.revision ?? 0, state: record ? terminalStateSchema.parse(record.state) : null, pendingArchives: 0 };
    },
    async save(ownerId, expectedRevision, state) {
      const input = stateInputSchema.parse({ ownerId, expectedRevision, state });
      const next = expectedRevision + 1;
      // One atomic compare-and-swap per owner. Unique _id protects concurrent first writes.
      try {
        const result = await collection.updateOne({ _id: ownerId, revision: expectedRevision },
          { $set: { revision: next, state: input.state, updatedAt: new Date() } }, { upsert: expectedRevision === 0 });
        if (!result.matchedCount && !result.upsertedCount) throw new PersistenceError('revision_conflict');
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) throw new PersistenceError('revision_conflict');
        throw error;
      }
      return next;
    },
  };
}
