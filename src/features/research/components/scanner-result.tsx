"use client";
import type { ScannerEvaluation } from '../../../cores/evaluacion/scanner';
import { scannerCores } from '../../../cores/evaluacion/scanner-settings';
import './scanner-cores.css';
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export default function ScannerResult({ evaluation, demo }: { evaluation: ScannerEvaluation | null; demo: boolean }) {
  if (!evaluation) return null;
  const p = evaluation.projection, news = evaluation.results.find(r => r.core === 'news'),mc=evaluation.results.find(r=>r.core==='monteCarlo');
  return <section className="scanner-result" aria-label="Resultado de los cores">
    <strong>{demo ? 'Demostración · ' : ''}Confluencia {evaluation.score === null ? 'no evaluable' : `${evaluation.score.toFixed(1)}%`} <small>· {evaluation.available}/{evaluation.active} cores evaluables</small></strong>
    {p && <><div className="scanner-result-stats"><span>Escenario a {p.days} días<b>{usd(p.target)}</b></span><span>Contribución de noticias al precio<b>{p.newsImpact >= 0 ? '+' : ''}{usd(p.newsImpact)}</b></span><span>PoP Monte Carlo{mc?.dataMode==='estimated'?' · estimada':''}<b>{evaluation.monteCarloPop === null ? 'Sin datos' : `${(evaluation.monteCarloPop * 100).toFixed(1)}%`}</b></span></div>
      {p.pnl !== null && <p>P/L del escenario{p.pnlMethod === 'diagonal' ? ' PMCC al vencer la call corta (LEAPS con valor temporal)' : ' al vencimiento'}: <strong>{usd(p.pnl)}</strong>{p.baselinePnl !== null && <> · efecto de noticias sobre P/L: <strong>{usd(p.pnl - p.baselinePnl)}</strong></>}. Incluye los costes configurados en la estrategia.</p>}
      <p>La zona punteada es un escenario de sensibilidad: combina los sesgos disponibles, sus pesos y la volatilidad histórica. La banda usa ±1.645σ y no es un intervalo predictivo calibrado. Las velas históricas conservan sus precios.</p></>}
    {news && <p>Noticias: {news.score === null ? 'sin cobertura verificada' : `sentimiento ${evaluation.sentiment.score! > 0 ? 'positivo' : evaluation.sentiment.score! < 0 ? 'negativo' : 'neutral'} · ${evaluation.sentiment.articles.length} titulares`}. {news.score !== null && 'La confluencia y el escenario incorporan este sentimiento; la PoP neutral al riesgo conserva sus supuestos.'}</p>}
    {mc?.dataMode==='estimated'&&<p>Monte Carlo: {mc.automaticEstimation?'estimación automática':'escenario estimado'} sobre contratos existentes. Puede usar volatilidad histórica y primas teóricas; no representa cotizaciones para enviar órdenes.</p>}
    <details><summary>Ver contribución y datos de cada core</summary><ul>{evaluation.results.map(r => <li key={r.core}><strong>{scannerCores.find(c => c.id === r.core)?.title}: {r.score === null ? 'sin datos' : `${r.score.toFixed(1)}/100`} · peso {r.weight}</strong><br/>{r.reason}</li>)}</ul></details>
  </section>;
}
