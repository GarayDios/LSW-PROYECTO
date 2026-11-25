"use client";
import { Check } from 'lucide-react';
import { activeScannerCores, scannerCores, type ScannerSettings, type ScannerCoreId } from '../../../cores/evaluacion/scanner-settings';
import type { ScannerEvaluation } from '../../../cores/evaluacion/scanner';
import './scanner-cores.css';

export default function ScannerCores({ settings, onChange, evaluation, demo }: {
  settings: ScannerSettings; onChange: (settings: ScannerSettings) => void; evaluation: ScannerEvaluation | null; demo: boolean;
}) {
  const update = (id: ScannerCoreId, value: Partial<ScannerSettings['cores'][ScannerCoreId]>) => onChange({ ...settings, cores: { ...settings.cores, [id]: { ...settings.cores[id], ...value } } });
  return <section className="scanner-section core-section scanner-cores" aria-label="Cores del análisis">
    <div className="step-heading"><span>03</span><h3>Análisis que participan</h3><span className="section-code">{activeScannerCores(settings).length}/7</span></div>
    <p className="core-hint">Selecciona los cores y su peso relativo. La puntuación bajo cada nombre mide compatibilidad (0–100); no es una probabilidad de ganancia.</p>
    <p className="core-hint">En Monte Carlo, puntuación 65/100 corresponde a 65% de trayectorias con beneficio bajo el modelo. No es una probabilidad real calibrada.</p>
    <div className="core-bulk-actions"><button type="button" onClick={() => onChange({ ...settings, cores: Object.fromEntries(scannerCores.map(c => [c.id, { enabled: true, weight: settings.cores[c.id].weight || 1 }])) as ScannerSettings['cores'] })}>Activar todos</button><button type="button" onClick={() => onChange({ ...settings, cores: Object.fromEntries(scannerCores.map(c => [c.id, { ...settings.cores[c.id], enabled: false }])) as ScannerSettings['cores'] })}>Limpiar</button></div>
    {scannerCores.map(core => {
      const entry = settings.cores[core.id], result = evaluation?.results.find(r => r.core === core.id), active = entry.enabled && entry.weight > 0;
      return <div className="scanner-core-row" key={core.id}>
        <label className="core-option" title={core.description}><input type="checkbox" aria-label={core.title} checked={entry.enabled} onChange={() => update(core.id, { enabled: !entry.enabled })}/><span className="custom-check">{entry.enabled && <Check size={11}/>}</span><span>{core.title}<small>{!active ? entry.enabled ? 'Excluido: peso 0' : 'Desactivado' : result ? result.score === null ? 'Sin datos' : `Puntuación ${result.score.toFixed(1)}/100${demo ? ' · demo' : ''}${result.dataMode==='estimated'?result.automaticEstimation?' · estimación automática':' · estimado':result.dataMode==='observed'?' · proveedor':''}` : 'Consultando datos…'}</small></span></label>
        <label className="scanner-core-weight">Peso<input aria-label={`Peso de ${core.title}`} type="number" min="0" max="100" step="0.1" disabled={!entry.enabled} value={entry.weight} onChange={event => { const weight=event.currentTarget.valueAsNumber;if(Number.isFinite(weight)&&weight>=0&&weight<=100)update(core.id,{weight}); }}/></label>
        {active && result?.score === null && <details className="scanner-core-missing"><summary>¿Qué falta?</summary><p>{result.reason}</p></details>}
      </div>;
    })}
    {settings.cores.monteCarlo.enabled&&<><label className="core-hint">Entradas de Monte Carlo<select aria-label="Datos del core Monte Carlo" value={settings.monteCarlo.dataMode??'auto'} onChange={event=>onChange({...settings,monteCarlo:{...settings.monteCarlo,dataMode:event.target.value as 'auto'|'observed'|'estimated'}})}><option value="auto">Automático · proveedor o estimación</option><option value="observed">Solo datos del proveedor</option><option value="estimated">Escenario estimado</option></select></label><p className="core-hint">Se recalcula con los demás cores. En automático prefiere cotizaciones vigentes; si faltan, puede usar volatilidad histórica y primas teóricas sobre contratos existentes. El resultado indica su procedencia. No completa contratos, tasas o dividendos ausentes.</p><details className="scanner-mc-controls"><summary>Parámetros Monte Carlo</summary><div className="field-grid"><label>Semilla<input aria-label="Semilla del core Monte Carlo" type="number" min="0" max="4294967295" value={settings.monteCarlo.seed} onChange={event=>{const seed=event.currentTarget.valueAsNumber;if(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff)onChange({...settings,monteCarlo:{...settings.monteCarlo,seed}});}}/></label><label>Trayectorias<select aria-label="Trayectorias del core Monte Carlo" value={settings.monteCarlo.paths} onChange={event=>onChange({...settings,monteCarlo:{...settings.monteCarlo,paths:Number(event.target.value)}})}>{[100,500,2000,5000,10000].map(paths=><option key={paths} value={paths}>{paths.toLocaleString('es-MX')}</option>)}</select></label></div><p className="core-hint">Misma semilla y entradas producen el mismo resultado. Más trayectorias reducen el error de muestreo; no mejoran los supuestos del modelo.</p></details></>}
    <p className="core-hint">Peso 2 aporta el doble que peso 1; peso 0 lo excluye. Los cores sin datos no aportan peso. Sin cores evaluables, la empresa queda «no evaluable».</p>
    {evaluation && <p className="scanner-coverage" role="status">{evaluation.available}/{evaluation.active} evaluables · {evaluation.missing} sin datos · Confluencia {evaluation.score === null ? 'no evaluable' : `${evaluation.score.toFixed(1)}%`}</p>}
  </section>;
}
