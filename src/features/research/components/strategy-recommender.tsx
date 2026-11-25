"use client";
import { useEffect,useMemo,useState } from 'react';
import type { CompanyResearch } from '../../../cores/compartido/research-model';
import type { StrategyId } from '../../../cores/compartido/types';
import type {ContractRecommendationRequest,ContractRecommendations} from '../../../cores/evaluacion/contract-recommendations';
import type {ContractRecommendationReply} from '../contract-recommendations.worker';
import RecommendationWorker from '../contract-recommendations.worker?worker';
import type { AnalysisSettings } from '../analysis-settings';
import { strategies } from '../../strategies/catalog';
import { scannerCores } from '../../../cores/evaluacion/scanner-settings';
import './strategy-recommender.css';

const money=(value:number|null)=>value===null?'Sin determinar':value.toLocaleString('en-US',{style:'currency',currency:'USD'});
export default function StrategyRecommender({research,strategy,days,settings,onDetailed}:{research:CompanyResearch|null;strategy:StrategyId;days:number;settings:AnalysisSettings;onDetailed:()=>void}){
  const [limit,setLimit]=useState(5),[order,setOrder]=useState<'analysis'|'pnl'|'capital'>('analysis');
  const request=useMemo<ContractRecommendationRequest|null>(()=>research?{research,strategy,days,settings,limit,order}:null,[research,strategy,days,settings,limit,order]);
  const [run,setRun]=useState<{request:ContractRecommendationRequest;result?:ContractRecommendations;error?:string}|null>(null);
  const current=run?.request===request?run:null,result=current?.result;
  const loading=!!request&&!current;
  useEffect(()=>{
    if(!request)return;
    let active=true,worker:Worker|null=null;
    const timer=setTimeout(()=>{try{
      const next=new RecommendationWorker();worker=next;
      next.onmessage=(event:MessageEvent<ContractRecommendationReply>)=>{if(!active)return;setRun({request,...event.data});next.terminate();worker=null;};
      next.onerror=()=>{if(!active)return;setRun({request,error:'No se pudieron comparar los contratos. Actualiza las variables e inténtalo de nuevo.'});next.terminate();worker=null;};
      next.postMessage(request);
    }catch(error){if(active)setRun({request,error:error instanceof Error?error.message:'No se pudo iniciar la comparación.'});}},150);
    return()=>{active=false;clearTimeout(timer);worker?.terminate();};
  },[request]);
  const title=strategies.find(row=>row.id===strategy)!.title;
  return <div className="account-overview strategy-recommender" aria-label="Recomendador de contratos">
    <section className="panel"><span className="eyebrow">CONTRATOS Y COMBINACIONES</span><h2>Contratos recomendados · {title}</h2><p>{research?.symbol??'Empresa pendiente'} · plazo solicitado: {days} días · capital: {money(settings.capital)}.</p>
      <p>{strategy==='wheel'?'Se comparan puts para iniciar Wheel con el efectivo necesario para una posible asignación.':strategy==='pmcc'?'Cada propuesta combina una call larga ITM y una call corta con menor vencimiento.':strategy==='backspread'?'Cada propuesta conserva la proporción de una call vendida y dos calls compradas a un strike superior.':'Cada propuesta combina call y put del mismo strike y vencimiento para la base del Gamma Scalping. La cobertura dinámica se evalúa por separado.'}</p>
      <div className="option-chain-filters"><label>Ordenar contratos<select aria-label="Orden de contratos recomendados" value={order} onChange={event=>setOrder(event.target.value as typeof order)}><option value="analysis">Confluencia de los cores</option><option value="pnl">Retorno estimado sobre capital</option><option value="capital">Menor capital requerido</option></select></label><label>Mostrar<select aria-label="Cantidad de combinaciones recomendadas" value={limit} onChange={event=>setLimit(Number(event.target.value))}>{[3,5,10].map(value=><option key={value} value={value}>{value} combinaciones</option>)}</select></label></div>
      <p>Se comparan combinaciones compatibles usando los cores activos, la PoP de cada estructura, el capital, los costes y el plazo. Los empates se resuelven por retorno comparable cuando existe y por spread. El retorno comparable conserva su condición experimental.</p>
      {loading&&<p role="status">Buscando y comparando contratos para {title}…</p>}{current?.error&&<p role="alert">{current.error}</p>}{!request&&<p role="status">Esperando la cadena de opciones de la empresa.</p>}
      {result&&<><p role="status">{result.candidates.length} combinaciones propuestas · {result.totalContracts.toLocaleString('es-MX')} contratos recibidos · {result.eligibleContracts} elegibles · {result.checked} búsquedas de combinaciones. Entradas {result.dataMode==='estimated'?'estimadas sobre contratos existentes':'del proveedor'}.</p>{result.bounded&&<p>Comparación acotada a {result.poolSize} contratos y hasta 40 búsquedas. Puede haber otras combinaciones fuera de esta selección.</p>}{result.missing.map(reason=><p role="status" key={reason}>{reason}</p>)}</>}
      <button className="secondary-button" onClick={onDetailed}>Ver evaluación detallada</button>
    </section>
    {result?.candidates.map((candidate,index)=>{
      const {analysis:a,evaluation:e,profitability:p}=candidate;
      return <article className="panel contract-recommendation" data-contract-strategy={strategy} data-contract-id={candidate.id} key={candidate.id}>
        <h3>Combinación {index+1} · {title}</h3><p>{a.dataMode==='estimated'?'Escenario estimado: primas e IV reconstruidas, identificadas como supuestos.':candidate.executionReady?'Contratos con entradas OPRA al corte; el bróker verifica su ejecución.':'Contratos para análisis con el feed disponible; se requiere verificar cotizaciones ejecutables.'}</p>
        <div className="table-scroll"><table className="companies-table"><thead><tr><th>Acción</th><th>Cantidad</th><th>Contrato</th><th>Tipo</th><th>Strike</th><th>Vencimiento</th><th>Bid</th><th>Ask</th><th>Prima de entrada</th><th>IV</th></tr></thead><tbody>{a.legs.map(leg=><tr key={leg.contract.symbol}><td>{leg.quantity>0?'Comprar':'Vender'}</td><td>{Math.abs(leg.quantity)}</td><td>{leg.contract.symbol}</td><td>{leg.contract.type.toUpperCase()}</td><td>{money(leg.contract.strike.value)}</td><td>{leg.contract.expiration}</td><td>{money(leg.contract.bid.value)}</td><td>{money(leg.contract.ask.value)}</td><td>{money(leg.entry)}</td><td>{leg.contract.impliedVolatility.value===null?'—':`${(leg.contract.impliedVolatility.value*100).toFixed(2)}%`}</td></tr>)}</tbody></table></div>
        <div className="contract-metrics"><span>Débito / crédito neto<b>{money(a.entryDebit)}</b></span><span>Capital requerido<b>{money(a.capitalRequired)}</b></span><span>Pérdida máxima del modelo<b>{money(a.maxLoss)}</b></span><span>Confluencia<b>{e.score===null?'Sin datos':`${e.score.toFixed(1)}%`}</b></span><span>PoP Monte Carlo del modelo<b>{e.monteCarloPop===null?'Sin calcular':`${(e.monteCarloPop*100).toFixed(1)}%`}</b></span><span>Coste por spread<b>{money(a.spreadCost)}</b></span></div>
        <p>{e.available}/{e.active} cores evaluables. Prima de entrada por unidad cotizada: ask al comprar, bid al vender; el débito neto incluye cantidades, multiplicador y comisiones. Un valor negativo representa crédito.</p>
        {p.expectedPnl!==null&&<p>P/L medio comparable a {candidate.horizonSessions} sesiones: <strong>{money(p.expectedPnl)}</strong> · retorno sobre capital: {p.returnOnCapital===null?'—':`${(p.returnOnCapital*100).toFixed(2)}%`} · P10–P90: {money(p.p10)} a {money(p.p90)}. {p.status==='experimental'?'Estimación experimental.':'Modelo de precio con mejora en validación histórica; el P/L de opciones sigue siendo condicional.'}</p>}
        <details><summary>Por qué se proponen estos contratos</summary><ul>{e.results.map(core=><li key={core.core}><strong>{scannerCores.find(row=>row.id===core.core)?.title}: {core.score===null?'sin datos':`${core.score.toFixed(1)}/100`}</strong>. {core.reason}</li>)}</ul><p>{p.reason}</p><ul>{a.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></details>
      </article>;
    })}
  </div>;
}
