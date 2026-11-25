"use client";
import type { StrategyOutlook } from '../../../cores/evaluacion/strategy-outlook';
const money=(value:number|null)=>value===null?'Sin calcular':value.toLocaleString('en-US',{style:'currency',currency:'USD'});
export default function ProfitabilityOutlook({outlook,compact=false}:{outlook:StrategyOutlook;compact?:boolean}){
  const {profitability:p,forecast:f}=outlook;
  return <section className="profitability-outlook" aria-label="Pronóstico de rentabilidad">
    <h3>Pronóstico de rentabilidad · {outlook.horizonSessions??'—'} sesiones</h3>
    <p role="status">{p.status==='validated'?'Modelo de precio con mejora histórica frente a las referencias':p.status==='experimental'?'Estimación experimental · validación histórica insuficiente':'Pronóstico pendiente'}. {p.reason}</p>
    {p.expectedPnl!==null&&<><div className="scanner-result-stats"><span>P/L medio de los comparables<b>{money(p.expectedPnl)}</b></span><span>Retorno sobre capital requerido<b>{p.returnOnCapital===null?'Sin calcular':`${(p.returnOnCapital*100).toFixed(2)}%`}</b></span><span>Rango descriptivo P10–P90<b>{money(p.p10)} a {money(p.p90)}</b></span></div>
      <p>{f?.neighbors} ventanas históricas comparables ya resueltas al corte. Primas {outlook.resolved.scenario?.dataMode==='estimated'?'estimadas':'del proveedor'}, comisiones de entrada/salida e interés sobre el débito incluidos. Opciones valoradas con IV constante; Wheel representa la put inicial y PMCC conserva el valor temporal de la LEAPS.</p></>}
    {!compact&&f&&<details><summary>Evidencia y validación del pronóstico</summary><p>{f.validation.periods.length} periodos fuera de muestra. Error absoluto medio del precio: modelo {f.validation.modelMae===null?'—':`${(f.validation.modelMae*100).toFixed(2)}%`}; sin cambio {f.validation.noChangeMae===null?'—':`${(f.validation.noChangeMae*100).toFixed(2)}%`}; media histórica {f.validation.historicalMeanMae===null?'—':`${(f.validation.historicalMeanMae*100).toFixed(2)}%`}.</p><p>La validación corresponde al precio del subyacente. El P/L de opciones es una transformación condicional de esos comparables, sin historial de ejecuciones de opciones ni validación propia. El rango no es un intervalo predictivo calibrado.</p><p>Fuente: {f.source}. Corte: {f.asOf}. La PoP Monte Carlo es una medida distinta, neutral al riesgo.</p></details>}
  </section>;
}
