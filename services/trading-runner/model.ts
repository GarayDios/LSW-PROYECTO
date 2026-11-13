import { z } from 'zod';
import type { AlertQueue } from './alerts.ts';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
export const ownerSchema = z.string().trim().min(1).max(255);
export const exitPolicySchema = z.object({
  stopLossPct: z.number().finite().min(0.1).max(50),
  takeProfitPct: z.number().finite().min(0.1).max(200),
  exitOnSignal: z.boolean().optional(), closeAtEnd: z.boolean().optional(),
  execution: z.enum(['monitored', 'bracket']).optional(),
}).strict().refine(policy => policy.execution !== 'bracket' || !policy.exitOnSignal && !policy.closeAtEnd, 'Bracket usa únicamente los precios de stop loss y take profit.');
export const planInputSchema = z.object({
  ownerId: ownerSchema,
  symbol: z.string().regex(/^[A-Z][A-Z0-9.\-]{0,14}$/),
  historyYears: z.union([z.literal(3), z.literal(5)]),
  startDate: date, endDate: date,
  maxOrderUsd: z.number().finite().min(1).max(10000),
  maxPositionUsd: z.number().finite().min(1).max(25000),
  exitPolicy: exitPolicySchema.nullable().optional(),
  maxDailyLossUsd: z.number().finite().min(1).max(25000).optional(),
  maxTotalExposureUsd: z.number().finite().min(1).max(1000000).optional(),
  enabled: z.literal(false),
}).strict().refine(value => value.startDate <= value.endDate && value.maxPositionUsd >= value.maxOrderUsd, 'Revisa las fechas y los límites de capital.');
export type PlanInput = z.infer<typeof planInputSchema>;
export type TradingPlan = Omit<PlanInput, 'enabled'> & { id: string; enabled: boolean; createdAt: string; updatedAt: string };
export type RunEvent = {
  id: string; ownerId: string; planId: string; time: string;
  status: 'waiting' | 'blocked' | 'submitted' | 'duplicate' | 'ambiguous' | 'error' | 'partial' | 'filled' | 'rejected' | 'canceled' | 'expired' | 'exit_pending' | 'exit_filled';
  message: string; clientOrderId?: string; brokerOrderId?: string; signalTime?: number;
};
export type Execution = {
  clientOrderId: string; ownerId: string; planId: string; signalTime: number;
  state: 'reserved' | 'submitted' | 'ambiguous' | 'failed' | 'partial' | 'filled' | 'rejected' | 'canceled' | 'expired'; brokerOrderId?: string;
  symbol?: string; side?: 'buy' | 'sell'; quantity?: number; limitPrice?: number;
  filledQuantity?: number; filledAveragePrice?: number; brokerStatus?: string;
  reason?: string; createdAt?: string; updatedAt?: string; cancelRequestedAt?: string;
  orderType?: 'limit' | 'stop'; timeInForce?: 'day' | 'gtc'; stopPrice?: number;
  orderClass?: 'bracket'; parentClientOrderId?: string; childrenRegistered?: boolean;
  bracketTakeProfit?: number; bracketStopLoss?: number;
};
export type PositionLedger = {
  ownerId: string; planId: string; symbol: string; quantity: number; averageEntryPrice: number;
  realizedPnlUsd: number; cycle: number; updatedAt: string;
};
export type PortfolioStatus = {
  paused: boolean; date: string; equityStartUsd: number | null; equityUsd: number | null; dailyPnlUsd: number | null;
  ownedExposureUsd: number; totalExposureUsd: number; reservedEntryUsd: number;
  limits: { maxDailyLossUsd: number | null; maxTotalExposureUsd: number | null };
  dailyLossBlocked: boolean; exposureBlocked: boolean; uncertain: boolean; updatedAt: string;
};
export type ExecutionUpdate = {
  brokerOrderId: string; symbol: string; side: 'buy' | 'sell'; quantity: number; limitPrice?: number; stopPrice?: number;
  filledQuantity: number; filledAveragePrice: number; brokerStatus: string; state: Execution['state']; updatedAt: string;
};
export interface RunnerStore extends AlertQueue {
  listPlans(ownerId: string): TradingPlan[];
  createPlan(input: PlanInput, now: string): TradingPlan;
  setEnabled(ownerId: string, planId: string, enabled: boolean, now: string): TradingPlan | null;
  listEvents(ownerId: string, limit?: number): RunEvent[];
  addEvent(event: RunEvent): void;
  reserveExecution(execution: Execution): boolean;
  getExecution(clientOrderId: string): Execution | null;
  listExecutions(ownerId: string): Execution[];
  updateExecution(clientOrderId: string, state: Execution['state'], brokerOrderId?: string, patch?: Partial<Execution>): void;
  reconcileExecution(clientOrderId: string, update: ExecutionUpdate): { execution: Execution; changed: boolean };
  listOwnedPositions(ownerId: string): PositionLedger[];
  getPortfolioStatus(ownerId: string): PortfolioStatus;
  savePortfolioStatus(ownerId: string, status: PortfolioStatus): void;
  setPaused(ownerId: string, paused: boolean): void;
  acquireLease(key: string, now: number, expires: number): boolean;
  releaseLease(key: string): void;
  close(): void;
}
