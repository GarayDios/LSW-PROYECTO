import { f5Today, f5Pending } from '../../src/cores/06-gestion-de-riesgos/operation-state.ts';
export { f5Today, f5Pending };
import { z } from 'zod';
import { BrokerError } from '../../src/api/brokers/alpaca/client.ts';
import { parseF5Request } from '../../src/features/f5/validation.ts';
import type { F5Activity, F5AutomationPlanInput, F5Leg, F5Lifecycle, F5Operation, F5Position, F5RiskSettings } from '../../src/features/f5/types.ts';

export const defaultF5Risk: F5RiskSettings = { paused: false, maxDailyLossUsd: 1000, maxGrossExposureUsd: 1000000, maxPremiumExposureUsd: 100000, maxAbsDelta: 10000, maxCycleCapitalUsd: 100000 };
const positive = z.number().finite().positive();
export const riskSettingsSchema = z.object({ maxDailyLossUsd: positive.max(1000000), maxGrossExposureUsd: positive.max(100000000), maxPremiumExposureUsd: positive.max(10000000), maxAbsDelta: positive.max(1000000), maxCycleCapitalUsd: positive.max(10000000) }).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value);
const strike = positive.max(1000000), days = z.number().int().min(1).max(730), nonnegative = z.number().finite().nonnegative();
export const planSchema = z.object({
  operationId: z.string().uuid().optional(), initial: z.record(z.unknown()).optional(), startDate: date, endDate: date,
  maxActions: z.number().int().min(1).max(1000), maxCapitalUsd: positive.max(10000000),
  policy: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('wheel'), minDte: days, maxDte: days, minStrike: strike, maxStrike: strike, minPremium: positive.max(1000000) }).strict(),
    z.object({ kind: z.literal('pmcc'), rollAtDte: z.number().int().min(0).max(365), minDte: days, maxDte: days, minStrike: strike, maxStrike: strike, maxDebit: nonnegative.max(1000000), minCredit: nonnegative.max(1000000) }).strict(),
    z.object({ kind: z.literal('gamma'), deltaThreshold: positive.max(100000), maxShares: z.number().int().min(1).max(100000), intervalSeconds: z.number().int().min(60).max(86400) }).strict(),
    z.object({ kind: z.literal('exit'), stopLossPct: positive.max(100), takeProfitPct: positive.max(10000), closeDte: z.number().int().min(0).max(365) }).strict(),
  ]),
}).strict().refine(plan => Boolean(plan.operationId) !== Boolean(plan.initial) && plan.startDate <= plan.endDate)
  .refine(plan => (plan.policy.kind !== 'wheel' && plan.policy.kind !== 'pmcc') || plan.policy.minDte <= plan.policy.maxDte && plan.policy.minStrike <= plan.policy.maxStrike);

export function parsePlan(value: unknown): F5AutomationPlanInput {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) throw new BrokerError('f5_plan_invalid', 400, 'Revisa el ciclo, ventana, límites y política del plan F5.', false);
  const { initial, ...rest } = parsed.data;
  if (!initial) return rest as F5AutomationPlanInput;
  const request = parseF5Request(initial);
  if (request.action !== 'open') throw new BrokerError('f5_plan_invalid', 400, 'Un plan inicial requiere una apertura revisada.', false);
  return { ...rest, initial: request };
}
export const executed = (operation: F5Operation, leg?: F5Leg): number => {
  if (!operation.brokerOrder) return 0;
  const value = leg && operation.input.order_class === 'mleg' ? operation.brokerOrder.legs?.find(actual => actual.symbol === leg.symbol)?.filled_qty : operation.brokerOrder.filled_qty;
  return typeof value === 'string' && /^\d+(?:\.0+)?$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : NaN;
};
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;

/** Quantities come from executions and explicit provider events, never ITM prices. */
export function f5Residual(parent: F5Operation, operations: F5Operation[], positions: F5Position[], activities: F5Activity[], time: number): { lifecycle: F5Lifecycle; legs: F5Leg[]; quantity: number; vector: Map<string, number> } {
  const vector = new Map<string, number>();
  const children = operations.filter(operation => operation.parentId === parent.id);
  let uncertain = false, assigned = false, expired = false;
  let hedgeShares = 0;
  const add = (operation: F5Operation) => {
    for (const leg of operation.legs) {
      const count = executed(operation, leg);
      if (!Number.isFinite(count)) { uncertain = true; continue; }
      vector.set(leg.symbol, (vector.get(leg.symbol) ?? 0) + count * (leg.side === 'buy' ? 1 : -1));
    }
  };
  add(parent);
  for (const child of children) {
    if (child.action === 'hedge') {
      const count = executed(child);
      if (!Number.isFinite(count)) uncertain = true;
      else hedgeShares += count * (child.input.side === 'buy' ? 1 : -1);
    } else add(child);
  }
  for (const [symbol, expected] of vector) {
    if (expected === 0) continue;
    const actual = positions.filter(position => position.symbol === symbol && position.assetClass === 'us_option');
    if (actual.length > 1) { uncertain = true; continue; }
    const held = actual[0]?.quantity ?? 0;
    if (held === expected) continue;
    const events = activities.filter(event => event.symbol === symbol && ['OPASN', 'OPEXP', 'OPEXC'].includes(event.type)
      && !parent.activityBaselineIds?.includes(event.id) && event.date.slice(0, 10) >= parent.createdAt.slice(0, 10) && Date.parse(event.date.slice(0, 10) + 'T12:00:00Z') <= time + 86400000);
    const removed = events.reduce((sum, event) => sum + Math.abs(Number(event.quantity)), 0);
    const afterEvents = expected - Math.sign(expected) * removed;
    if (events.length && Number.isInteger(removed) && removed > 0 && removed <= Math.abs(expected) && held === afterEvents) {
      vector.set(symbol, held); assigned ||= events.some(event => event.type === 'OPASN' || event.type === 'OPEXC'); expired ||= events.some(event => event.type === 'OPEXP');
    } else uncertain = true;
  }
  const pending = f5Pending(parent) || children.some(f5Pending);
  if (hedgeShares < 0) uncertain = true;
  const nonzero = [...vector].filter(([, count]) => count !== 0);
  const quantity = nonzero.reduce((count, [, qty]) => gcd(count, Math.abs(qty)), 0);
  const legs: F5Leg[] = nonzero.map(([symbol, count]) => ({ symbol, side: count > 0 ? 'sell' : 'buy', ratio: Math.abs(count) / quantity, intent: count > 0 ? 'sell_to_close' : 'buy_to_close' }));
  const currentShort = nonzero.find(([, count]) => count < 0)?.[0];
  const awaitingShort=parent.strategy==='pmcc'&&nonzero.length===1&&nonzero[0][1]>0&&children.some(child=>child.action==='roll'&&child.request.action==='roll'&&child.request.step==='close-short'&&child.state==='filled');
  const phase: F5Lifecycle['phase'] = uncertain ? 'uncertain' : pending ? 'pending' : nonzero.length === 0 ? assigned ? 'assigned' : expired ? 'expired' : 'closed'
    : executed(parent) < parent.quantity || children.some(child => child.action === 'close' && executed(child) > 0) || nonzero.length !== parent.legs.length ? 'partial' : 'open';
  return { vector, legs, quantity, lifecycle: { phase, remainingQuantity: quantity, hedgeShares,
    canClose: !uncertain && !pending && quantity > 0 && hedgeShares === 0,
    canHedge: !uncertain && !pending && parent.strategy === 'gamma' && (quantity > 0 || hedgeShares > 0),
    canRoll: !uncertain && !pending && parent.strategy === 'pmcc' && (nonzero.length === 2 && Boolean(currentShort)||awaitingShort),
    ...(parent.strategy==='pmcc'?{rollPhase:awaitingShort?'open-short' as const:'close-short' as const}:{}),
    ...(currentShort ? { shortContract: currentShort } : {}),
    ...(uncertain ? { reason: 'Las posiciones no coinciden con las ejecuciones y eventos verificables del ciclo. Revisa movimientos manuales o espera la actividad del bróker.' } : pending ? { reason: 'Hay una orden pendiente o parcial; concilia o cancela antes de operar el residuo.' } : {}),
  } };
}
