import type { F5AutomationPlan, F5Contract, F5Operation, F5Request, F5Status } from '../../src/features/f5/types.ts';
import type { F5Broker } from './f5-service.ts';
import { executed, f5Residual, f5Today } from './f5-model.ts';

type Decision = { request?: F5Request; key?: string; reason: string };
const days = (expiry: string, today: string) => Math.round((Date.parse(expiry + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000);
const round = (value: number) => Math.round(value * 100) / 100;
function current(contract: F5Contract, now: number, feed: F5Status['feed']) {
  const time = contract.quoteTime ? Date.parse(contract.quoteTime) : NaN;
  return contract.tradable && contract.size === 100 && contract.style === 'american' && contract.bid !== null && contract.ask !== null && contract.bid >= 0 && contract.ask > 0 && contract.bid <= contract.ask && Number.isFinite(time) && time <= now + 5000 && now - time <= (feed === 'indicative' ? 1200000 : 60000);
}
function choose(contracts: F5Contract[], min: number, max: number) {
  const middle = (min + max) / 2;
  return contracts.sort((a, b) => a.expiry.localeCompare(b.expiry) || Math.abs(a.strike - middle) - Math.abs(b.strike - middle) || a.symbol.localeCompare(b.symbol))[0];
}

/** Selection uses only current provider observations inside a user-approved policy. */
export async function chooseF5Action(input: { plan: F5AutomationPlan; parent: F5Operation; snapshot: F5Status; broker: F5Broker; now: number }): Promise<Decision> {
  const { plan, parent, snapshot, broker, now } = input, today = f5Today(now), policy = plan.policy;
  const residual = f5Residual(parent, snapshot.operations, snapshot.positions, snapshot.activities, now);
  if (residual.lifecycle.phase === 'uncertain' || residual.lifecycle.phase === 'pending') return { reason: residual.lifecycle.reason ?? 'El ciclo necesita conciliación.' };
  if (policy.kind === 'wheel') {
    if (residual.quantity !== 0 || executed(parent) <= 0) return { reason: 'Wheel espera el cierre, vencimiento o asignación confirmados por Alpaca.' };
    if (!['assigned', 'expired', 'closed'].includes(residual.lifecycle.phase)) return { reason: 'No hay un evento verificable para continuar Wheel.' };
    const quantity = executed(parent), stock = snapshot.positions.find(position => position.symbol === parent.underlying && position.assetClass === 'us_equity')?.quantity ?? 0;
    const phase = stock >= quantity * 100 ? 'call' : 'put';
    if (residual.lifecycle.phase === 'assigned' && parent.request.action === 'open' && parent.request.wheelPhase === 'put' && phase !== 'call') return { reason: 'La asignación está informada, pero las acciones aún no están disponibles en Alpaca.' };
    const chain = await broker.contracts(parent.underlying);
    if (!chain.complete) return { reason: 'La cadena está incompleta; no se elegirá un contrato automáticamente.' };
    const candidate = choose(chain.contracts.filter(contract => contract.underlying === parent.underlying && contract.type === phase && current(contract, now, snapshot.feed) && contract.bid! >= policy.minPremium && days(contract.expiry, today) >= policy.minDte && days(contract.expiry, today) <= policy.maxDte && contract.strike >= policy.minStrike && contract.strike <= policy.maxStrike), policy.minStrike, policy.maxStrike);
    if (!candidate) return { reason: 'No hay un contrato Wheel dentro del vencimiento, strike y prima autorizados.' };
    return { request: { action: 'open', strategy: 'wheel', underlying: parent.underlying, quantity, contracts: [candidate.symbol], wheelPhase: phase, limitPrice: round(candidate.bid!), maxCapitalUsd: plan.maxCapitalUsd }, key: `wheel:${parent.id}:${phase}`, reason: `Wheel continúa con ${phase.toUpperCase()} tras verificar posiciones y eventos del bróker.` };
  }
  if (policy.kind === 'pmcc') {
    if (!residual.lifecycle.canRoll) return { reason: 'PMCC necesita las dos piernas confirmadas y sin órdenes pendientes.' };
    const short = await broker.contract(residual.lifecycle.shortContract!);
    if (days(short.expiry, today) > policy.rollAtDte) return { reason: 'La call corta aún no entra en la ventana autorizada para rolar.' };
    const longSymbol = [...residual.vector].find(([, qty]) => qty > 0)![0], long = await broker.contract(longSymbol), chain = await broker.contracts(parent.underlying);
    if (!chain.complete || !current(short, now, snapshot.feed)) return { reason: 'No hay una cadena y cotización completas para revisar el roll.' };
    const candidate = choose(chain.contracts.filter(contract => contract.type === 'call' && contract.underlying === parent.underlying && contract.symbol !== short.symbol && current(contract, now, snapshot.feed) && contract.expiry > short.expiry && contract.expiry < long.expiry && days(contract.expiry, today) >= policy.minDte && days(contract.expiry, today) <= policy.maxDte && contract.strike >= Math.max(policy.minStrike, long.strike) && contract.strike <= policy.maxStrike && round(short.ask! - contract.bid!) <= policy.maxDebit && round(contract.bid! - short.ask!) >= policy.minCredit), policy.minStrike, policy.maxStrike);
    if (!candidate) return { reason: 'Ningún roll cumple el límite de débito/crédito y vencimiento autorizado.' };
    return { request: { action: 'roll', operationId: parent.id, newShortContract: candidate.symbol, limitPrice: round(short.ask! - candidate.bid!), maxCapitalUsd: plan.maxCapitalUsd }, key: `roll:${parent.id}:${short.symbol}`, reason: 'Renovación de la call corta mediante una orden combinada.' };
  }
  if (policy.kind === 'gamma') {
    if (!residual.lifecycle.canHedge) return { reason: 'Gamma espera ejecuciones y posiciones conciliadas.' };
    if (plan.lastActionAt && now - Date.parse(plan.lastActionAt) < policy.intervalSeconds * 1000) return { reason: 'Aún no corresponde evaluar otra cobertura según el intervalo autorizado.' };
    let optionDelta = 0;
    for (const [symbol, quantity] of residual.vector) if (quantity !== 0) {
      const contract = await broker.contract(symbol);
      if (!current(contract, now, snapshot.feed) || contract.delta === null) return { reason: 'Falta delta observada reciente para cubrir Gamma.' };
      optionDelta += quantity * 100 * contract.delta;
    }
    const before = optionDelta + residual.lifecycle.hedgeShares;
    if (Math.abs(before) < policy.deltaThreshold && residual.quantity > 0) return { reason: 'La delta neta está dentro del umbral autorizado.' };
    const target = Math.max(0, Math.min(policy.maxShares, parent.quantity * 100, Math.round(-optionDelta)));
    const change = target - residual.lifecycle.hedgeShares;
    if (change === 0 || Math.abs(before + change) > Math.abs(before) + 0.5) return { reason: 'La neutralización adicional requeriría una venta en corto o superaría el límite de acciones.' };
    if (!broker.stockQuote) return { reason: 'El servicio no tiene una cotización de acciones verificable para cubrir Gamma.' };
    const quote = await broker.stockQuote(parent.underlying);
    if (!Number.isFinite(Date.parse(quote.time)) || now - Date.parse(quote.time) > 60000 || Date.parse(quote.time) > now + 5000 || quote.bid <= 0 || quote.ask < quote.bid) return { reason: 'La cotización de la acción no es válida o está desactualizada.' };
    return { request: { action: 'hedge', operationId: parent.id, side: change > 0 ? 'buy' : 'sell', quantity: Math.abs(change), limitPrice: round(change > 0 ? quote.ask : quote.bid), maxCapitalUsd: plan.maxCapitalUsd }, key: `gamma:${parent.id}:${Math.floor(now / (policy.intervalSeconds * 1000))}`, reason: `Cobertura Gamma: delta observada ${before.toFixed(2)} → ${(before + change).toFixed(2)}.` };
  }
  if (!residual.lifecycle.canClose) return { reason: residual.lifecycle.reason ?? 'El residuo no está listo para un cierre automático.' };
  const held = snapshot.positions.filter(position => residual.vector.get(position.symbol));
  const contracts = await Promise.all(residual.legs.map(leg => broker.contract(leg.symbol)));
  if (!contracts.every(contract => current(contract, now, snapshot.feed))) return { reason: 'No hay cotizaciones recientes para cerrar todas las piernas.' };
  const nearExpiry = contracts.some(contract => days(contract.expiry, today) <= policy.closeDte);
  const pnlKnown = held.every(position => position.unrealizedPnl !== null && Number.isFinite(position.unrealizedPnl));
  const pnl = held.reduce((sum, position) => sum + (position.unrealizedPnl ?? 0), 0), capital = Math.max(parent.reservedCapitalUsd, Math.abs(parent.limitPrice) * executed(parent) * 100, 1);
  if (!nearExpiry && (!pnlKnown || pnl > -capital * policy.stopLossPct / 100 && pnl < capital * policy.takeProfitPct / 100)) return { reason: pnlKnown ? 'La posición no alcanzó las condiciones de salida autorizadas.' : 'Alpaca no informó un resultado verificable para evaluar la salida.' };
  const net = residual.legs.reduce((sum, leg, index) => sum + (leg.side === 'buy' ? contracts[index].ask! : -contracts[index].bid!) * leg.ratio, 0);
  const limitPrice = round(residual.legs.length === 1 ? Math.abs(net) : net);
  return { request: { action: 'close', operationId: parent.id, limitPrice, maxCapitalUsd: plan.maxCapitalUsd }, key: `exit:${parent.id}:${JSON.stringify([...residual.vector])}`, reason: nearExpiry ? 'Cierre preventivo por proximidad al vencimiento.' : 'Salida por umbral de resultado observado del ciclo.' };
}
