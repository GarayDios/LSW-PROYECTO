import { createHash } from 'node:crypto';
import type { RunEvent } from './model.ts';

export type QueuedAlert = { id: string; event: RunEvent; attempts: number; nextAttemptAt: number; deliveredAt: number | null };
export interface AlertQueue {
  pendingAlerts(ownerId: string, now: number, limit?: number): QueuedAlert[];
  settleAlert(ownerId: string, id: string, now: number, delivered: boolean): void;
}
export type AlertConfig = { url: string; token?: string };

/** Repeated operational failures are grouped into 15-minute buckets. Fills stay distinct. */
export function alertKey(event: RunEvent): string | null {
  if (!['submitted', 'partial', 'filled', 'rejected', 'canceled', 'expired', 'exit_pending', 'exit_filled', 'ambiguous', 'error', 'blocked'].includes(event.status)) return null;
  if (event.status === 'blocked' && !/pérdida diaria|exposición|conciliar/i.test(event.message)) return null;
  const occurrence = event.clientOrderId && !['ambiguous', 'error', 'blocked', 'exit_pending'].includes(event.status)
    ? event.message : Math.floor(Date.parse(event.time) / 900000);
  return createHash('sha256').update(JSON.stringify([event.ownerId, event.planId, event.clientOrderId ?? '', event.status, occurrence])).digest('hex');
}

export function readAlertConfig(env: Record<string, string | undefined>): AlertConfig | null {
  const value = env.TRADING_ALERT_WEBHOOK_URL?.trim(), token = env.TRADING_ALERT_WEBHOOK_TOKEN?.trim();
  if (!value && !token) return null;
  if (!value || token && (token.length < 32 || token.length > 512 || /[\r\n]/.test(token))) throw Error('invalid_alert_configuration');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw Error('invalid_alert_configuration');
  return { url: url.href, ...(token ? { token } : {}) };
}

/** At-least-once delivery. Receivers deduplicate by Idempotency-Key; no redirects or raw diagnostics. */
export function createAlertDispatcher(options: { queue: AlertQueue; ownerId: string; config: AlertConfig | null; fetcher?: typeof fetch; now?: () => number }) {
  let running = false;
  return async () => {
    if (running || !options.config) return;
    running = true;
    try {
      const now = options.now ?? Date.now;
      for (const alert of options.queue.pendingAlerts(options.ownerId, now(), 5)) {
        let delivered = false;
        try {
          const response = await (options.fetcher ?? fetch)(options.config.url, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': alert.id, ...(options.config.token ? { Authorization: `Bearer ${options.config.token}` } : {}) },
            body: JSON.stringify({ id: alert.id, mode: 'paper', event: alert.event }), signal: AbortSignal.timeout(3000), redirect: 'manual',
          });
          delivered = response.ok;
          await response.body?.cancel();
        } catch { /* The queue stores no remote error text or credentials. */ }
        options.queue.settleAlert(options.ownerId, alert.id, now(), delivered);
      }
    } finally { running = false; }
  };
}
