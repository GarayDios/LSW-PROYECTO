import { createHash, randomUUID } from 'node:crypto';
import { analyzeHistory, type AnalysisResult } from '../../src/features/analysis/signals.ts';
import type { Candle } from '../../src/features/market/chart-history.ts';
import type { Execution, PortfolioStatus, PositionLedger, RunEvent, RunnerStore, TradingPlan } from './model.ts';
import type { PaperOrderInput } from '../../src/api/brokers/alpaca/client.ts';

export type RunnerOrder = {
  id: string; client_order_id: string; status: string; symbol: string; side: 'buy' | 'sell';
  qty: string; filled_qty: string; filled_avg_price?: string | null; limit_price?: string | null; type: string; time_in_force: string;
  stop_price?: string | null; order_class?: string; legs?: RunnerOrder[] | null;
};
export interface RunnerBroker {
  getClock(): Promise<{ timestamp: string; is_open: boolean; next_close?: string }>;
  getCalendar(start: string, end: string): Promise<{ date: string; open: string; close: string }[]>;
  getAccount(): Promise<{ status: string; buying_power: string; equity: string; cash?: string; trading_blocked: boolean; account_blocked?: boolean; trade_suspended_by_user?: boolean }>;
  getAsset(symbol: string): Promise<{ symbol: string; tradable: boolean; class: string; status: string }>;
  getPosition(symbol: string): Promise<{ qty: string } | null>;
  listPositions(): Promise<{ symbol: string; qty: string; market_value?: string; current_price?: string; asset_class?: string }[]>;
  listOpenOrders(symbol?: string): Promise<RunnerOrder[]>;
  getLatestQuote(symbol: string): Promise<{ bidPrice: number; askPrice: number; time: number }>;
  getOrderByClientId(id: string): Promise<RunnerOrder | null>;
  getOrder(id: string): Promise<RunnerOrder>;
  cancelOwnedOrder(orderId: string, clientOrderId: string): Promise<void>;
  submitPaperOrder(order: PaperOrderInput): Promise<RunnerOrder>;
}
export type RunnerOptions = {
  store: RunnerStore; broker: RunnerBroker | null; ownerId: string; enabled: boolean; maxOrderUsd?: number; maxDailyLossUsd?: number; maxTotalExposureUsd?: number; now?: () => number;
  history: (symbol: string, start: string, end: string) => Promise<Candle[]>; analyze?: (bars: readonly Candle[]) => AnalysisResult;
};
export const etDate = (timestamp: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
function previousDate(date: string) { const value = new Date(date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10); }
const hashId = (value: string) => 'tepic-' + createHash('sha256').update(value).digest('hex').slice(0, 48);
export function orderIdForSignal(plan: TradingPlan, signalTime: number): string { return hashId(`${plan.ownerId}|${plan.id}|${plan.symbol}|sma20-50-rsi14-v1|${signalTime}|buy`); }
export function orderIdForExit(plan: TradingPlan, position: PositionLedger, reason: string): string { return hashId(`${plan.ownerId}|${plan.id}|${plan.symbol}|exit-v1|${position.cycle}|${position.quantity.toFixed(8)}|${reason}`); }
const terminal = (state: Execution['state']) => ['filled', 'rejected', 'canceled', 'expired', 'failed'].includes(state);
const acceptedStatuses = new Set(['new', 'accepted', 'pending_new', 'accepted_for_bidding', 'pending_cancel', 'partially_filled', 'filled', 'canceled', 'expired', 'rejected', 'done_for_day', 'held']);

/** Ownership comes exclusively from confirmed fills in the durable ledger. */
export function createRunner(options: RunnerOptions) {
  let running = false;
  const closedHistories = new Map<string, AnalysisResult>();
  let sessionCache: { today: string; previousSession: string } | null = null;
  const now = options.now ?? Date.now, timestamp = () => new Date(now()).toISOString();
  const globalLimit = options.maxOrderUsd ?? 1000;
  if (!Number.isFinite(globalLimit) || globalLimit <= 0 || globalLimit > 10000) throw new RangeError('Límite del servicio inválido.');
  if (options.maxDailyLossUsd !== undefined && (!Number.isFinite(options.maxDailyLossUsd) || options.maxDailyLossUsd < 1 || options.maxDailyLossUsd > 25000) || options.maxTotalExposureUsd !== undefined && (!Number.isFinite(options.maxTotalExposureUsd) || options.maxTotalExposureUsd < 1 || options.maxTotalExposureUsd > 1000000)) throw new RangeError('Límites de riesgo del servicio inválidos.');
  const log = (plan: TradingPlan, status: RunEvent['status'], message: string, extra: Partial<RunEvent> = {}) => {
    const event: RunEvent = { id: randomUUID(), ownerId: plan.ownerId, planId: plan.id, time: timestamp(), status, message, ...extra };
    options.store.addEvent(event); return event;
  };
  const mutableAllowed = (plan: TradingPlan, side: 'buy' | 'sell') => (side === 'sell' || !options.store.getPortfolioStatus(plan.ownerId).paused) && !!options.store.listPlans(plan.ownerId).find(value => value.id === plan.id)?.enabled;

  function applyOrder(plan: TradingPlan, execution: Execution, order: RunnerOrder, initial = false): RunEvent | null {
    if (order.client_order_id !== execution.clientOrderId || order.symbol !== plan.symbol || order.side !== (execution.side ?? 'buy') || order.type !== (execution.orderType ?? 'limit') || order.time_in_force !== (execution.timeInForce ?? 'day') || execution.brokerOrderId && execution.brokerOrderId !== order.id || execution.limitPrice !== undefined && Number(order.limit_price) !== execution.limitPrice || execution.stopPrice !== undefined && Number(order.stop_price) !== execution.stopPrice || execution.orderClass === 'bracket' && order.order_class !== 'bracket' || !acceptedStatuses.has(order.status)) throw new Error('order_identity_or_status_uncertain');
    const quantity = Number(order.qty), filledQuantity = Number(order.filled_qty), filledAveragePrice = Number(order.filled_avg_price ?? 0);
    if (order.status === 'filled' && Math.abs(quantity - filledQuantity) > 1e-8 || order.status === 'partially_filled' && !(filledQuantity > 0 && filledQuantity < quantity)) throw new Error('fill_status_uncertain');
    const state: Execution['state'] = order.status === 'filled' ? 'filled' : order.status === 'canceled' ? 'canceled' : order.status === 'rejected' ? 'rejected' : order.status === 'expired' || order.status === 'done_for_day' && order.time_in_force === 'day' ? 'expired' : filledQuantity > 0 ? 'partial' : 'submitted';
    const result = options.store.reconcileExecution(execution.clientOrderId, { brokerOrderId: order.id, symbol: order.symbol, side: order.side, quantity, ...(order.type === 'stop' ? { stopPrice: Number(order.stop_price) } : { limitPrice: Number(order.limit_price) }), filledQuantity, filledAveragePrice, brokerStatus: order.status, state, updatedAt: timestamp() });
    if (!result.changed || initial && state === 'submitted') return null;
    const status: RunEvent['status'] = state === 'filled' ? order.side === 'sell' ? 'exit_filled' : 'filled' : state === 'partial' ? 'partial' : state === 'submitted' ? execution.state === 'ambiguous' || execution.state === 'reserved' ? 'duplicate' : order.side === 'sell' ? 'exit_pending' : 'submitted' : state;
    return log(plan, status, `Alpaca Paper: ${order.status}; ${filledQuantity}/${quantity} acciones ejecutadas${filledQuantity > 0 ? ` a precio medio $${filledAveragePrice.toFixed(4)}` : ''}.`, { clientOrderId: execution.clientOrderId, brokerOrderId: order.id, signalTime: execution.signalTime });
  }
  function registerBracket(plan: TradingPlan, execution: Execution, order: RunnerOrder) {
    if (execution.orderClass !== 'bracket' || execution.childrenRegistered) return;
    if (!order.legs?.length && ['canceled', 'expired', 'rejected'].includes(order.status) && Number(order.filled_qty) === 0) {
      options.store.updateExecution(execution.clientOrderId, execution.state, undefined, { childrenRegistered: true }); return;
    }
    const legs = order.legs;
    if (!legs || legs.length !== 2 || new Set(legs.map(leg => leg.id)).size !== 2 || new Set(legs.map(leg => leg.client_order_id)).size !== 2 || !legs.some(leg => leg.type === 'limit') || !legs.some(leg => leg.type === 'stop')) throw Error('bracket_legs_uncertain');
    for (const leg of legs) {
      if (!leg.id || !leg.client_order_id || leg.id === order.id || leg.client_order_id === execution.clientOrderId || leg.symbol !== plan.symbol || leg.side !== 'sell' || leg.time_in_force !== 'gtc' || !Number.isFinite(Number(leg.qty)) || Number(leg.qty) <= 0 || Number(leg.qty) > execution.quantity! || leg.type === 'limit' && Number(leg.limit_price) !== execution.bracketTakeProfit || leg.type === 'stop' && Number(leg.stop_price) !== execution.bracketStopLoss) throw Error('bracket_identity_uncertain');
      const existing = options.store.getExecution(leg.client_order_id);
      if (existing && existing.parentClientOrderId !== execution.clientOrderId) throw Error('bracket_ownership_uncertain');
    }
    for (const leg of legs) {
      options.store.reserveExecution({ clientOrderId: leg.client_order_id, ownerId: plan.ownerId, planId: plan.id, signalTime: execution.signalTime,
        state: 'submitted', brokerOrderId: leg.id, symbol: plan.symbol, side: 'sell', quantity: Number(leg.qty), orderType: leg.type as 'limit' | 'stop', timeInForce: 'gtc',
        ...(leg.type === 'stop' ? { stopPrice: Number(leg.stop_price) } : { limitPrice: Number(leg.limit_price) }),
        parentClientOrderId: execution.clientOrderId, reason: leg.type === 'stop' ? 'bracket_stop_loss' : 'bracket_take_profit', createdAt: timestamp(), updatedAt: timestamp() });
    }
    options.store.updateExecution(execution.clientOrderId, execution.state, undefined, { childrenRegistered: true });
  }
  async function reconcile(plans: TradingPlan[]): Promise<RunEvent[]> {
    const events: RunEvent[] = [];
    if (!options.broker) return events;
    // Entries are always applied before their exit fills, regardless of database ordering.
    const executions = options.store.listExecutions(options.ownerId).filter(item => !terminal(item.state) || item.orderClass === 'bracket' && !item.childrenRegistered).sort((a, b) => Number(!!a.parentClientOrderId) - Number(!!b.parentClientOrderId));
    for (const execution of executions) {
      const plan = plans.find(value => value.id === execution.planId);
      if (!plan) continue;
      try {
        const order = execution.brokerOrderId ? await options.broker.getOrder(execution.brokerOrderId) : await options.broker.getOrderByClientId(execution.clientOrderId);
        if (!order) throw new Error('order_missing');
        const event = applyOrder(plan, execution, order); if (event) events.push(event);
        registerBracket(plan, options.store.getExecution(execution.clientOrderId)!, order);
      } catch {
        options.store.updateExecution(execution.clientOrderId, 'ambiguous', undefined, { updatedAt: timestamp() });
        events.push(log(plan, 'ambiguous', 'No se pudieron conciliar la orden y sus cantidades; se bloquean nuevas órdenes hasta aclararla.', { clientOrderId: execution.clientOrderId, brokerOrderId: execution.brokerOrderId }));
      }
    }
    return events;
  }
  async function refreshRisk(): Promise<PortfolioStatus> {
    const previous = options.store.getPortfolioStatus(options.ownerId), today = etDate(now());
    const plans = options.store.listPlans(options.ownerId).filter(plan => plan.enabled);
    const smallest = (values: (number | undefined)[]) => values.some(value => value !== undefined) ? Math.min(...values.filter((value): value is number => value !== undefined)) : null;
    const limits = { maxDailyLossUsd: smallest([options.maxDailyLossUsd, ...plans.map(plan => plan.maxDailyLossUsd)]), maxTotalExposureUsd: smallest([options.maxTotalExposureUsd, ...plans.map(plan => plan.maxTotalExposureUsd)]) };
    let risk: PortfolioStatus = { ...previous, ...(previous.date !== today ? { equityStartUsd: null, equityUsd: null, dailyPnlUsd: null, dailyLossBlocked: false } : {}), date: today, limits, uncertain: true, updatedAt: timestamp() };
    try {
      if (!options.broker) throw new Error('broker_unconfigured');
      const [account, positions, openOrders] = await Promise.all([options.broker.getAccount(), options.broker.listPositions(), options.broker.listOpenOrders()]);
      const equity = Number(account.equity); if (!Number.isFinite(equity) || equity <= 0) throw new Error('equity_uncertain');
      let positionExposure = 0, ownedExposureUsd = 0, reservedEntryUsd = 0;
      let uncertain = options.store.listExecutions(options.ownerId).some(item => ['ambiguous', 'reserved'].includes(item.state));
      const owned = options.store.listOwnedPositions(options.ownerId).filter(item => item.quantity > 0);
      for (const position of positions) {
        const qty = Number(position.qty), marketValue = Number(position.market_value);
        if (!Number.isFinite(qty) || !Number.isFinite(marketValue)) throw new Error('exposure_uncertain');
        positionExposure += Math.abs(marketValue);
      }
      for (const symbol of new Set(owned.map(item => item.symbol))) {
        const live = positions.find(item => item.symbol === symbol), liveQty = Number(live?.qty ?? 0);
        const ownedQty = owned.filter(item => item.symbol === symbol).reduce((sum, item) => sum + item.quantity, 0);
        if (!live || liveQty + 1e-8 < ownedQty || live.asset_class && live.asset_class !== 'us_equity') uncertain = true;
        const price = live?.current_price !== undefined ? Number(live.current_price) : liveQty > 0 ? Math.abs(Number(live?.market_value)) / liveQty : NaN;
        if (!Number.isFinite(price) || price <= 0) uncertain = true; else ownedExposureUsd += ownedQty * price;
      }
      const counted = new Set<string>();
      for (const order of openOrders.filter(item => item.side === 'buy')) {
        const remaining = Number(order.qty) - Number(order.filled_qty), price = Number(order.limit_price);
        if (!Number.isFinite(remaining) || remaining < 0 || !Number.isFinite(price) || price <= 0) throw new Error('pending_exposure_uncertain');
        reservedEntryUsd += remaining * price; counted.add(order.client_order_id);
      }
      for (const execution of options.store.listExecutions(options.ownerId).filter(item => !terminal(item.state) && (item.side ?? 'buy') === 'buy' && !counted.has(item.clientOrderId))) {
        if (execution.quantity === undefined || execution.limitPrice === undefined) { uncertain = true; continue; }
        reservedEntryUsd += Math.max(0, execution.quantity - (execution.filledQuantity ?? 0)) * execution.limitPrice;
      }
      const equityStartUsd = previous.date === today && previous.equityStartUsd !== null ? previous.equityStartUsd : equity;
      const dailyPnlUsd = equity - equityStartUsd, totalExposureUsd = positionExposure + reservedEntryUsd;
      risk = { ...risk, equityStartUsd, equityUsd: equity, dailyPnlUsd, ownedExposureUsd, totalExposureUsd, reservedEntryUsd, uncertain,
        dailyLossBlocked: previous.date === today && previous.dailyLossBlocked || limits.maxDailyLossUsd !== null && dailyPnlUsd <= -limits.maxDailyLossUsd,
        exposureBlocked: limits.maxTotalExposureUsd !== null && totalExposureUsd >= limits.maxTotalExposureUsd };
    } catch { /* Last confirmed amounts remain visible; uncertainty blocks orders. */ }
    options.store.savePortfolioStatus(options.ownerId, risk); return options.store.getPortfolioStatus(options.ownerId);
  }
  async function analysisFor(plan: TradingPlan): Promise<AnalysisResult> {
    const today = etDate(now()), end = previousDate(today);
    const start = new Date(end + 'T12:00:00Z'); start.setUTCFullYear(start.getUTCFullYear() - plan.historyYears);
    if (sessionCache?.today !== today) {
      const calendarStart = new Date(now() - 14 * 86400000).toISOString().slice(0, 10);
      const sessions = (await options.broker!.getCalendar(calendarStart, end)).filter(session => session.date < today).sort((a, b) => a.date.localeCompare(b.date));
      if (!sessions.length) throw new Error('No se pudo verificar la sesión anterior del mercado.');
      sessionCache = { today, previousSession: sessions.at(-1)!.date }; closedHistories.clear();
    }
    const historyKey = `${plan.symbol}:${plan.historyYears}:${sessionCache.previousSession}`;
    let analysis = closedHistories.get(historyKey);
    if (!analysis) {
      const bars = (await options.history(plan.symbol, start.toISOString().slice(0, 10), end)).filter(bar => etDate(bar.time) < today), latestBar = bars.at(-1);
      if (!latestBar || etDate(latestBar.time) !== sessionCache.previousSession) throw new Error('Falta el cierre de la última sesión confirmada por el calendario.');
      if (bars.length < 100 || bars[0].time > start.getTime() + 14 * 86400000) throw new Error('El proveedor no cubre los años de contexto del plan.');
      analysis = (options.analyze ?? analyzeHistory)(bars); closedHistories.set(historyKey, analysis);
    }
    return analysis;
  }
  const validQuote = (quote: { time: number; askPrice: number; bidPrice: number }) => [quote.time, quote.askPrice, quote.bidPrice].every(Number.isFinite) && quote.askPrice > 0 && quote.bidPrice > 0 && quote.askPrice >= quote.bidPrice && now() - quote.time <= 60000 && quote.time <= now() + 5000 && (quote.askPrice - quote.bidPrice) / quote.askPrice <= .02;
  const priceFor = (price: number, side: 'buy' | 'sell') => {
    const adjusted = price * (side === 'buy' ? 1.005 : .995), factor = adjusted >= 1 ? 100 : 10000;
    return (side === 'buy' ? Math.ceil(adjusted * factor) : Math.floor(adjusted * factor)) / factor;
  };

  async function submit(plan: TradingPlan, side: 'buy' | 'sell', quantity: number, limitPrice: number, clientOrderId: string, signalTime: number, reason: string): Promise<RunEvent> {
    if (!mutableAllowed(plan, side)) return log(plan, 'blocked', 'La entrada está pausada o el plan fue desactivado antes del envío.');
    const existing = options.store.getExecution(clientOrderId);
    if (existing) return log(plan, existing.state === 'ambiguous' ? 'ambiguous' : 'duplicate', 'Esta decisión ya tiene una orden o reserva persistente; no se reenvía.', { clientOrderId, brokerOrderId: existing.brokerOrderId, signalTime });
    const bracket = side === 'buy' && plan.exitPolicy?.execution === 'bracket';
    const roundedPrice = (value: number) => Number(value.toFixed(value >= 1 ? 2 : 4));
    const bracketTakeProfit = bracket ? roundedPrice(limitPrice * (1 + plan.exitPolicy!.takeProfitPct / 100)) : undefined;
    const bracketStopLoss = bracket ? roundedPrice(limitPrice * (1 - plan.exitPolicy!.stopLossPct / 100)) : undefined;
    if (bracket && !(bracketStopLoss! > 0 && bracketStopLoss! < limitPrice && bracketTakeProfit! > limitPrice)) return log(plan, 'blocked', 'Los umbrales bracket son demasiado próximos para la precisión del precio.');
    if (!options.store.reserveExecution({ clientOrderId, ownerId: plan.ownerId, planId: plan.id, signalTime, state: 'reserved', side, symbol: plan.symbol, quantity, limitPrice, filledQuantity: 0, filledAveragePrice: 0, reason,
      ...(bracket ? { orderClass: 'bracket', timeInForce: 'gtc', bracketTakeProfit, bracketStopLoss, childrenRegistered: false } : {}), createdAt: timestamp(), updatedAt: timestamp() })) return log(plan, 'duplicate', 'Otra evaluación reservó esta decisión.', { clientOrderId });
    try {
      const base = { symbol: plan.symbol, qty: String(quantity), type: 'limit' as const, limit_price: limitPrice.toFixed(limitPrice >= 1 ? 2 : 4), client_order_id: clientOrderId };
      const order = await options.broker!.submitPaperOrder(bracket ? { ...base, side: 'buy', time_in_force: 'gtc', order_class: 'bracket', take_profit: { limit_price: String(bracketTakeProfit) }, stop_loss: { stop_price: String(bracketStopLoss) } } : { ...base, side, time_in_force: 'day' });
      const event = applyOrder(plan, options.store.getExecution(clientOrderId)!, order, true);
      registerBracket(plan, options.store.getExecution(clientOrderId)!, order);
      if (event && !['submitted', 'duplicate'].includes(event.status)) return event;
      return log(plan, side === 'sell' ? 'exit_pending' : 'submitted', `Orden límite Paper de ${side === 'buy' ? 'compra' : 'salida'} enviada: ${quantity} ${plan.symbol}, límite $${limitPrice}. El envío no confirma ejecución.`, { clientOrderId, brokerOrderId: order.id, signalTime });
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      const definite = ['broker_order_invalid', 'broker_order_rejected', 'broker_account_blocked', 'broker_asset_not_tradable', 'broker_market_closed', 'broker_insufficient_funds', 'broker_insufficient_position'].includes(code);
      options.store.updateExecution(clientOrderId, definite ? 'rejected' : 'ambiguous', undefined, { updatedAt: timestamp() });
      return log(plan, definite ? 'rejected' : 'ambiguous', definite ? 'Alpaca rechazó la orden; no se registró como ejecutada.' : 'No se pudo confirmar la orden. Se conciliará por su identificador y no se reenviará a ciegas.', { clientOrderId, signalTime });
    }
  }
  async function cancelEntry(plan: TradingPlan, execution: Execution): Promise<RunEvent> {
    if (!mutableAllowed(plan, 'sell')) return log(plan, 'blocked', 'La desactivación del plan impide gestionar nuevas órdenes de salida.');
    if (!execution.brokerOrderId || execution.state === 'ambiguous') return log(plan, 'ambiguous', 'La entrada pendiente debe conciliarse antes de solicitar su cancelación.');
    if (execution.cancelRequestedAt && (execution.brokerStatus === 'pending_cancel' || now() - Date.parse(execution.cancelRequestedAt) < 60000)) return log(plan, 'exit_pending', 'Se espera confirmación de la cancelación de la entrada propia antes de vender.');
    options.store.updateExecution(execution.clientOrderId, execution.state, undefined, { cancelRequestedAt: timestamp() });
    try { await options.broker!.cancelOwnedOrder(execution.brokerOrderId, execution.clientOrderId); } catch { /* Reconcile a fill/cancel race before any sale. */ }
    return log(plan, 'exit_pending', 'Cancelación solicitada solo para la entrada propia pendiente; se verificará su estado antes de vender.', { clientOrderId: execution.clientOrderId, brokerOrderId: execution.brokerOrderId });
  }
  async function evaluate(plan: TradingPlan): Promise<RunEvent> {
    const broker = options.broker;
    if (!options.enabled || !broker) return log(plan, 'blocked', 'La automatización de práctica no está habilitada en el servicio.');
    const risk = options.store.getPortfolioStatus(plan.ownerId);
    if (risk.uncertain) return log(plan, 'blocked', 'No se pudo verificar la exposición o conciliar una orden; no se envían nuevas órdenes.');
    const current = now(), today = etDate(current), clock = await broker.getClock();
    if (!clock.is_open) return log(plan, 'waiting', 'Mercado cerrado; se revisará en la siguiente sesión.');
    if (!Number.isFinite(Date.parse(clock.timestamp)) || Math.abs(current - Date.parse(clock.timestamp)) > 120000) return log(plan, 'blocked', 'El reloj del mercado no está actualizado.');
    const position = options.store.listOwnedPositions(plan.ownerId).find(item => item.planId === plan.id && item.symbol === plan.symbol && item.quantity > 0);
    const endDue = !!plan.exitPolicy?.closeAtEnd && (today > plan.endDate || today === plan.endDate && Number.isFinite(Date.parse(clock.next_close ?? '')) && current >= Date.parse(clock.next_close!) - 15 * 60000);
    const pendingEntries = options.store.listExecutions(plan.ownerId).filter(item => item.planId === plan.id && (item.side ?? 'buy') === 'buy' && !terminal(item.state));
    if (today > plan.endDate && pendingEntries.some(item => item.orderClass === 'bracket')) return cancelEntry(plan, pendingEntries.find(item => item.orderClass === 'bracket')!);
    if (endDue && pendingEntries.length) return cancelEntry(plan, pendingEntries[0]);
    if (position) {
      if (!plan.exitPolicy) return log(plan, 'waiting', 'Posición propia confirmada; este plan heredado solo automatiza entradas y no tiene política de salida.');
      if (plan.exitPolicy.execution === 'bracket') {
        const executions = options.store.listExecutions(plan.ownerId).filter(item => item.planId === plan.id);
        const parents = executions.filter(item => item.orderClass === 'bracket' && (item.filledQuantity ?? 0) > 0);
        const protectedPosition = parents.some(parent => parent.state === 'filled' && parent.childrenRegistered && executions.some(item => item.parentClientOrderId === parent.clientOrderId && item.orderType === 'stop' && !terminal(item.state) && item.brokerStatus !== 'held' && item.brokerStatus !== undefined));
        return log(plan, protectedPosition ? 'waiting' : 'blocked', protectedPosition ? 'Alpaca mantiene las salidas bracket; el runner concilia sus ejecuciones sin enviar ventas adicionales.' : 'Exposición propia sin stop bracket activo confirmado. Revisa las órdenes de Alpaca; no se envía otra venta que pueda competir con sus salidas.');
      }
      const quote = await broker.getLatestQuote(plan.symbol);
      if (!validQuote(quote)) return log(plan, 'blocked', 'Cotización inválida, antigua o con diferencial superior al 2%; se conserva la posición.');
      const changePct = (quote.bidPrice / position.averageEntryPrice - 1) * 100;
      let reason = changePct <= -plan.exitPolicy.stopLossPct ? 'stop_loss' : changePct >= plan.exitPolicy.takeProfitPct ? 'take_profit' : endDue ? 'window_end' : '';
      if (!reason && plan.exitPolicy.exitOnSignal) {
        try { const signal = (await analysisFor(plan)).latest; if (signal?.action === 'sell' && etDate(signal.time) === sessionCache!.previousSession) reason = 'bearish_signal'; }
        catch { return log(plan, 'blocked', 'No se pudo verificar la señal de salida; stop loss y take profit se revisarán con la siguiente cotización.'); }
      }
      if (!reason) return log(plan, 'waiting', 'La posición propia no alcanza una condición de salida.');
      if (pendingEntries.length) return cancelEntry(plan, pendingEntries[0]);
      const pending = options.store.listExecutions(plan.ownerId).find(item => item.planId === plan.id && item.side === 'sell' && !terminal(item.state));
      if (pending) return log(plan, 'exit_pending', 'La salida propia sigue pendiente; no se reserva su cantidad otra vez.', { clientOrderId: pending.clientOrderId, brokerOrderId: pending.brokerOrderId });
      const [live, open] = await Promise.all([broker.getPosition(plan.symbol), broker.listOpenOrders(plan.symbol)]);
      const allOwned = options.store.listOwnedPositions(plan.ownerId).filter(item => item.symbol === plan.symbol).reduce((sum, item) => sum + item.quantity, 0);
      if (!live || Number(live.qty) + 1e-8 < allOwned || open.length) return log(plan, 'blocked', 'La posición disponible u otra orden del símbolo impide vender exclusivamente las acciones propias.');
      const quantity = Math.floor(position.quantity + 1e-8), limitPrice = priceFor(quote.bidPrice, 'sell');
      if (quantity < 1 || limitPrice <= 0) return log(plan, 'blocked', 'La cantidad propia disponible no permite una salida de acciones completas.');
      return submit(plan, 'sell', quantity, limitPrice, orderIdForExit(plan, position, reason), current, reason);
    }
    if (risk.paused) return log(plan, 'blocked', 'Entradas pausadas. La conciliación y las salidas de los planes habilitados continúan.');
    if (today < plan.startDate || today > plan.endDate || endDue) return log(plan, 'waiting', 'Fuera de la ventana de nuevas entradas del plan.');
    if (risk.dailyLossBlocked || risk.exposureBlocked) return log(plan, 'blocked', risk.dailyLossBlocked ? 'Se alcanzó la pérdida diaria máxima; las entradas quedan bloqueadas durante esta fecha de Nueva York.' : 'Se alcanzó el límite de exposición agregada de la cuenta.');
    let analysis: AnalysisResult;
    try { analysis = await analysisFor(plan); } catch (error) { return log(plan, 'blocked', error instanceof Error ? error.message : 'No se pudo verificar el histórico.'); }
    const signal = analysis.latest;
    if (!signal || signal.action !== 'buy' || etDate(signal.time) !== sessionCache!.previousSession) return log(plan, 'waiting', signal?.reason ?? 'Faltan velas cerradas para evaluar la regla.');
    const clientOrderId = orderIdForSignal(plan, signal.time), previous = options.store.getExecution(clientOrderId);
    if (previous) return log(plan, previous.state === 'ambiguous' ? 'ambiguous' : 'duplicate', 'Esta señal ya tiene una orden o reserva persistente; no se reenvía.', { clientOrderId, brokerOrderId: previous.brokerOrderId, signalTime: signal.time });
    const [account, asset, live, openOrders, quote] = await Promise.all([broker.getAccount(), broker.getAsset(plan.symbol), broker.getPosition(plan.symbol), broker.listOpenOrders(plan.symbol), broker.getLatestQuote(plan.symbol)]);
    if (account.status !== 'ACTIVE' || account.trading_blocked || account.account_blocked || account.trade_suspended_by_user || asset.symbol !== plan.symbol || !asset.tradable || asset.class !== 'us_equity' || asset.status !== 'active') return log(plan, 'blocked', 'La cuenta o el activo no permiten esta entrada de práctica.');
    if (live && Number(live.qty) !== 0 || openOrders.length) return log(plan, 'blocked', 'Ya existe una posición u orden abierta en este símbolo.');
    if (!validQuote(quote)) return log(plan, 'blocked', 'La cotización es inválida, tiene más de 60 segundos o el diferencial supera el 2%.');
    const limitPrice = priceFor(quote.askPrice, 'buy'), buyingPower = Math.min(Number(account.buying_power), account.cash === undefined ? Infinity : Number(account.cash));
    if (!Number.isFinite(buyingPower) || buyingPower <= 0) return log(plan, 'blocked', 'No se pudo verificar el capital de práctica disponible.');
    const headroom = risk.limits.maxTotalExposureUsd === null ? Infinity : Math.max(0, risk.limits.maxTotalExposureUsd - risk.totalExposureUsd);
    const quantity = Math.floor(Math.min(plan.maxOrderUsd, plan.maxPositionUsd, globalLimit, buyingPower, headroom) / limitPrice);
    if (quantity < 1) return log(plan, 'blocked', 'Los límites de capital o exposición no alcanzan para una acción completa.');
    return submit(plan, 'buy', quantity, limitPrice, clientOrderId, signal.time, 'bullish_signal');
  }
  return {
    status: () => ({ mode: 'paper' as const, available: true, configured: options.broker !== null, enabled: options.enabled, ownerId: options.ownerId, maxOrderUsd: globalLimit, buyOnly: !options.store.listPlans(options.ownerId).some(plan => !!plan.exitPolicy), paused: options.store.getPortfolioStatus(options.ownerId).paused, running }),
    risk: () => options.store.getPortfolioStatus(options.ownerId),
    async tick(ownerId = options.ownerId): Promise<RunEvent[]> {
      if (ownerId !== options.ownerId) throw new Error('owner_not_allowed');
      if (running || !options.store.acquireLease(`tick:${ownerId}`, now(), now() + 180000)) return [];
      running = true; const events: RunEvent[] = [];
      try {
        const plans = options.store.listPlans(ownerId); events.push(...await reconcile(plans)); await refreshRisk();
        for (const plan of plans.filter(plan => plan.enabled)) {
          try { const event = await evaluate(plan); events.push(event); if (['submitted', 'partial', 'filled', 'exit_pending', 'exit_filled', 'ambiguous', 'rejected'].includes(event.status)) await refreshRisk(); }
          catch { events.push(log(plan, 'error', 'No se pudo completar la evaluación; no se enviaron órdenes adicionales.')); }
        }
        return events;
      } finally { running = false; options.store.releaseLease(`tick:${ownerId}`); }
    },
  };
}
