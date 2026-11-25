import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { F5AutomationPlan, F5ControlEvent, F5Health, F5Operation, F5RiskSettings, F5RiskState } from '../../src/features/f5/types.ts';
import { defaultF5Risk } from './f5-model.ts';

export type F5Store = {
  list(ownerId: string): F5Operation[];
  get(ownerId: string, id: string): F5Operation | null;
  insert(ownerId: string, operation: F5Operation): void;
  update(ownerId: string, operation: F5Operation): void;
  reserve(ownerId: string, id: string, lease: string, now: number): boolean;
  acquire(ownerId: string, now: number): string | null;
  release(ownerId: string, lease: string): void;
  owns(ownerId:string,lease:string,now:number):boolean;
  bind(ownerId:string,binding:string):void;
  settings(ownerId: string): F5RiskSettings;
  setSettings(ownerId: string, value: F5RiskSettings): void;
  risk(ownerId: string): F5RiskState | null;
  setRisk(ownerId: string, value: F5RiskState): void;
  health(ownerId: string): F5Health | null;
  setHealth(ownerId: string, value: F5Health): void;
  plans(ownerId: string): F5AutomationPlan[];
  savePlan(ownerId: string, value: F5AutomationPlan): void;
  events(ownerId: string): F5ControlEvent[];
  event(ownerId: string, value: F5ControlEvent, dedupKey: string): boolean;
  claim(ownerId: string, key: string, operationId: string): boolean;
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
    create table if not exists f5_control (owner_id text not null, kind text not null, payload text not null, primary key(owner_id,kind));
    create table if not exists f5_plans (id text primary key, owner_id text not null, payload text not null);
    create table if not exists f5_events (id text primary key, owner_id text not null, time text not null, dedup_key text not null, payload text not null, unique(owner_id,dedup_key));
    create table if not exists f5_actions (owner_id text not null, action_key text not null, operation_id text not null, primary key(owner_id,action_key));
    create table if not exists f5_accounts (owner_id text primary key,binding text not null);
  `);
  const read = (row: Record<string, unknown> | undefined): F5Operation | null => row ? {
    ...JSON.parse(String(row.payload)), state: String(row.state),
  } as F5Operation : null;
  const control = <T>(ownerId: string, kind: string): T | null => {
    const row = database.prepare('select payload from f5_control where owner_id=? and kind=?').get(ownerId, kind);
    return row ? JSON.parse(String(row.payload)) as T : null;
  };
  const setControl = (ownerId: string, kind: string, value: unknown) => { database.prepare('insert into f5_control(owner_id,kind,payload) values(?,?,?) on conflict(owner_id,kind) do update set payload=excluded.payload').run(ownerId, kind, JSON.stringify(value)); };
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
    owns(ownerId,lease,now){return !!database.prepare('select 1 from f5_account_leases where owner_id=? and lease=? and expires_at>?').get(ownerId,lease,now);},
    bind(ownerId,binding){database.prepare('insert into f5_accounts(owner_id,binding) values(?,?) on conflict(owner_id) do nothing').run(ownerId,binding);if(database.prepare('select binding from f5_accounts where owner_id=?').get(ownerId)?.binding!==binding)throw new Error('El registro F5 pertenece a otra cuenta de bróker. Configura un archivo separado para esta cuenta.');},
    settings(ownerId) { return control<F5RiskSettings>(ownerId, 'settings') ?? { ...defaultF5Risk }; },
    setSettings(ownerId, value) { setControl(ownerId, 'settings', value); },
    risk(ownerId) { return control<F5RiskState>(ownerId, 'risk'); },
    setRisk(ownerId, value) { setControl(ownerId, 'risk', value); },
    health(ownerId) { return control<F5Health>(ownerId, 'health'); },
    setHealth(ownerId, value) { setControl(ownerId, 'health', value); },
    plans(ownerId) { return database.prepare('select payload from f5_plans where owner_id=? order by id').all(ownerId).map(row => JSON.parse(String(row.payload)) as F5AutomationPlan); },
    savePlan(ownerId, value) { database.prepare('insert into f5_plans(id,owner_id,payload) values(?,?,?) on conflict(id) do update set payload=excluded.payload where f5_plans.owner_id=excluded.owner_id').run(value.id, ownerId, JSON.stringify(value)); },
    events(ownerId) { return database.prepare('select payload from f5_events where owner_id=? order by time desc,id desc limit 200').all(ownerId).map(row => JSON.parse(String(row.payload)) as F5ControlEvent); },
    event(ownerId, value, dedupKey) { return Number(database.prepare('insert into f5_events(id,owner_id,time,dedup_key,payload) values(?,?,?,?,?) on conflict(owner_id,dedup_key) do nothing').run(value.id, ownerId, value.time, dedupKey, JSON.stringify(value)).changes) === 1; },
    claim(ownerId, key, operationId) { return Number(database.prepare('insert into f5_actions(owner_id,action_key,operation_id) values(?,?,?) on conflict(owner_id,action_key) do nothing').run(ownerId, key, operationId).changes) === 1; },
    close() { database.close(); },
  };
}
