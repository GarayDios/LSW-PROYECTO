"use client";
import {useEffect,useMemo,useState} from 'react';
import type {CompanyResearch} from '../../../cores/compartido/research-model';
import {knownBy} from '../../../cores/compartido/research-model';
import type {StrategyId} from '../../../cores/compartido/types';
import {historicalExercise,historicalState,historicalCloseAvailableAt,historicalPositionMark} from '../../../cores/evaluacion/historical-exercise';
import {calculateTechnicalIndicators} from '../../../cores/01-analisis-tecnico/indicators';
import {useCompanyResearch} from '../hooks/use-company-research';
import {analysisPolicy,type AnalysisSettings} from '../analysis-settings';
import {modelDividendYield} from '../contract-terms';
import {strategies} from '../../strategies/catalog';
import HistoricalReplayChart from './historical-replay-chart';
import PnlPlot from './replay-pnl-plot';
import {HistoricalPointInspector,HistoricalPositionDetails} from './historical-point-inspector';
import './strategy-recommender.css';
import './historical-replay.css';
const money=(value:number|null)=>value===null?'Sin calcular':value.toLocaleString('en-US',{style:'currency',currency:'USD'});
const date=(time:number)=>new Date(time).toISOString().slice(0,10);
const EMPTY_BARS:CompanyResearch['market']['bars']=[];
export default function HistoricalReplayPanel({research,strategy,days,settings,provider,demo,start}:{research:CompanyResearch|null;strategy:StrategyId;days:number;settings:AnalysisSettings;provider:'alpaca'|'webull';demo:boolean;start:string}){
  const bars=research?.market.bars??EMPTY_BARS;
  const strategyTitle=strategies.find(item=>item.id===strategy)?.title??strategy;
  const selectableBars=useMemo(()=>bars.filter(bar=>date(bar.time)>=start),[bars,start]);
  const latest=bars.at(-1),suggested=selectableBars[Math.max(0,selectableBars.length-33)];
  const [draft,setDraft]=useState(''),[selection,setSelection]=useState<{symbol:string;date:string}|null>(null),[revealed,setRevealed]=useState(false);
  const [cursorTime,setCursorTime]=useState<number|null>(null),[visibleSessions,setVisibleSessions]=useState(120),[playing,setPlaying]=useState(false);
  const [shortPercent,setShortPercent]=useState(100),[longPercent,setLongPercent]=useState(80),[backspreadPercent,setBackspreadPercent]=useState(110),[enabled,setEnabled]=useState(false),[contracts,setContracts]=useState(1);
  const [assumeMacro,setAssumeMacro]=useState(false),[assumedRate,setAssumedRate]=useState(4),[assumedDividend,setAssumedDividend]=useState(0);
  const selected=selection&&selection.symbol===research?.symbol?selection.date:'';
  const desired=draft||(suggested?date(suggested.time):'');
  const validDesired=/^\d{4}-\d{2}-\d{2}$/.test(desired)&&desired>=start&&!!latest&&desired<=date(latest.time);
  const asOf=selected?new Date(historicalCloseAvailableAt(Date.parse(selected))).toISOString():'';
  const historicalEnd=selected?new Date(Date.parse(selected)+86400000).toISOString().slice(0,10):start;
  const historical=useCompanyResearch({enabled:!!asOf&&!demo,symbol:research?.symbol??'',start,end:historicalEnd,cutoff:asOf||undefined,provider});
  const rule=settings.scanner?.rule??'sma-rsi';
  const state=useMemo(()=>asOf&&bars.length&&research?historicalState(research.symbol,bars,asOf,rule):null,[asOf,bars,research,rule]);
  const snapshot=demo?null:historical.research;
  const spot=state?.market.spot.value??null,hv=state?.market.historicalVolatility.value??null;
  const policy=useMemo(()=>snapshot?analysisPolicy(settings,snapshot):null,[snapshot,settings]);
  const automaticRate=policy?.riskFreeRate??snapshot?.macro.riskFreeRate;
  const automaticDividend=useMemo(()=>snapshot?modelDividendYield(snapshot,policy??{}):null,[snapshot,policy]);
  const rate=useMemo(()=>assumeMacro?{value:assumedRate/100,kind:'assumed' as const,source:'Usuario: tasa supuesta para ejercicio histórico',observedAt:asOf,availableAt:asOf}:automaticRate,[assumeMacro,assumedRate,asOf,automaticRate]);
  const q=useMemo(()=>assumeMacro?{value:assumedDividend/100,kind:'assumed' as const,source:'Usuario: dividendo supuesto para ejercicio histórico',observedAt:asOf,availableAt:asOf}:automaticDividend,[assumeMacro,assumedDividend,asOf,automaticDividend]);
  const exercise=useMemo(()=>{
    if(settings.dividendModel==='declared-cash'&&!assumeMacro)return {result:null,error:'El modelo elegido usa dividendos discretos. Para este ejercicio BSM debes elegir explícitamente los supuestos de tasa y dividendo continuos.'};
    if(!enabled||!state||spot===null||hv===null||!rate||!q||!knownBy(rate,asOf)||!knownBy(q,asOf))return {result:null,error:'Se requieren tasa y dividendo conocidos en el corte histórico. Puedes definir supuestos explícitos para este ejercicio.'};
    try{return {result:historicalExercise({strategy,spot,volatility:hv,rate:rate.value!,dividendYield:q.value!,days,longDays:settings.longDays,shortStrike:Math.round(spot*shortPercent)/100,longStrike:Math.round(spot*(strategy==='backspread'?backspreadPercent:longPercent))/100,feePerContract:settings.feePerContract,capital:settings.capital,asOf,futureBars:revealed?bars:[],contracts}),error:''};}catch(error){return {result:null,error:error instanceof Error?error.message:'No se pudo calcular el ejercicio.'};}
  },[enabled,state,bars,spot,hv,rate,q,asOf,strategy,days,settings.longDays,settings.feePerContract,settings.capital,settings.dividendModel,assumeMacro,shortPercent,longPercent,backspreadPercent,revealed,contracts]);
  const result=exercise.result,last=result?.points.at(-1);
  const graphBars=useMemo(()=>{
    if(!state?.bar)return [];
    const end=Date.parse(asOf)+(revealed?days*86400000:0);
    const available=bars.filter(bar=>historicalCloseAvailableAt(bar.time)<=end);
    const entryIndex=available.findIndex(bar=>bar.time===state.bar!.time);
    return available.slice(visibleSessions===0?0:Math.max(0,entryIndex-visibleSessions+1));
  },[state,bars,asOf,revealed,days,visibleSessions]);
  const cursor=graphBars.find(bar=>bar.time===cursorTime)??state?.bar??null;
  const cursorIndex=cursor?graphBars.findIndex(bar=>bar.time===cursor.time):-1;
  const pointCutoff=cursor?new Date(historicalCloseAvailableAt(cursor.time)).toISOString():'';
  const point=useMemo(()=>pointCutoff&&research?historicalState(research.symbol,bars,pointCutoff,rule):null,[pointCutoff,research,bars,rule]);
  const graphEnd=graphBars.at(-1)?.time;
  const graphIndicators=useMemo(()=>graphEnd===undefined?[]:calculateTechnicalIndicators(bars.filter(bar=>bar.time<=graphEnd)),[bars,graphEnd]);
  const mark=useMemo(()=>{
    if(!result||!cursor)return null;
    const elapsed=(historicalCloseAvailableAt(cursor.time)-Date.parse(asOf))/86400000;
    return elapsed>=0&&elapsed<=result.basis.days?historicalPositionMark(result.basis,cursor.close,elapsed):null;
  },[result,cursor,asOf]);
  const pnlPoints=useMemo(()=>result&&state?.bar?[{time:state.bar.time,value:historicalPositionMark(result.basis,result.basis.spot,0).pnl},...result.points.map(p=>({time:p.time,value:p.pnl}))]:[],[result,state]);
  useEffect(()=>{
    if(!playing)return;
    const timer=setTimeout(()=>{if(cursorIndex>=0&&cursorIndex<graphBars.length-1)setCursorTime(graphBars[cursorIndex+1].time);else setPlaying(false);},650);
    return()=>clearTimeout(timer);
  },[playing,cursorIndex,graphBars]);
  function inspect(time:number){setPlaying(false);setCursorTime(time);}
  function loadEntry(value:string){
    const bar=bars.filter(row=>date(row.time)<=value&&date(row.time)>=start).at(-1);
    if(!bar||!research)return;
    const actual=date(bar.time);setSelection({symbol:research.symbol,date:actual});setDraft(actual);setCursorTime(bar.time);setRevealed(false);setEnabled(false);setPlaying(false);
  }
  function inspectDate(value:string){const bar=graphBars.filter(row=>date(row.time)<=value).at(-1);if(bar)inspect(bar.time);}
  return <section className="panel historical-replay" aria-label="Reproducción de una fecha pasada"><span className="eyebrow">ENTRADA FIJA → CURSOR HISTÓRICO → P/L DE LA ESTRATEGIA</span><h2>Explorar una fecha y su estrategia</h2><p>Elige la entrada y recorre los puntos de la gráfica. Cada punto muestra los datos y los indicadores conocidos entonces; la posición conserva los strikes y las primas de su entrada.</p>
    <div className="replay-controls"><label>Fecha de entrada<input type="date" aria-label="Fecha del ejercicio histórico" min={start} max={latest?date(latest.time):undefined} value={desired} onChange={event=>setDraft(event.target.value)}/></label><button className="primary-button" disabled={!research||!validDesired} onClick={()=>loadEntry(desired)}>Cargar fecha pasada</button></div>
    {!state&&<p role="status">Carga una fecha para seleccionar velas, consultar sus indicadores y preparar el ejercicio.</p>}
    {state&&state.bar&&<><div className="replay-entry-summary" data-replay-entry-date={selected}><strong>Entrada fijada: {selected}</strong><span>{research?.symbol} · {strategyTitle} · precio {money(spot)}</span><span>Disponible desde {asOf} · velas diarias</span></div>
      <div className="replay-controls"><label>Ventana visible<select aria-label="Ventana de la gráfica histórica" value={visibleSessions} onChange={event=>setVisibleSessions(Number(event.target.value))}><option value="60">60 sesiones de contexto</option><option value="120">120 sesiones de contexto</option><option value="252">252 sesiones de contexto</option><option value="0">Todo el rango cargado</option></select></label>
        <label>Punto a inspeccionar<input type="date" aria-label="Fecha del punto histórico" min={graphBars[0]?date(graphBars[0].time):selected} max={graphBars.at(-1)?date(graphBars.at(-1)!.time):selected} value={cursor?date(cursor.time):selected} onChange={event=>inspectDate(event.target.value)}/></label>
        <button className="secondary-button" disabled={cursorIndex<=0} onClick={()=>inspect(graphBars[cursorIndex-1].time)}>Punto anterior</button><button className="secondary-button" disabled={cursorIndex<0||cursorIndex>=graphBars.length-1} onClick={()=>inspect(graphBars[cursorIndex+1].time)}>Punto siguiente</button>
        <button className="secondary-button" disabled={graphBars.length<2} onClick={()=>{if(!playing&&cursorIndex>=graphBars.length-1)setCursorTime(graphBars[revealed?Math.max(0,graphBars.findIndex(bar=>bar.time===state.bar!.time)):0].time);setPlaying(value=>!value);}}>{playing?'Pausar recorrido':'Reproducir recorrido'}</button>
        <button className="secondary-button" disabled={!cursor||date(cursor.time)===selected||date(cursor.time)<start} onClick={()=>cursor&&loadEntry(date(cursor.time))}>Usar punto como entrada</button>
      </div>
      <label className="replay-cursor-control">Recorrer cierres<input type="range" aria-label="Punto de la simulación histórica" min="0" max={Math.max(0,graphBars.length-1)} step="1" value={Math.max(0,cursorIndex)} onChange={event=>{const bar=graphBars[event.currentTarget.valueAsNumber];if(bar)inspect(bar.time);}}/></label>
      <HistoricalReplayChart bars={graphBars} indicators={graphIndicators} entryTime={state.bar.time} cursorTime={cursor?.time??state.bar.time} onSelect={inspect} support={point?.structure?.support?.price} resistance={point?.structure?.resistance?.price} pnl={revealed?pnlPoints.map(p=>({time:p.time,pnl:p.value})):undefined} strategyLabel={strategyTitle} selectedPnl={mark?.pnl??null} capital={result?.required??null}/>
      {point&&<HistoricalPointInspector state={point} entryDate={selected} mark={mark} capital={result?.required??null} positionEnabled={enabled}/>}
      {historical.loading&&<p role="status">Consultando empresa y macro disponibles en el corte de entrada…</p>}{historical.error&&<p role="alert">{historical.error}</p>}
      <details><summary>Fuentes históricas de empresa y macro · fecha de entrada</summary><p>Margen neto SEC: {snapshot?.fundamentals.netMargin.value===null||snapshot?.fundamentals.netMargin.value===undefined?'no disponible':(snapshot.fundamentals.netMargin.value*100).toFixed(2)+'%'}. Tasa: {rate?.value===null||rate?.value===undefined?'no disponible':(rate.value*100).toFixed(2)+'%'}. Dividendo: {q?.value===null||q?.value===undefined?'no disponible':(q.value*100).toFixed(2)+'%'}.</p><p>Estos datos corresponden al corte de entrada; recorrer el cursor no consulta fuentes actuales ni cambia las entradas del ejercicio.</p><ul>{snapshot?.quality.sources.map(source=><li key={source.source}>{source.source}: {source.message}</li>)}</ul></details>
      <h3>Ejercicio de {strategyTitle}</h3><p>Usa términos teóricos, multiplicador supuesto de 100 acciones, HV fijada al entrar y primas BSM. Son valoraciones del ejercicio. Wheel representa la put inicial; PMCC conserva la LEAPS al vencimiento corto; Backspread mantiene −1/+2; Gamma muestra el straddle sin cobertura dinámica.</p>
      <label><input type="checkbox" aria-label="Usar supuestos macro en ejercicio histórico" checked={assumeMacro} onChange={event=>setAssumeMacro(event.target.checked)}/>Usar tasa y dividendo supuestos para este ejercicio</label><p>Si faltan datos macro históricos, puedes definir los supuestos de la simulación.</p>
      {assumeMacro&&<div className="replay-controls"><label>Tasa anual supuesta (%)<input type="number" aria-label="Tasa supuesta del ejercicio histórico" min="-20" max="100" step="0.1" value={assumedRate} onChange={event=>setAssumedRate(event.currentTarget.valueAsNumber)}/></label><label>Dividendo anual supuesto (%)<input type="number" aria-label="Dividendo supuesto del ejercicio histórico" min="0" max="100" step="0.1" value={assumedDividend} onChange={event=>setAssumedDividend(event.currentTarget.valueAsNumber)}/></label></div>}
      <div className="replay-controls"><label>Unidades de la estrategia<input type="number" aria-label="Unidades del ejercicio histórico" min="1" max="100" step="1" value={contracts} onChange={event=>setContracts(event.currentTarget.valueAsNumber)}/></label><label>Strike corto / ATM (% del precio)<input aria-label="Strike del ejercicio histórico" type="number" min="1" max="300" value={shortPercent} onChange={event=>setShortPercent(event.currentTarget.valueAsNumber)}/></label>{(strategy==='pmcc'||strategy==='backspread')&&<label>Strike largo (% del precio)<input aria-label="Strike largo del ejercicio histórico" type="number" min="1" max="300" value={strategy==='backspread'?backspreadPercent:longPercent} onChange={event=>strategy==='backspread'?setBackspreadPercent(event.currentTarget.valueAsNumber):setLongPercent(event.currentTarget.valueAsNumber)}/></label>}<button className="secondary-button" onClick={()=>setEnabled(true)}>Calcular ejercicio teórico</button></div>
      {enabled&&exercise.error&&<p role="status">{exercise.error}</p>}
      {result&&<><p>Capital requerido: {money(result.required)} · débito neto: {money(result.debit)} · horizonte: {days} días. Comisiones de entrada y salida incluidas.</p>
        <HistoricalPositionDetails result={result} mark={mark}/>
        <button className="primary-button" onClick={()=>{setPlaying(false);setRevealed(value=>!value);}}>{revealed?'Ocultar evolución posterior':'Revelar evolución posterior'}</button>
        {revealed&&<><PnlPlot values={pnlPoints} cursorTime={cursor?.time??state.bar.time} onSelect={inspect}/><p role="status">{last?'P/L marcado al '+date(last.time)+': '+money(last.pnl)+' · '+(result.required>0?(last.pnl/result.required*100).toFixed(2)+'%':'retorno no calculable')+' del capital requerido. '+(result.complete?'Último cierre disponible cerca del horizonte.':'Ejercicio parcial: falta evolución hasta el horizonte.'):'No hay cierres posteriores dentro del plazo seleccionado.'} Las valoraciones mantienen los supuestos del corte, sin usar IV futura ni simular asignaciones.</p></>}
      </>}
    </>}
  </section>;
}
