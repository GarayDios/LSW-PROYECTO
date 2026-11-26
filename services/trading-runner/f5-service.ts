import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BrokerError } from '../../src/api/brokers/alpaca/client.ts';
import { openingLegs, parseF5Request, requiredOptionsLevel } from '../../src/features/f5/validation.ts';
import type { AlpacaOptionsClient } from '../../src/api/brokers/alpaca/options.ts';
import type { F5Account, F5AutomationPlan, F5BrokerOrder, F5Contract, F5Control, F5ControlEvent, F5Leg, F5Operation, F5OrderInput, F5Position, F5Request, F5Status, F5Feed } from '../../src/features/f5/types.ts';
import type { F5Store } from './f5-store.ts';
import { executed, f5Residual, parsePlan, riskSettingsSchema } from './f5-model.ts';
import { enforceF5Risk, measureF5Risk } from '../../src/cores/06-gestion-de-riesgos/f5-risk.ts';
import { buildF5Report } from './f5-report.ts';
import { dailyRiskResetSchema } from '../../src/features/f5/risk-reset.ts';

export type F5Broker = Pick<AlpacaOptionsClient, 'account' | 'clock' | 'contract' | 'positions' | 'orders' | 'activities' | 'orderByClientId' | 'submit' | 'cancel'> & Partial<Pick<AlpacaOptionsClient, 'stockQuote'|'fillActivities'|'feeActivities'|'optionActivities'>> & {
  contracts(underlying:string,expiry?:string):Promise<{contracts:F5Contract[];complete:boolean;feed:F5Feed}>;
  preview?(input:F5OrderInput):Promise<void>;
  activitiesComplete?():boolean;
};
type Options = { store: F5Store; broker: F5Broker | null; ownerId: string; enabled: boolean; automationEnabled?: boolean; feed?: F5Feed; provider?:'alpaca'|'webull'; now?: () => number; reservedShares?: (underlying: string) => number; onEvent?: (event: F5ControlEvent) => void };
type Result = { status: number; value: unknown };
const unresolved = (operation: F5Operation) => ['reserved', 'submitted', 'partial', 'ambiguous'].includes(operation.state);
const identifier = z.string().uuid();
const submittedBody = z.object({ previewId: identifier }).strict();
const canceledBody = z.object({ operationId: identifier }).strict();
const realDate = (time: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
function fail(code: string, message: string, status = 409): never { throw new BrokerError(code, status, message, false); }
const numeric = (value: unknown) => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : NaN;
const precision = (value: number) => Math.round(value * 100) / 100;
const cash = (value: number) => `$${value.toFixed(2)}`;
function flatten(orders: F5BrokerOrder[]): F5BrokerOrder[] { return orders.flatMap(order => [order, ...flatten(order.legs ?? [])]); }
function accountReady(account: F5Account, level: number) {
  if (account.blocked || account.status !== 'ACTIVE' && !(account.status==='OPENAPI_VERIFIED'&&account.optionsPermissionSource==='preview')) fail('f5_account_blocked', 'La cuenta de pruebas está bloqueada o no está verificada.');
  if (account.optionsPermissionSource!=='preview' && (account.optionsLevel===null||account.optionsLevel < level)) fail('f5_options_permission', `La operación necesita nivel ${level} de opciones habilitado en la cuenta.`);
  if (![account.cash, account.buyingPower, account.optionsBuyingPower, account.equity].every(Number.isFinite)) fail('f5_account_uncertain', 'No se pudo verificar el capital de la cuenta Paper.');
}
function quoteReady(contract: F5Contract, time: number, feed: F5Feed) {
  const quoteTime = contract.quoteTime ? Date.parse(contract.quoteTime) : NaN;
  // Indicative is delayed and altered. Its provenance is shown in every review.
  const maxAge = feed === 'opra' ? 60000 : 20 * 60000;
  if (contract.bid === null || contract.ask === null || !Number.isFinite(contract.bid) || !Number.isFinite(contract.ask) || contract.bid < 0 || contract.ask <= 0 || contract.bid > contract.ask || !Number.isFinite(quoteTime) || time - quoteTime > maxAge || quoteTime > time + 5000) {
    fail('f5_quote_unavailable', `No hay una cotización válida y reciente para ${contract.symbol}. Actualiza los contratos.`);
  }
}
function closeLegs(legs: F5Leg[]): F5Leg[] {
  return legs.map(leg => ({ ...leg, side: leg.side === 'buy' ? 'sell' : 'buy', intent: leg.side === 'buy' ? 'sell_to_close' : 'buy_to_close' }));
}
function orderInput(legs: F5Leg[], quantity: number, limitPrice: number, clientId: string): F5OrderInput {
  const base = { client_order_id: clientId, qty: String(quantity), type: 'limit' as const, time_in_force: 'day' as const, limit_price: limitPrice.toFixed(2) };
  return legs.length === 1 ? { ...base, symbol: legs[0].symbol, side: legs[0].side, position_intent: legs[0].intent }
    : { ...base, order_class: 'mleg', legs: legs.map(leg => ({ symbol: leg.symbol, side: leg.side, ratio_qty: String(leg.ratio), position_intent: leg.intent })) };
}

/** A submitted request is durably consumed before the only permitted POST. */
export function createF5Service(options: Options) {
  const now = options.now ?? Date.now, feed = options.feed ?? 'indicative', store = options.store;
  const provider=options.provider??'alpaca',label=provider==='webull'?'Webull Sandbox':'Alpaca Paper';
  const broker = () => options.broker ?? fail('f5_not_configured', `Configura ${label} en el servicio para consultar y operar F5.`, 503);
  const get = (id: string) => store.get(options.ownerId, id) ?? fail('f5_operation_not_found', 'La operación F5 no existe en esta cuenta.', 404);
  function event(status: F5ControlEvent['status'], message: string, planId?: string, operationId?: string, key?: string) {
    const value: F5ControlEvent = { id: randomUUID(), time: new Date(now()).toISOString(), status, message, ...(planId ? { planId } : {}), ...(operationId ? { operationId } : {}) };
    if (store.event(options.ownerId, value, key ?? `${planId ?? 'manual'}:${operationId ?? ''}:${status}:${Math.floor(now() / 900000)}:${message}`)) options.onEvent?.(value);
  }
  async function measure(account: F5Account, positions: F5Position[]) {
    const risk = await measureF5Risk({ account, positions, operations: store.list(options.ownerId), settings: store.settings(options.ownerId), previous: store.risk(options.ownerId), time: now(), feed, contract: symbol => broker().contract(symbol) });
    store.setRisk(options.ownerId, risk); return risk;
  }

  function matchingResponse(operation: F5Operation, order: F5BrokerOrder): F5Operation {
    if (order.client_order_id !== operation.clientOrderId || numeric(order.qty) !== operation.quantity || order.type !== 'limit' || order.time_in_force !== 'day' || numeric(order.limit_price) !== operation.limitPrice || operation.brokerOrder?.id && operation.brokerOrder.id !== order.id) {
      fail('f5_order_identity_uncertain', 'El bróker devolvió una orden que no coincide con la revisión. Revisa la cuenta Paper.');
    }
    if (operation.input.order_class === 'mleg') {
      const legs = order.legs;
      if (order.order_class !== 'mleg' || !legs || legs.length !== operation.legs.length || new Set(legs.map(leg => leg.symbol)).size !== legs.length) fail('f5_order_legs_uncertain', 'No se pudieron verificar todas las piernas de la orden combinada.');
      for (const expected of operation.legs) {
        const found = legs.find(leg => leg.symbol === expected.symbol);
        if (!found || found.side !== expected.side || found.position_intent !== expected.intent || numeric(found.ratio_qty) !== expected.ratio || numeric(found.qty) !== operation.quantity * expected.ratio) fail('f5_order_legs_uncertain', 'Las piernas del bróker no coinciden con la revisión.');
      }
    } else {
      const intentMatches = operation.action === 'hedge'
        ? order.position_intent == null || order.position_intent === (operation.input.side === 'buy' ? 'buy_to_open' : 'sell_to_close')
        : order.position_intent === operation.input.position_intent;
      if (order.symbol !== operation.input.symbol || order.side !== operation.input.side || !intentMatches || order.legs?.length || order.order_class && order.order_class !== 'simple') fail('f5_order_identity_uncertain', 'La dirección o el contrato de la orden no coincide.');
    }
    const filled = numeric(order.filled_qty);
    if (!Number.isInteger(filled) || filled < 0 || filled > operation.quantity) fail('f5_order_fill_uncertain', 'La cantidad ejecutada no es coherente con la orden.');
    if (operation.brokerOrder && filled < numeric(operation.brokerOrder.filled_qty)) fail('f5_order_fill_uncertain', 'El bróker corrigió una ejecución anterior. Revisa la cuenta antes de continuar.');
    let state: F5Operation['state'];
    if (order.status === 'filled') {
      if (filled !== operation.quantity || order.legs?.some(leg => numeric(leg.filled_qty) !== operation.quantity * (operation.legs.find(expected => expected.symbol === leg.symbol)?.ratio ?? 0))) fail('f5_order_fill_uncertain', 'El bróker no confirmó la ejecución completa de todas las piernas.');
      state = 'filled';
    } else if (order.status === 'partially_filled') {
      if (filled <= 0 || filled >= operation.quantity) fail('f5_order_fill_uncertain', 'La ejecución parcial no tiene una cantidad válida.');
      state = 'partial';
    } else if (order.status === 'canceled') state = 'canceled';
    else if (order.status === 'rejected') state = 'rejected';
    else if (order.status === 'expired' || order.status === 'done_for_day') state = 'expired';
    else if (['new', 'accepted', 'pending_new', 'accepted_for_bidding', 'pending_cancel', 'held', 'stopped', 'suspended', 'calculated'].includes(order.status)) state = filled > 0 ? 'partial' : 'submitted';
    else state = 'ambiguous';
    return { ...operation, state, brokerOrder: order, message: state === 'ambiguous' ? 'Estado del bróker desconocido. Revisa la cuenta antes de continuar.' : `${label}: ${order.status}. Ejecutadas ${filled} de ${operation.quantity} unidades.` };
  }

  async function reconcileOne(operation: F5Operation): Promise<F5Operation> {
    if (!unresolved(operation)) return operation;
    try {
      const order = await broker().orderByClientId(operation.clientOrderId);
      const updated = order ? matchingResponse(operation, order) : { ...operation, state: 'ambiguous' as const, message: 'No se confirmó la orden reservada. Se conserva el identificador y no se repetirá el envío.' };
      store.update(options.ownerId, updated);
      if (updated.state !== operation.state || updated.brokerOrder?.filled_qty !== operation.brokerOrder?.filled_qty) event(updated.state === 'reserved' || updated.state === 'preview' ? 'info' : updated.state, updated.message ?? 'Estado F5 actualizado.', updated.planId, updated.id, `${updated.id}:${updated.state}:${updated.brokerOrder?.filled_qty ?? '0'}`);
      return updated;
    } catch (error) {
      const updated = { ...operation, state: 'ambiguous' as const, message: error instanceof BrokerError ? error.message : 'No se pudo conciliar la orden. No se repetirá el envío.' };
      store.update(options.ownerId, updated); return updated;
    }
  }
  async function reconcile() {
    for (const operation of store.list(options.ownerId)) if (unresolved(operation)) await reconcileOne(operation);
  }
  function activeChildren(parentId: string) {
    return store.list(options.ownerId).filter(operation => operation.parentId === parentId && (unresolved(operation) || numeric(operation.brokerOrder?.filled_qty) > 0));
  }
  function confirmedHedge(parentId: string): number {
    return store.list(options.ownerId).filter(operation => operation.parentId === parentId && operation.action === 'hedge').reduce((total, operation) => {
      const filled = operation.brokerOrder ? numeric(operation.brokerOrder.filled_qty) : 0;
      if (!Number.isFinite(filled)) fail('f5_hedge_uncertain', 'No se puede verificar la cobertura en acciones de este ciclo.');
      return total + filled * (operation.input.side === 'buy' ? 1 : -1);
    }, 0);
  }

  async function prepare(request: F5Request, existing?: F5Operation): Promise<F5Operation> {
    if(provider==='webull'&&request.action==='roll'&&!request.step)request={...request,step:'close-short'};
    const api = broker(), time = now();
    const [account, marketOpen, positions, openOrders, activities] = await Promise.all([api.account(), api.clock(), api.positions(), api.orders(), api.activities()]);
    if(account.optionsPermissionSource==='preview'&&!api.preview)fail('f5_options_permission','El adaptador no dispone de una revisión verificable de permisos.');
    if (flatten(openOrders).length) fail('f5_pending_broker_orders', 'Hay órdenes pendientes en la cuenta Paper. Concílialas o cancélalas antes de preparar otra operación F5.');
    const others = store.list(options.ownerId).filter(operation => operation.id !== existing?.id && unresolved(operation));
    if (others.length) fail('f5_pending_operations', 'Hay operaciones F5 pendientes o sin confirmar. Actualiza su estado antes de enviar otra.');
    let strategy: F5Operation['strategy'], underlying: string, legs: F5Leg[], quantity: number, parentId: string | undefined;
    let contracts: F5Contract[] = [], reserve = 0;
    const warnings = [`Las órdenes se envían exclusivamente a ${label} con saldo de práctica.`,
      feed === 'webull-sandbox' ? 'Webull Sandbox: precios retrasados de pruebas; la fecha del contrato y la validación del proveedor se conservan.' : feed === 'indicative' ? 'Feed indicative: cotizaciones modificadas y retrasadas; no son precios OPRA ejecutables. El límite lo confirmas tú.' : 'Cotización OPRA observada; un precio mostrado no garantiza ejecución.',
      `${label} decide la aceptación, ejecución, vencimiento, ejercicio y asignación; el terminal no los inventa.`];
    if (request.action === 'open') {
      strategy = request.strategy; underlying = request.underlying; quantity = request.quantity;
      contracts = await Promise.all(request.contracts.map(symbol => api.contract(symbol)));
      legs = openingLegs(request, contracts, realDate(time));
      accountReady(account, requiredOptionsLevel(strategy));
      contracts.forEach(contract => quoteReady(contract, time, feed));
      for (const position of positions.filter(position => position.assetClass === 'us_option' && position.quantity !== 0)) {
        const held = await api.contract(position.symbol);
        if (held.underlying === underlying) fail('f5_existing_option_position', 'Ya hay contratos abiertos de esta empresa en el bróker, incluidos posibles restos parciales. Resuélvelos antes de abrir otro ciclo F5.');
      }
      const debit = request.limitPrice * quantity * 100;
      if (strategy === 'wheel') {
        if (request.limitPrice <= 0) fail('f5_invalid_limit', 'La prima límite de una sola opción debe ser positiva.');
        if (contracts[0].type === 'put') reserve = contracts[0].strike * quantity * 100;
        else {
          const allShares = positions.find(position => position.symbol === underlying && position.assetClass === 'us_equity')?.quantity ?? 0;
          const reservedShares = options.reservedShares?.(underlying) ?? 0;
          if (!Number.isFinite(reservedShares) || reservedShares < 0) fail('f5_share_reservation_uncertain', 'No se pudo verificar la reserva de acciones de otros planes.');
          const shares = allShares - reservedShares;
          let allocated = 0;
          for (const position of positions.filter(position => position.assetClass === 'us_option' && position.quantity < 0)) {
            const held = await api.contract(position.symbol);
            if (held.underlying === underlying && held.type === 'call') allocated += Math.abs(position.quantity) * held.size;
          }
          if (shares - allocated < quantity * 100) fail('f5_uncovered_call', 'La call Wheel necesita 100 acciones disponibles por contrato, además de las que ya cubren otras calls.');
          reserve = 0;
          warnings.push('Las acciones de cobertura deben permanecer en la cuenta hasta cerrar la call o recibir la decisión del bróker.');
        }
      } else if (strategy === 'pmcc') {
        if (request.limitPrice <= 0) fail('f5_invalid_limit', 'PMCC necesita un débito límite positivo.');
        reserve = debit + contracts[1].strike * quantity * 100;
        warnings.push('Reserva conservadora: débito más el nominal de la call corta para afrontar asignaciones. La call larga no es una acción entregable automática.');
      } else if (strategy === 'backspread') {
        reserve = Math.max(0, (contracts[1].strike - contracts[0].strike + request.limitPrice) * quantity * 100);
        warnings.push('El riesgo entre strikes incluye la prima neta; el bróker puede rechazar una combinación que no admita.');
      } else {
        if (request.limitPrice <= 0) fail('f5_invalid_limit', 'El straddle Gamma necesita un débito límite positivo.');
        reserve = debit;
        warnings.push('Gamma abre call y put juntas. Las coberturas en acciones se revisan después de la ejecución; no hay rebalanceo automático ni ventas de acciones en corto.');
      }
      if (store.list(options.ownerId).some(operation => operation.action === 'open' && operation.underlying === underlying && operation.state === 'filled'
        && (operation.legs.some(leg => positions.some(position => position.symbol === leg.symbol && position.quantity !== 0)) || confirmedHedge(operation.id) !== 0)
        && !store.list(options.ownerId).some(child => child.parentId === operation.id && child.action === 'close' && child.state === 'filled'))) {
        // Distinct cycles cannot silently share the same broker positions/collateral.
        fail('f5_existing_underlying_cycle', 'Ya hay una apertura F5 registrada para esta empresa. Ciérrala o revisa su vencimiento/asignación antes de iniciar otra.');
      }
    } else {
      const parent = get(request.operationId);
      if (parent.action !== 'open' || !parent.brokerOrder || executed(parent) <= 0 || !Number.isFinite(executed(parent))) fail('f5_open_not_filled', 'Primero debe existir una ejecución confirmada de la apertura en el bróker.');
      const residual = f5Residual(parent, store.list(options.ownerId), positions, activities, time);
      strategy = parent.strategy; underlying = parent.underlying; parentId = parent.id; quantity = residual.quantity;
      accountReady(account, 1);
      if (request.action === 'close') {
        if (residual.lifecycle.hedgeShares !== 0) fail('f5_hedge_not_flat', 'Cierra primero la cobertura en acciones de Gamma con una orden revisada.');
        if (!residual.lifecycle.canClose) fail(residual.lifecycle.phase === 'uncertain' ? 'f5_position_missing' : 'f5_child_operation_exists', residual.lifecycle.reason ?? 'No hay un residuo confirmado disponible para cerrar.');
        legs = residual.legs;
        contracts = await Promise.all(legs.map(leg => api.contract(leg.symbol)));
        contracts.forEach(contract => {
          if (!contract.tradable || contract.expiry < realDate(time)) fail('f5_contract_unavailable', 'El contrato ya no está disponible para un cierre desde el terminal. Revisa Alpaca.');
          quoteReady(contract, time, feed);
        });
        for (const leg of legs) {
          const position = positions.find(position => position.symbol === leg.symbol && position.assetClass === 'us_option');
          const available = leg.side === 'sell' ? position?.quantity ?? 0 : -(position?.quantity ?? 0);
          if (available !== quantity * leg.ratio) fail('f5_position_missing', 'Las posiciones del bróker no coinciden exactamente con este ciclo: cambiaron, vencieron o fueron asignadas. Revisa la cuenta antes de cerrar.');
        }
        if (legs.length === 1 && request.limitPrice <= 0) fail('f5_invalid_limit', 'La prima de cierre de una sola opción debe ser positiva.');
        reserve = legs.length === 1 ? (legs[0].side === 'buy' ? request.limitPrice * quantity * 100 : 0) : Math.max(0, request.limitPrice * quantity * 100);
      } else if (request.action === 'roll') {
        if (!residual.lifecycle.canRoll || strategy !== 'pmcc') fail('f5_roll_unavailable', 'El ciclo PMCC necesita una call larga y una corta confirmadas para rolar.');
        accountReady(account, 3);
        if(provider!=='webull'&&request.step)fail('f5_roll_invalid','Las etapas de renovación corresponden a Webull; Alpaca usa una sola revisión combinada.');
        const staged=provider==='webull',openingShort=staged&&request.step==='open-short';
        if(staged&&openingShort!==(residual.lifecycle.rollPhase==='open-short'))fail('f5_roll_invalid','Primero debe confirmarse el cierre de la call corta anterior. Después revisa y confirma la nueva apertura.');
        const closed=store.list(options.ownerId).find(op=>op.parentId===parent.id&&op.action==='roll'&&op.request.action==='roll'&&op.request.step==='close-short'&&op.state==='filled');
        const shortSymbol = residual.lifecycle.shortContract??closed?.legs[0]?.symbol;
        if(!shortSymbol)fail('f5_roll_invalid','No se confirmó la call corta anterior.');
        const longSymbol = [...residual.vector].find(([, count]) => count > 0)![0];
        const [long, old, replacement] = await Promise.all([api.contract(longSymbol), openingShort?Promise.resolve(null):api.contract(shortSymbol), api.contract(request.newShortContract)]);
        for (const item of [long, ...(old?[old]:[]), replacement]) quoteReady(item, time, feed);
        const encodedDate=shortSymbol.slice(-15,-9),oldExpiry=old?.expiry??`20${encodedDate.slice(0,2)}-${encodedDate.slice(2,4)}-${encodedDate.slice(4,6)}`;
        if (replacement.symbol === shortSymbol || replacement.underlying !== underlying || replacement.type !== 'call' || replacement.style !== 'american' || replacement.size !== 100 || !replacement.tradable || replacement.expiry <= oldExpiry || replacement.expiry >= long.expiry || replacement.strike < long.strike || (positions.find(position => position.symbol === replacement.symbol)?.quantity ?? 0) !== 0) fail('f5_roll_invalid', 'La nueva call corta debe ser distinta, americana, del mismo subyacente, posterior a la corta y anterior a la larga, con strike cubierto.');
        if (!openingShort&&residual.vector.get(longSymbol) !== -residual.vector.get(shortSymbol)!) fail('f5_roll_invalid', 'El residuo PMCC no conserva una proporción 1:1 verificable.');
        quantity = Math.abs(residual.vector.get(openingShort?longSymbol:shortSymbol)!);
        legs = staged?openingShort?[{symbol:replacement.symbol,side:'sell',ratio:1,intent:'sell_to_open'}]:[{symbol:shortSymbol,side:'buy',ratio:1,intent:'buy_to_close'}]:[{ symbol: shortSymbol, side: 'buy', ratio: 1, intent: 'buy_to_close' }, { symbol: replacement.symbol, side: 'sell', ratio: 1, intent: 'sell_to_open' }];
        contracts = staged?[openingShort?replacement:old!]:[old!, replacement];
        if(staged&&request.limitPrice<=0)fail('f5_invalid_limit','Cada etapa Webull usa una prima positiva; el lado distingue compra y venta.');
        reserve = staged?(openingShort?replacement.strike:request.limitPrice)*quantity*100:Math.max(0, request.limitPrice * quantity * 100) + replacement.strike * quantity * 100;
        warnings.push(staged?'Renovación Webull en dos etapas manuales: primero cerrar la call corta, conservar la larga y esperar la ejecución; después revisar y confirmar la nueva venta cubierta por la larga. No se envía la segunda etapa automáticamente.':'El roll viaja en una sola orden combinada. El bróker puede rechazar la cobertura externa; nunca se enviarán las piernas por separado.');
      } else {
        if (strategy !== 'gamma') fail('f5_hedge_strategy', 'Solo un straddle Gamma confirmado admite esta cobertura.');
        if (!residual.lifecycle.canHedge) fail('f5_position_missing', residual.lifecycle.reason ?? 'No existe una cobertura o posición Gamma verificable.');
        quantity = request.quantity;
        const owned = residual.lifecycle.hedgeShares, stock = positions.find(position => position.symbol === underlying && position.assetClass === 'us_equity');
        const change = request.side === 'buy' ? quantity : -quantity;
        if (quantity > parent.quantity * 100 || owned + change < 0 || owned + change > parent.quantity * 100) fail('f5_short_hedge_disabled', 'La cobertura se limita a acciones enteras compradas por este ciclo; no admite ventas en corto ni vender acciones manuales.');
        if (request.side === 'sell' && (!stock || stock.quantity < (parent.stockBaseline ?? 0) + owned)) fail('f5_hedge_position_missing', 'Las acciones actuales no cubren la posición manual inicial y toda la cobertura atribuida al ciclo.');
        const unwind = request.side === 'sell' && quantity <= owned;
        contracts = unwind ? [] : await Promise.all([...residual.vector].filter(([, qty]) => qty !== 0).map(([symbol]) => api.contract(symbol)));
        let netDelta = owned;
        for (const [index, contract] of contracts.entries()) {
          quoteReady(contract, time, feed);
          if (contract.delta === null || !Number.isFinite(contract.delta) || contract.expiry <= realDate(time)) fail('f5_delta_unavailable', 'No hay delta observada vigente para revisar la cobertura Gamma.');
          const held = positions.find(position => position.symbol === contract.symbol && position.assetClass === 'us_option');
          if (!held || held.quantity !== residual.vector.get(contract.symbol)) fail('f5_position_missing', 'El straddle ya no coincide exactamente con este ciclo en el bróker; revisa movimientos, vencimientos o asignaciones.');
          netDelta += contract.delta * held.quantity * 100;
        }
        // Unwinding attributed shares is always available; opening/increasing a
        // hedge must reduce the absolute observed delta, rounded to whole shares.
        if (!unwind && Math.abs(netDelta + change) > Math.abs(netDelta) + 0.5) fail('f5_hedge_increases_delta', 'La cantidad y dirección elegidas aumentan la delta neta. Revisa la cobertura con las griegas actuales.');
        legs = [{ symbol: underlying, side: request.side, ratio: 1, intent: request.side === 'buy' ? 'buy_to_open' : 'sell_to_close' }];
        if (request.limitPrice <= 0) fail('f5_invalid_limit', 'El precio límite de la acción debe ser positivo.');
        reserve = request.side === 'buy' ? quantity * request.limitPrice : 0;
        warnings.push(unwind ? 'La venta reduce únicamente las acciones de cobertura atribuidas y ejecutadas de este ciclo.' : `Delta observada antes de la cobertura: ${netDelta.toFixed(2)} acciones equivalentes. Tras ejecutarse toda la orden: ${(netDelta + change).toFixed(2)}.`);
      }
    }
    if (!Number.isFinite(reserve) || reserve < 0 || reserve > request.maxCapitalUsd + 0.001) fail('f5_budget_exceeded', `La reserva necesaria (${cash(reserve)}) supera el capital máximo indicado.`);
    const available = Math.max(0, Math.min(account.cash, account.buyingPower, account.optionsBuyingPower));
    if (reserve > available + 0.001) fail('f5_insufficient_funds', `La reserva necesaria (${cash(reserve)}) supera el capital disponible verificado (${cash(available)}).`);
    if (!marketOpen) warnings.push('Mercado cerrado. Puedes revisar el borrador; para enviar debes actualizar la revisión durante la sesión regular.');
    const id = existing?.id ?? randomUUID(), clientOrderId = existing?.clientOrderId ?? `f5_${randomUUID().replaceAll('-', '')}`;
    const input = orderInput(legs, quantity, request.limitPrice, clientOrderId);
    // Equity hedges have no option position intent in the broker payload.
    if (request.action === 'hedge') delete input.position_intent;
    const operation: F5Operation = {
      id, strategy, underlying, action: request.action, ...(parentId ? { parentId } : {}), request,
      legs, quantity, limitPrice: request.limitPrice, reservedCapitalUsd: precision(reserve), clientOrderId, input,
      createdAt: existing?.createdAt ?? new Date(time).toISOString(), expiresAt: existing?.expiresAt ?? new Date(time + 60000).toISOString(), state: 'preview', warnings,
      ...(request.action === 'open' ? { stockBaseline: existing?.stockBaseline ?? (positions.find(position => position.symbol === underlying && position.assetClass === 'us_equity')?.quantity ?? 0), activityBaselineIds: existing?.activityBaselineIds ?? activities.map(activity => activity.id) } : {}),
    };
    const risk = await measure(account, positions);
    const deltaChange = request.action === 'hedge' ? quantity * (request.side === 'buy' ? 1 : -1) : contracts.every(contract => contract.delta !== null) ? legs.reduce((total, leg, index) => total + (contracts[index]?.delta ?? 0) * leg.ratio * quantity * 100 * (leg.side === 'buy' ? 1 : -1), 0) : null;
    const allocation = reserve + (parentId ? get(parentId).reservedCapitalUsd + store.list(options.ownerId).filter(op => op.parentId === parentId && op.action === 'hedge').reduce((total, op) => total + executed(op) * op.limitPrice * (op.input.side === 'buy' ? 1 : -1), 0) : 0);
    enforceF5Risk(store.settings(options.ownerId), risk, operation, deltaChange, allocation);
    await api.preview?.(operation.input);
    return operation;
  }

  async function status(): Promise<F5Status> {
    if (!options.broker) return { configured: false, enabled: options.enabled, marketOpen: false, mode: provider==='webull'?'sandbox':'paper', provider,feed, account: null, operations: store.list(options.ownerId), positions: [], activities: [], message: `Configura las claves de ${label} en el servicio.` };
    await reconcile();
    const [account, marketOpen, positions, activities] = await Promise.all([broker().account(), broker().clock(), broker().positions(), broker().activities()]);
    const risk = await measure(account, positions);
    const operations = store.list(options.ownerId);
    return { configured: true, enabled: options.enabled, marketOpen, mode: provider==='webull'?'sandbox':'paper', provider,feed, account, risk, riskSettings: store.settings(options.ownerId), activitiesComplete:broker().activitiesComplete?.()??true, operations: operations.map(operation => operation.action === 'open' ? { ...operation, lifecycle: f5Residual(operation, operations, positions, activities, now()).lifecycle } : operation), positions, activities,...(provider==='webull'?{message:'Permisos validados por revisión de Webull; no se presume un nivel de opciones. Horario regular calculado con calendario NYSE; cotizaciones recientes y revisión del proveedor obligatorias para enviar.'}:{}) };
  }

  async function handle(method: string, path: string, ownerId: string, body?: unknown): Promise<Result> {
    let lease: string | null = null;
    try {
      if (ownerId !== options.ownerId) fail('f5_owner_required', 'Esta cuenta Paper pertenece a otro usuario.', 403);
      const url = new URL(path, 'http://f5.local');
      if (method === 'GET' && url.pathname === '/f5/contracts') {
        const underlying = z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/).safeParse(url.searchParams.get('underlying'));
        const expiry = url.searchParams.get('expiry');
        if (!underlying.success || expiry !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) fail('f5_invalid_query', 'Selecciona empresa y vencimiento válidos.', 400);
        return { status: 200, value: await broker().contracts(underlying.data, expiry ?? undefined) };
      }
      if (!((method === 'GET' && ['/f5/status','/f5/report'].includes(url.pathname)) || (method === 'POST' && ['/f5/preview', '/f5/submit', '/f5/cancel', '/f5/reset-daily-risk'].includes(url.pathname)))) return { status: 404, value: { error: { code: 'not_found', message: 'La operación F5 no existe.' } } };
      lease = store.acquire(ownerId, now());
      if (!lease) fail('f5_request_busy', 'La cuenta está procesando otra solicitud F5. Actualiza su estado antes de continuar.');
      if (method === 'POST' && url.pathname === '/f5/reset-daily-risk') {
        if (provider !== 'alpaca') fail('f5_risk_reset_unavailable', 'El reinicio manual solo está disponible para Alpaca Paper.');
        const parsed = dailyRiskResetSchema.safeParse(body);
        if (!parsed.success) fail('f5_risk_reset_invalid', 'Confirma el reinicio con la referencia actual.', 400);
        broker();
        const state = await status(), risk = state.risk!, settings = store.settings(ownerId);
        const { reference } = parsed.data;
        if (reference.date !== risk.date || reference.baselineEquity !== risk.baselineEquity || reference.maxDailyLossUsd !== settings.maxDailyLossUsd || reference.resetId !== (risk.resetId ?? null)) fail('f5_risk_reset_changed', 'La referencia de riesgo cambió. Actualiza el estado.');
        if (!risk.dailyLossBlocked) fail('f5_risk_reset_not_needed', 'El bloqueo diario ya no está activo.');
        accountReady(state.account!, 0);
        if (state.account!.equity <= 0) fail('f5_account_uncertain', 'No se pudo verificar un patrimonio positivo para reiniciar el control.');
        if (store.list(ownerId).some(unresolved)) fail('f5_pending_operations', 'Concilia las operaciones pendientes antes de reiniciar el control diario.');
        if (flatten(await broker().orders()).length) fail('f5_pending_broker_orders', 'Concilia las órdenes pendientes antes de reiniciar el control diario.');
        const next = await measureF5Risk({ account: state.account!, positions: state.positions, operations: store.list(ownerId), settings, previous: null, time: now(), feed, contract: symbol => broker().contract(symbol) });
        next.resetId = randomUUID();
        if (next.date !== reference.date || !store.owns(ownerId, lease, now())) fail('f5_risk_reset_changed', 'La revisión del reinicio venció. Actualiza el estado.');
        const audit: F5ControlEvent = { id: randomUUID(), time: new Date(now()).toISOString(), status: 'info',
          message: `Reinicio manual del control diario Alpaca Paper. Referencia anterior ${cash(risk.baselineEquity)}, variación ${cash(risk.dailyPnlUsd)}; nueva referencia ${cash(next.baselineEquity)}. Límite diario ${cash(settings.maxDailyLossUsd)}.`,
          riskReset: { previous: risk, newBaselineEquity: next.baselineEquity, maxDailyLossUsd: settings.maxDailyLossUsd } };
        store.resetDailyRisk(ownerId, next, audit);
        return { status: 200, value: { risk: next } };
      }
      if (method === 'GET') {
        const state=await status();
        if(url.pathname==='/f5/status')return {status:200,value:state};
        const batches=await Promise.allSettled([broker().fillActivities?.(),broker().feeActivities?.(),broker().optionActivities?.()]);
        const [fills,fees,activities]=batches.map(result=>result.status==='fulfilled'?result.value:undefined);
        return {status:200,value:buildF5Report({operations:state.operations,positions:state.positions,fills,fees,activities,now,provider:label})};
      }
      if (url.pathname === '/f5/preview') {
        await reconcile();
        const operation = await prepare(parseF5Request(body)); store.insert(ownerId, operation);
        return { status: 201, value: { operation } };
      }
      if (url.pathname === '/f5/submit') {
        const parsed = submittedBody.safeParse(body);
        if (!parsed.success) fail('f5_invalid_preview', 'Confirma una revisión válida del servidor.', 400);
        let operation = get(parsed.data.previewId);
        if (operation.state !== 'preview') {
          operation = await reconcileOne(operation);
          return { status: operation.state === 'ambiguous' ? 409 : 200, value: { operation } };
        }
        if (!options.enabled) fail('f5_disabled', `El envío de opciones F5 está desactivado en el servicio. Habilita ${provider==='webull'?'WEBULL_MANUAL_ENABLED':'ALPACA_F5_ENABLED'} después de revisar la configuración.`);
        if (now() >= Date.parse(operation.expiresAt)) {
          store.update(ownerId, { ...operation, state: 'expired', message: 'La revisión venció antes del envío.' });
          fail('f5_preview_expired', 'La revisión venció. Actualiza contratos y revisa nuevamente.');
        }
        await reconcile();
        const checked = await prepare(operation.request, operation);
        if (JSON.stringify(checked.input) !== JSON.stringify(operation.input) || checked.reservedCapitalUsd !== operation.reservedCapitalUsd) fail('f5_review_changed', 'Las condiciones cambiaron. Prepara y confirma otra revisión.');
        if (!await broker().clock()) fail('f5_market_closed', 'El mercado está cerrado. No se envió la orden F5.');
        if (now() >= Date.parse(operation.expiresAt)) {
          store.update(ownerId, { ...operation, state: 'expired', message: 'La revisión venció durante la validación.' });
          fail('f5_preview_expired', 'La revisión venció durante la validación. Revisa nuevamente antes de enviar.');
        }
        if (!store.reserve(ownerId, operation.id, lease, now())) fail('f5_preview_consumed', 'La revisión, la reserva de cuenta o su vigencia cambió. Actualiza el estado antes de continuar.');
        operation = { ...operation, state: 'reserved' }; // persisted BEFORE POST
        try {
          const received = await broker().submit(operation.input, Date.parse(operation.expiresAt));
          operation = matchingResponse(operation, received);
        } catch (error) {
          if (error instanceof BrokerError && error.code === 'f5_preview_expired') {
            operation = { ...operation, state: 'expired', message: error.message };
            store.update(ownerId, operation);
            return { status: 200, value: { operation } };
          }
          if (error instanceof BrokerError && error.code === 'broker_order_rejected') {
            operation = { ...operation, state: 'rejected', message: error.message };
            store.update(ownerId, operation);
            return { status: 200, value: { operation } };
          }
          // Even a client-side timeout or a malformed success response can hide
          // a broker insert. This client id is never posted a second time.
          operation = { ...operation, state: 'ambiguous', message: error instanceof BrokerError ? error.message : 'No se pudo confirmar el envío. Se conciliará el identificador sin repetir la orden.' };
          store.update(ownerId, operation);
          operation = await reconcileOne(operation);
        }
        store.update(ownerId, operation);
        return { status: operation.state === 'ambiguous' ? 202 : 200, value: { operation } };
      }
      const parsed = canceledBody.safeParse(body);
      if (!parsed.success) fail('f5_invalid_operation', 'Selecciona una orden válida para cancelar.', 400);
      let operation = await reconcileOne(get(parsed.data.operationId));
      if (!unresolved(operation) || !operation.brokerOrder) fail('f5_cannot_cancel', 'No hay una orden pendiente confirmada del bróker para cancelar. Actualiza el estado.');
      await broker().cancel(operation.brokerOrder.id);
      operation = { ...operation, message: 'Cancelación solicitada; sigue pendiente hasta que el bróker confirme el estado. Puede coincidir con una ejecución.' };
      store.update(ownerId, operation);
      operation = await reconcileOne(operation);
      return { status: 200, value: { operation } };
    } catch (error) {
      if (error instanceof BrokerError) return { status: error.status, value: { error: { code: error.code, message: error.message } } };
      return { status: 503, value: { error: { code: 'f5_unavailable', message: 'No se pudo completar la solicitud F5. Revisa el estado antes de intentar otra operación.' } } };
    } finally { if (lease) store.release(ownerId, lease); }
  }
  return { handle };
}
