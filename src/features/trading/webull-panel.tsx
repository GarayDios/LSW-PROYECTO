"use client";
import { useCallback,useEffect,useRef,useState } from 'react';
import type { WebullOperation } from '../../../services/trading-runner/webull-service';
type Status={configured:boolean;connected:boolean;enabled:boolean;mode:'sandbox';region?:string;operations:WebullOperation[];message?:string};
async function request<T>(body?:unknown):Promise<T>{const response=await fetch('/api/webull',{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const value=await response.json() as T&{error?:{message?:string}};if(!response.ok)throw Error(value.error?.message??'No se pudo confirmar Webull.');return value;}
const stateLabel=(op:WebullOperation)=>op.state==='preview'?'En revisión':op.state==='submitted'?`Confirmada por Webull: ${op.order?.state}`:op.state==='reserved'?'Envío por conciliar':'Confirmación pendiente';
export default function WebullPanel({symbol,allowTrading}:{symbol:string;allowTrading:boolean}){
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [side,setSide]=useState<'BUY'|'SELL'>('BUY'),[quantity,setQuantity]=useState('1'),[limit,setLimit]=useState('');
  const [preview,setPreview]=useState<WebullOperation|null>(null),[now,setNow]=useState(Date.now);
  const lock=useRef(false),sequence=useRef(0),mounted=useRef(true),allowed=useRef(allowTrading);
  allowed.current=allowTrading;
  const refresh=useCallback(async()=>{try{const value=await request<Status>();if(mounted.current)setStatus(value);}catch(e){if(mounted.current){setStatus(null);setError(e instanceof Error?e.message:'No se pudo consultar Webull.');}}},[]);
  useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;sequence.current++;};},[refresh]);
  useEffect(()=>{setPreview(null);sequence.current++;},[symbol,allowTrading]);
  useEffect(()=>{if(!preview)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[preview]);
  function edit(fn:()=>void){sequence.current++;setPreview(null);setError('');fn();}
  async function prepare(e:React.FormEvent){e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');setPreview(null);const current=++sequence.current;
    try{const value=await request<{operation:WebullOperation}>({action:'preview',input:{symbol,side,quantity:Number(quantity),limitPrice:Number(limit)}});if(mounted.current&&current===sequence.current){setPreview(value.operation);setNow(Date.now());}}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:'No se confirmó la revisión.');}finally{lock.current=false;if(mounted.current)setBusy(false);}}
  async function action(kind:'submit'|'reconcile',op:WebullOperation){if(lock.current||kind==='submit'&&(!allowed.current||!status?.enabled||Date.now()>=Date.parse(op.expiresAt)))return;
    lock.current=true;setBusy(true);setError('');if(kind==='submit')setPreview(null);
    try{const value=await request<{operation:WebullOperation}>({action:kind,operationId:op.id});if(mounted.current)setNotice(`${stateLabel(value.operation)}. Referencia: ${value.operation.clientOrderId}.`);}
    catch(e){if(mounted.current)setError(`${e instanceof Error?e.message:'Respuesta sin confirmar.'} Referencia: ${op.clientOrderId}. Consulta el estado antes de preparar otra orden.`);}
    finally{lock.current=false;if(mounted.current){setBusy(false);await refresh();}}}
  return <section className="panel manual-broker-panel" aria-label="Órdenes manuales Webull">
    <h2>Webull · entorno de pruebas</h2><p>Acciones de Estados Unidos · órdenes límite DAY · cada envío requiere tu confirmación.</p>
    <p role="status">{status?.connected?'Cuenta OpenAPI verificada':status?.message??'Conexión pendiente'}. {status?.enabled?'Envío habilitado en servidor':'Envío deshabilitado en servidor'}.</p>
    <button className="secondary-button" disabled={busy} onClick={()=>{setError('');void refresh();}}>Consultar conexión Webull</button>
    {!status?.configured&&<p>Necesitas solicitar acceso <a href="https://developer.webull.com.mx/apis/docs/" target="_blank" rel="noreferrer">Webull OpenAPI</a>. Las credenciales de pruebas se configuran en el servidor. Esta conexión todavía no está verificada con tu cuenta.</p>}
    <form onSubmit={prepare}><fieldset disabled={busy||!status?.connected}><legend>Preparar orden de acciones · {symbol}</legend><div className="manual-fields">
      <label>Operación<select aria-label="Operación Webull" value={side} onChange={e=>edit(()=>setSide(e.target.value as 'BUY'|'SELL'))}><option value="BUY">Comprar</option><option value="SELL">Vender</option></select></label>
      <label>Acciones<input aria-label="Cantidad Webull" type="number" min="1" max="10000" step="1" value={quantity} onChange={e=>edit(()=>setQuantity(e.target.value))} required/></label>
      <label>Precio límite · USD<input aria-label="Precio límite Webull" type="number" min="0.01" step="0.01" value={limit} onChange={e=>edit(()=>setLimit(e.target.value))} required/></label>
    </div><p>Importe límite: USD {(Number(quantity)*Number(limit)||0).toFixed(2)}, antes de costes. La revisión del proveedor comprueba permisos y disponibilidad.</p><button className="secondary-button" type="submit">Revisar orden Webull</button></fieldset></form>
    {preview&&<div className="manual-review" aria-label="Revisión de orden Webull"><h3>Revisa antes de enviar</h3><p>{preview.input.side==='BUY'?'Comprar':'Vender'} {preview.input.quantity} acciones de {preview.input.symbol} a USD {preview.input.limitPrice.toFixed(2)} como límite · DAY · Webull pruebas.</p><p>Referencia: {preview.clientOrderId}. Vigencia: {Math.max(0,Math.ceil((Date.parse(preview.expiresAt)-now)/1000))} segundos.</p><button className="primary-button" disabled={busy||!allowTrading||!status?.enabled||now>=Date.parse(preview.expiresAt)} onClick={()=>void action('submit',preview)}>Confirmar y enviar a Webull pruebas</button></div>}
    {notice&&<p role="status">{notice}</p>}{error&&<p className="form-error" role="alert">{error}</p>}
    <h3>Registro Webull</h3>{status?.operations.filter(op=>op.state!=='preview').map(op=><article className="manual-review" key={op.id}><strong>{op.input.symbol} · {stateLabel(op)}</strong><p>{op.input.quantity} acciones · límite USD {op.input.limitPrice.toFixed(2)} · ejecutadas {op.order?.filledQuantity??'sin confirmar'}.</p><small>{op.clientOrderId}</small><p><button className="secondary-button" disabled={busy} onClick={()=>void action('reconcile',op)}>Conciliar referencia Webull</button></p></article>)}
    <p>La ejecución de opciones y de Wheel en Webull requiere verificar el producto y los permisos de tu cuenta. Este adaptador prepara órdenes de acciones en pruebas.</p>
  </section>;
}
