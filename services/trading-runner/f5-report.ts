import { f5OptionSymbol } from '../../src/features/f5/validation.ts';
import type { F5BrokerOrder, F5Operation, F5Position } from '../../src/features/f5/types.ts';
import type { F5AccountingActivity, F5AccountingBatch, F5Coverage, F5CycleReport, F5Report, F5ReportEvent, F5ReportMetrics } from '../../src/features/f5/report-types.ts';

type Inputs = { operations: F5Operation[]; positions: F5Position[]; fills?: F5AccountingBatch; fees?: F5AccountingBatch; activities?: F5AccountingBatch; now?: () => number };
type Lot = { quantity: number; price: number | null };
type WorkEvent = F5ReportEvent & { time: string; signed: number; multiplier: number; inventory: boolean; realized: number | null };
type Context = { row: F5CycleReport; operations: F5Operation[]; events: WorkEvent[]; lots: Map<string, Lot[]>; cashKnown: boolean; fillsKnown: boolean; settlementsKnown: boolean; basisKnown: boolean; marksKnown: boolean; feesKnown: boolean; feeOrders: Set<string>; filledOrders: Set<string>; feeTotal: number; manualMixed: boolean };
const round = (value: number) => Math.round((value + Number.EPSILON) * 1e8) / 1e8;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
const dateOf = (value: string | null | undefined): string | null => value && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value.length === 10 ? value + 'T12:00:00Z' : value)) ? value.slice(0, 10) : null;
const worst = (values: F5Coverage[]): F5Coverage => values.includes('unknown') ? 'unknown' : values.includes('partial') ? 'partial' : 'complete';
const empty = (): F5ReportMetrics => ({ cashFlowUsd: 0, realizedPnlUsd: 0, unrealizedPnlUsd: 0, grossPnlUsd: 0, feesUsd: 0, netPnlUsd: 0, observedCashFlowUsd: 0, observedFeesUsd: 0, coverage: { fills: 'complete', fees: 'complete', settlements: 'complete', positions: 'complete' }, warnings: [] });
function combined(metrics: F5ReportMetrics[]): F5ReportMetrics {
  const result = empty();
  for (const field of ['cashFlowUsd', 'realizedPnlUsd', 'unrealizedPnlUsd', 'grossPnlUsd', 'feesUsd', 'netPnlUsd'] as const) result[field] = metrics.some(item => item[field] === null) ? null : round(metrics.reduce((total, item) => total + item[field]!, 0));
  result.observedCashFlowUsd = round(metrics.reduce((total, item) => total + item.observedCashFlowUsd, 0));
  result.observedFeesUsd = round(metrics.reduce((total, item) => total + item.observedFeesUsd, 0));
  for (const field of ['fills', 'fees', 'settlements', 'positions'] as const) result.coverage[field] = worst(metrics.map(item => item.coverage[field]));
  result.warnings = [...new Set(metrics.flatMap(item => item.warnings))]; return result;
}
const publicEvent = (event: WorkEvent): F5ReportEvent => { const { time: _time, signed: _signed, multiplier: _multiplier, inventory: _inventory, realized: _realized, ...visible } = event; return visible; };
function event(activity: F5AccountingActivity, type: F5ReportEvent['type'], operationId: string | null, overrides: Partial<WorkEvent> = {}): WorkEvent {
  return { id: 'activity:' + activity.id, operationId, activityId: activity.id, type, symbol: activity.symbol, date: activity.date ?? dateOf(activity.transactionTime), quantity: activity.quantity, price: activity.price,
    cashFlowUsd: null, feeUsd: null, source: 'Alpaca Paper account activity ' + activity.id, known: false, time: activity.transactionTime ?? (activity.date ? activity.date + 'T23:59:59.999Z' : ''), signed: 0, multiplier: activity.symbol && f5OptionSymbol.test(activity.symbol) ? 100 : 1, inventory: false, realized: null, ...overrides };
}
function unique(batch: F5AccountingBatch | undefined, warnings: string[]): F5AccountingActivity[] {
  if (!batch) return [];
  const found = new Map<string, F5AccountingActivity>(), conflicts = new Set<string>();
  for (const activity of batch.items) {
    if (conflicts.has(activity.id)) continue;
    const previous = found.get(activity.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(activity)) { found.delete(activity.id); conflicts.add(activity.id); warnings.push('Una actividad tiene versiones contradictorias y se excluyó: ' + activity.id); }
    else found.set(activity.id, activity);
  }
  warnings.push(...batch.warnings); return [...found.values()];
}

/** Economic FIFO in USD, before tax treatment. No model prices, guessed fees or account-wide PnL allocation. */
export function buildF5Report(input: Inputs): F5Report {
  const generatedAt = new Date((input.now ?? Date.now)()).toISOString();
  const warnings = ['Contabilidad económica FIFO en USD, no un informe fiscal. Las primas de contratos ejercidos o asignados se muestran separadas del coste de las acciones.',
    'Las comisiones solo son conocidas cuando están publicadas y vinculadas. Una ausencia de cargos no demuestra comisiones finales de cero.',
    'Un promedio de orden sin fecha de ejecución conserva su flujo en «Sin fecha de ejecución»; no se inventa un día de negociación.'];
  const fills = unique(input.fills, warnings), fees = unique(input.fees, warnings), activities = unique(input.activities, warnings);
  const operations = new Map(input.operations.filter(operation => operation.state !== 'preview').map(operation => [operation.id, operation]));
  const contexts = new Map<string, Context>(), operationCycle = new Map<string, Context>(), orderCycle = new Map<string, { context: Context; operation: F5Operation }[]>();
  const symbolCycles = new Map<string, Set<Context>>(), unattributed: F5ReportEvent[] = [], used = new Set<string>();
  const rootOf = (operation: F5Operation): F5Operation | null => {
    const seen = new Set<string>(); let current = operation;
    while (current.parentId) { if (seen.has(current.id)) return null; seen.add(current.id); const parent = operations.get(current.parentId); if (!parent) return null; current = parent; }
    return current.action === 'open' ? current : null;
  };
  for (const operation of operations.values()) {
    const root = rootOf(operation);
    if (!root) { warnings.push('Una operación no tiene una apertura raíz verificable: ' + operation.id); continue; }
    let context = contexts.get(root.id);
    if (!context) {
      context = { row: { id: root.id, strategy: root.strategy, underlying: root.underlying, openedAt: root.createdAt, operationIds: [], state: 'uncertain', metrics: empty(), events: [] }, operations: [], events: [], lots: new Map(), cashKnown: true, fillsKnown: true, settlementsKnown: true, basisKnown: true, marksKnown: true, feesKnown: true, feeOrders: new Set(), filledOrders: new Set(), feeTotal: 0, manualMixed: false };
      contexts.set(root.id, context);
    }
    context.operations.push(operation); context.row.operationIds.push(operation.id); operationCycle.set(operation.id, context);
    for (const leg of operation.legs) { const owners = symbolCycles.get(leg.symbol) ?? new Set(); owners.add(context); symbolCycles.set(leg.symbol, owners); }
    const order = operation.brokerOrder;
    if (order) for (const item of [order, ...(order.legs ?? [])]) {
      const owners = orderCycle.get(item.id) ?? []; owners.push({ context, operation }); orderCycle.set(item.id, owners);
    }
    if (['reserved', 'ambiguous'].includes(operation.state) && !order) { context.cashKnown = false; context.fillsKnown = false; context.row.metrics.warnings.push('Hay un envío reservado o incierto sin ejecución conciliada.'); }
  }
  const ownerOf = (activity: F5AccountingActivity) => activity.orderId ? orderCycle.get(activity.orderId) : undefined;
  const matchedFill = (activity: F5AccountingActivity, operation: F5Operation, symbol: string, id: string) => activity.type === 'FILL' && activity.symbol === symbol && (activity.orderId === id || activity.orderId === operation.brokerOrder?.id);

  for (const context of contexts.values()) {
    context.operations.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const operation of context.operations) {
      const order = operation.brokerOrder;
      if (!order) continue;
      if (order.client_order_id !== operation.clientOrderId) { context.cashKnown = false; context.fillsKnown = false; context.row.metrics.warnings.push('La identidad de una orden no coincide con su registro.'); continue; }
      const parentFilled = number(order.filled_qty);
      if (parentFilled === null || parentFilled < 0 || parentFilled > operation.quantity) { context.cashKnown = false; context.fillsKnown = false; continue; }
      if (parentFilled === 0) continue;
      context.filledOrders.add(order.id);
      const complex = operation.input.order_class === 'mleg';
      const leafOrders: F5BrokerOrder[] = complex ? order.legs ?? [] : [order];
      if (complex && (leafOrders.length !== operation.legs.length || operation.legs.some(leg => !leafOrders.some(item => item.symbol === leg.symbol && item.side === leg.side)))) { context.cashKnown = false; context.fillsKnown = false; context.row.metrics.warnings.push('Faltan piernas confirmadas; no se reconstruyen primas por modelo.'); continue; }
      const details: { order: F5BrokerOrder; symbol: string; side: 'buy' | 'sell'; quantity: number; price: number | null; fills: F5AccountingActivity[]; complete: boolean }[] = [];
      for (const item of leafOrders) {
        const symbol = item.symbol, side = item.side, quantity = number(item.filled_qty);
        if (!symbol || !side || quantity === null || quantity < 0) { context.cashKnown = false; context.fillsKnown = false; continue; }
        const recorded = fills.filter(activity => matchedFill(activity, operation, symbol, item.id) && ownerOf(activity)?.length === 1);
        const valid = recorded.every(activity => activity.quantity !== null && activity.quantity > 0 && activity.price !== null && activity.price >= 0 && activity.side === side && activity.transactionTime !== null);
        const total = recorded.reduce((sum, activity) => sum + (activity.quantity ?? 0), 0);
        details.push({ order: item, symbol, side, quantity, price: number(item.filled_avg_price), fills: recorded, complete: valid && Math.abs(total - quantity) < 1e-8 });
      }
      if (details.length !== leafOrders.length) continue;
      const allPriced = details.every(item => item.complete || item.quantity === 0 || item.price !== null && item.price >= 0);
      const aggregatePrice = number(order.filled_avg_price);
      const aggregate = complex && !allPriced && aggregatePrice !== null;
      if (aggregate) context.events.push({ id: 'order:' + order.id, operationId: operation.id, activityId: null, type: 'order_fill', symbol: null, date: null, quantity: parentFilled, price: aggregatePrice, cashFlowUsd: round(-aggregatePrice * parentFilled * 100), feeUsd: null, source: 'Alpaca Paper net filled_avg_price ' + order.id, known: true, time: operation.createdAt, signed: 0, multiplier: 100, inventory: false, realized: null, reason: 'Prima neta confirmada del conjunto; no hay reparto observado completo entre piernas.' });
      for (const item of details) {
        if (item.quantity === 0) continue;
        const multiplier = f5OptionSymbol.test(item.symbol) ? 100 : 1, direction = item.side === 'buy' ? 1 : -1;
        if (item.complete && !aggregate) {
          for (const activity of item.fills) {
            used.add(activity.id);
            context.events.push(event(activity, 'fill', operation.id, { quantity: activity.quantity, cashFlowUsd: round(-direction * activity.quantity! * activity.price! * multiplier), known: true, signed: direction * activity.quantity!, multiplier, inventory: true }));
          }
        } else {
          const known = item.price !== null && item.price >= 0;
          context.events.push({ id: 'order:' + item.order.id, operationId: operation.id, activityId: null, type: 'order_fill', symbol: item.symbol, date: null, quantity: item.quantity, price: known ? item.price : null,
            cashFlowUsd: aggregate ? 0 : known ? round(-direction * item.quantity * item.price! * multiplier) : null, feeUsd: null, source: 'Alpaca Paper cumulative fill ' + item.order.id, known: known || aggregate, time: operation.createdAt, signed: direction * item.quantity, multiplier, inventory: true, realized: null,
            reason: aggregate ? 'Cantidad confirmada; la prima de esta pierna no se inventa a partir del neto.' : 'Promedio acumulado confirmado; no hay detalle completo de fechas de ejecución.' });
          for (const activity of item.fills) used.add(activity.id); // covered by this cumulative snapshot, not counted twice
          if (!known && !aggregate) context.cashKnown = false;
          if (!known) context.basisKnown = false;
        }
      }
      if (!input.fills?.complete) context.row.metrics.warnings.push('El detalle histórico de fills es parcial o no fue consultado; se usan promedios confirmados cuando están disponibles.');
    }
  }

  // External fills are never silently allocated to an F5 cycle. A matching symbol
  // traded outside the ledger after its opening invalidates attribution/marks.
  for (const activity of fills) if (!used.has(activity.id)) {
    unattributed.push(publicEvent(event(activity, 'unattributed', null, { reason: 'El fill no tiene un ID de orden F5 inequívoco o no coincide con su ejecución.' })));
    for (const context of symbolCycles.get(activity.symbol ?? '') ?? []) if ((activity.transactionTime ?? activity.date ?? '') >= context.row.openedAt.slice(0, 10)) {
      context.manualMixed = true; context.row.metrics.warnings.push('Hay ejecuciones externas sobre un instrumento del ciclo; no se atribuye su coste o valor automáticamente.');
    }
  }

  const settled = new Set<string>();
  for (const activity of activities.filter(item => ['OPASN', 'OPEXC', 'OPEXP'].includes(item.type))) {
    const candidates = [...(symbolCycles.get(activity.symbol ?? '') ?? [])].filter(context => (activity.date ?? '') >= context.row.openedAt.slice(0, 10));
    if (candidates.length !== 1 || activity.quantity === null || activity.quantity === 0 || activity.status && activity.status !== 'executed') {
      unattributed.push(publicEvent(event(activity, 'unattributed', null, { reason: 'No se pudo vincular el evento a un único contrato y ciclo F5.' }))); continue;
    }
    const context = candidates[0], symbol = activity.symbol!;
    const opening = context.operations.find(operation => operation.legs.some(leg => leg.symbol === symbol));
    if (!opening) continue;
    const openingLeg = opening.legs.find(leg => leg.symbol === symbol)!;
    const type = activity.type === 'OPASN' ? 'assignment' : activity.type === 'OPEXC' ? 'exercise' : 'expiration';
    const closeDirection = activity.type === 'OPASN' ? 1 : activity.type === 'OPEXC' ? -1 : openingLeg.side === 'sell' ? 1 : -1;
    context.events.push(event(activity, type, opening.id, { cashFlowUsd: activity.netAmount ?? (activity.type === 'OPEXP' ? 0 : null), signed: closeDirection * Math.abs(activity.quantity), multiplier: 100, price: 0, inventory: true, known: activity.netAmount !== null || activity.type === 'OPEXP' }));
    settled.add(activity.id);
    if (activity.type === 'OPEXP') continue;
    // A shared date or similar cash amount is insufficient. Require an actual
    // group/reference, then cross-check the equity quantity, strike and cash.
    const related = activities.filter(item => item.type === 'OPTRD' && item.symbol === context.row.underlying && (activity.groupId !== null && item.groupId === activity.groupId || item.relatedActivityId === activity.id || item.optionSymbol === symbol));
    const occ = symbol.match(/(\d{6})([CP])(\d{8})$/), strike = occ ? Number(occ[3]) / 1000 : NaN;
    const equityDirection = activity.type === 'OPASN' ? occ?.[2] === 'P' ? 1 : -1 : occ?.[2] === 'C' ? 1 : -1;
    const expectedQuantity = equityDirection * Math.abs(activity.quantity) * 100;
    if (related.length !== 1 || related[0].quantity !== expectedQuantity || related[0].price !== strike || related[0].netAmount === null || Math.abs(related[0].netAmount! + expectedQuantity * strike) > 0.011 || related[0].status && related[0].status !== 'executed' || settled.has(related[0].id)) {
      context.settlementsKnown = false; context.cashKnown = false; context.row.metrics.warnings.push('La asignación/ejercicio no tiene una entrega de acciones vinculada y verificable; no se infiere por fecha o importe.'); continue;
    }
    const stock = related[0]; settled.add(stock.id);
    context.events.push(event(stock, 'settlement', opening.id, { cashFlowUsd: stock.netAmount, signed: expectedQuantity, quantity: Math.abs(expectedQuantity), price: strike, multiplier: 1, inventory: true, known: true }));
  }
  for (const activity of activities) if (!settled.has(activity.id)) unattributed.push(publicEvent(event(activity, 'unattributed', null, { reason: 'Actividad del bróker sin referencia inequívoca al ciclo; no se incorpora al PnL.' })));

  for (const activity of fees) {
    let owners = ownerOf(activity);
    if (!owners?.length && activity.groupId) {
      const links = fills.filter(fill => fill.groupId === activity.groupId).flatMap(fill => ownerOf(fill) ?? []);
      const unique = new Map(links.map(link => [link.operation.id, link])); owners = [...unique.values()];
    }
    if (owners?.length !== 1 || activity.netAmount === null || activity.currency !== null && activity.currency !== 'USD' || activity.status && activity.status !== 'executed') {
      unattributed.push(publicEvent(event(activity, 'unattributed', null, { reason: 'El cargo no tiene importe USD e ID de orden/grupo atribuible a un único ciclo; no se reparte por fecha.' }))); continue;
    }
    const { context, operation } = owners[0];
    const amount = round(-activity.netAmount);
    context.feeTotal += amount; if (operation.brokerOrder) context.feeOrders.add(operation.brokerOrder.id);
    context.events.push(event(activity, 'fee', operation.id, { feeUsd: amount, cashFlowUsd: 0, known: true }));
  }

  for (const context of contexts.values()) {
    context.events.sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
    for (const item of context.events.filter(item => item.inventory && item.symbol)) {
      const lots = context.lots.get(item.symbol!) ?? [], signed = item.signed; let remainder = Math.abs(signed), realized = 0, known = true;
      const direction = Math.sign(signed);
      while (remainder > 1e-8 && lots.length && Math.sign(lots[0].quantity) !== direction) {
        const lot = lots[0], count = Math.min(remainder, Math.abs(lot.quantity));
        if (lot.price === null || item.price === null) known = false;
        else realized += count * (item.price - lot.price) * Math.sign(lot.quantity) * item.multiplier;
        lot.quantity += direction * count; remainder -= count;
        if (Math.abs(lot.quantity) < 1e-8) lots.shift();
      }
      if (remainder > 1e-8) {
        if (['assignment', 'exercise', 'expiration'].includes(item.type)) { context.settlementsKnown = false; known = false; context.row.metrics.warnings.push('El evento de opciones excede el saldo atribuible del contrato.'); }
        else lots.push({ quantity: direction * remainder, price: item.price });
      }
      context.lots.set(item.symbol!, lots); item.realized = known ? round(realized) : null;
      if (!known) context.basisKnown = false;
    }
    let marketValue = 0, unrealized = 0;
    for (const [symbol, lots] of context.lots) {
      const quantity = round(lots.reduce((sum, lot) => sum + lot.quantity, 0));
      if (quantity === 0) continue;
      const positions = input.positions.filter(position => position.symbol === symbol), owners = symbolCycles.get(symbol);
      const held = positions[0];
      if (positions.length !== 1 || !held || held.quantity !== quantity || held.marketValue === null || !Number.isFinite(held.marketValue) || context.manualMixed || owners && owners.size !== 1) {
        context.marksKnown = false; context.row.metrics.warnings.push('El valor de mercado de ' + symbol + ' no puede aislarse de posiciones ajenas o cambios externos.'); continue;
      }
      marketValue += held.marketValue;
      if (lots.some(lot => lot.price === null)) context.basisKnown = false;
      else unrealized += held.marketValue - lots.reduce((sum, lot) => sum + lot.quantity * lot.price! * (f5OptionSymbol.test(symbol) ? 100 : 1), 0);
    }
    const observedCash = round(context.events.reduce((sum, item) => sum + (item.cashFlowUsd ?? 0), 0));
    const flat = [...context.lots.values()].every(lots => lots.every(lot => Math.abs(lot.quantity) < 1e-8));
    const pending = context.operations.some(operation => ['reserved', 'submitted', 'partial', 'ambiguous'].includes(operation.state));
    context.feesKnown = !!input.fees?.complete && [...context.filledOrders].every(id => context.feeOrders.has(id));
    if (!context.feesKnown) context.row.metrics.warnings.push('Comisiones completas desconocidas: se muestran únicamente cargos publicados y vinculados.');
    if (!input.activities?.complete && context.events.some(item => item.type === 'assignment' || item.type === 'exercise' || item.type === 'expiration')) context.settlementsKnown = false;
    if (context.manualMixed) { context.basisKnown = false; context.marksKnown = false; }
    const cashKnown = context.cashKnown && context.events.every(item => item.cashFlowUsd !== null), allKnown = cashKnown && context.settlementsKnown && context.marksKnown;
    // Flat completed cycles can be valued from observed net order cash without
    // pretending an observed net spread premium was a price for each leg.
    const gross = allKnown ? round(observedCash + marketValue) : null;
    const realized = allKnown && flat ? gross : allKnown && context.basisKnown ? round(context.events.reduce((sum, item) => sum + (item.realized ?? 0), 0)) : null;
    const m = context.row.metrics;
    m.cashFlowUsd = cashKnown ? observedCash : null; m.observedCashFlowUsd = observedCash; m.observedFeesUsd = round(context.feeTotal);
    m.grossPnlUsd = gross; m.realizedPnlUsd = realized; m.unrealizedPnlUsd = allKnown && flat ? 0 : allKnown && context.basisKnown ? round(unrealized) : null;
    m.feesUsd = context.feesKnown ? round(context.feeTotal) : null; m.netPnlUsd = gross !== null && m.feesUsd !== null ? round(gross - m.feesUsd) : null;
    m.coverage = { fills: !context.fillsKnown ? 'unknown' : input.fills?.complete ? 'complete' : 'partial', fees: context.feesKnown ? 'complete' : context.feeOrders.size ? 'partial' : 'unknown', settlements: context.settlementsKnown ? 'complete' : 'partial', positions: context.marksKnown ? 'complete' : 'unknown' };
    m.warnings = [...new Set(m.warnings)]; context.row.events = context.events.map(publicEvent);
    context.row.state = !allKnown || pending ? 'uncertain' : flat ? 'closed' : 'open';
  }
  const cycles = [...contexts.values()].map(context => context.row).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const strategies = [...new Set(cycles.map(cycle => cycle.strategy))].map(strategy => { const rows = cycles.filter(cycle => cycle.strategy === strategy); return { strategy, cycleCount: rows.length, metrics: combined(rows.map(row => row.metrics)) }; });
  const dailyDates = new Set([...contexts.values()].flatMap(context => context.events.map(item => item.date ?? 'Sin fecha de ejecución')));
  const daily = [...dailyDates].sort().map(date => {
    const all = [...contexts.values()].flatMap(context => context.events.filter(item => (item.date ?? 'Sin fecha de ejecución') === date)), metrics = empty();
    metrics.observedCashFlowUsd = round(all.reduce((sum, item) => sum + (item.cashFlowUsd ?? 0), 0)); metrics.observedFeesUsd = round(all.reduce((sum, item) => sum + (item.feeUsd ?? 0), 0));
    metrics.cashFlowUsd = all.every(item => item.cashFlowUsd !== null) ? metrics.observedCashFlowUsd : null;
    metrics.realizedPnlUsd = all.some(item => item.inventory && item.realized === null) ? null : round(all.reduce((sum, item) => sum + (item.realized ?? 0), 0));
    metrics.unrealizedPnlUsd = null; metrics.grossPnlUsd = null; metrics.netPnlUsd = null; metrics.feesUsd = null;
    metrics.coverage = { fills: input.fills?.complete ? 'complete' : 'partial', fees: 'unknown', settlements: input.activities?.complete ? 'complete' : 'partial', positions: 'unknown' };
    metrics.warnings = ['Sin instantáneas históricas de mercado, no se inventa PnL no realizado diario. Las comisiones diarias son el subconjunto observado.']; return { date, metrics };
  });
  return { generatedAt, currency: 'USD', source: 'Alpaca Paper: cumulative order fills, account activities and current positions', totals: combined(cycles.map(cycle => cycle.metrics)), cycles, strategies, daily, unattributed, warnings: [...new Set(warnings)] };
}
