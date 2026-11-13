import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Execution, ExecutionUpdate, PlanInput, PortfolioStatus, PositionLedger, RunnerStore, RunEvent, TradingPlan } from './model.ts';
import { alertKey, type QueuedAlert } from './alerts.ts';

/** One durable file per deployed service; no API keys or access tokens are stored. */
export function openRunnerStore(filename: string): RunnerStore {
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec(`
    pragma journal_mode = WAL;
    pragma busy_timeout = 5000;
    create table if not exists plans (
      id text primary key, owner_id text not null, symbol text not null,
      enabled integer not null default 0 check(enabled in (0,1)), payload text not null
    );
    create index if not exists plans_owner on plans(owner_id);
    create unique index if not exists plans_one_enabled_symbol on plans(owner_id,symbol) where enabled=1;
    create table if not exists events (
      id text primary key, owner_id text not null, time text not null, payload text not null
    );
    create index if not exists events_owner_time on events(owner_id,time desc);
    create table if not exists executions (
      client_order_id text primary key, owner_id text not null, plan_id text not null,
      signal_time integer not null, state text not null, broker_order_id text
    );
    create table if not exists leases (key text primary key, expires integer not null);
    create table if not exists owned_positions (
      owner_id text not null, plan_id text not null, symbol text not null, payload text not null,
      primary key(owner_id,plan_id,symbol)
    );
    create table if not exists portfolio_state (
      owner_id text primary key, paused integer not null default 0, payload text
    );
    create table if not exists alerts (
      id text primary key, owner_id text not null, payload text not null,
      attempts integer not null default 0, next_attempt_at integer not null, delivered_at integer
    );
    create index if not exists alerts_pending on alerts(owner_id,delivered_at,next_attempt_at);
  `);
  // Existing deployments keep their plans, events and execution reservations.
  const executionColumns = database.prepare('pragma table_info(executions)').all();
  if (!executionColumns.some(row => row.name === 'payload')) database.exec('alter table executions add column payload text');
  const readExecution = (row: Record<string, unknown> | undefined): Execution | null => row ? {
    ...(row.payload ? JSON.parse(String(row.payload)) : {}),
    clientOrderId: String(row.client_order_id), ownerId: String(row.owner_id), planId: String(row.plan_id),
    signalTime: Number(row.signal_time), state: String(row.state) as Execution['state'],
    ...(row.broker_order_id ? { brokerOrderId: String(row.broker_order_id) } : {}),
  } : null;
  const getExecution = (id: string) => readExecution(database.prepare('select * from executions where client_order_id=?').get(id));
  const writeExecution = (execution: Execution) => {
    database.prepare('update executions set state=?,broker_order_id=?,payload=? where client_order_id=?').run(execution.state, execution.brokerOrderId ?? null, JSON.stringify(execution), execution.clientOrderId);
  };
  const emptyPortfolio = (): PortfolioStatus => ({ paused: false, date: '', equityStartUsd: null, equityUsd: null, dailyPnlUsd: null, ownedExposureUsd: 0, totalExposureUsd: 0, reservedEntryUsd: 0, limits: { maxDailyLossUsd: null, maxTotalExposureUsd: null }, dailyLossBlocked: false, exposureBlocked: false, uncertain: true, updatedAt: '' });
  const precise = (value: number) => Math.round(value * 1e8) / 1e8;
  return {
    listPlans(ownerId) {
      return database.prepare('select payload from plans where owner_id=? order by id').all(ownerId).map(row => JSON.parse(String(row.payload)) as TradingPlan);
    },
    createPlan(input: PlanInput, now) {
      const plan: TradingPlan = { ...input, id: randomUUID(), enabled: false, createdAt: now, updatedAt: now };
      database.prepare('insert into plans(id,owner_id,symbol,enabled,payload) values(?,?,?,?,?)').run(plan.id, plan.ownerId, plan.symbol, 0, JSON.stringify(plan));
      return plan;
    },
    setEnabled(ownerId, planId, enabled, now) {
      const row = database.prepare('select payload from plans where owner_id=? and id=?').get(ownerId, planId);
      if (!row) return null;
      const plan = { ...JSON.parse(String(row.payload)), enabled, updatedAt: now } as TradingPlan;
      database.prepare('update plans set enabled=?,payload=? where owner_id=? and id=?').run(enabled ? 1 : 0, JSON.stringify(plan), ownerId, planId);
      return plan;
    },
    listEvents(ownerId, limit = 50) {
      return database.prepare('select payload from events where owner_id=? order by time desc,id desc limit ?').all(ownerId, Math.max(1, Math.min(100, limit))).map(row => JSON.parse(String(row.payload)) as RunEvent);
    },
    addEvent(event) {
      database.exec('begin immediate');
      try {
        database.prepare('insert into events(id,owner_id,time,payload) values(?,?,?,?)').run(event.id, event.ownerId, event.time, JSON.stringify(event));
        const key = alertKey(event);
        if (key) database.prepare('insert into alerts(id,owner_id,payload,next_attempt_at) values(?,?,?,?) on conflict(id) do nothing').run(key, event.ownerId, JSON.stringify(event), Date.parse(event.time));
        database.exec('commit');
      } catch (error) { database.exec('rollback'); throw error; }
    },
    pendingAlerts(ownerId, now, limit = 5) {
      return database.prepare('select * from alerts where owner_id=? and delivered_at is null and next_attempt_at<=? order by next_attempt_at,id limit ?').all(ownerId, now, Math.max(1, Math.min(100, limit))).map(row => ({ id: String(row.id), event: JSON.parse(String(row.payload)), attempts: Number(row.attempts), nextAttemptAt: Number(row.next_attempt_at), deliveredAt: null }) as QueuedAlert);
    },
    settleAlert(ownerId, id, now, delivered) {
      if (delivered) database.prepare('update alerts set delivered_at=?,attempts=attempts+1 where owner_id=? and id=? and delivered_at is null').run(now, ownerId, id);
      else database.prepare('update alerts set next_attempt_at=?,attempts=attempts+1 where owner_id=? and id=? and delivered_at is null').run(now + Math.min(3600000, 60000 * 2 ** Math.min(6, Number(database.prepare('select attempts from alerts where owner_id=? and id=?').get(ownerId, id)?.attempts ?? 0))), ownerId, id);
    },
    reserveExecution(execution) {
      const result = database.prepare('insert into executions(client_order_id,owner_id,plan_id,signal_time,state,broker_order_id,payload) values(?,?,?,?,?,?,?) on conflict(client_order_id) do nothing').run(execution.clientOrderId, execution.ownerId, execution.planId, execution.signalTime, execution.state, execution.brokerOrderId ?? null, JSON.stringify(execution));
      return Number(result.changes) === 1;
    },
    getExecution,
    listExecutions(ownerId) {
      return database.prepare('select * from executions where owner_id=? order by signal_time desc,client_order_id').all(ownerId).map(row => readExecution(row)!);
    },
    updateExecution(clientOrderId, state, brokerOrderId, patch = {}) {
      const previous = getExecution(clientOrderId);
      if (previous) writeExecution({ ...previous, ...patch, state, ...(brokerOrderId ? { brokerOrderId } : {}) });
    },
    reconcileExecution(clientOrderId, update: ExecutionUpdate) {
      database.exec('begin immediate');
      try {
        const previous = getExecution(clientOrderId);
        if (!previous) throw new Error('execution_missing');
        const oldQuantity = previous.filledQuantity ?? 0;
        const deltaQuantity = precise(update.filledQuantity - oldQuantity);
        const oldValue = oldQuantity * (previous.filledAveragePrice ?? 0);
        const deltaValue = update.filledQuantity * update.filledAveragePrice - oldValue;
        const orderPrice = update.limitPrice ?? update.stopPrice;
        if (![update.quantity, orderPrice, update.filledQuantity, update.filledAveragePrice, deltaValue].every(Number.isFinite) || update.quantity <= 0 || orderPrice === undefined || orderPrice <= 0 || update.filledQuantity < 0 || update.filledQuantity > update.quantity + 1e-8 || deltaQuantity < 0 || (update.filledQuantity > 0 && update.filledAveragePrice <= 0) || (deltaQuantity > 0 && deltaValue <= 0)) throw new Error('fill_uncertain');
        if (deltaQuantity === 0 && Math.abs(deltaValue) > 1e-8) throw new Error('fill_correction_uncertain');
        const validBracketReduction = previous.parentClientOrderId && previous.side === 'sell' && previous.quantity !== undefined && update.quantity <= previous.quantity && update.quantity >= update.filledQuantity;
        if (previous.symbol && previous.symbol !== update.symbol || previous.side && previous.side !== update.side || previous.quantity !== undefined && previous.quantity !== update.quantity && !validBracketReduction) throw new Error('order_conflict');
        const row = database.prepare('select payload from owned_positions where owner_id=? and plan_id=? and symbol=?').get(previous.ownerId, previous.planId, update.symbol);
        const position: PositionLedger = row ? JSON.parse(String(row.payload)) : { ownerId: previous.ownerId, planId: previous.planId, symbol: update.symbol, quantity: 0, averageEntryPrice: 0, realizedPnlUsd: 0, cycle: 0, updatedAt: update.updatedAt };
        if (deltaQuantity > 0 || Math.abs(deltaValue) > 1e-8) {
          if (update.side === 'buy') {
            if (position.quantity === 0 && oldQuantity > 0 && deltaQuantity === 0) throw new Error('closed_fill_correction_uncertain');
            if (position.quantity === 0 && deltaQuantity > 0) position.cycle++;
            const cost = position.quantity * position.averageEntryPrice + deltaValue;
            position.quantity = precise(position.quantity + deltaQuantity);
            if (cost < 0 || position.quantity <= 0) throw new Error('fill_uncertain');
            position.averageEntryPrice = cost / position.quantity;
          } else {
            if (deltaQuantity > position.quantity + 1e-8) throw new Error('owned_quantity_exceeded');
            position.realizedPnlUsd += deltaValue - deltaQuantity * position.averageEntryPrice;
            position.quantity = precise(position.quantity - deltaQuantity);
            if (position.quantity === 0) position.averageEntryPrice = 0;
          }
          position.updatedAt = update.updatedAt;
          database.prepare('insert into owned_positions(owner_id,plan_id,symbol,payload) values(?,?,?,?) on conflict(owner_id,plan_id,symbol) do update set payload=excluded.payload').run(position.ownerId, position.planId, position.symbol, JSON.stringify(position));
        }
        const execution: Execution = { ...previous, ...update };
        writeExecution(execution);
        database.exec('commit');
        return { execution, changed: previous.state !== execution.state || previous.brokerStatus !== execution.brokerStatus || deltaQuantity !== 0 || Math.abs(deltaValue) > 1e-8 };
      } catch (error) { database.exec('rollback'); throw error; }
    },
    listOwnedPositions(ownerId) {
      return database.prepare('select payload from owned_positions where owner_id=? order by plan_id,symbol').all(ownerId).map(row => JSON.parse(String(row.payload)) as PositionLedger);
    },
    getPortfolioStatus(ownerId) {
      const row = database.prepare('select paused,payload from portfolio_state where owner_id=?').get(ownerId);
      return { ...(row?.payload ? JSON.parse(String(row.payload)) : emptyPortfolio()), paused: Number(row?.paused ?? 0) === 1 };
    },
    savePortfolioStatus(ownerId, status) {
      database.prepare('insert into portfolio_state(owner_id,payload) values(?,?) on conflict(owner_id) do update set payload=excluded.payload').run(ownerId, JSON.stringify(status));
    },
    setPaused(ownerId, paused) {
      database.prepare('insert into portfolio_state(owner_id,paused) values(?,?) on conflict(owner_id) do update set paused=excluded.paused').run(ownerId, paused ? 1 : 0);
    },
    acquireLease(key, now, expires) {
      return Number(database.prepare('insert into leases(key,expires) values(?,?) on conflict(key) do update set expires=excluded.expires where leases.expires<=?').run(key, expires, now).changes) === 1;
    },
    releaseLease(key) { database.prepare('delete from leases where key=?').run(key); },
    close() { database.close(); },
  };
}
