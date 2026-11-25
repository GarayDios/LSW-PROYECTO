"use client";
import { Check } from 'lucide-react';
import { activeScannerCores, scannerCores, type ScannerSettings, type ScannerCoreId } from '../../../cores/evaluacion/scanner-settings';
import type { ScannerEvaluation } from '../../../cores/evaluacion/scanner';
import './scanner-cores.css';

export default function ScannerCores({ settings, onChange, evaluation, demo, onEstimate, estimated=false }: {
  settings: ScannerSettings; onChange: (settings: ScannerSettings) => void; evaluation: ScannerEvaluation | null; demo: boolean; onEstimate?: () => void; estimated?: boolean;
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
        <label className="core-option" title={core.description}><input type="checkbox" aria-label={core.title} checked={entry.enabled} onChange={() => update(core.id, { enabled: !entry.enabled })}/><span className="custom-check">{entry.enabled && <Check size={11}/>}</span><span>{core.title}<small>{!active ? entry.enabled ? 'Excluido: peso 0' : 'Desactivado' : result ? result.score === null ? 'Sin datos' : `Puntuación ${result.score.toFixed(1)}/100${demo ? ' · demo' : ''}` : 'Consultando datos…'}</small></span></label>
        <label className="scanner-core-weight">Peso<input aria-label={`Peso de ${core.title}`} type="number" min="0" max="100" step="0.1" disabled={!entry.enabled} value={entry.weight} onChange={event => { const weight=event.currentTarget.valueAsNumber;if(Number.isFinite(weight)&&weight>=0&&weight<=100)update(core.id,{weight}); }}/></label>
        {active && result?.score === null && <details className="scanner-core-missing"><summary>¿Qué falta?</summary><p>{result.reason}</p>{core.id==='monteCarlo'&&!demo&&!estimated&&onEstimate&&<><p>Con contratos existentes, tasa y dividendo disponibles puedes elegir una reconstrucción con volatilidad histórica y primas teóricas. No son cotizaciones observadas.</p><button className="secondary-button" type="button" onClick={onEstimate}>Calcular escenario estimado</button></>}</details>}
      </div>;
    })}
    <p className="core-hint">Peso 2 aporta el doble que peso 1; peso 0 lo excluye. Los cores sin datos no aportan peso. Sin cores evaluables, la empresa queda «no evaluable».</p>
    {evaluation && <p className="scanner-coverage" role="status">{evaluation.available}/{evaluation.active} evaluables · {evaluation.missing} sin datos · Confluencia {evaluation.score === null ? 'no evaluable' : `${evaluation.score.toFixed(1)}%`}</p>}
  </section>;
}
