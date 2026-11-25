"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Clock3, ExternalLink, Layers3, LoaderCircle, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { strategies } from '../strategies/catalog';
import type { StrategyId } from '../../cores/compartido/types';
import type { F5Contract, F5Operation, F5Request, F5Side, F5Status, F5Feed } from './types';
import F5ReportPanel from './f5-report-panel';
import './f5-panel.css';

const cash = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const dateTime = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('es-MX', { timeZone: 'America/Mazatlan' }) : 'Sin fecha de cotización';
const title = (strategy: StrategyId) => strategies.find(item => item.id === strategy)?.title ?? strategy;
const stateLabels: Record<F5Operation['state'], string> = {
  preview: 'En revisión', reserved: 'Envío reservado', submitted: 'Enviada al bróker', partial: 'Ejecución parcial', filled: 'Ejecutada',
  canceled: 'Cancelada', rejected: 'Rechazada', expired: 'Vencida', ambiguous: 'Confirmación pendiente',
};
const intentLabels = { buy_to_open: 'Comprar para abrir', sell_to_open: 'Vender para abrir', buy_to_close: 'Comprar para cerrar', sell_to_close: 'Vender para cerrar' };
const pending = (operation: F5Operation) => ['reserved', 'submitted', 'partial', 'ambiguous'].includes(operation.state);
const contractLabel = (contract: F5Contract) => `${contract.expiry} · ${contract.type.toUpperCase()} ${cash(contract.strike)} · bid ${cash(contract.bid)} / ask ${cash(contract.ask)}`;
function nextFriday(years = 0) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + years);
  date.setUTCDate(date.getUTCDate() + ((5 - date.getUTCDay() + 7) % 7 || 7));
  return date.toISOString().slice(0, 10);
}
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
  const result = await response.json().catch(() => null) as T & { error?: { message?: string;code?:string } | string };
  if (!response.ok || !result) {
    const message = typeof result?.error === 'string' ? result.error : result?.error?.message;
    const code=typeof result?.error==='object'?result.error?.code:undefined;
    throw new F5RequestError(message || 'No se pudo consultar el bróker. Actualiza el estado antes de continuar.',code??'');
  }
  return result;
}
class F5RequestError extends Error {
  code:string;
  constructor(message:string,code:string){super(message);this.code=code;}
}

export default function F5Panel({ underlying: initialUnderlying, initialStrategy, initialWheelPhase = 'put', mode = 'trade', allowTrading=false, broker='alpaca',onActivity }: { underlying: string; initialStrategy: StrategyId; initialWheelPhase?: 'put' | 'call'; mode?: 'trade' | 'orders' | 'portfolio'; allowTrading?:boolean;broker?:'alpaca'|'webull';onActivity?:()=>void }) {
  const endpoint=broker==='webull'?'/api/webull-f5':'/api/f5',brokerLabel=broker==='webull'?'Webull Sandbox':'Alpaca Paper',brokerName=broker==='webull'?'Webull':'Alpaca';
  const post = <T,>(body:unknown)=>api<T>(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const [tab, setTab] = useState<'operations' | 'report'>('operations');
  const [status, setStatus] = useState<F5Status | null>(null);
  const [statusError, setStatusError] = useState('');
  const [statusErrorCode,setStatusErrorCode]=useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [strategy, setStrategy] = useState<StrategyId>(initialStrategy);
  const [underlying, setUnderlying] = useState(initialUnderlying);
  const [wheelPhase, setWheelPhase] = useState<'put' | 'call'>(initialWheelPhase);
  const [expiry, setExpiry] = useState(nextFriday);
  const [longExpiry, setLongExpiry] = useState(() => nextFriday(1));
  const [contracts, setContracts] = useState<F5Contract[]>([]);
  const [chainComplete, setChainComplete] = useState(true);
  const [chainFeed, setChainFeed] = useState<F5Feed>(broker==='webull'?'webull-sandbox':'indicative');
  const [loadedKey, setLoadedKey] = useState('');
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError,setChainError]=useState('');
  const [selection, setSelection] = useState<string[]>(['', '']);
  const [quantity, setQuantity] = useState('1');
  const [limitPrice, setLimitPrice] = useState('');
  const [budget, setBudget] = useState('1000');
  const [preview, setPreview] = useState<F5Operation | null>(null);
  const [management, setManagement] = useState<{ operation: F5Operation; action: 'close' | 'hedge' | 'roll' } | null>(null);
  const [rollExpiry, setRollExpiry] = useState(nextFriday);
  const [rollContracts, setRollContracts] = useState<F5Contract[]>([]);
  const [rollContract, setRollContract] = useState('');
  const [rollLoading, setRollLoading] = useState(false);
  const [managementLimit, setManagementLimit] = useState('');
  const [managementBudget, setManagementBudget] = useState('1000');
  const [hedgeSide, setHedgeSide] = useState<F5Side>('buy');
  const [hedgeQuantity, setHedgeQuantity] = useState('1');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const statusSequence = useRef(0);
  const chainSequence = useRef(0);
  const rollSequence = useRef(0);
  const formSequence = useRef(0);
  const busyRef = useRef(false);
  const attempted = useRef(new Set<string>());
  const [attemptedIds,setAttemptedIds]=useState<Set<string>>(()=>new Set());
  const mounted = useRef(true);
  const contractsTimer=useRef<ReturnType<typeof setTimeout>|null>(null);

  const refresh = useCallback(async () => {
    const sequence = ++statusSequence.current;
    setRefreshing(true);
    try {
      const result = await api<F5Status>(endpoint+'?resource=status');
      if (mounted.current && sequence === statusSequence.current) { setStatus(result); setStatusError(''); setStatusErrorCode(''); }
    } catch (failure) {
      if (mounted.current && sequence === statusSequence.current) {
        setStatus(null);
        setStatusError(failure instanceof Error ? failure.message : 'No se pudo actualizar la cuenta.');
        setStatusErrorCode(failure instanceof F5RequestError?failure.code:'');
      }
    } finally { if (mounted.current && sequence === statusSequence.current) setRefreshing(false); }
  }, [endpoint]);
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(()=>{if(mounted.current)void refresh();});
    const timer = setInterval(() => { if (!busyRef.current) void refresh(); }, 15000);
    return () => { mounted.current = false; statusSequence.current++; chainSequence.current++; rollSequence.current++; formSequence.current++; clearInterval(timer); };
  }, [refresh]);
  useEffect(() => { let active=true;queueMicrotask(()=>{if(!active)return;setUnderlying(initialUnderlying); setStrategy(initialStrategy); setWheelPhase(initialWheelPhase); setSelection(['', '']); setPreview(null); setManagement(null); formSequence.current++;});return()=>{active=false;}; }, [initialUnderlying, initialStrategy, initialWheelPhase]);
  useEffect(() => {
    if (!preview) return;
    queueMicrotask(()=>setNow(Date.now()));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [preview]);

  const chainKey = `${underlying}|${expiry}|${strategy === 'pmcc' ? longExpiry : ''}`;
  const validChain = loadedKey === chainKey;
  const account = status?.account;
  const available = Boolean(status?.configured && account && !statusError);
  const canSend = allowTrading && available && status?.enabled && status.marketOpen && !account?.blocked;
  const operations = status?.operations.filter(operation => operation.state !== 'preview') ?? [];
  const pendingOperations = operations.filter(pending);
  const expired = !!preview && Date.parse(preview.expiresAt) <= now;
  const selectedContracts = selection.map(symbol => contracts.find(contract => contract.symbol === symbol));

  const invalidate=useCallback(() => { formSequence.current++; setPreview(null); setError(''); setNotice(''); },[]);
  function changeStrategy(next: StrategyId) { invalidate(); setStrategy(next); setSelection(['', '']); }
  const loadContracts=useCallback(async () => {
    if(contractsTimer.current!==null){clearTimeout(contractsTimer.current);contractsTimer.current=null;}
    invalidate();
    const sequence = ++chainSequence.current;
    const requestedKey = chainKey;
    setChainLoading(true); setChainError(''); setSelection(['', '']); setContracts([]); setLoadedKey('');
    try {
      const expiries = strategy === 'pmcc' ? [...new Set([expiry, longExpiry])] : [expiry];
      const responses = await Promise.all(expiries.map(value => api<{ contracts: F5Contract[]; complete: boolean; feed: F5Feed }>(`${endpoint}?resource=contracts&underlying=${encodeURIComponent(underlying)}&expiry=${encodeURIComponent(value)}`)));
      if (!mounted.current || sequence !== chainSequence.current) return;
      setContracts([...new Map(responses.flatMap(result => result.contracts).map(contract => [contract.symbol, contract])).values()].sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike));
      setChainComplete(responses.every(result => result.complete)); setChainFeed(responses[0]?.feed ?? 'indicative'); setLoadedKey(requestedKey);
    } catch (failure) { if (mounted.current && sequence === chainSequence.current) setChainError(failure instanceof Error ? failure.message : 'No se pudieron cargar los contratos.'); }
    finally { if (mounted.current && sequence === chainSequence.current) setChainLoading(false); }
  },[chainKey,strategy,expiry,longExpiry,underlying,invalidate,endpoint]);
  useEffect(()=>{
    let active=true;queueMicrotask(()=>{if(!active)return;setLoadedKey('');setSelection(['','']);setContracts([]);setChainError('');
    if(mode!=='trade'||tab!=='operations'||!available||!/^[A-Z][A-Z0-9.-]{0,14}$/.test(underlying)||!expiry||strategy==='pmcc'&&!longExpiry){setChainLoading(false);return;}
    setChainLoading(true);
    contractsTimer.current=setTimeout(()=>void loadContracts(),300);});
    return ()=>{active=false;if(contractsTimer.current!==null){clearTimeout(contractsTimer.current);contractsTimer.current=null;}chainSequence.current++;};
  },[available,mode,tab,loadContracts,underlying,expiry,strategy,longExpiry]);
  async function prepare(request: F5Request) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice(''); setPreview(null);
    const sequence = formSequence.current;
    try {
      const result = await post<{ operation: F5Operation }>({ action: 'preview', request });
      if (mounted.current && sequence === formSequence.current) { setPreview(result.operation); setNow(Date.now()); }
    } catch (failure) { if (mounted.current && sequence === formSequence.current) setError(failure instanceof Error ? failure.message : 'No se pudo revisar la orden.'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function prepareOpening(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validChain || selection.slice(0, strategy === 'wheel' ? 1 : 2).some(symbol => !symbol)) { setError('Consulta el vencimiento y selecciona cada contrato de la estrategia.'); return; }
    setManagement(null);
    void prepare({ action: 'open', strategy, underlying, quantity: Number(quantity), contracts: selection.slice(0, strategy === 'wheel' ? 1 : 2), ...(strategy === 'wheel' ? { wheelPhase } : {}), limitPrice: Number(limitPrice), maxCapitalUsd: Number(budget) });
  }
  async function submit() {
    if (!preview || busyRef.current || attempted.current.has(preview.id) || expired || !canSend) return;
    busyRef.current = true; attempted.current.add(preview.id); setAttemptedIds(new Set(attempted.current)); setBusy(true); setError(''); setNotice('');
    try {
      const result = await post<{ operation: F5Operation }>({ action: 'submit', previewId: preview.id });
      if (!mounted.current) return;
      setPreview(null); setManagement(null);
      setNotice(`${stateLabels[result.operation.state]}. Referencia: ${result.operation.clientOrderId}. ${result.operation.message ?? 'Consulta las cantidades ejecutadas y el estado confirmado por el bróker.'}`);
    } catch (failure) {
      if (mounted.current) setError(`${failure instanceof Error ? failure.message : 'No se recibió confirmación del envío.'} Actualiza el estado y consulta esta referencia antes de preparar otra operación: ${preview.clientOrderId}.`);
    } finally { busyRef.current = false; if (mounted.current) { setBusy(false); await refresh();onActivity?.(); } }
  }
  async function cancel(operation: F5Operation) {
    if (busyRef.current||!allowTrading) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await post<{ operation: F5Operation }>({ action: 'cancel', operationId: operation.id });
      if (mounted.current) setNotice(`Cancelación consultada: ${stateLabels[result.operation.state]}. La solicitud puede coincidir con una ejecución; revisa las cantidades confirmadas.`);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'No se pudo confirmar la cancelación.'); }
    finally { busyRef.current = false; if (mounted.current) { setBusy(false); await refresh();onActivity?.(); } }
  }
  function manage(operation: F5Operation, action: 'close' | 'hedge' | 'roll') {
    invalidate(); rollSequence.current++; setManagement({ operation, action }); setManagementLimit(''); setManagementBudget('1000'); setHedgeSide('buy'); setHedgeQuantity('1'); setRollContracts([]); setRollContract(''); setRollLoading(false);
  }
  async function loadRollContracts() {
    if (!management || management.action !== 'roll' || busyRef.current || rollLoading) return;
    invalidate(); const sequence = ++rollSequence.current; setRollLoading(true); setRollContracts([]); setRollContract('');
    try {
      const result = await api<{ contracts: F5Contract[]; complete: boolean; feed: F5Feed }>(`${endpoint}?resource=contracts&underlying=${encodeURIComponent(management.operation.underlying)}&expiry=${encodeURIComponent(rollExpiry)}`);
      if (mounted.current && sequence === rollSequence.current) setRollContracts(result.contracts.filter(contract => contract.type === 'call' && contract.expiry === rollExpiry && contract.tradable && contract.size === 100 && contract.style === 'american'));
    } catch (failure) { if (mounted.current && sequence === rollSequence.current) setError(failure instanceof Error ? failure.message : 'No se pudieron consultar las calls para la renovación.'); }
    finally { if (mounted.current && sequence === rollSequence.current) setRollLoading(false); }
  }
  function prepareManagement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!management) return;
    const base = { operationId: management.operation.id, limitPrice: Number(managementLimit), maxCapitalUsd: Number(managementBudget) };
    if (management.action === 'roll' && !rollContract) { setError('Consulta y selecciona la nueva call corta para revisar la renovación.'); return; }
    void prepare(management.action === 'close' ? { action: 'close', ...base } : management.action === 'roll' ? { action: 'roll', ...base, newShortContract: rollContract,...(broker==='webull'?{step:management.operation.lifecycle?.rollPhase??'close-short'}:{}) } : { action: 'hedge', ...base, side: hedgeSide, quantity: Number(hedgeQuantity) });
  }

  const selectionLabels = strategy === 'wheel' ? [wheelPhase === 'put' ? 'PUT para vender con efectivo reservado' : 'CALL para vender cubierta por acciones'] : strategy === 'pmcc' ? ['CALL larga · comprar 1', 'CALL corta · vender 1'] : strategy === 'backspread' ? ['CALL de strike inferior · vender 1', 'CALL de strike superior · comprar 2'] : ['CALL · comprar 1', 'PUT · comprar 1'];
  function choices(index: number) {
    return contracts.filter(contract => {
      if (!contract.tradable || contract.size !== 100 || contract.style !== 'american') return false;
      if (strategy === 'wheel') return contract.type === (wheelPhase === 'put' ? 'put' : 'call') && contract.expiry === expiry;
      if (strategy === 'pmcc') return contract.type === 'call' && contract.expiry === (index === 0 ? longExpiry : expiry);
      if (strategy === 'backspread') return contract.type === 'call' && contract.expiry === expiry;
      return contract.type === (index === 0 ? 'call' : 'put') && contract.expiry === expiry;
    });
  }

  return <div className="f5-workspace" aria-label={`Opciones F5 en ${brokerLabel}`}>
    <section className="panel f5-connection">
      <div className="f5-heading"><div><span className="f5-kicker"><Layers3 size={14}/>F5 · {brokerLabel.toUpperCase()}</span><h2>{mode === 'portfolio' ? 'Tu cuenta y posiciones de opciones' : mode === 'orders' ? 'Órdenes y ejecuciones del bróker' : `Contratos y estrategias en ${brokerLabel}`}</h2><p>Contratos existentes y ejecuciones de {brokerLabel}, con saldo virtual.</p></div><button className="secondary-button" disabled={refreshing || busy} onClick={() => void refresh()}><RefreshCw size={14} className={refreshing ? 'spin' : ''}/>{refreshing ? 'Consultando…' : 'Actualizar estado'}</button></div>
      <div className="f5-status-row"><span className={`f5-status ${available ? 'ready' : ''}`}>{available ? 'Cuenta consultada' : refreshing && !status ? 'Conectando con el servicio' : 'Conexión pendiente'}</span>{available && <><span>{status?.marketOpen ? 'Mercado abierto' : 'Mercado cerrado'}</span><span>{account?.optionsPermissionSource==='preview'?'Permisos: revisión del proveedor':`Opciones nivel ${account?.optionsLevel??'no confirmado'}`}</span><span>{status?.enabled ? 'Envío habilitado' : 'Envío desactivado'}</span></>}</div>
      {statusError && <p className="f5-error" role="alert">{statusError}</p>}{status?.message && <p className="f5-muted">{status.message}</p>}
      {!available && !refreshing && statusErrorCode==='auth_required' && <a className="f5-external" href="/signin-with-chatgpt?return_to=%2F">Iniciar sesión con ChatGPT<ArrowRight size={13}/></a>}
      {!available && !refreshing && <details className="f5-setup"><summary>Cómo habilitar la conexión F5</summary><p>Inicia sesión con el propietario de la cuenta. Configura las credenciales de {brokerLabel} y el servicio de ejecución en el servidor; inicia <code>npm run trading:serve</code>. Habilita <code>{broker==='webull'?'WEBULL_MANUAL_ENABLED=true':'ALPACA_F5_ENABLED=true'}</code> en el terminal y en el servicio cuando vayas a enviar órdenes.</p><p>Las claves permanecen en el servidor. Una conexión incompleta muestra este estado y no genera contratos de ejemplo.</p></details>}
      {available && !status?.enabled && <p className="f5-muted">Puedes consultar contratos y revisar una orden. El envío requiere habilitar F5 en el servidor del terminal y en el servicio.</p>}
      {account?.blocked && <p className="f5-error" role="alert">{brokerName} indica que la cuenta está bloqueada para operar. Revisa su estado antes de enviar órdenes.</p>}
      {account && <div className="f5-account"><div><span>Patrimonio Paper</span><strong>{cash(account.equity)}</strong></div><div><span>Efectivo</span><strong>{cash(account.cash)}</strong></div><div><span>Poder de compra de opciones</span><strong>{cash(account.optionsBuyingPower)}</strong></div><div><span>Poder de compra de la cuenta</span><strong>{cash(account.buyingPower)}</strong></div></div>}
    </section>

    <p className="f5-muted">Órdenes manuales: {allowTrading?'habilitadas para revisar y confirmar en esta sesión':'deshabilitadas en esta sesión'}. Cada apertura, cierre, renovación o cobertura necesita una revisión y tu confirmación.</p>
    <nav className="f5-workspace-tabs" aria-label="Secciones de opciones F5"><button className={tab === 'operations' ? 'active' : ''} aria-current={tab === 'operations' ? 'page' : undefined} onClick={() => setTab('operations')}>Operaciones F5</button><button className={tab === 'report' ? 'active' : ''} aria-current={tab === 'report' ? 'page' : undefined} onClick={() => setTab('report')}>Reporte F5</button></nav>
    {tab === 'report' && <F5ReportPanel available={available} broker={broker}/>}
    {tab === 'operations' && <>
    {mode === 'trade' && <section className="panel f5-builder"><div className="f5-heading"><div><span className="f5-kicker">01 · PREPARA LA ESTRATEGIA</span><h2>Elige contratos y define tu límite</h2><p>Una revisión no envía órdenes. El servidor vuelve a comprobar la cuenta, las cotizaciones y la cobertura antes del envío.</p></div></div>
      <form onSubmit={prepareOpening}>
        <fieldset disabled={busy} className="f5-fields-reset"><div className="f5-form-grid">
          <label className="f5-field">Estrategia F5<select aria-label="Estrategia F5" value={strategy} onChange={event => changeStrategy(event.target.value as StrategyId)}>{strategies.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
          <label className="f5-field">Símbolo de la empresa<input aria-label="Empresa F5" value={underlying} maxLength={15} pattern="[A-Z][A-Z0-9.\-]*" required onChange={event => { invalidate(); setUnderlying(event.target.value.toUpperCase().trim()); setSelection(['', '']); }}/></label>
          {strategy === 'wheel' && <label className="f5-field">Fase de Wheel<select aria-label="Fase de Wheel" value={wheelPhase} onChange={event => { invalidate(); setWheelPhase(event.target.value as 'put' | 'call'); setSelection(['', '']); }}><option value="put">Vender PUT con efectivo</option><option value="call">Vender CALL con acciones</option></select></label>}
          <label className="f5-field">{strategy === 'pmcc' ? 'Vencimiento de la call corta' : 'Vencimiento de opciones'}<input aria-label="Vencimiento F5" type="date" value={expiry} required onChange={event => { invalidate(); setExpiry(event.target.value); }}/></label>
          {strategy === 'pmcc' && <label className="f5-field">Vencimiento de la call larga<input aria-label="Vencimiento largo F5" type="date" min={expiry} value={longExpiry} required onChange={event => { invalidate(); setLongExpiry(event.target.value); }}/></label>}
        </div><div className="f5-chain-action"><button className="secondary-button" type="button" disabled={!available || chainLoading || !underlying || !expiry || strategy === 'pmcc' && !longExpiry} onClick={() => void loadContracts()}>{chainLoading ? <LoaderCircle size={14} className="spin"/> : <RefreshCw size={14}/>}Consultar contratos de {brokerName}</button><span role="status">{chainLoading?`Consultando contratos de ${underlying}…`:validChain?`${contracts.length} contratos recibidos` : available?'Los contratos se consultan automáticamente al cambiar empresa o vencimiento.':'Conecta la cuenta para consultar contratos.'}</span></div>
        {chainError&&<p className="f5-error" role="alert">{chainError} Puedes reintentar con «Consultar contratos de {brokerName}».</p>}
        {validChain && <><p className="f5-feed">{chainFeed === 'webull-sandbox' ? 'Webull Sandbox ? cotizaciones retrasadas de pruebas; consulta la fecha de cada contrato.' : chainFeed === 'opra' ? 'Feed OPRA · cotizaciones según los permisos de tu cuenta.' : 'Feed indicative · precios derivados y modificados; no equivalen a cotizaciones OPRA ejecutables.'}</p>{!chainComplete && <p className="f5-muted">La consulta es parcial. Solo se muestran los contratos recibidos; puedes acotar el vencimiento y volver a consultar.</p>}{!contracts.length && <p className="f5-muted">Alpaca no devolvió contratos para este vencimiento. Selecciona otra fecha y consulta de nuevo.</p>}</>}
        <div className="f5-legs-grid">{selectionLabels.map((label, index) => <div className="f5-contract-choice" key={`${strategy}-${index}`}><label className="f5-field">{label}<select aria-label={`Contrato F5 ${index + 1}`} value={validChain ? selection[index] : ''} disabled={!validChain || !available || !choices(index).length} required onChange={event => { invalidate(); setSelection(previous => previous.map((symbol, position) => position === index ? event.target.value : symbol)); }}><option value="">{chainLoading?'Consultando contratos…':validChain&&!choices(index).length?'No hay contratos para esta selección':'Selecciona un contrato'}</option>{choices(index).map(contract => <option value={contract.symbol} key={contract.symbol}>{contractLabel(contract)}</option>)}</select></label>{validChain&&<p className="f5-muted">{choices(index).length} contratos disponibles para esta selección.{!choices(index).length&&' Prueba otro vencimiento.'}</p>}{validChain && selectedContracts[index] && <div className="f5-contract-detail"><strong>{selectedContracts[index]!.symbol}</strong><span>Bid {cash(selectedContracts[index]!.bid)} · Ask {cash(selectedContracts[index]!.ask)} · Delta {selectedContracts[index]!.delta?.toFixed(3) ?? 'no disponible'}</span><small>{dateTime(selectedContracts[index]!.quoteTime)} · multiplicador {selectedContracts[index]!.size}</small></div>}</div>)}</div>
        <div className="f5-form-grid f5-order-fields"><label className="f5-field">Unidades de la estrategia<input aria-label="Unidades F5" type="number" min="1" max="100" step="1" value={quantity} required onChange={event => { invalidate(); setQuantity(event.target.value); }}/></label><label className="f5-field">{strategy === 'wheel' ? 'Prima límite por acción · USD' : 'Precio neto límite por acción · USD'}<input aria-label="Precio límite F5" type="number" step="0.01" min={strategy === 'wheel' ? '0.01' : undefined} value={limitPrice} placeholder={strategy === 'wheel' ? 'Ej. 1.25' : 'Débito positivo / crédito negativo'} required onChange={event => { invalidate(); setLimitPrice(event.target.value); }}/></label><label className="f5-field">Capital máximo autorizado · USD<input aria-label="Capital máximo F5" type="number" min="1" step="0.01" value={budget} required onChange={event => { invalidate(); setBudget(event.target.value); }}/></label></div>
        <p className="f5-strategy-note">{strategy === 'wheel' ? 'La PUT requiere efectivo por el strike × 100 × contratos. La CALL requiere acciones disponibles en la cuenta. Las asignaciones se consultan en el bróker; la siguiente fase se revisa y confirma por separado.' : strategy === 'pmcc' ? 'La call larga vence después que la corta y tiene un strike igual o inferior. Se envían juntas en una orden multipierna. Este terminal exige además una reserva conservadora para la posible asignación de la call corta.' : strategy === 'backspread' ? 'Una call vendida de strike inferior y dos compradas de strike superior, al mismo vencimiento. El límite neto puede ser débito positivo o crédito negativo; Alpaca valida la aceptación del conjunto.' : 'Compra de un straddle: call y put con igual strike y vencimiento. Después de la ejecución puedes revisar coberturas en acciones completas. Cada ajuste requiere confirmación; las ventas se limitan a acciones disponibles y no abren posiciones cortas.'}</p>
        <div className="f5-form-footer"><span>Orden límite · vigencia del día · contratos de 100 acciones</span><button className="primary-button" type="submit" disabled={busy || !available || !validChain || pendingOperations.some(operation => operation.underlying === underlying)}>{busy ? <LoaderCircle size={14} className="spin"/> : <ShieldCheck size={14}/>}Revisar orden F5<ArrowRight size={14}/></button></div></fieldset>
      </form>
    </section>}

    {management && <section className="panel f5-management"><div className="f5-heading"><div><span className="f5-kicker">GESTIÓN DE UNA EJECUCIÓN CONFIRMADA</span><h2>{management.action === 'close' ? 'Revisar el cierre de opciones' : management.action==='roll'?'Revisar renovación PMCC':'Revisar una cobertura en acciones'} · {management.operation.underlying}</h2><p>{title(management.operation.strategy)} · apertura {management.operation.clientOrderId}</p></div><button className="secondary-button" disabled={busy} onClick={() => { invalidate(); setManagement(null); }}>Volver al registro</button></div><form onSubmit={prepareManagement}><fieldset disabled={busy} className="f5-fields-reset"><div className="f5-form-grid">{management.action==='roll'&&<><label className="f5-field">Nuevo vencimiento corto<input aria-label="Vencimiento renovación F5" type="date" value={rollExpiry} onChange={e=>{invalidate();setRollExpiry(e.target.value);setRollContract('');}} required/></label><button className="secondary-button" type="button" disabled={rollLoading} onClick={()=>void loadRollContracts()}>Consultar renovación</button><label className="f5-field">Nueva call corta<select aria-label="Contrato renovación F5" value={rollContract} onChange={e=>{invalidate();setRollContract(e.target.value);}} required><option value="">Selecciona contrato</option>{rollContracts.map(c=><option key={c.symbol} value={c.symbol}>{contractLabel(c)}</option>)}</select></label></>}{management.action === 'hedge' && <><label className="f5-field">Acción de cobertura<select aria-label="Acción de cobertura F5" value={hedgeSide} onChange={event => { invalidate(); setHedgeSide(event.target.value as F5Side); }}><option value="buy">Comprar acciones</option><option value="sell">Vender acciones disponibles</option></select></label><label className="f5-field">Acciones completas<input aria-label="Acciones de cobertura F5" type="number" min="1" step="1" value={hedgeQuantity} required onChange={event => { invalidate(); setHedgeQuantity(event.target.value); }}/></label></>}<label className="f5-field">Precio límite · USD<input aria-label="Precio límite de gestión F5" type="number" step="0.01" min={management.action === 'hedge' || management.operation.legs.length === 1 ? '0.01' : undefined} value={managementLimit} required onChange={event => { invalidate(); setManagementLimit(event.target.value); }}/></label><label className="f5-field">Capital máximo autorizado · USD<input aria-label="Capital de gestión F5" type="number" min="1" step="0.01" value={managementBudget} required onChange={event => { invalidate(); setManagementBudget(event.target.value); }}/></label></div><p className="f5-muted">{management.action==='roll'&&broker==='webull'?'Renovación en dos confirmaciones: primero cerrar la call corta; esperar su ejecución y revisar una nueva venta cubierta por la call larga. Cada etapa usa una prima positiva.':management.action === 'close' ? 'El servidor invierte las piernas de esta apertura y comprueba las posiciones actuales. En una orden multipierna, usa un precio positivo para pagar un débito o negativo para recibir un crédito. La cobertura en acciones de Gamma debe quedar cerrada antes de cerrar sus opciones.' : 'Revisa cantidades y precio con el estado actual de la cuenta. Esta orden es independiente del straddle; el servidor comprueba el efectivo, las acciones disponibles y las coberturas ya ejecutadas.'}</p><button type="submit" className="primary-button" disabled={!available || busy}>Revisar {management.action === 'close' ? 'cierre' : management.action==='roll'?'renovación':'cobertura'}<ArrowRight size={14}/></button></fieldset></form></section>}

    {preview && <section className="panel f5-review" aria-label="Revisión de orden F5"><div className="f5-heading"><div><span className="f5-kicker">02 · REVISA ANTES DE ENVIAR</span><h2>{preview.action === 'close' ? 'Cerrar' : preview.action === 'hedge' ? 'Cobertura de' : 'Abrir'} {title(preview.strategy)} · {preview.underlying}</h2><p>Destino: Alpaca Paper · saldo virtual · orden límite del día.</p></div><span className="f5-expiry"><Clock3 size={14}/>{expired ? 'Revisión vencida' : `Válida durante ${Math.max(0, Math.ceil((Date.parse(preview.expiresAt) - now) / 1000))} s`}</span></div><div className="f5-review-metrics"><div><span>Unidades</span><strong>{preview.quantity}</strong></div><div><span>Límite {preview.input.order_class === 'mleg' ? 'neto' : 'por acción'}</span><strong>{cash(preview.limitPrice)}</strong></div><div><span>Capital requerido por el terminal</span><strong>{cash(preview.reservedCapitalUsd)}</strong></div><div><span>Tu límite de capital</span><strong>{cash(preview.request.maxCapitalUsd)}</strong></div></div><div className="f5-review-legs">{preview.action === 'hedge' ? <p>{preview.input.side === 'sell' ? 'Vender' : 'Comprar'} {preview.quantity} acciones de {preview.underlying}.</p> : preview.legs.map(leg => <div key={leg.symbol}><strong>{intentLabels[leg.intent]} {preview.quantity * leg.ratio}</strong><span>{leg.symbol}</span><small>Multiplicador: 100 acciones por contrato</small></div>)}</div>{preview.warnings.length > 0 && <ul className="f5-warnings">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}<p className="f5-muted">Identificador de envío: <code>{preview.clientOrderId}</code>. Recibir la orden no equivale a ejecutarla; el registro mostrará cantidades y precios confirmados por Alpaca.</p>{!status?.marketOpen && <p className="f5-muted">El mercado está cerrado. Consulta cotizaciones actuales y prepara una revisión durante la sesión para enviar.</p>}{attemptedIds.has(preview.id) && <p className="f5-error">Esta revisión ya tuvo un intento de envío. Actualiza el estado y concilia su referencia antes de preparar otra orden.</p>}<div className="f5-review-actions"><button className="secondary-button" disabled={busy} onClick={() => { invalidate(); }}>Editar la orden</button><button className="primary-button" disabled={busy || expired || !canSend || attemptedIds.has(preview.id)} onClick={() => void submit()}>{busy ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>}Confirmar y enviar a {brokerLabel}</button></div></section>}

    {error && <p className="f5-error f5-message" role="alert">{error}</p>}{notice && <p className="f5-notice f5-message" role="status">{notice}</p>}
    {pendingOperations.length > 0 && <div className="f5-pending-note"><Clock3 size={16}/><p>Hay {pendingOperations.length} órdenes pendientes de completar o confirmar. Actualiza el estado para consultar sus ejecuciones antes de preparar operaciones sobre los mismos contratos.</p></div>}

    {mode !== 'orders' && <section className="panel f5-positions"><div className="f5-heading"><div><span className="f5-kicker"><Wallet size={14}/>POSICIONES DE LA CUENTA PAPER</span><h2>Opciones y acciones confirmadas por {brokerName}</h2><p>Incluye posiciones abiertas desde otras herramientas de la misma cuenta.</p></div></div>{status?.positions.length ? <div className="f5-table-scroll"><table><thead><tr><th>Activo</th><th>Cantidad</th><th>Entrada media</th><th>Valor de mercado</th><th>Resultado no realizado</th></tr></thead><tbody>{status.positions.map(position => <tr key={position.symbol}><td><strong>{position.symbol}</strong><small>{position.assetClass}</small></td><td>{position.quantity}</td><td>{cash(position.averagePrice)}</td><td>{cash(position.marketValue)}</td><td className={(position.unrealizedPnl ?? 0) < 0 ? 'negative' : 'positive'}>{cash(position.unrealizedPnl)}</td></tr>)}</tbody></table></div> : <p className="f5-empty">{available ? 'La cuenta no tiene posiciones abiertas.' : 'Las posiciones aparecerán cuando se pueda consultar la cuenta.'}</p>}</section>}

    <section className="panel f5-orders"><div className="f5-heading"><div><span className="f5-kicker">REGISTRO F5 DEL SERVICIO</span><h2>Órdenes, cierres y coberturas</h2><p>Las ejecuciones parciales y los estados inciertos permanecen visibles hasta su conciliación.</p></div><a className="f5-external" href={broker==='webull'?'https://app.webull.com/':'https://app.alpaca.markets/paper/dashboard/overview'} target="_blank" rel="noreferrer">Abrir {brokerLabel}<ExternalLink size={13}/></a></div>{operations.length ? <div className="f5-order-list">{operations.map(operation => {
      const closeInProgress = operations.some(child => child.parentId === operation.id && child.action === 'close' && (pending(child) || child.state === 'filled'));
      return <article className="f5-order-card" key={operation.id}><div className="f5-order-card-heading"><div><strong>{operation.underlying} · {title(operation.strategy)}</strong><span>{operation.action === 'close' ? 'Cierre de opciones' : operation.action === 'hedge' ? 'Cobertura en acciones' : operation.action==='roll'?'Renovación PMCC':'Apertura de estrategia'} · {dateTime(operation.createdAt)}</span></div><span className={`f5-order-state ${operation.state}`}>{stateLabels[operation.state]}</span></div><div className="f5-order-summary"><span>{operation.quantity} {operation.action === 'hedge' ? 'acciones' : 'unidades'} · límite {cash(operation.limitPrice)}</span><span>Ejecutadas: <strong>{operation.brokerOrder?.filled_qty ?? '0'} / {operation.brokerOrder?.qty ?? operation.quantity}</strong></span><span>Precio medio ejecutado: <strong>{cash(operation.brokerOrder?.filled_avg_price == null ? null : Number(operation.brokerOrder.filled_avg_price))}</strong></span></div><div className="f5-order-leg-list">{operation.legs.map(leg => <p key={leg.symbol}>{intentLabels[leg.intent]} {operation.quantity * leg.ratio} · {leg.symbol}</p>)}</div><p className="f5-order-reference">Referencia: {operation.clientOrderId}{operation.brokerOrder && <><br/>ID {brokerName}: {operation.brokerOrder.id} · estado: {operation.brokerOrder.status}</>}</p>{operation.message && <p className="f5-muted">{operation.message}</p>}<div className="f5-order-actions">{pending(operation) && operation.brokerOrder && <button className="secondary-button" disabled={busy || !allowTrading} onClick={() => void cancel(operation)}>Solicitar cancelación</button>}{operation.action === 'open' && (operation.lifecycle?.canClose??operation.state==='filled') && !closeInProgress && <><button className="secondary-button" disabled={busy || !available} onClick={() => manage(operation, 'close')}>Preparar cierre</button>{operation.strategy==='pmcc'&&operation.lifecycle?.canRoll&&<button className="secondary-button" disabled={busy||!available} onClick={()=>manage(operation,'roll')}>{broker==='webull'?(operation.lifecycle?.rollPhase==='open-short'?'Preparar nueva call corta':'Preparar cierre de call corta'):'Preparar renovación PMCC'}</button>}{operation.strategy === 'gamma' && <button className="secondary-button" disabled={busy || !available} onClick={() => manage(operation, 'hedge')}>Preparar cobertura en acciones</button>}</>}</div></article>;
    })}</div> : <p className="f5-empty">{available ? 'Todavía no hay órdenes F5 enviadas desde este servicio. Prepara y revisa una estrategia para comenzar.' : 'El registro se recupera desde el servicio de ejecución al conectar la cuenta.'}</p>}</section>

    <section className="panel f5-activities"><div className="f5-heading"><div><span className="f5-kicker">EVENTOS DEL BRÓKER</span><h2>Asignaciones, ejercicios y vencimientos</h2><p>{brokerLabel} puede publicar estas actividades después de la ejecución. Las posiciones de la cuenta son la referencia actual para comprobar acciones disponibles.</p></div></div>{status?.activities.length ? <div className="f5-activity-list">{status.activities.map(activity => <article key={activity.id}><strong>{activity.symbol || 'Cuenta'} · {activity.type}</strong><p>{activity.description}</p><small>{activity.date} · cantidad {activity.quantity}</small></article>)}</div> : <p className="f5-empty">{available ? status?.activitiesComplete===false?'El proveedor no confirmó el historial de actividades; no se presume que está vacío.':'No se recibieron actividades de opciones en la consulta actual.' : `Las actividades se consultarán directamente en ${brokerName} al conectar.`}</p>}</section>
    </>}
  </div>;
}
