import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { F5Operation } from '../../src/features/f5/types.ts';

export type F5Store = {
  list(ownerId: string): F5Operation[];
  get(ownerId: string, id: string): F5Operation | null;
  insert(ownerId: string, operation: F5Operation): void;
  update(ownerId: string, operation: F5Operation): void;
  reserve(ownerId: string, id: string, lease: string, now: number): boolean;
  acquire(ownerId: string, now: number): string | null;
  release(ownerId: string, lease: string): void;
  close(): void;
};

/** Broker payloads and reservations only. Credentials never enter this database. */
export function openF5Store(filename: string): F5Store {
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec(`
    pragma journal_mode=WAL;
    pragma busy_timeout=5000;
    create table if not exists f5_operations (
      id text primary key, owner_id text not null, state text not null,
      created_at text not null, client_order_id text not null unique, payload text not null
    );
    create index if not exists f5_operations_owner on f5_operations(owner_id,created_at);
    create table if not exists f5_account_leases (
      owner_id text primary key, lease text not null, expires_at integer not null
    );
  `);
  const read = (row: Record<string, unknown> | undefined): F5Operation | null => row ? {
    ...JSON.parse(String(row.payload)), state: String(row.state),
  } as F5Operation : null;
  return {
    list(ownerId) {
      return database.prepare('select state,payload from f5_operations where owner_id=? order by created_at desc,id desc').all(ownerId).map(row => read(row)!);
    },
    get(ownerId, id) { return read(database.prepare('select state,payload from f5_operations where owner_id=? and id=?').get(ownerId, id)); },
    insert(ownerId, operation) {
      database.prepare('insert into f5_operations(id,owner_id,state,created_at,client_order_id,payload) values(?,?,?,?,?,?)').run(operation.id, ownerId, operation.state, operation.createdAt, operation.clientOrderId, JSON.stringify(operation));
    },
    update(ownerId, operation) {
      const result = database.prepare('update f5_operations set state=?,payload=? where owner_id=? and id=?').run(operation.state, JSON.stringify(operation), ownerId, operation.id);
      if (Number(result.changes) !== 1) throw new Error('f5_operation_not_found');
    },
    reserve(ownerId, id, lease, now) {
      // A stale worker cannot consume a second preview, even if its HTTP reads
      // outlive a lease. Reservation and the account-wide conflict check are
      // one SQLite statement, not a read-then-write race.
      return Number(database.prepare(`update f5_operations set state='reserved' where owner_id=? and id=? and state='preview'
        and exists(select 1 from f5_account_leases where owner_id=? and lease=? and expires_at>?)
        and not exists(select 1 from f5_operations other where other.owner_id=? and other.id<>?
          and other.state in ('reserved','submitted','partial','ambiguous'))`).run(ownerId, id, ownerId, lease, now, ownerId, id).changes) === 1;
    },
    acquire(ownerId, now) {
      const lease = randomUUID();
      const result = database.prepare(`insert into f5_account_leases(owner_id,lease,expires_at) values(?,?,?)
        on conflict(owner_id) do update set lease=excluded.lease,expires_at=excluded.expires_at
        where f5_account_leases.expires_at < ?`).run(ownerId, lease, now + 300000, now);
      return Number(result.changes) === 1 ? lease : null;
    },
    release(ownerId, lease) { database.prepare('delete from f5_account_leases where owner_id=? and lease=?').run(ownerId, lease); },
    close() { database.close(); },
  };
}
