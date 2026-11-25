"use client";
import { useState } from 'react';
import { optionDatasetSchema,validateOptionRanking,type OptionValidation } from '../../../cores/evaluacion/option-validation';
import { optionValidationExample } from '../validation-example';
import { analysisPolicy,type AnalysisSettings } from '../analysis-settings';
import type { CompanyResearch } from '../../../cores/compartido/research-model';
import type { CoreId,StrategyId } from '../../../cores/compartido/types';
import { evaluationTuning } from '../../../cores/evaluacion/evaluation-policy';

function download(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();URL.revokeObjectURL(url);}
export default function OptionValidationPanel({research,cores,strategy,days,settings,onSettings}:{research:CompanyResearch|null;cores:CoreId[];strategy:StrategyId;days:number;settings:AnalysisSettings;onSettings:(s:AnalysisSettings)=>void}){
  const [dataset,setDataset]=useState<unknown>(null),[result,setResult]=useState<OptionValidation|null>(null),[error,setError]=useState(''),[signature,setSignature]=useState('');
  const current=JSON.stringify([cores,strategy,days,settings]);
  function run(){try{if(!research)throw new Error('Carga la empresa para disponer de la política de análisis.');const output=validateOptionRanking(dataset,cores,strategy,Math.max(1,days),analysisPolicy(settings,research));setResult(output);setSignature(current);setError('');}catch{setError('Archivo o política inválidos. Usa el formato del ejemplo; selecciona cores con peso positivo. Los detalles del formato están en la guía de verificación.');}}
  return <section className="panel observed-strategy-analysis" aria-label="Validación histórica de opciones"><h2>Validación histórica de opciones · núcleo cuantitativo</h2>
    {settings.scanner&&<p>Esta importación evalúa los criterios cuantitativos del contrato. Para validar la confluencia de los siete cores hacen falta también sus noticias, fundamentales y demás evidencias históricas; este informe no acredita esa validación.</p>}
    <p>Importa instantáneas con fecha, contratos y cotizaciones de salida. Se separa entrenamiento de prueba y se excluyen salidas de entrenamiento que aún no eran conocidas. Las velas de acciones por sí solas no validan opciones.</p>
    <label>Cadena histórica y salidas (JSON, máximo 5 MB)<input aria-label="Datos históricos de opciones" type="file" accept="application/json,.json" onChange={async e=>{setResult(null);try{const file=e.target.files?.[0];if(!file||file.size>5*1024*1024)throw new Error();const parsed=optionDatasetSchema.parse(JSON.parse(await file.text()));setDataset(parsed);setError('');}catch{setDataset(null);setError('No se pudo importar: verifica tamaño, estructura y fechas del JSON.');}}}/></label>
    <p><button className="secondary-button" onClick={()=>download('ejemplo-opciones-SINTETICO.json',optionValidationExample())}>Descargar ejemplo sintético</button>{' '}<button className="secondary-button" disabled={!dataset||!research} onClick={run}>Validar fuera de muestra</button></p>
    {error&&<p role="alert">{error}</p>}
    {!result&&<p>Sin evidencia importada no se declara calibrado el ranking. Gamma requiere además el historial de coberturas.</p>}
    {result&&<><p><strong>{result.kind==='fixture'?'DATOS SINTÉTICOS DE PRUEBA':'Datos importados: autenticidad declarada por quien los proporciona'}</strong> · {result.source} · estrategia {result.strategy}</p>
      {signature!==current&&<p role="status">Los parámetros cambiaron desde esta validación. Ejecuta de nuevo antes de comparar.</p>}
      <p>{result.testedPeriods} períodos de prueba. Retorno medio por período: {result.meanReturn===null?'—':(result.meanReturn*100).toFixed(2)+'%'}. Frecuencia de resultado positivo: {result.winRate===null?'—':(result.winRate*100).toFixed(1)+'%'}.</p>
      <p>{result.sufficientSample?'La muestra cumple el mínimo descriptivo; no demuestra capacidad predictiva.':'Muestra insuficiente para promover nuevos pesos al ranking.'}</p>
      <div className="comparison-table"><table><thead><tr><th>Entrenamiento anterior a</th><th>Prueba</th><th>Muestras de entrenamiento</th><th>Retorno medio</th><th>Pesos iguales</th></tr></thead><tbody>{result.folds.map(f=><tr key={f.testStart}><td>{f.trainBefore.slice(0,10)}</td><td>{f.testStart.slice(0,10)} a {f.testEnd.slice(0,10)}</td><td>{f.trainSamples}</td><td>{f.meanReturn===null?'—':(f.meanReturn*100).toFixed(2)+'%'}</td><td>{f.equalWeightReturn===null?'—':(f.equalWeightReturn*100).toFixed(2)+'%'}</td></tr>)}</tbody></table></div>
      <ul>{result.warnings.map(w=><li key={w}>{w}</li>)}</ul>
      <details><summary>{result.excluded.length} muestras excluidas</summary><ul>{result.excluded.map((x,i)=><li key={i}>{x.symbol} · {x.asOf}: {x.reason}</li>)}</ul></details>
      <button className="secondary-button" onClick={()=>download('validacion-opciones.json',{...result,parameters:JSON.parse(signature)})}>Exportar informe</button>{' '}
      {!settings.scanner&&<button className="secondary-button" disabled={!result.sufficientSample||signature!==current} onClick={()=>{const weights=result.folds.at(-1)?.weights;if(weights)onSettings({...settings,tuning:{...evaluationTuning(settings.tuning),coreWeights:weights}});}}>Aplicar pesos del último entrenamiento</button>}
    </>}
  </section>;
}
