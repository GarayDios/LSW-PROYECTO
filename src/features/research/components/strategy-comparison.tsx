"use client";
import { useMemo } from 'react';
import { rankObservedCompanies } from '../../../cores/evaluacion/observed-ranking';
import type { CoreId, StrategyId } from '../../../cores/compartido/types';
import { strategies } from '../../strategies/catalog';
import type { CompanyResearch } from '../../../cores/compartido/research-model';
import { analysisPolicy, type AnalysisSettings } from '../analysis-settings';
import './strategy-comparison.css';
import EvaluationControls from './evaluation-controls';
import { activeCoreWeight, coreWeight, evaluationTuning } from '../../../cores/evaluacion/evaluation-policy';
import ModelAssumptions from './model-assumptions';
import { modelMacroContext } from '../model-macro';
import { modelDividendYield } from '../contract-terms';
import { activeScannerCores, scannerCores } from '../../../cores/evaluacion/scanner-settings';

const money = (n: number | null) => n === null ? 'No determinado' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
export default function StrategyComparison({research,loading=false,error='',onRetry,days,cores,settings,onSettings,onChoose,onCores}:{research:CompanyResearch|null;loading?:boolean;error?:string;onRetry?:()=>void;days:number;cores:CoreId[];settings:AnalysisSettings;onSettings:(s:AnalysisSettings)=>void;onChoose:(s:StrategyId)=>void;onCores:(cores:CoreId[])=>void}) {
  const tuning=evaluationTuning(settings.tuning);
  const activeCount=settings.scanner?activeScannerCores(settings.scanner).length:cores.filter(c=>coreWeight(tuning,c)>0).length;
  const rows=useMemo(()=>research&&cores.length&&(settings.scanner?activeScannerCores(settings.scanner).length>0:activeCoreWeight(evaluationTuning(settings.tuning),cores)>0)?strategies.map(s=>({strategy:s,...rankObservedCompanies([research],cores,s.id,Math.max(1,days),analysisPolicy(settings,research))[0]})).sort((a,b)=>(b.score??-1)-(a.score??-1)):[],[research,cores,days,settings]);
  const macro=research?modelMacroContext(research,analysisPolicy(settings,research)):null;
  const modelDividend=research?modelDividendYield(research,analysisPolicy(settings,research)):null;
  const dividend=research?settings.dividendPercentBySymbol[research.symbol]:undefined;
  const update=(key:'capital'|'feePerContract'|'maxSpreadPercent'|'longDays',value:number)=>{if(Number.isFinite(value))onSettings({...settings,[key]:value});};
  const best=rows.find(r=>r.score!==null && r.strategyAnalysis.status==='available' && r.strategy.id!=='gamma');
  return <section className="panel observed-strategy-analysis" aria-label="Comparación de estrategias por empresa">
    <h2>Compara estrategias para {research?.symbol??'tu empresa'}</h2>
    <p>Consulta automática de mercado, dividendos y tasa. Capital disponible: {money(settings.capital)}.</p>
    {loading&&<p role="status">Obteniendo datos de la empresa…</p>}
    {error&&<p role="alert">{error} {onRetry&&<button className="secondary-button" onClick={onRetry} disabled={loading}>Reintentar consulta</button>}</p>}
    {modelDividend&&<p className="automatic-input-status">Dividendo del modelo: {modelDividend.value===null?'no disponible':`${(modelDividend.value*100).toFixed(2)}% anual${modelDividend.kind==='estimated'?' · estimado automáticamente':modelDividend.kind==='assumed'?' · supuesto del modelo':''}`}. Las fuentes y los supuestos se pueden consultar en los detalles.</p>}
    <details className="comparison-advanced"><summary>Ajustar capital y criterios</summary>
    <div className="comparison-settings">
      <label>Capital disponible (USD)<input type="number" min="1" max="10000000" value={settings.capital} onChange={e=>update('capital',e.currentTarget.valueAsNumber)}/></label>
      <label>Comisión por contrato (USD)<input type="number" min="0" max="100" step="0.01" value={settings.feePerContract} onChange={e=>update('feePerContract',e.currentTarget.valueAsNumber)}/></label>
      <label>Spread máximo (%)<input type="number" min="0" max="200" value={settings.maxSpreadPercent} onChange={e=>update('maxSpreadPercent',e.currentTarget.valueAsNumber)}/></label>
      <label>Plazo largo PMCC (días)<input type="number" min={days+1} max="3650" value={settings.longDays} onChange={e=>update('longDays',e.currentTarget.valueAsNumber)}/></label>
    </div>
    {macro&&<p role="status">Tasa del modelo: {macro.rateAvailable?`${(macro.rate.value!*100).toFixed(3)}% anual continua`:"no disponible"} · {macro.manualRate?"supuesto manual":"fuente externa FRED/ALFRED"}. {macro.rateAvailable?`Fuente: ${macro.rate.source}.`:"Falta una tasa conocida en el corte para valorar opciones."} Inflación y PIB se muestran como contexto.</p>}
    <EvaluationControls settings={settings} onSettings={onSettings}/>
    <ModelAssumptions settings={settings} onSettings={onSettings}/>
    {settings.modelMode==='estimated'&&<p role="status"><strong>MODO ESTIMADO: resultados bajo supuestos, no cotizaciones observadas.</strong></p>}
    {research&&<div className="comparison-assumption"><label><input type="checkbox" checked={dividend!==undefined} onChange={e=>{const values={...settings.dividendPercentBySymbol};if(e.target.checked)values[research.symbol]=0;else delete values[research.symbol];onSettings({...settings,dividendPercentBySymbol:values});}}/> Usar un dividendo supuesto solo para {research.symbol}</label>{dividend!==undefined&&<label>Dividendo anual supuesto (%)<input type="number" min="0" max="100" step="0.1" value={dividend} onChange={e=>{const v=e.currentTarget.valueAsNumber;if(Number.isFinite(v)&&v>=0&&v<=100)onSettings({...settings,dividendPercentBySymbol:{...settings.dividendPercentBySymbol,[research.symbol]:v}});}}/></label>}<p>0% supone ausencia de dividendos futuros. El supuesto queda identificado y no acredita información histórica. También se aplica al generar oportunidades de esta empresa.</p></div>}
    </details>
    {!research?(!loading&&!error&&<p>Esperando datos de la empresa para comparar.</p>):<>
      <p>{best?`Mayor compatibilidad calculable: ${best.strategy.title} (${best.score}/100).`:'Aún faltan entradas para completar los cores seleccionados.'} La media de los cores disponibles mide compatibilidad, no rentabilidad esperada. Gamma se revisa aparte porque requiere cobertura dinámica.</p>
      {!activeCount&&<p role="alert">Selecciona al menos un core para comparar.</p>}
      {!settings.scanner&&cores.includes('probability')&&coreWeight(tuning,'probability')>0&&<p>PMCC y Gamma requieren modelos adicionales para publicar una probabilidad conjunta. <button className="secondary-button" onClick={()=>onCores(cores.filter(c=>c!=='probability'))}>Comparar sin el core de probabilidad</button> Los demás cores conservan sus pesos; esta elección también cambia el generador de oportunidades.</p>}
      <div className="comparison-table"><table><thead><tr><th>Estrategia</th><th>Compatibilidad</th><th>Capital inicial</th><th>Pérdida máxima</th><th>Ganancia máxima</th><th/></tr></thead><tbody>{rows.map(r=><tr key={r.strategy.id}><td>{r.strategy.title}</td><td>{r.score===null?`${r.availableCoreCount}/${activeCount} cores`:r.strategyAnalysis.status!=='available'?`Perfil de acción ${r.score}/100; opción incompleta`:`${r.score}/100`}</td><td>{money(r.strategyAnalysis.capitalRequired)}</td><td>{money(r.strategyAnalysis.maxLoss)}</td><td>{r.strategyAnalysis.maxGain===null&&r.strategyAnalysis.status==='available'&&r.strategy.id==='backspread'?'Sin límite superior en el modelo':money(r.strategyAnalysis.maxGain)}</td><td><button className="secondary-button" onClick={()=>onChoose(r.strategy.id)}>Elegir</button></td></tr>)}</tbody></table></div>
      <details className="comparison-calculations"><summary>Ver contratos, cálculos y fuentes</summary>
      {rows.map(r=>{const a=r.strategyAnalysis;return <details key={r.strategy.id}><summary>{r.strategy.title}: contratos, escenarios y motivos</summary>
        <p>{r.reason}</p>{r.scannerEvaluation&&<ul>{r.scannerEvaluation.results.map(core=><li key={core.core}>{scannerCores.find(c=>c.id===core.core)?.title}: {core.score===null?'sin datos':`${core.score}/100`}. {core.reason}</li>)}</ul>}{a.missing.length>0&&<p role="status">Faltan: {a.missing.join('; ')}.</p>}
        {a.diagnostics&&<><p>{a.diagnostics.eligibleContracts}/{a.diagnostics.totalContracts} contratos superan los filtros individuales. Los siguientes descartes pueden coincidir en un mismo contrato.</p><ul>{a.diagnostics.rejected.map(d=><li key={d.code}>{d.label}: {d.count}</li>)}</ul></>}
        <ul>{a.legs.map(l=><li key={l.contract.symbol}>{l.quantity>0?'Comprar':'Vender'} {Math.abs(l.quantity)} × {l.contract.symbol} · strike {money(l.contract.strike.value)} · entrada {money(l.entry)} · IV {((l.contract.impliedVolatility.value??0)*100).toFixed(2)}% · OI {l.contract.openInterest.value??'no publicado'}</li>)}</ul>
        <p>Débito neto (negativo = crédito): {money(a.entryDebit)}. Coste frente al punto medio por spread: {money(a.spreadCost)}. Delta neta: {a.netDelta?.toFixed(2)??'—'} acciones; theta: {money(a.netTheta)} por día.</p>
        <p>Equilibrios al vencimiento común: {a.breakevens.length?a.breakevens.map(money).join(', '):'No determinados'}. {a.probabilityMethod}</p>
        <p>{a.model}. Horizonte: {a.horizonDays?.toFixed(1)??'—'} días.</p>
        <p>Multiplicador de prima/ejercicio: {a.contractMultiplier??'no verificado'}. Acciones entregables por contrato: {a.deliverableShares??'no verificadas'}. Se distinguen ambos importes en los cálculos.</p>
        {a.strategy==='pmcc'&&<><p>Reserva ante asignación: {money(a.assignmentReserve)}. Coste de financiación al horizonte: {money(a.financingCost)}.</p><div className="comparison-table"><table><thead><tr><th>Cambio de acción</th><th>Cambio relativo de IV</th><th>Resultado de la diagonal</th></tr></thead><tbody>{a.ivScenarios.map((s,i)=><tr key={i}><td>{(s.change*100).toFixed(0)}%</td><td>{(s.ivChange*100).toFixed(0)}%</td><td>{money(s.pnl)}</td></tr>)}</tbody></table></div></>}
        {a.scenarios.length>0&&<div className="comparison-table"><table><thead><tr><th>Cambio del subyacente</th><th>Precio</th><th>Resultado al horizonte</th></tr></thead><tbody>{a.scenarios.map(s=><tr key={s.change}><td>{(s.change*100).toFixed(0)}%</td><td>{money(s.spot)}</td><td>{money(s.pnl)}</td></tr>)}</tbody></table></div>}
        <ul>{r.coreResults.map(c=><li key={c.core}><strong>{c.core}: {c.score??'sin calcular'}</strong> · {c.reason}</li>)}</ul>
        <ul>{a.warnings.map(w=><li key={w}>{w}</li>)}</ul>
      </details>;})}
      </details>
    </>}
  </section>;
}
