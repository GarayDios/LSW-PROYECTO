"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import './broker-panel.css';

type Connection = { alpaca: { configured: boolean; ownerAuthorized: boolean; mode: 'paper' }; webull: { supported: boolean; requiresApproval: boolean }; automation: { configured: boolean; enabled: boolean }; identity?: { userId: string | null } | null };
type ExitPolicy = { stopLossPct: number; takeProfitPct: number; exitOnSignal?: boolean; closeAtEnd?: boolean; execution?: 'monitored' | 'bracket' };
type Plan = { id: string; symbol: string; historyYears: 3 | 5; startDate: string; endDate: string; maxOrderUsd: number; maxPositionUsd: number; enabled: boolean; exitPolicy?: ExitPolicy | null; maxDailyLossUsd?: number; maxTotalExposureUsd?: number };
type RunnerEvent = { id: string; planId: string; time: string | number; status: string; message: string; clientOrderId?: string; brokerOrderId?: string };
type RunnerStatus = { mode: 'paper'; configured: boolean; enabled: boolean; available: boolean; running: boolean; maxOrderUsd: number; buyOnly: boolean };
type Account = { status: string; currency: string; buyingPower: string | number; equity: string | number; mode: 'paper' };
type Execution = { clientOrderId: string; planId: string; state: string; brokerOrderId?: string; side?: string; symbol?: string; quantity?: number; limitPrice?: number; stopPrice?: number; parentClientOrderId?: string; filledQuantity?: number; filledAveragePrice?: number; brokerStatus?: string; reason?: string; createdAt?: number | string; updatedAt?: number | string };
type OwnedPosition = { planId: string; symbol: string; quantity: number; averageEntryPrice: number; realizedPnlUsd: number; updatedAt: number | string };
type PortfolioRisk = { paused: boolean; date: string; equityStartUsd: number | null; equityUsd: number | null; dailyPnlUsd: number | null; ownedExposureUsd: number; totalExposureUsd: number; reservedEntryUsd: number; limits: { maxDailyLossUsd: number | null; maxTotalExposureUsd: number | null }; dailyLossBlocked: boolean; exposureBlocked: boolean; uncertain: boolean; updatedAt: number | string };
const executionLabels: Record<string, string> = { reserved: 'Preparando envío', submitted: 'Enviada al bróker', ambiguous: 'Confirmación pendiente', failed: 'Envío fallido', partial: 'Ejecución parcial', filled: 'Ejecutada', rejected: 'Rechazada', canceled: 'Cancelada', expired: 'Vencida' };

async function readJson<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(value.error?.message || 'No se pudo completar la consulta. Revisa la conexión del servicio en el servidor.');
  return value;
}

export default function BrokerPanel({ symbol, operationStart, operationEnd, realHistory }: { symbol: string; operationStart: string; operationEnd: string; realHistory: boolean }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [runner, setRunner] = useState<RunnerStatus | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [events, setEvents] = useState<RunnerEvent[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [positions, setPositions] = useState<OwnedPosition[]>([]);
  const [risk, setRisk] = useState<PortfolioRisk | null>(null);
  const seenExecutions = useRef<Record<string, string> | null>(null);
  const [budget, setBudget] = useState('100');
  const [maxPosition, setMaxPosition] = useState('1000');
  const [years, setYears] = useState<3 | 5>(3);
  const [exitsEnabled, setExitsEnabled] = useState(false);
  const [exitExecution, setExitExecution] = useState<'monitored' | 'bracket'>('monitored');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [exitOnSignal, setExitOnSignal] = useState(false);
  const [closeAtEnd, setCloseAtEnd] = useState(false);
  const [dailyLimitEnabled, setDailyLimitEnabled] = useState(false);
  const [dailyLimit, setDailyLimit] = useState('');
  const [exposureLimitEnabled, setExposureLimitEnabled] = useState(false);
  const [exposureLimit, setExposureLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const status = await readJson<Connection>(await fetch('/api/broker/status', { signal, credentials: 'same-origin', cache: 'no-store' }));
      if (signal?.aborted) return;
      setConnection(status);
      if (!status.automation.configured || !status.alpaca.ownerAuthorized) { setRunner(null); setPlans([]); setEvents([]); setExecutions([]); setPositions([]); setRisk(null); seenExecutions.current=null; return; }
      const [running, saved, log, executionLog, owned, portfolio] = await Promise.all([
        fetch('/api/automation?resource=status', { signal, credentials: 'same-origin', cache: 'no-store' }).then(readJson<RunnerStatus>),
        fetch('/api/automation?resource=plans', { signal, credentials: 'same-origin', cache: 'no-store' }).then(readJson<{ plans: Plan[] }>),
        fetch('/api/automation?resource=events', { signal, credentials: 'same-origin', cache: 'no-store' }).then(readJson<{ events: RunnerEvent[] }>),
        fetch('/api/automation?resource=executions', { signal, credentials: 'same-origin', cache: 'no-store' }).then(readJson<{ executions: Execution[] }>),
        fetch('/api/automation?resource=positions', { signal, credentials: 'same-origin', cache: 'no-store' }).then(readJson<{ positions: OwnedPosition[] }>),
        fetch('/api/automation?resource=risk', { signal, credentials: 'same-origin', cache: 'no-store' }).then(readJson<{ risk: PortfolioRisk }>),
      ]);
      if (!signal?.aborted) {
        setRunner(running); setPlans(saved.plans); setEvents(log.events); setExecutions(executionLog.executions); setPositions(owned.positions); setRisk(portfolio.risk);
        const changed=seenExecutions.current&&executionLog.executions.find(entry=>seenExecutions.current?.[entry.clientOrderId]!==`${entry.state}:${entry.filledQuantity??0}`&&['filled','partial','rejected','canceled','expired'].includes(entry.state));
        if(changed)setNotice(`${changed.symbol??'Orden Paper'}: ${executionLabels[changed.state]??changed.state}${changed.filledQuantity?` · ${changed.filledQuantity} acciones ejecutadas`:''}.`);
        seenExecutions.current=Object.fromEntries(executionLog.executions.map(entry=>[entry.clientOrderId,`${entry.state}:${entry.filledQuantity??0}`]));
      }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'No se pudo consultar el servicio.'); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); const timer=setInterval(()=>void refresh(controller.signal),15000); return () => {controller.abort();clearInterval(timer);}; }, [refresh]);

  async function action(body: unknown, message: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await readJson(await fetch('/api/automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) }));
      setNotice(message);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'La solicitud no pudo completarse.'); }
    finally { setBusy(false); }
  }
  async function checkAccount() {
    setBusy(true); setError('');
    try { const value = await readJson<{ account: Account }>(await fetch('/api/broker/account', { cache: 'no-store', credentials: 'same-origin' })); setAccount(value.account); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo consultar la cuenta de práctica.'); }
    finally { setBusy(false); }
  }
  const authorized = connection?.alpaca.configured && connection.alpaca.ownerAuthorized;
  const canCreate = authorized && runner?.available && realHistory;
  const maxOrderLimit = Math.min(runner?.maxOrderUsd ?? 10000, 10000);
  const validBudget = Number.isFinite(Number(budget)) && Number(budget) >= 1 && Number(budget) <= maxOrderLimit && Number.isFinite(Number(maxPosition)) && Number(maxPosition) >= Number(budget) && Number(maxPosition) <= 10000;
  const validWindow = /^\d{4}-\d{2}-\d{2}$/.test(operationStart) && /^\d{4}-\d{2}-\d{2}$/.test(operationEnd) && operationStart <= operationEnd;
  const validExits=!exitsEnabled||(Number(stopLoss)>=.1&&Number(stopLoss)<=50&&Number(takeProfit)>=.1&&Number(takeProfit)<=200);
  const validRisk=(!dailyLimitEnabled||(Number(dailyLimit)>=1&&Number(dailyLimit)<=25000))&&(!exposureLimitEnabled||(Number(exposureLimit)>=1&&Number(exposureLimit)<=1000000));
  const visiblePlans = plans.filter(plan => plan.symbol === symbol);
  const formatCash = (value: string | number) => Number(value).toLocaleString('en-US', { style: 'currency', currency: account?.currency || 'USD' });
  const executionForEvent = (entry: RunnerEvent) => executions.find(execution=>execution.clientOrderId===entry.clientOrderId||!!entry.brokerOrderId&&execution.brokerOrderId===entry.brokerOrderId);
  const eventLabel = (entry: RunnerEvent) => { const execution=executionForEvent(entry);return execution?executionLabels[execution.state]??execution.state:executionLabels[entry.status]??({waiting:'En espera',duplicate:'Señal ya atendida',blocked:'Evaluación bloqueada',error:'Error de evaluación'}[entry.status]??entry.status); };
  return <section className="panel broker-panel" aria-label="Bróker y automatización">
    <div className="broker-panel-heading"><div><span className="broker-kicker">ACCIONES · CUENTA DE PRÁCTICA</span><h2>Bróker y automatización</h2></div><span className="broker-paper-badge">Alpaca Paper</span></div>
    <div className="broker-connection"><span className={authorized ? 'positive' : ''}>{!connection ? 'Comprobando conexión…' : !connection.alpaca.configured ? 'Claves de Alpaca pendientes' : !connection.alpaca.ownerAuthorized ? 'Esta cuenta no tiene acceso al bróker configurado' : 'Conexión de práctica configurada'}</span><button className="secondary-button" disabled={busy || !authorized} onClick={checkAccount}>Consultar cuenta Paper</button></div>
    {!connection?.alpaca.configured && <p className="broker-explainer">Configura las claves de práctica de Alpaca y el propietario de la cuenta en el servidor. El histórico real necesita esta conexión. Webull OpenAPI requiere autorización y credenciales de su entorno regional.</p>}
    {connection?.identity === null && <p className="broker-explainer"><a className="secondary-button" href="/signin-with-chatgpt?return_to=%2F" target="_top">Iniciar sesión para conectar mi cuenta</a></p>}
    {connection?.identity?.userId && <details className="broker-identity"><summary>Identificador para conectar mi cuenta de práctica</summary><p>Usa este identificador como propietario del bróker al configurar el servidor: <code>{connection.identity.userId}</code></p></details>}
    {account && <div className="broker-account"><span>Estado: <strong>{account.status}</strong></span><span>Patrimonio Paper: <strong>{formatCash(account.equity)}</strong></span><span>Poder de compra: <strong>{formatCash(account.buyingPower)}</strong></span></div>}
    <div className="broker-automation-info"><strong>{runner?.available ? runner.running ? 'Servicio conectado · evaluación en curso' : 'Servicio de evaluación conectado' : 'La automatización requiere su servicio activo'}</strong><p>Evalúa reglas con sesiones diarias completas mientras el servicio permanezca ejecutándose. Las salidas opcionales solo venden las acciones registradas por el plan. Las opciones del laboratorio siguen siendo simulaciones locales.</p></div>
    <form className="broker-plan-form" onSubmit={event => {
      event.preventDefault();
      if (!validBudget || !validWindow || !validExits || !validRisk || !canCreate) return;
      void action({ action: 'create', plan: { symbol, historyYears: years, startDate: operationStart, endDate: operationEnd, maxOrderUsd: Number(budget), maxPositionUsd: Number(maxPosition), ...(exitsEnabled?{exitPolicy:{stopLossPct:Number(stopLoss),takeProfitPct:Number(takeProfit),execution:exitExecution,exitOnSignal:exitExecution==='monitored'&&exitOnSignal,closeAtEnd:exitExecution==='monitored'&&closeAtEnd}}:{}), ...(dailyLimitEnabled?{maxDailyLossUsd:Number(dailyLimit)}:{}), ...(exposureLimitEnabled?{maxTotalExposureUsd:Number(exposureLimit)}:{}) } }, 'Plan de práctica creado y desactivado. Revisa sus límites antes de activarlo.');
    }}>
      <p className="broker-muted">Selecciona las fechas en el rango de operación superior y define aquí tus límites de compra y posición. El plan se prepara desactivado para que revises sus datos antes de confirmar la activación.</p>
      {symbol === 'AAPL' && <p className="broker-muted">AAPL es un preset técnico para probar el flujo de Alpaca Paper; no es una recomendación de inversión.</p>}
      <div className="broker-plan-fields"><label>Historia para las reglas<select value={years} onChange={event => setYears(Number(event.target.value) as 3 | 5)}><option value={3}>3 años de velas diarias</option><option value={5}>5 años de velas diarias</option></select></label><label>Máximo por compra (USD)<input type="number" min="1" max={maxOrderLimit} step="1" value={budget} onChange={event => setBudget(event.target.value)} required/></label><label>Máxima posición (USD)<input type="number" min="1" max="10000" step="1" value={maxPosition} onChange={event => setMaxPosition(event.target.value)} required/></label></div>
      <fieldset className="broker-optional-policy"><legend>Salidas y límites adicionales</legend><label className="broker-checkbox"><input type="checkbox" checked={exitsEnabled} onChange={event=>setExitsEnabled(event.target.checked)}/>Preparar salidas automáticas de las acciones de este plan</label>{exitsEnabled&&<><label>Modalidad de salidas<select aria-label="Modalidad de salidas" value={exitExecution} onChange={event=>setExitExecution(event.target.value as 'monitored'|'bracket')}><option value="monitored">Reglas evaluadas por el servicio</option><option value="bracket">Bracket GTC en Alpaca Paper</option></select></label><div className="broker-plan-fields broker-two-fields"><label>Stop loss (%)<input type="number" min="0.1" max="50" step="0.1" value={stopLoss} onChange={event=>setStopLoss(event.target.value)} required/></label><label>Take profit (%)<input type="number" min="0.1" max="200" step="0.1" value={takeProfit} onChange={event=>setTakeProfit(event.target.value)} required/></label></div>{exitExecution==='monitored'&&<><label className="broker-checkbox"><input type="checkbox" checked={exitOnSignal} onChange={event=>setExitOnSignal(event.target.checked)}/>Salir también ante una señal de venta diaria</label><label className="broker-checkbox"><input type="checkbox" checked={closeAtEnd} onChange={event=>setCloseAtEnd(event.target.checked)}/>Cerrar al finalizar el rango seleccionado</label><p className="broker-muted">Los umbrales se comprueban durante las evaluaciones; no son órdenes stop garantizadas. El cierre de fin de rango se intenta en los últimos 15 minutos de la sesión final o en la siguiente sesión disponible.</p></>}{exitExecution==='bracket'&&<p className="broker-muted">Alpaca recibe entrada y dos salidas GTC. Los porcentajes fijan precios respecto al límite de entrada, no al precio final ejecutado. Las salidas se activan al completarse la entrada y permanecen en el bróker aunque el servicio se detenga. No se garantiza el precio del stop. Esta modalidad no añade cierre por señal o fecha.</p>}</>}<label className="broker-checkbox"><input type="checkbox" checked={dailyLimitEnabled} onChange={event=>setDailyLimitEnabled(event.target.checked)}/>Limitar la pérdida diaria de la cuenta</label>{dailyLimitEnabled&&<label className="broker-risk-input">Pérdida diaria máxima (USD)<input type="number" min="1" max="25000" step="1" value={dailyLimit} onChange={event=>setDailyLimit(event.target.value)} required/></label>}<label className="broker-checkbox"><input type="checkbox" checked={exposureLimitEnabled} onChange={event=>setExposureLimitEnabled(event.target.checked)}/>Limitar la exposición total de la cuenta</label>{exposureLimitEnabled&&<label className="broker-risk-input">Exposición total máxima (USD)<input type="number" min="1" max="1000000" step="1" value={exposureLimit} onChange={event=>setExposureLimit(event.target.value)} required/></label>}<p className="broker-muted">La pérdida diaria compara el patrimonio con la primera lectura del día en Nueva York e incluye movimientos de toda la cuenta. La exposición incluye posiciones manuales y compras pendientes. Se aplica el menor límite entre los planes habilitados.</p></fieldset>
      <p className="broker-plan-window">{symbol} · Ventana de evaluación: {operationStart} → {operationEnd}. {runner ? `Límite del servicio por compra: $${runner.maxOrderUsd}.` : ''}</p>
      <p className="broker-muted">El presupuesto debe alcanzar al menos una acción completa; el precio se comprobará antes del envío.</p>
      <p className="broker-muted">En cada evaluación se vuelven a consultar los últimos {years} años de sesiones completas. Las señales dibujadas en el rango elegido son retrospectivas; no se envían como órdenes antiguas.</p>
      {!realHistory && <p className="broker-muted">Selecciona histórico real de Alpaca antes de preparar una automatización.</p>}
      {!validWindow && <p className="broker-error">Selecciona un rango de operación válido antes de preparar el plan.</p>}
      {!validBudget && <p className="broker-error">Define una compra de al menos $1 y hasta ${maxOrderLimit}, sin superar la posición máxima. La posición máxima admite hasta $10,000.</p>}
      {!validExits&&<p className="broker-error">Define una pérdida entre 0.1% y 50% y una ganancia entre 0.1% y 200% para preparar las salidas.</p>}{!validRisk&&<p className="broker-error">Indica los importes de los límites seleccionados: pérdida diaria de $1 a $25,000 y exposición de $1 a $1,000,000.</p>}
      <button className="secondary-button" type="submit" disabled={busy || !canCreate || !validBudget || !validWindow || !validExits || !validRisk}>Preparar plan Paper desactivado</button>
    </form>
    {visiblePlans.length > 0 && <div className="broker-plans">{visiblePlans.map(plan => {
      const matchesWindow = plan.startDate === operationStart && plan.endDate === operationEnd;
      return <div className="broker-plan" key={plan.id}><div>
        <strong>{plan.symbol} · {plan.enabled ? 'Activado' : 'Desactivado'}</strong>
        <p>{plan.startDate} → {plan.endDate} · compra ≤ ${plan.maxOrderUsd} · posición ≤ ${plan.maxPositionUsd}</p>
        <p>{plan.exitPolicy ? `Salidas ${plan.exitPolicy.execution === 'bracket' ? 'bracket GTC' : 'por reglas'}: pérdida ${plan.exitPolicy.stopLossPct}% · ganancia ${plan.exitPolicy.takeProfitPct}%${plan.exitPolicy.exitOnSignal ? ' · señal de venta' : ''}${plan.exitPolicy.closeAtEnd ? ' · fin del rango' : ''}` : 'Sin salidas automáticas configuradas'}{plan.maxDailyLossUsd ? ` · pérdida diaria ≤ $${plan.maxDailyLossUsd}` : ''}{plan.maxTotalExposureUsd ? ` · exposición cuenta ≤ $${plan.maxTotalExposureUsd}` : ''}</p>
        {!plan.enabled && (matchesWindow ? <p>Revisa el símbolo, las fechas, las salidas y los límites antes de confirmar las órdenes automáticas en Alpaca Paper.</p> : <p id={`plan-range-${plan.id}`}>El rango cambió; prepara un nuevo plan con las fechas seleccionadas.</p>)}</div><button className={plan.enabled ? 'secondary-button' : 'primary-button small'} disabled={busy || !authorized || !runner?.available || !plan.enabled && (!matchesWindow || !runner.enabled || !connection?.automation.enabled)} aria-describedby={!plan.enabled && !matchesWindow ? `plan-range-${plan.id}` : undefined} onClick={() => {
        if (!plan.enabled && !matchesWindow) return;
        void action({ action: plan.enabled ? 'disable' : 'enable', planId: plan.id }, plan.enabled ? 'Plan de práctica desactivado.' : 'Plan Paper activado. El servicio evaluará las siguientes sesiones dentro de su ventana.');
      }}>{plan.enabled ? 'Desactivar plan' : 'Confirmar y activar Paper'}</button></div>;
    })}</div>}
    {visiblePlans.length > 0 && (!runner?.enabled || !connection?.automation.enabled) && <p className="broker-muted">El servidor mantiene desactivado el envío automático. Los planes se pueden revisar sin enviar órdenes.</p>}
    {risk&&<div className="broker-risk-status" aria-label="Riesgo y pausa de la cuenta"><h3>Estado de riesgo de la cuenta</h3><div className="broker-account"><span>Entradas nuevas: <strong>{risk.paused?'Pausadas':'Sin pausa manual'}</strong></span><span>Resultado del día: <strong>{risk.dailyPnlUsd===null?'No disponible':formatCash(risk.dailyPnlUsd)}</strong></span><span>Exposición total: <strong>{formatCash(risk.totalExposureUsd)}</strong></span><span>Exposición de planes: <strong>{formatCash(risk.ownedExposureUsd)}</strong></span><span>Compras reservadas: <strong>{formatCash(risk.reservedEntryUsd)}</strong></span></div><p className="broker-muted">{risk.date} · Pérdida diaria máxima: {risk.limits.maxDailyLossUsd===null?'Sin límite adicional':formatCash(risk.limits.maxDailyLossUsd)} · Exposición máxima: {risk.limits.maxTotalExposureUsd===null?'Sin límite adicional':formatCash(risk.limits.maxTotalExposureUsd)}.</p>{(risk.dailyLossBlocked||risk.exposureBlocked||risk.uncertain)&&<p className="broker-error">{risk.dailyLossBlocked?'Se alcanzó el límite de pérdida diaria. ':''}{risk.exposureBlocked?'Se alcanzó el límite de exposición. ':''}{risk.uncertain?'La información de cuenta u órdenes es incierta; se bloquean entradas nuevas.':''}</p>}<p className="broker-muted">Pausar detiene nuevas entradas y mantiene las salidas configuradas y la conciliación. Las compras y salidas bracket ya enviadas siguen vigentes. Desactivar un plan detiene sus nuevas órdenes del servicio; no cancela órdenes del bróker.</p><button className="secondary-button" disabled={busy||!authorized||!runner?.available} onClick={()=>void action({action:risk.paused?'resume':'pause'},risk.paused?'Pausa retirada. Los planes habilitados podrán evaluarse con sus límites.':'Entradas pausadas. Las salidas configuradas y la conciliación continúan.')}>{risk.paused?'Reanudar planes habilitados':'Pausar nuevas entradas'}</button></div>}
    <div className="broker-controls"><button className="secondary-button" disabled={busy} onClick={() => { setError(''); void refresh(); }}>Actualizar estado</button><button className="secondary-button" disabled={busy || !authorized || !runner?.enabled || !connection?.automation.enabled || !runner.available || runner.running || !visiblePlans.some(plan => plan.enabled)} onClick={() => void action({ action: 'tick' }, 'Evaluación solicitada. Consulta el registro para conocer el resultado.')}>Evaluar planes Paper activos</button></div>
    {notice && <p className="broker-notice" role="status">{notice}</p>}{error && <p className="broker-error" role="alert">{error}</p>}
    {executions.length>0&&<div className="broker-events"><h3>Órdenes Paper y ejecuciones</h3>{executions.filter(entry=>!entry.symbol||entry.symbol===symbol).slice(0,8).map(entry=><div className="broker-event" key={entry.clientOrderId}><strong>{entry.symbol??symbol} · {entry.side==='sell'?'Venta':'Compra'} · {executionLabels[entry.state]??entry.state}</strong><p>Ejecutadas: {entry.filledQuantity??0} de {entry.quantity??'—'} acciones{entry.filledAveragePrice!==undefined?` · precio medio ${formatCash(entry.filledAveragePrice)}`:''}{entry.limitPrice!==undefined?` · límite ${formatCash(entry.limitPrice)}`:''}.</p>{entry.stopPrice!==undefined&&<p>Precio de activación del stop: {formatCash(entry.stopPrice)}.</p>}{entry.parentClientOrderId&&<small>Salida bracket vinculada a la entrada del plan.</small>}{entry.brokerStatus&&<small>Estado del bróker: {entry.brokerStatus}</small>}{entry.reason&&<p>{entry.reason}</p>}{entry.brokerOrderId&&<small>Referencia Paper: {entry.brokerOrderId}</small>}</div>)}</div>}
    {positions.length>0&&<div className="broker-events"><h3>Acciones registradas por los planes</h3>{positions.filter(position=>position.symbol===symbol).map(position=><div className="broker-event" key={`${position.planId}-${position.symbol}`}><strong>{position.symbol} · {position.quantity} acciones</strong><p>Entrada media: {formatCash(position.averageEntryPrice)} · Resultado realizado: {formatCash(position.realizedPnlUsd)}.</p></div>)}</div>}
    {events.length > 0 && <div className="broker-events"><h3>Registro del servicio</h3>{events.slice(0, 8).map(entry => <div className="broker-event" key={entry.id}><span>{new Date(entry.time).toLocaleString('es-MX', { timeZone: 'America/Mazatlan' })}</span><strong>{eventLabel(entry)}</strong><p>{entry.message}</p>{entry.brokerOrderId && <small>Referencia Paper: {entry.brokerOrderId}</small>}</div>)}</div>}
  </section>;
}
