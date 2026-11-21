"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import type { OptionInputs, StrategyId } from '../../../cores/compartido/types';
import type { CompanyResearch } from '../../../cores/compartido/research-model';
import { blackScholes } from '../../../cores/nucleo-cuantitativo/bsm';
import { validateMonteCarlo, type MonteCarloRequest, type MonteCarloResult } from '../../../cores/nucleo-cuantitativo/monte-carlo';
import { strategyMonteCarloScenario, type MonteCarloScenario } from '../../../cores/evaluacion/monte-carlo-scenario';
import { analysisPolicy, type AnalysisSettings } from '../analysis-settings';
import type { MonteCarloReply } from '../monte-carlo.worker';
import MonteCarloWorker from '../monte-carlo.worker?worker';
import './monte-carlo-panel.css';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const number = (s: string) => s.trim() === '' ? NaN : Number(s);
type Run = { result: MonteCarloResult; request: MonteCarloRequest; scenario: MonteCarloScenario; signature: string };

function SimulationCharts({ result }: { result: MonteCarloResult }) {
  const { fan, samplePaths, histogram } = result;
  const low = Math.min(...fan.map(p => p.p05), ...samplePaths.flat()), high = Math.max(...fan.map(p => p.p95), ...samplePaths.flat());
  const pad = Math.max((high - low) * .05, 1), min = low - pad, max = high + pad;
  const x = (i: number, count: number) => 65 + i / Math.max(1, count - 1) * 590;
  const y = (price: number) => 220 - (price - min) / (max - min) * 190;
  const line = (values: number[]) => values.map((price, i) => `${i ? 'L' : 'M'}${x(i, values.length).toFixed(2)},${y(price).toFixed(2)}`).join(' ');
  const band = [...fan.map((p, i) => `${x(i, fan.length)},${y(p.p95)}`), ...fan.map((p, i) => `${x(i, fan.length)},${y(p.p05)}`).reverse()].join(' ');
  const largest = Math.max(1, ...histogram.map(bin => bin.count));
  return <div className="mc-charts">
    <figure><figcaption>Precio del subyacente · banda P5–P95 y 12 trayectorias de muestra</figcaption>
      <svg viewBox="0 0 680 265" role="img" aria-label="Trayectorias Monte Carlo y percentiles del precio">
        <title>Trayectorias simuladas bajo el modelo neutral al riesgo</title>
        {[0, .5, 1].map(f => <g key={f}><line x1="65" x2="655" y1={y(min + f * (max - min))} y2={y(min + f * (max - min))} stroke="#35404c"/><text x="58" y={y(min + f * (max - min)) + 4} textAnchor="end">{(min + f * (max - min)).toFixed(1)}</text></g>)}
        <polygon points={band} fill="#72c9e1" opacity=".18"/>
        {samplePaths.map((path, i) => <path key={i} d={line(path)} fill="none" stroke="#8ca4bd" strokeWidth="1" opacity=".35"/>)}
        <path d={line(fan.map(p => p.median))} fill="none" stroke="#72c9e1" strokeWidth="2.5"/>
        <text x="65" y="246">Día 0</text><text x="655" y="246" textAnchor="end">Día {fan.at(-1)!.day.toFixed(1)}</text><text x="65" y="17">USD · línea central: mediana</text>
      </svg>
      <p>La banda contiene el 90% central de precios en cada fecha; una trayectoria puede salir de ella.</p>
    </figure>
    <figure><figcaption>Distribución de ganancias y pérdidas · USD por posición</figcaption>
      <svg viewBox="0 0 680 265" role="img" aria-label="Histograma de ganancias y pérdidas simuladas">
        <title>Frecuencias de resultados finales, incluidos los costes configurados</title>
        {histogram.map((bin, i) => {
          const height = bin.count / largest * 185, width = 590 / histogram.length;
          return <rect key={i} x={65 + i * width + 1} y={220 - height} width={Math.max(1, width - 2)} height={height} fill={bin.to <= 0 ? '#ef787b' : bin.from >= 0 ? '#41c9a6' : '#d6b66c'}><title>{money(bin.from)} a {money(bin.to)}: {bin.count} trayectorias</title></rect>;
        })}
        <line x1="65" x2="655" y1="220" y2="220" stroke="#657083"/>
        <text x="65" y="246">{money(histogram[0].from)}</text><text x="655" y="246" textAnchor="end">{money(histogram.at(-1)!.to)}</text><text x="65" y="17">Altura: número de trayectorias</text>
      </svg>
    </figure>
  </div>;
}

export default function MonteCarloPanel({ input, premium, side = 'buy', context, research, strategy, days, settings, singleWarnings = [] }: {
  input: OptionInputs | null; premium?: number; side?: 'buy' | 'sell'; context: string;
  research: CompanyResearch | null; strategy: StrategyId; days: number; settings: AnalysisSettings; singleWarnings?: string[];
}) {
  const [target, setTarget] = useState<'single' | 'strategy'>('single');
  const [paths, setPaths] = useState('10000'), [steps, setSteps] = useState('32'), [seed, setSeed] = useState('42');
  const [hedge, setHedge] = useState(false), [hedgeFee, setHedgeFee] = useState('0.005');
  const [spread, setSpread] = useState('10'), [borrow, setBorrow] = useState('5');
  const [running, setRunning] = useState(false), [error, setError] = useState(''), [run, setRun] = useState<Run | null>(null);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => { worker.current?.terminate(); }, []);
  const candidate = useMemo((): { scenario: MonteCarloScenario | null; error?: string } => {
    try {
      if (target === 'strategy') return research
        ? strategyMonteCarloScenario(research, strategy, Math.max(1, days), analysisPolicy(settings, research))
        : { scenario: null, error: 'Carga datos de Alpaca para simular los contratos de la estrategia seleccionada.' };
      if (!input) return { scenario: null, error: 'Faltan entradas completas del contrato o escenario mostrado arriba.' };
      if (research && settings.dividendModel === 'declared-cash') return { scenario: null, error: 'El modelo actual usa pagos discretos. Monte Carlo requiere elegir explícitamente dividendos continuos.' };
      const entry = premium ?? blackScholes(input).price;
      return { scenario: {
        label: `${context} · opción individual ${input.type.toUpperCase()} ${side === 'buy' ? 'comprada' : 'vendida'} · por una acción entregable`,
        basis: { spot: input.spot, days: input.days, volatility: input.volatility, rate: input.rate, dividendYield: input.dividendYield ?? 0,
          legs: [{ type: input.type, strike: input.strike, quantity: side === 'buy' ? 1 : -1, units: 1, premium: entry }], feePerContract: 0 },
        sources: [context],
        warnings: [...singleWarnings, premium === undefined ? 'Prima teórica BSM usada como supuesto del ejercicio; no es una cotización observada.' : 'Prima del modelo mostrado arriba; puede ser un punto medio o un supuesto, no un precio de ejecución.',
          'Ejercicio por una acción entregable, sin comisiones de opciones; no representa un contrato completo ni una estrategia.'],
      } };
    } catch (failure) { return { scenario: null, error: failure instanceof Error ? failure.message : 'Entradas no disponibles.' }; }
  }, [target, research, strategy, days, settings, input, premium, side, context, singleWarnings]);
  const scenario = candidate.scenario;
  const request: MonteCarloRequest | null = scenario ? { ...scenario.basis, paths: number(paths), steps: number(steps), seed: number(seed),
    mode: hedge ? 'delta-hedged' : 'terminal', hedgeFeePerShare: number(hedgeFee), hedgeSpreadBps: number(spread), stockBorrowRate: number(borrow) / 100 } : null;
  const signature = JSON.stringify({ request, scenario, context, target });
  const stale = !!run && run.signature !== signature;

  function simulate() {
    if (!request || !scenario) return;
    worker.current?.terminate(); worker.current = null; setError('');
    try {
      validateMonteCarlo(request);
      const capturedRequest = structuredClone(request), capturedScenario = structuredClone(scenario);
      const next = new MonteCarloWorker();
      worker.current = next; setRunning(true);
      next.onmessage = (event: MessageEvent<MonteCarloReply>) => {
        if (worker.current !== next) return;
        if (event.data.result) setRun({ result: event.data.result, request: capturedRequest, scenario: capturedScenario, signature });
        else setError(event.data.error);
        next.terminate(); worker.current = null; setRunning(false);
      };
      next.onerror = () => { if (worker.current !== next) return; next.terminate(); worker.current = null; setRunning(false); setError('No se pudo ejecutar Monte Carlo. Intenta de nuevo con menos trayectorias.'); };
      next.postMessage(capturedRequest);
    } catch (failure) { setRunning(false); setError(failure instanceof Error ? failure.message : 'Revisa los parámetros.'); }
  }
  function exportRun() {
    if (!run) return;
    const artifact = { version: 1, measure: 'Q: neutral al riesgo; no probabilidad real calibrada', assumptions: 'GBM, volatilidad y tasas constantes; liquidación europea; financiación simétrica a r; dividendos y préstamo de acciones por paso; sin límites de margen', ...run };
    const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'monte-carlo-resultado.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <details className="panel monte-carlo-panel">
    <summary>Núcleo cuantitativo · Monte Carlo</summary>
    <p>Explora miles de trayectorias bajo los supuestos de BSM. La frecuencia de beneficio pertenece al modelo neutral al riesgo; no es una predicción de éxito real.</p>
    <div className="mc-controls">
      <label>Posición a simular<select aria-label="Posición Monte Carlo" value={target} onChange={e => setTarget(e.target.value as 'single' | 'strategy')}><option value="single">Opción individual del modelo</option><option value="strategy" disabled={!research}>Estrategia seleccionada · Alpaca</option></select></label>
      <label>Trayectorias<input aria-label="Trayectorias Monte Carlo" type="number" min="100" max="50000" step="100" value={paths} onChange={e => setPaths(e.target.value)}/></label>
      <label>Pasos por trayectoria<input aria-label="Pasos Monte Carlo" type="number" min="1" max="128" value={steps} onChange={e => setSteps(e.target.value)}/></label>
      <label>Semilla reproducible<input aria-label="Semilla Monte Carlo" type="number" min="0" max="4294967295" value={seed} onChange={e => setSeed(e.target.value)}/></label>
    </div>
    {scenario ? <div className="mc-inputs"><p>{scenario.label}</p><p>Precio {money(scenario.basis.spot)} · {scenario.basis.days.toFixed(2)} días · volatilidad {percent(scenario.basis.volatility)} · tasa {percent(scenario.basis.rate)} · dividendo {percent(scenario.basis.dividendYield)}.</p>
      <ul>{scenario.basis.legs.map((leg, i) => <li key={i}>{leg.quantity > 0 ? '+' : ''}{leg.quantity} {leg.type.toUpperCase()} · strike efectivo {money(leg.strike)} · {leg.units} acciones entregables · prima {money(leg.premium)} por acción.</li>)}</ul>
      <p>Comisión de entrada: {money(scenario.basis.feePerContract)} por contrato/unidad de posición. La prima y las comisiones se financian o remuneran a la tasa indicada hasta el vencimiento.</p>
    </div> : <p role="status">{candidate.error}</p>}
    <label className="mc-toggle"><input aria-label="Cobertura delta Monte Carlo" type="checkbox" checked={hedge} onChange={e => setHedge(e.target.checked)}/> Simular cobertura delta con acciones enteras en cada paso</label>
    {hedge && <><div className="mc-controls">
      <label>Comisión por acción · USD<input aria-label="Comisión de cobertura Monte Carlo" type="number" min="0" max="10" step=".001" value={hedgeFee} onChange={e => setHedgeFee(e.target.value)}/></label>
      <label>Spread completo de la acción · puntos básicos<input aria-label="Spread Monte Carlo" type="number" min="0" max="1000" step="1" value={spread} onChange={e => setSpread(e.target.value)}/></label>
      <label>Préstamo anual de acciones · %<input aria-label="Préstamo Monte Carlo" type="number" min="0" max="100" step=".1" value={borrow} onChange={e => setBorrow(e.target.value)}/></label>
    </div><p>Cobertura idealizada: permite acciones cortas y financiación sin límite de margen. Compra al ask y vende al bid del spread supuesto. Los dividendos y el préstamo se acumulan por paso; aumentar pasos cambia la frecuencia y el coste de ajustar.</p></>}
    <div className="mc-actions"><button type="button" className="primary-button" disabled={!scenario || running} onClick={simulate}>{running ? 'Simulando…' : 'Simular Monte Carlo'}</button>
      {running && <button type="button" className="secondary-button" onClick={() => { worker.current?.terminate(); worker.current = null; setRunning(false); }}>Cancelar simulación</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div aria-live="polite">{running && <p role="status">Calculando trayectorias… puedes seguir utilizando el terminal.</p>}{stale && <p role="status" className="mc-stale">Resultado anterior: cambiaron las entradas o los controles. Ejecuta otra simulación para actualizarlo.</p>}</div>
    {run && <section className="mc-results" aria-label="Resultados Monte Carlo">
      <p><strong>{stale ? 'Resultado anterior' : 'Resultado de la simulación'}</strong> · {run.scenario.label} · {run.result.paths.toLocaleString('es-MX')} trayectorias · {run.result.steps} pasos · semilla {run.result.seed} · {run.request.mode === 'delta-hedged' ? 'con cobertura delta' : 'sin cobertura'}.</p>
      <div className="mc-metrics">{[
        ['Beneficio simulado bajo el modelo', percent(run.result.pnl.probabilityOfProfit)], ['Pérdida simulada bajo el modelo', percent(run.result.pnl.probabilityOfLoss)],
        ['Resultado medio · USD', money(run.result.pnl.mean)], ['Mediana · USD', money(run.result.pnl.median)],
        ['Percentil 5 del resultado', money(run.result.pnl.p05)], ['Percentil 95 del resultado', money(run.result.pnl.p95)],
        ['Pérdida VaR 95% del modelo', money(run.result.pnl.lossVaR95)], ['Pérdida media del peor 5%', money(run.result.pnl.expectedShortfall95)],
      ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <p>Intervalo numérico 95% de la media: {money(run.result.pnl.meanInterval95[0])} a {money(run.result.pnl.meanInterval95[1])}. Intervalo Wilson de la frecuencia de beneficio: {percent(run.result.pnl.profitInterval95[0])} a {percent(run.result.pnl.profitInterval95[1])}. Miden incertidumbre de muestreo dentro del modelo; no su error frente al mercado. VaR y peor 5% son pérdidas del escenario, no pérdidas máximas.</p>
      <p>Valor europeo descontado de las opciones por Monte Carlo: <strong>{money(run.result.fairValue.mean)}</strong> · BSM con la misma volatilidad común: <strong>{money(run.result.bsmValue)}</strong>. Intervalo numérico 95% de la valoración: {money(run.result.fairValue.interval95[0])} a {money(run.result.fairValue.interval95[1])}. Débito inicial neto: {money(run.result.initialDebit)}; un valor negativo representa crédito.</p>
      {run.request.mode === 'delta-hedged' && <p>Sin cobertura, resultado medio en las mismas trayectorias: {money(run.result.unhedgedPnl.mean)}. Costes medios de cobertura y préstamo: {money(run.result.meanHedgeCosts)} · {run.result.meanHedgeTrades.toFixed(1)} ajustes medios, incluidos apertura y cierre · P95 de la caída máxima entre pasos del valor de la posición: {money(run.result.drawdownP95!)}.</p>}
      <SimulationCharts result={run.result}/>
      <button type="button" className="secondary-button" onClick={exportRun}>Exportar simulación JSON</button>
      <details><summary>Entradas y supuestos de esta ejecución</summary><ul>{run.scenario.sources.map((source, i) => <li key={i}>{source}</li>)}{run.scenario.warnings.map((warning, i) => <li key={`w${i}`}>{warning}</li>)}</ul></details>
    </section>}
    <p>Modelo: movimiento browniano geométrico, volatilidad y tasas constantes, dividendos continuos, vencimiento común y liquidación europea por efectivo. No modela saltos, cambios de IV, ejercicio anticipado ni asignación. PMCC requiere otro tratamiento por sus vencimientos distintos. Las simulaciones son un análisis separado del ranking y las órdenes.</p>
  </details>;
}
