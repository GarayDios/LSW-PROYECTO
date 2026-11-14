"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock3, LoaderCircle, Pause, Play, RefreshCw, Settings2, ShieldCheck } from 'lucide-react';
import { strategies } from '../strategies/catalog';
import type { F5AutomationPlan, F5AutomationPlanInput, F5Control, F5OpenRequest, F5Operation, F5PlanPolicy, F5RiskSettings } from './types';
import './f5-control-panel.css';

const cash = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? 'No disponible' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const time = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('es-MX', { timeZone: 'America/Mazatlan' }) : 'Sin evaluación confirmada';
const strategyName = (id: string) => strategies.find(strategy => strategy.id === id)?.title ?? id;
const pending = (operation: F5Operation) => ['reserved', 'submitted', 'partial', 'ambiguous'].includes(operation.state);
const dateNY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const futureDate = () => { const value = new Date(`${dateNY()}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + 30); return value.toISOString().slice(0, 10); };
const riskFields: { key: keyof Omit<F5RiskSettings, 'paused'>; label: string; unit: string }[] = [
  { key: 'maxDailyLossUsd', label: 'Pérdida diaria máxima F5', unit: 'USD' },
  { key: 'maxGrossExposureUsd', label: 'Exposición bruta máxima F5', unit: 'USD' },
  { key: 'maxPremiumExposureUsd', label: 'Exposición máxima en primas F5', unit: 'USD' },
  { key: 'maxAbsDelta', label: 'Delta absoluta máxima F5', unit: 'acciones equivalentes' },
  { key: 'maxCycleCapitalUsd', label: 'Capital máximo por ciclo F5', unit: 'USD' },
];
type RiskDraft = Record<keyof Omit<F5RiskSettings, 'paused'>, string>;
const emptyRisk = (): RiskDraft => ({ maxDailyLossUsd: '', maxGrossExposureUsd: '', maxPremiumExposureUsd: '', maxAbsDelta: '', maxCycleCapitalUsd: '' });
const policyLabels: Record<F5PlanPolicy['kind'], string> = { wheel: 'Continuar las fases de Wheel', pmcc: 'Renovar la call corta de PMCC', gamma: 'Revisar y ajustar Delta con acciones', exit: 'Cerrar por umbrales o vencimiento' };
const eventLabels: Record<string, string> = { info: 'Información', waiting: 'En espera', blocked: 'Bloqueado', submitted: 'Orden enviada', partial: 'Ejecución parcial', filled: 'Ejecutada', rejected: 'Rechazada', canceled: 'Cancelada', expired: 'Vencida', ambiguous: 'Confirmación pendiente', error: 'Error de evaluación' };

async function request<T>(body?: unknown): Promise<T> {
  const response = await fetch(body ? '/api/f5' : '/api/f5?resource=control', {
    credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'control', request: body }) } : {}),
  });
  const value = await response.json().catch(() => null) as T & { error?: string | { message?: string } };
  if (!response.ok || !value) throw new Error(typeof value?.error === 'string' ? value.error : value?.error?.message || 'No se pudo consultar el control F5. Actualiza el estado antes de continuar.');
  return value;
}

function PolicySummary({ policy }: { policy: F5PlanPolicy }) {
  return <dl className="f5-policy-summary"><div><dt>Regla</dt><dd>{policyLabels[policy.kind]}</dd></div>{policy.kind === 'wheel' || policy.kind === 'pmcc' ? <><div><dt>Vencimientos candidatos</dt><dd>{policy.minDte} a {policy.maxDte} días</dd></div><div><dt>Rango de strikes</dt><dd>{cash(policy.minStrike)} → {cash(policy.maxStrike)}</dd></div>{policy.kind === 'wheel' ? <div><dt>Prima mínima por acción</dt><dd>{cash(policy.minPremium)}</dd></div> : <><div><dt>Renovar al llegar a</dt><dd>{policy.rollAtDte} días del vencimiento corto</dd></div><div><dt>Límite de débito / crédito mínimo</dt><dd>{cash(policy.maxDebit)} / {cash(policy.minCredit)}</dd></div></>}</> : policy.kind === 'gamma' ? <><div><dt>Umbral de Delta</dt><dd>{policy.deltaThreshold} acciones equivalentes</dd></div><div><dt>Máximo de acciones de cobertura</dt><dd>{policy.maxShares}</dd></div><div><dt>Intervalo mínimo entre ajustes</dt><dd>{policy.intervalSeconds} segundos</dd></div></> : <><div><dt>Umbral de pérdida / ganancia</dt><dd>{policy.stopLossPct}% / {policy.takeProfitPct}%</dd></div><div><dt>Cerrar al llegar a</dt><dd>{policy.closeDte} días del vencimiento</dd></div></>}</dl>;
}

export default function F5ControlPanel({ available, operations, preparedOpening, onChange }: { available: boolean; operations: F5Operation[]; preparedOpening: F5OpenRequest | null; onChange(): void }) {
  const [control, setControl] = useState<F5Control | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [riskDraft, setRiskDraft] = useState<RiskDraft>(emptyRisk);
  const [source, setSource] = useState('');
  const [policyKind, setPolicyKind] = useState<F5PlanPolicy['kind']>('exit');
  const [startDate, setStartDate] = useState(dateNY);
  const [endDate, setEndDate] = useState(futureDate);
  const [maxActions, setMaxActions] = useState('4');
  const [maxCapital, setMaxCapital] = useState('1000');
  const [minDte, setMinDte] = useState('14');
  const [maxDte, setMaxDte] = useState('45');
  const [minStrike, setMinStrike] = useState('');
  const [maxStrike, setMaxStrike] = useState('');
  const [minPremium, setMinPremium] = useState('0.10');
  const [rollAtDte, setRollAtDte] = useState('7');
  const [maxDebit, setMaxDebit] = useState('0');
  const [minCredit, setMinCredit] = useState('0');
  const [deltaThreshold, setDeltaThreshold] = useState('20');
  const [maxShares, setMaxShares] = useState('50');
  const [intervalSeconds, setIntervalSeconds] = useState('60');
  const [stopLossPct, setStopLossPct] = useState('10');
  const [takeProfitPct, setTakeProfitPct] = useState('20');
  const [closeDte, setCloseDte] = useState('1');
  const [activation, setActivation] = useState<F5AutomationPlan | null>(null);
  const [resumeReview, setResumeReview] = useState(false);
  const mounted = useRef(true);
  const actionLock = useRef(false);
  const fetchSequence = useRef(0);
  const riskDirty = useRef(false);
  const availableRef = useRef(available);
  availableRef.current = available;

  const update = useCallback((value: F5Control) => {
    setControl(value);
    if (!riskDirty.current) setRiskDraft(Object.fromEntries(riskFields.map(field => [field.key, String(value.settings[field.key])])) as RiskDraft);
  }, []);
  const load = useCallback(async () => {
    if (!availableRef.current) return;
    const sequence = ++fetchSequence.current;
    setLoading(true);
    try {
      const value = await request<F5Control>();
      if (mounted.current && sequence === fetchSequence.current) { update(value); setError(''); }
    } catch (failure) {
      if (mounted.current && sequence === fetchSequence.current) { setControl(null); setError(failure instanceof Error ? failure.message : 'No se pudo actualizar el control F5.'); }
    } finally { if (mounted.current && sequence === fetchSequence.current) setLoading(false); }
  }, [update]);
  useEffect(() => {
    mounted.current = true;
    if (available) void load(); else { setControl(null); fetchSequence.current++; }
    const timer = setInterval(() => { if (availableRef.current && !actionLock.current) void load(); }, 15000);
    return () => { mounted.current = false; fetchSequence.current++; clearInterval(timer); };
  }, [available, load]);

  const selectedOperation = source === 'initial' ? null : operations.find(operation => operation.id === source) ?? null;
  const selectedStrategy = source === 'initial' ? preparedOpening?.strategy : selectedOperation?.strategy;
  const eligibleSources = operations.filter(operation => operation.action === 'open' && Number(operation.brokerOrder?.filled_qty ?? 0) > 0 && !pending(operation));
  const risk = control?.risk;
  const activePlans = control?.plans.filter(plan => plan.enabled) ?? [];
  const staleHealth = !!control?.health.lastCompletedAt && Date.now() - Date.parse(control.health.lastCompletedAt) > 240000;

  async function act(body: unknown, success: string) {
    if (!availableRef.current || actionLock.current) return false;
    actionLock.current = true; setBusy(true); setError(''); setNotice(''); fetchSequence.current++;
    try {
      const value = await request<F5Control>(body);
      if (mounted.current) { update(value); setNotice(success); setActivation(null); setResumeReview(false); onChange(); }
      return true;
    } catch (failure) { if (mounted.current) { setError(`${failure instanceof Error ? failure.message : 'No se confirmó el cambio.'} Actualiza el estado para comprobar el resultado antes de repetirlo.`); setActivation(null); setResumeReview(false); } return false; }
    finally { actionLock.current = false; if (mounted.current) { setBusy(false); void load(); } }
  }
  function saveRisk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const settings = Object.fromEntries(riskFields.map(field => [field.key, Number(riskDraft[field.key])])) as Omit<F5RiskSettings, 'paused'>;
    if (Object.values(settings).some(value => !Number.isFinite(value) || value <= 0)) { setError('Los límites deben ser importes positivos.'); return; }
    riskDirty.current = false;
    void act({ action: 'risk', settings }, 'Límites F5 guardados. El servicio comprueba cada operación con esta configuración.');
  }
  function chooseSource(value: string) {
    setSource(value); setActivation(null); setError('');
    const operation = operations.find(item => item.id === value);
    const strategy = value === 'initial' ? preparedOpening?.strategy : operation?.strategy;
    setPolicyKind(strategy === 'wheel' || strategy === 'pmcc' || strategy === 'gamma' ? strategy : 'exit');
    setMaxCapital(String(value === 'initial' ? preparedOpening?.maxCapitalUsd ?? 1000 : operation?.request.maxCapitalUsd ?? 1000));
  }
  function createPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source || source === 'initial' && !preparedOpening || source !== 'initial' && !selectedOperation) { setError('Selecciona una apertura confirmada o una revisión actual de apertura.'); return; }
    const policy: F5PlanPolicy = policyKind === 'wheel' ? { kind: 'wheel', minDte: Number(minDte), maxDte: Number(maxDte), minStrike: Number(minStrike), maxStrike: Number(maxStrike), minPremium: Number(minPremium) }
      : policyKind === 'pmcc' ? { kind: 'pmcc', rollAtDte: Number(rollAtDte), minDte: Number(minDte), maxDte: Number(maxDte), minStrike: Number(minStrike), maxStrike: Number(maxStrike), maxDebit: Number(maxDebit), minCredit: Number(minCredit) }
      : policyKind === 'gamma' ? { kind: 'gamma', deltaThreshold: Number(deltaThreshold), maxShares: Number(maxShares), intervalSeconds: Number(intervalSeconds) }
      : { kind: 'exit', stopLossPct: Number(stopLossPct), takeProfitPct: Number(takeProfitPct), closeDte: Number(closeDte) };
    const plan: F5AutomationPlanInput = { ...(source === 'initial' ? { initial: preparedOpening! } : { operationId: source }), startDate, endDate, maxActions: Number(maxActions), maxCapitalUsd: Number(maxCapital), policy };
    void act({ action: 'create-plan', plan }, 'Plan F5 guardado y desactivado. Revisa sus reglas y límites antes de activarlo.');
  }
  function numberField(label: string, value: string, setter: (value: string) => void, min = '0', step = '1') {
    return <label className="f5-field">{label}<input aria-label={label} type="number" min={min} step={step} value={value} required onChange={event => setter(event.target.value)}/></label>;
  }

  return <div className="f5-control-panel" aria-label="Control y automatización F5">
    <section className="panel"><div className="f5-heading"><div><span className="f5-kicker"><ShieldCheck size={14}/>RIESGO DE LA CUENTA Y SERVICIO F5</span><h2>Límites, pausa y seguimiento continuo</h2><p>Los planes se ejecutan en el servicio de servidor mientras permanezca encendido y conectado a Alpaca Paper.</p></div><button className="secondary-button" disabled={!available || loading || busy} onClick={() => void load()}><RefreshCw size={14} className={loading ? 'spin' : ''}/>Actualizar control F5</button></div>
      {!available && <p className="f5-empty">Conecta la cuenta Paper para recuperar sus límites, planes y evaluaciones.</p>}
      {control && <><div className="f5-control-status"><span className={`f5-status ${control.settings.paused ? '' : 'ready'}`}>{control.settings.paused ? 'Nuevas entradas pausadas' : 'Sin pausa manual'}</span><span>{control.health.automationEnabled ? 'Automatización habilitada en el servicio' : 'Automatización desactivada en el servicio'}</span><span>{control.health.running ? 'Evaluación en curso' : 'Entre evaluaciones'}</span></div><div className="f5-health-times"><span>Último inicio: <strong>{time(control.health.lastStartedAt)}</strong></span><span>Última evaluación completada: <strong>{time(control.health.lastCompletedAt)}</strong></span></div>{staleHealth && <p className="f5-error">No hay una evaluación completada reciente. Revisa que el servicio continúe ejecutándose.</p>}{control.health.lastError && <p className="f5-error" role="alert">{control.health.lastError}</p>}
        {risk ? <><div className="f5-account f5-control-metrics"><div><span>Resultado de la cuenta hoy</span><strong className={risk.dailyPnlUsd < 0 ? 'negative' : 'positive'}>{cash(risk.dailyPnlUsd)}</strong></div><div><span>Exposición bruta</span><strong>{cash(risk.grossExposureUsd)}</strong></div><div><span>Exposición en primas</span><strong>{cash(risk.premiumExposureUsd)}</strong></div><div><span>Delta neta observada</span><strong>{risk.netDelta === null ? 'No disponible' : risk.netDelta.toFixed(2)}</strong></div></div><p className="f5-muted">Corte: {time(risk.updatedAt)} · sesión de Nueva York: {risk.date}. La pérdida diaria compara el patrimonio con la primera lectura conservada del día e incluye toda la cuenta.</p>{(risk.uncertain || risk.blockedReasons.length > 0) && <div className="f5-risk-blocked" role="status"><strong>{risk.uncertain ? 'Hay información de riesgo pendiente de verificar.' : 'Hay límites que bloquean nuevas operaciones.'}</strong><ul>{risk.blockedReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div>}</> : <p className="f5-muted">Todavía no hay una lectura de riesgo confirmada. El servicio no debe enviar operaciones con información incierta.</p>}
        <form onSubmit={saveRisk} className="f5-risk-form"><fieldset disabled={busy} className="f5-fields-reset"><legend>Límites globales F5</legend><div className="f5-form-grid">{riskFields.map(field => <label className="f5-field" key={field.key}>{field.label}<input aria-label={field.label} type="number" min="0.01" step="0.01" value={riskDraft[field.key]} required onChange={event => { riskDirty.current = true; setRiskDraft(previous => ({ ...previous, [field.key]: event.target.value })); }}/><small>{field.unit}</small></label>)}</div><div className="f5-control-actions"><button className="secondary-button" type="submit" disabled={!available}>Guardar límites F5</button><button type="button" className="secondary-button" disabled={!available} onClick={() => control.settings.paused ? setResumeReview(true) : void act({ action: 'pause' }, 'Nuevas entradas F5 pausadas. Revisa el registro para seguir las operaciones existentes.')} >{control.settings.paused ? <Play size={14}/> : <Pause size={14}/>} {control.settings.paused ? 'Revisar reanudación F5' : 'Pausar nuevas entradas F5'}</button></div></fieldset></form>
        {resumeReview && <div className="f5-control-review" aria-label="Revisión de reanudación F5"><h3>Reanudar los planes habilitados</h3><p>Hay {activePlans.length} planes habilitados. Al retirar la pausa podrán enviar las acciones previstas por sus políticas, ventanas y límites.</p><div className="f5-control-actions"><button className="secondary-button" disabled={busy} onClick={() => setResumeReview(false)}>Volver</button><button className="primary-button" disabled={busy} onClick={() => void act({ action: 'resume' }, 'Pausa manual retirada. Los planes habilitados vuelven a evaluarse con sus límites.')}><Play size={14}/>Confirmar reanudación F5</button></div></div>}
      </>}
    </section>

    <section className="panel f5-plan-builder"><div className="f5-heading"><div><span className="f5-kicker"><Settings2 size={14}/>AUTORIZACIÓN ACOTADA POR PLAN</span><h2>Prepara una política automática</h2><p>Define qué puede hacer el servicio, hasta cuándo y con qué capital. Guardar el plan lo mantiene desactivado.</p></div></div><form onSubmit={createPlan}><fieldset className="f5-fields-reset" disabled={busy || !available || !control}><div className="f5-form-grid"><label className="f5-field">Origen del plan F5<select aria-label="Origen del plan F5" value={source} required onChange={event => chooseSource(event.target.value)}><option value="">Selecciona una apertura</option>{preparedOpening && <option value="initial">Revisión actual · {preparedOpening.underlying} · {strategyName(preparedOpening.strategy)}</option>}{eligibleSources.map(operation => <option value={operation.id} key={operation.id}>{operation.underlying} · {strategyName(operation.strategy)} · {operation.clientOrderId.slice(-12)}</option>)}</select></label><label className="f5-field">Política del plan F5<select aria-label="Política del plan F5" value={policyKind} onChange={event => setPolicyKind(event.target.value as F5PlanPolicy['kind'])}>{selectedStrategy && selectedStrategy !== 'backspread' && <option value={selectedStrategy}>{policyLabels[selectedStrategy]}</option>}<option value="exit">{policyLabels.exit}</option></select></label><label className="f5-field">Inicio del plan F5<input aria-label="Inicio del plan F5" type="date" value={startDate} required onChange={event => setStartDate(event.target.value)}/></label><label className="f5-field">Fin del plan F5<input aria-label="Fin del plan F5" type="date" min={startDate} value={endDate} required onChange={event => setEndDate(event.target.value)}/></label>{numberField('Máximo de acciones del plan F5', maxActions, setMaxActions, '1')}{numberField('Capital máximo del plan F5', maxCapital, setMaxCapital, '1', '0.01')}</div>
      {(policyKind === 'wheel' || policyKind === 'pmcc') && <div className="f5-form-grid f5-plan-policy-fields">{numberField('Días mínimos del nuevo contrato F5', minDte, setMinDte, '1')}{numberField('Días máximos del nuevo contrato F5', maxDte, setMaxDte, '1')}{numberField('Strike mínimo del plan F5', minStrike, setMinStrike, '0.01', '0.01')}{numberField('Strike máximo del plan F5', maxStrike, setMaxStrike, '0.01', '0.01')}{policyKind === 'wheel' ? numberField('Prima mínima de Wheel', minPremium, setMinPremium, '0.01', '0.01') : <>{numberField('Renovar PMCC a días de vencer', rollAtDte, setRollAtDte, '0')}{numberField('Débito máximo de renovación PMCC', maxDebit, setMaxDebit, '0', '0.01')}{numberField('Crédito mínimo de renovación PMCC', minCredit, setMinCredit, '0', '0.01')}</>}</div>}
      {policyKind === 'gamma' && <div className="f5-form-grid f5-plan-policy-fields">{numberField('Umbral de Delta de Gamma', deltaThreshold, setDeltaThreshold, '1', '0.1')}{numberField('Máximo de acciones de Gamma', maxShares, setMaxShares, '1')}{numberField('Intervalo de cobertura Gamma en segundos', intervalSeconds, setIntervalSeconds, '60')}</div>}
      {policyKind === 'exit' && <div className="f5-form-grid f5-plan-policy-fields">{numberField('Pérdida porcentual de salida F5', stopLossPct, setStopLossPct, '0.1', '0.1')}{numberField('Ganancia porcentual de salida F5', takeProfitPct, setTakeProfitPct, '0.1', '0.1')}{numberField('Cerrar F5 a días del vencimiento', closeDte, setCloseDte, '0')}</div>}
      <p className="f5-strategy-note">{policyKind === 'wheel' ? 'El servicio consulta las asignaciones y las acciones actuales antes de cambiar de PUT con efectivo a CALL cubierta. La selección de nuevos contratos queda limitada por strikes, días y prima mínima.' : policyKind === 'pmcc' ? 'La renovación cierra la call corta vigente y abre otra dentro de los rangos autorizados. La call larga, la cobertura y las ejecuciones previas se verifican antes de enviar una orden combinada.' : policyKind === 'gamma' ? 'El servicio usa las deltas observadas para ajustar acciones completas dentro del umbral, el intervalo y el máximo autorizados. Las ventas reducen acciones disponibles y no abren posiciones cortas.' : 'El servicio comprueba las condiciones de ganancia, pérdida y vencimiento. Las órdenes son límite: alcanzar un umbral no garantiza su ejecución ni un precio final.'}</p><p className="f5-muted">Una acción del plan es un envío de orden, no una garantía de ejecución. Los estados inciertos bloquean decisiones posteriores. La apertura de una revisión actual usa sus contratos y su precio límite; solo se envía después de activar el plan.</p><button className="secondary-button" type="submit" disabled={!source || busy || !available || !control}>Guardar plan F5 desactivado</button></fieldset></form></section>

    <section className="panel f5-automation-plans"><div className="f5-heading"><div><span className="f5-kicker">PLANES CONSERVADOS EN EL SERVICIO</span><h2>Revisa, activa y supervisa</h2><p>Desactivar un plan detiene sus próximos envíos. Las órdenes ya recibidas por Alpaca deben conciliarse o cancelarse por separado.</p></div></div>{control?.plans.length ? <div className="f5-plan-list">{control.plans.map(plan => <article className="f5-plan-card" key={plan.id}><div className="f5-order-card-heading"><div><strong>{plan.underlying} · {strategyName(plan.strategy)}</strong><span>{plan.startDate} → {plan.endDate} · {plan.actions}/{plan.maxActions} acciones enviadas</span></div><span className={`f5-status ${plan.enabled ? 'ready' : ''}`}>{plan.enabled ? 'Habilitado' : 'Desactivado'}</span></div><PolicySummary policy={plan.policy}/><p className="f5-muted">Capital máximo: {cash(plan.maxCapitalUsd)} · última evaluación: {time(plan.lastEvaluatedAt)}{plan.lastActionAt ? ` · último envío: ${time(plan.lastActionAt)}` : ''}.</p>{plan.holdReason && <p className="f5-plan-hold">{plan.holdReason}</p>}<div className="f5-control-actions"><button className={plan.enabled ? 'secondary-button' : 'primary-button small'} disabled={busy || !available || !control.health.automationEnabled && !plan.enabled} onClick={() => plan.enabled ? void act({ action: 'disable-plan', planId: plan.id }, 'Plan F5 desactivado. Las órdenes existentes conservan su estado en Alpaca.') : setActivation(plan)}>{plan.enabled ? 'Desactivar plan F5' : 'Revisar activación F5'}</button></div></article>)}</div> : <p className="f5-empty">Todavía no hay planes F5 guardados. Preparar una orden manual no activa su automatización.</p>}
      {activation && <div className="f5-control-review" aria-label="Revisión de activación automática F5"><span className="f5-kicker">CONFIRMACIÓN DE ÓRDENES AUTOMÁTICAS EN PAPER</span><h3>Activar {strategyName(activation.strategy)} · {activation.underlying}</h3><p>Autorizas al servicio a enviar hasta {activation.maxActions} órdenes entre {activation.startDate} y {activation.endDate}, con capital máximo de {cash(activation.maxCapitalUsd)}, según esta política:</p><PolicySummary policy={activation.policy}/>{activation.initial && <div className="f5-plan-initial"><strong>Apertura incluida en esta autorización</strong><p>{activation.initial.quantity} unidades · contratos {activation.initial.contracts.join(' + ')} · límite {cash(activation.initial.limitPrice)} · capital {cash(activation.initial.maxCapitalUsd)}.</p></div>}<p>El servicio puede seguir evaluando con el navegador cerrado mientras permanezca encendido. La habilitación del servidor, la pausa y los límites de riesgo siguen aplicándose.</p><div className="f5-control-actions"><button className="secondary-button" disabled={busy} onClick={() => setActivation(null)}>Volver sin activar</button><button className="primary-button" disabled={busy || !available || !control?.health.automationEnabled} onClick={() => void act({ action: 'enable-plan', planId: activation.id }, 'Plan automático F5 activado. Consulta sus evaluaciones y órdenes en el registro.')}><Check size={14}/>Confirmar y activar plan automático F5</button></div></div>}
      {activePlans.length > 0 && <div className="f5-control-tick"><p>La siguiente evaluación puede enviar órdenes dentro de las políticas de los {activePlans.length} planes habilitados.</p><button className="secondary-button" disabled={busy || !available || !control?.health.automationEnabled || control.health.running} onClick={() => void act({ action: 'tick' }, 'Evaluación F5 solicitada. Comprueba el registro y las ejecuciones confirmadas por Alpaca.')}><Play size={14}/>Evaluar planes F5 activos ahora</button></div>}
    </section>

    {error && <p className="f5-error" role="alert">{error}</p>}{notice && <p className="f5-notice" role="status">{notice}</p>}{busy && <p className="f5-control-busy" role="status"><LoaderCircle size={14} className="spin"/>Consultando y conservando el resultado en el servicio…</p>}
    <section className="panel f5-control-events"><div className="f5-heading"><div><span className="f5-kicker"><Clock3 size={14}/>EVALUACIONES Y TRANSICIONES</span><h2>Registro del ciclo y la automatización</h2><p>Las decisiones, bloqueos y acciones del servicio conservan su referencia de plan y operación.</p></div></div>{control?.events.length ? <div className="f5-control-event-list">{control.events.slice(0, 60).map(event => <article key={event.id}><div><strong>{eventLabels[event.status] ?? event.status}</strong><small>{time(event.time)}</small></div><p>{event.message}</p>{event.planId && <small>Plan: {event.planId}</small>}{event.operationId && <small>Operación: {event.operationId}</small>}</article>)}</div> : <p className="f5-empty">Las próximas evaluaciones y los eventos de ciclo aparecerán aquí.</p>}</section>
  </div>;
}
