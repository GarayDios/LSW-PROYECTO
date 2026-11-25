"use client";
import { useState, type FormEvent } from 'react';
import { CORE_IDS } from '../../../cores/compartido/types';
import { evaluationTuning, evaluationTuningSchema } from '../../../cores/evaluacion/evaluation-policy';
import type { AnalysisSettings } from '../analysis-settings';

const fields = [
  ['quoteMaxAgeMinutes','Antigüedad máxima de cotización (min)',1,60,1],
  ['legQuoteSkewMinutes','Diferencia máxima entre piernas (min)',0,60,1],
  ['spotOptionGapDays','Distancia máxima entre acción y opción (días)',0,7,.25],
  ['spotOptionSkewMinutes','Desfase máximo acción/opción con cotización (min)',0,60,1],
  ['binomialSteps','Pasos del árbol americano',20,500,1],
  ['trendBase','Base del core de tendencia',0,1,.01],
  ['trend20Coefficient','Coeficiente de retorno20',0,10,.05],
  ['trend60Coefficient','Coeficiente de retorno60',0,10,.05],
  ['riskDrawdownWeight','Peso de drawdown (resto: volatilidad bajista)',0,1,.05],
  ['tenorWeight','Peso del plazo al seleccionar contratos',0,10,.1],
  ['spreadWeight','Peso del spread al seleccionar contratos',0,10,.1],
  ['strikeDistanceWeight','Peso de distancia al strike en vista individual',0,10,.1],
] as const;

export default function EvaluationControls({settings,onSettings}:{settings:AnalysisSettings;onSettings:(s:AnalysisSettings)=>void}) {
  const [error,setError]=useState('');
  const tuning=evaluationTuning(settings.tuning);
  function apply(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    const number=(name:string)=>{const value=String(data.get(name)??'').trim();return value===''?NaN:Number(value);};
    const rawScenarios=String(data.get('scenarioChanges')??'').split(',');
    const parsed=evaluationTuningSchema.safeParse({...Object.fromEntries(fields.map(([name])=>[name,number(name)])),
      scenarioChanges:rawScenarios.map(v=>v.trim()===''?NaN:Number(v)/100),
      coreWeights:Object.fromEntries(CORE_IDS.map(id=>[id,settings.scanner?(tuning.coreWeights[id]??1):number(`weight-${id}`)]))});
    if(!parsed.success){setError('Revisa los límites, escenarios únicos y pesos: plazo y spread no pueden ser ambos cero.');return;}
    onSettings({...settings,tuning:parsed.data});setError('');
  }
  return <details className="evaluation-controls"><summary>{settings.scanner ? 'Parámetros del modelo' : 'Parámetros y pesos del análisis'}</summary>
    <p>Son decisiones del modelo, no parámetros óptimos demostrados. Se guardan con cada lista. {settings.scanner ? 'Selecciona los cores en «Análisis que participan». Los cores disponibles participan según sus pesos.' : 'Un peso de core igual a cero lo excluye; los datos faltantes de un core con peso positivo siguen bloqueando el total.'}</p>
    <form key={JSON.stringify(tuning)} onSubmit={apply}>
      <div className="comparison-settings">{fields.map(([name,label,min,max,step])=><label key={name}>{label}<input name={name} type="number" min={min} max={max} step={step} required defaultValue={tuning[name]}/></label>)}</div>
      <label>Escenarios del subyacente (% separados por comas)<input name="scenarioChanges" type="text" required defaultValue={tuning.scenarioChanges.map(v=>v*100).join(', ')} /></label>
      {!settings.scanner&&<div className="comparison-settings">{CORE_IDS.map(id=><label key={id}>Peso: {id}<input name={`weight-${id}`} type="number" min="0" max="100" step="0.1" required defaultValue={tuning.coreWeights[id]??1}/></label>)}</div>}
      <p>La antigüedad máxima puede restringirse a 1–60 minutos; el proveedor descarta cotizaciones de más de una hora. Los 365 días de BSM y las 252 sesiones de anualización son convenciones documentadas.</p>
      {error&&<p role="alert">{error}</p>}
      <button type="submit" className="secondary-button">Aplicar parámetros</button>{' '}
      <button type="button" className="secondary-button" onClick={()=>{onSettings({...settings,tuning:evaluationTuning()});setError('');}}>Restablecer parámetros</button>
    </form>
  </details>;
}
