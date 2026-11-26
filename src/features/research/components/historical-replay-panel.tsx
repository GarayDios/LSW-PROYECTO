"use client";
import { useEffect, useMemo, useState } from 'react';
import type { CompanyResearch } from '../../../cores/compartido/research-model';
import { knownBy } from '../../../cores/compartido/research-model';
import type { StrategyId } from '../../../cores/compartido/types';
import { historicalState, historicalCloseAvailableAt } from '../../../cores/evaluacion/historical-exercise';
import { backtestStrategy, strategyBacktestTerms, type StrategyBacktestInput } from '../../../cores/evaluacion/strategy-backtest';
import { calculateTechnicalIndicators } from '../../../cores/01-analisis-tecnico/indicators';
import { analyzeSupportResistance } from '../../../cores/01-analisis-tecnico/support-resistance';
import { detectTrendLines } from '../../../cores/01-analisis-tecnico/trend-lines';
import { activeScannerCores, defaultScannerSettings } from '../../../cores/evaluacion/scanner-settings';
import { coreChartStudies, defaultChartStudies } from '../../market/chart-core-layers';
import { useCompanyResearch } from '../hooks/use-company-research';
import { analysisPolicy, type AnalysisSettings } from '../analysis-settings';
import { modelDividendYield } from '../contract-terms';
import { strategies } from '../../strategies/catalog';
import HistoricalReplayChart from './historical-replay-chart';
import HistoricalStrategyResults from './historical-strategy-results';
import PnlPlot from './replay-pnl-plot';
import { HistoricalPointInspector } from './historical-point-inspector';
import './strategy-recommender.css';
import './historical-replay.css';
import { resolveReplayRange } from '../replay-range';

const money = (value: number | null) => value === null ? 'Sin calcular' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const date = (time: number) => new Date(time).toISOString().slice(0, 10);
const EMPTY_BARS: CompanyResearch['market']['bars'] = [];
const descriptions: Record<StrategyId, string> = {
  wheel: 'PUT con efectivo reservado → asignación de acciones → CALL cubierta. Las calls se renuevan hasta entregar las acciones; después puede comenzar otra vuelta.',
  pmcc: 'CALL larga de vencimiento lejano + CALL corta. Al vencer la corta se liquida su intrínseco y se renueva mientras quede plazo suficiente en la larga.',
  backspread: 'Una CALL vendida y dos CALL compradas de strike superior, con el mismo vencimiento. Cada ciclo liquida las tres posiciones.',
  gamma: 'Straddle comprado (CALL + PUT del mismo strike) y cobertura delta con acciones enteras. Los ajustes calculados al cierre se ejecutan en la apertura siguiente, incluidas ventas cortas simuladas.',
};

export default function HistoricalReplayPanel({ research, strategy, days, settings, provider, demo, start }: {
  research: CompanyResearch | null; strategy: StrategyId; days: number; settings: AnalysisSettings; provider: 'alpaca' | 'webull'; demo: boolean; start: string;
}) {
  const bars = research?.market.bars ?? EMPTY_BARS;
  const strategyTitle = strategies.find(item => item.id === strategy)!.title;
  const selectableBars = useMemo(() => bars.filter(bar => date(bar.time) >= start), [bars, start]);
  const availableBars = useMemo(() => bars.filter(bar => historicalCloseAvailableAt(bar.time) <= Date.now()), [bars]);
  const latest = availableBars.at(-1), suggested = selectableBars[Math.max(0, selectableBars.length - 80)];
  const [draftDate, setDraftDate] = useState<string | null>(null), [draftEnd, setDraftEnd] = useState<string | null>(null), [selection, setSelection] = useState<{ symbol: string; date: string; from: string; end: string } | null>(null);
  const [rangeError, setRangeError] = useState('');
  const [revealed, setRevealed] = useState(false), [cursorTime, setCursorTime] = useState<number | null>(null), [visibleSessions, setVisibleSessions] = useState(0), [playing, setPlaying] = useState(false);
  const [terms, setTerms] = useState({ ...strategyBacktestTerms(strategy), contracts: 1, capital: settings.capital,
    days: Math.max(1, Math.min(730, Math.round(days))), longDays: settings.longDays, feePerContract: settings.feePerContract, feePerShare: .005, slippageBps: 5 });
  const [assumeMacro, setAssumeMacro] = useState(false), [assumedRate, setAssumedRate] = useState(4), [assumedDividend, setAssumedDividend] = useState(0);
  const [request, setRequest] = useState<(Omit<StrategyBacktestInput, 'bars'> & { rateSource: string; dividendSource: string }) | null>(null), [runError, setRunError] = useState('');
  useEffect(() => {
    setTerms(current => ({ ...current, ...strategyBacktestTerms(strategy), days: Math.max(1, Math.min(730, Math.round(days))), longDays: settings.longDays }));
    setRequest(null); setPlaying(false); setCursorTime(null); setRunError('');
  }, [strategy, days, settings.longDays]);
  const selected = selection?.symbol === research?.symbol ? selection?.date ?? '' : '';
  const desired = draftDate ?? (suggested ? date(suggested.time) : '');
  const desiredEnd = draftEnd ?? (latest ? date(latest.time) : '');
  const rangeDirty = !!selection && (desired !== selection.from || desiredEnd !== selection.end);
  const validDesired = /^\d{4}-\d{2}-\d{2}$/.test(desired) && /^\d{4}-\d{2}-\d{2}$/.test(desiredEnd) && desired >= start && desired <= desiredEnd && !!latest && desiredEnd <= date(latest.time);
  const asOf = selected ? new Date(historicalCloseAvailableAt(Date.parse(selected))).toISOString() : '';
  const historicalEnd = selected ? date(Date.parse(selected) + 86400000) : start;
  const historical = useCompanyResearch({ enabled: !!asOf && !demo, symbol: research?.symbol ?? '', start, end: historicalEnd, cutoff: asOf || undefined, provider });
  const rule = settings.scanner?.rule ?? 'sma-rsi';
  const state = useMemo(() => asOf && research ? historicalState(research.symbol, bars, asOf, rule) : null, [asOf, research, bars, rule]);
  const snapshot = demo ? null : historical.research;
  const policy = useMemo(() => snapshot ? analysisPolicy(settings, snapshot) : null, [snapshot, settings]);
  const rate = policy?.riskFreeRate ?? snapshot?.macro.riskFreeRate;
  const q = useMemo(() => snapshot ? modelDividendYield(snapshot, policy ?? {}) : null, [snapshot, policy]);
  const run = useMemo(() => {
    if (!request || request.strategy !== strategy) return { result: null, error: '' };
    try { return { result: backtestStrategy({ ...request, bars: bars.filter(bar => historicalCloseAvailableAt(bar.time) <= Date.now()) }), error: '' }; }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : 'No se pudo ejecutar la estrategia.' }; }
  }, [request, strategy, bars]);
  const result = run.result;
  const graphBars = useMemo(() => {
    if (!state?.bar) return [];
    const end = revealed && selection ? Date.parse(selection.end) + 86400000 + 6 * 3600000 : Date.parse(asOf);
    const available = bars.filter(bar => historicalCloseAvailableAt(bar.time) <= Math.min(end, Date.now()));
    const entryIndex = available.findIndex(bar => bar.time === state.bar!.time);
    return available.slice(visibleSessions === 0 ? Math.max(0, entryIndex) : Math.max(0, entryIndex - visibleSessions));
  }, [state, bars, asOf, revealed, selection, visibleSessions]);
  const cursor = graphBars.find(bar => bar.time === cursorTime) ?? state?.bar ?? null;
  const cursorIndex = cursor ? graphBars.findIndex(bar => bar.time === cursor.time) : -1;
  const pointCutoff = cursor ? new Date(historicalCloseAvailableAt(cursor.time)).toISOString() : '';
  const point = useMemo(() => pointCutoff && research ? historicalState(research.symbol, bars, pointCutoff, rule) : null, [pointCutoff, research, bars, rule]);
  const chartStudies = coreChartStudies(defaultChartStudies, activeScannerCores(settings.scanner ?? defaultScannerSettings));
  const pointLevels = useMemo(() => point ? analyzeSupportResistance(point.market.bars).allLevels : [], [point]);
  const pointTrends = useMemo(() => point ? detectTrendLines(point.market.bars) : [], [point]);
  const graphEnd = graphBars.at(-1)?.time;
  const graphIndicators = useMemo(() => graphEnd === undefined ? [] : calculateTechnicalIndicators(bars.filter(bar => bar.time <= graphEnd)), [bars, graphEnd]);
  const portfolioPoint = revealed ? result?.snapshots.find(row => row.time === cursor?.time) : null;
  const pnlPoints = useMemo(() => result && state?.bar ? [{ time: state.bar.time, value: 0 }, ...result.equityCurve.map(row => ({ time: row.time, value: row.equity - result.initialCapital }))] : [], [result, state]);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => { if (cursorIndex >= 0 && cursorIndex < graphBars.length - 1) setCursorTime(graphBars[cursorIndex + 1].time); else setPlaying(false); }, 650);
    return () => clearTimeout(timer);
  }, [playing, cursorIndex, graphBars]);
  function inspect(time: number) { setPlaying(false); setCursorTime(time); }
  function loadEntry(value: string, endValue = desiredEnd) {
    if (!research) return;
    try {
      const range = resolveReplayRange(availableBars, value, endValue, start);
      setSelection({ symbol: research.symbol, date: range.decision, from: range.from, end: range.to });
      setDraftDate(range.from); setDraftEnd(range.to); setCursorTime(range.firstTime); setRevealed(true); setRequest(null); setRunError(''); setRangeError(''); setPlaying(false);
    } catch (error) { setRangeError(error instanceof Error ? error.message : 'No se pudo cargar el rango.'); }
  }
  function updateDateRange(bound: 'from' | 'to', value: string) {
    const from = bound === 'from' ? value : desired;
    const to = bound === 'to' ? value : desiredEnd;
    if (bound === 'from') setDraftDate(value); else setDraftEnd(value);
    setRequest(null); setPlaying(false); setRunError(''); setRangeError('');
    if (!from || !to) { setRangeError('Completa las dos fechas para actualizar la gráfica.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      setRangeError('Elige un inicio anterior o igual al fin del rango.'); return;
    }
    loadEntry(from, to);
  }
  function execute() {
    setRunError('');
    if (!selected || !state?.bar) return;
    if (rangeDirty || rangeError) { setRunError('Elige un rango de fechas válido antes de ejecutar la prueba.'); return; }
    if (availableBars.filter(bar => date(bar.time) > selected && date(bar.time) <= selection!.end).length < 2) {
      setRunError('El backtesting necesita al menos tres sesiones en el rango: una de decisión y dos posteriores para evaluar la estrategia.'); return;
    }
    if (!assumeMacro && settings.dividendModel === 'declared-cash') { setRunError('Este backtest BSM necesita que declares los supuestos continuos de tasa y dividendo.'); return; }
    if (!assumeMacro && (!rate || !q || !knownBy(rate, asOf) || !knownBy(q, asOf))) { setRunError('Faltan tasa o dividendo conocidos en la fecha de entrada. Puedes declarar los supuestos de esta simulación.'); return; }
    const from = date(Date.parse(selected) + 86400000), to = selection!.end;
    setRequest({ ...terms, strategy, from, to, rate: assumeMacro ? assumedRate / 100 : rate!.value!, dividendYield: assumeMacro ? assumedDividend / 100 : q!.value!,
      rateSource: assumeMacro ? 'Supuesto del usuario' : rate!.source, dividendSource: assumeMacro ? 'Supuesto del usuario' : q!.source });
    setRevealed(true); setPlaying(false); setCursorTime(state.bar.time);
  }
  const numeric = (key: keyof typeof terms, label: string, min: number, max: number, step = .01) => <label key={key}>{label}<input aria-label={label} type="number" required min={min} max={max} step={step} value={Number.isFinite(terms[key]) ? terms[key] : ''} onChange={event => setTerms({ ...terms, [key]: event.currentTarget.valueAsNumber })}/></label>;
  return <section className="panel historical-replay" aria-label="Reproducción de una fecha pasada" data-selected-backtest-strategy={strategy}>
    <span className="eyebrow">RANGO DE FECHAS → ESTRATEGIA → RESULTADO POR SESIÓN</span><h2>Explorar un rango y su estrategia</h2>
    <p>Selecciona un rango de fechas y prueba <strong>{strategyTitle}</strong> con los precios históricos posteriores. Recorre la gráfica para consultar el efectivo, las opciones, las acciones y el resultado de cada sesión.</p>
    <form className="replay-controls replay-date-range" onSubmit={event => { event.preventDefault(); loadEntry(desired); }}>
      <label>Desde<input type="date" aria-label="Inicio del rango histórico" required min={start} max={desiredEnd || undefined} value={desired} onChange={event => updateDateRange('from', event.target.value)}/></label>
      <label>Hasta<input type="date" aria-label="Fin del rango histórico" required min={desired || start} max={latest ? date(latest.time) : undefined} value={desiredEnd} onChange={event => updateDateRange('to', event.target.value)}/></label>
      <button className="primary-button" disabled={!research || !validDesired}>Cargar rango</button>
    </form>
    {rangeError ? <p role="alert">{rangeError}</p> : <p className="replay-range-status">La gráfica se actualiza al cambiar una fecha válida. Ejecuta de nuevo el backtest para evaluar el nuevo rango.</p>}
    {!state && runError && <p role="alert">{runError}</p>}
    {!state && <p role="status">Carga un rango para explorar el mercado y preparar el backtesting de {strategyTitle}.</p>}
    {state?.bar && <>
      <div className="replay-entry-summary" data-replay-entry-date={selected} data-replay-range-start={selection!.from} data-replay-range-end={selection!.end}><strong>Rango: {selection!.from} a {selection!.end}</strong><span>{research?.symbol} · {strategyTitle} · cierre {money(state.bar.close)}</span><span>La primera entrada se ejecuta en la apertura de la siguiente sesión.</span></div>
      <div className="replay-strategy-setup"><h3>Backtesting de {strategyTitle}</h3><p>{descriptions[strategy]}</p>
        <form onSubmit={event => { event.preventDefault(); execute(); }}>
          <details className="replay-parameters"><summary>Parámetros de la estrategia, costes y supuestos</summary>
          <div className="replay-controls">
            {numeric('capital', 'Capital inicial · USD', 1, 1e7)}{numeric('contracts', 'Unidades del ejercicio histórico', 1, 100, 1)}
            {numeric('days', 'Plazo de cada vencimiento · días', 1, 730, 1)}
            {strategy === 'pmcc' && numeric('longDays', 'Plazo de la call larga · días', 2, 3650, 1)}
            {numeric('shortPercent', strategy === 'gamma' ? 'Strike del straddle · % del precio' : 'Strike vendido · % del precio', 1, 300)}
            {(strategy === 'pmcc' || strategy === 'backspread') && numeric('longPercent', 'Strike comprado · % del precio', 1, 300)}
            {strategy === 'wheel' && numeric('callPercent', 'Strike de call cubierta · % del precio', 1, 300)}
          </div>
          <details className="replay-cost-settings"><summary>Costes y supuestos históricos</summary><div className="replay-controls">{numeric('feePerContract', 'Comisión por contrato · USD', 0, 100)}{numeric('feePerShare', 'Comisión por acción · USD', 0, 10, .001)}{numeric('slippageBps', 'Deslizamiento · pb', 0, 1000)}</div>
            <label><input type="checkbox" aria-label="Usar supuestos macro en ejercicio histórico" checked={assumeMacro} onChange={event => setAssumeMacro(event.target.checked)}/>Usar tasa y dividendo supuestos para este ejercicio</label>
            {assumeMacro ? <div className="replay-controls"><label>Tasa anual supuesta (%)<input type="number" required aria-label="Tasa supuesta del ejercicio histórico" min="-20" max="100" step=".01" value={Number.isFinite(assumedRate) ? assumedRate : ''} onChange={event => setAssumedRate(event.currentTarget.valueAsNumber)}/></label><label>Dividendo anual supuesto (%)<input type="number" required aria-label="Dividendo supuesto del ejercicio histórico" min="0" max="100" step=".01" value={Number.isFinite(assumedDividend) ? assumedDividend : ''} onChange={event => setAssumedDividend(event.currentTarget.valueAsNumber)}/></label></div> : <p>Tasa al corte: {rate?.value == null ? 'no disponible' : `${(rate.value * 100).toFixed(2)}%`}. Dividendo al corte: {q?.value == null ? 'no disponible' : `${(q.value * 100).toFixed(2)}%`}. Si faltan datos, puedes declarar supuestos para la simulación.</p>}
          </details>
          </details>
          <div className="replay-run-actions"><button className="primary-button" disabled={rangeDirty || !!rangeError || (historical.loading && !assumeMacro)}>Ejecutar backtest de {strategyTitle}</button>{result && <button type="button" className="secondary-button" onClick={() => { setRevealed(value => !value); setPlaying(false); setCursorTime(state.bar!.time); }}>{revealed ? 'Ocultar evolución posterior' : 'Revelar evolución posterior'}</button>}</div>
        </form>
        {historical.loading && <p role="status">Consultando los datos conocidos al corte histórico…</p>}{(runError || run.error) && <p role="alert">{runError || run.error}</p>}
        <p>Contratos y primas teóricos BSM; volatilidad estimada únicamente con cierres anteriores a cada apertura. Los parámetros usados en una ejecución permanecen fijados mientras recorres su resultado.</p>
        {revealed && result && request && <p className="replay-run-summary">Período simulado: {date(result.startTime)} a {date(result.endTime)} · capital {money(request.capital)} · {request.contracts} contrato(s) base · plazo {request.days} días · comisión {money(request.feePerContract)}/contrato · {request.feePerShare.toFixed(3)} USD/acción · deslizamiento {request.slippageBps} pb. Tasa {(request.rate * 100).toFixed(2)}% ({request.rateSource}); dividendo {(request.dividendYield * 100).toFixed(2)}% ({request.dividendSource}).</p>}
      </div>
      <div className="replay-controls"><label>Ventana visible<select aria-label="Ventana de la gráfica histórica" value={visibleSessions} onChange={event => setVisibleSessions(Number(event.target.value))}><option value="0">Solo el rango elegido</option><option value="60">60 sesiones previas de contexto</option><option value="120">120 sesiones de contexto</option><option value="252">252 sesiones de contexto</option></select></label>
        <label>Punto a inspeccionar<input type="date" aria-label="Fecha del punto histórico" min={graphBars[0] ? date(graphBars[0].time) : selected} max={graphBars.at(-1) ? date(graphBars.at(-1)!.time) : selected} value={cursor ? date(cursor.time) : selected} onChange={event => { const bar = graphBars.filter(row => date(row.time) <= event.target.value).at(-1); if (bar) inspect(bar.time); }}/></label>
        <button className="secondary-button" disabled={cursorIndex <= 0} onClick={() => inspect(graphBars[cursorIndex - 1].time)}>Punto anterior</button><button className="secondary-button" disabled={cursorIndex < 0 || cursorIndex >= graphBars.length - 1} onClick={() => inspect(graphBars[cursorIndex + 1].time)}>Punto siguiente</button>
        <button className="secondary-button" disabled={graphBars.length < 2} onClick={() => { if (!playing && cursorIndex >= graphBars.length - 1) setCursorTime(graphBars[revealed ? Math.max(0, graphBars.findIndex(bar => bar.time === state.bar!.time)) : 0].time); setPlaying(value => !value); }}>{playing ? 'Pausar recorrido' : 'Reproducir recorrido'}</button>
        <button className="secondary-button" disabled={!cursor || date(cursor.time) === selected || date(cursor.time) < start} onClick={() => cursor && loadEntry(date(cursor.time))}>Usar punto como entrada</button>
      </div>
      <label className="replay-cursor-control">Recorrer cierres<input type="range" aria-label="Punto de la simulación histórica" min="0" max={Math.max(0, graphBars.length - 1)} step="1" value={Math.max(0, cursorIndex)} onChange={event => { const bar = graphBars[event.currentTarget.valueAsNumber]; if (bar) inspect(bar.time); }}/></label>
      <HistoricalReplayChart studies={chartStudies} levels={pointLevels} trends={pointTrends} bars={graphBars} indicators={graphIndicators} entryTime={revealed && result ? result.trades[0]?.entryTime ?? state.bar.time : state.bar.time} cursorTime={cursor?.time ?? state.bar.time} onSelect={inspect} support={point?.structure?.support?.price} resistance={point?.structure?.resistance?.price} pnl={revealed ? pnlPoints.map(row => ({ time: row.time, pnl: row.value })) : undefined} strategyLabel={strategyTitle} selectedPnl={portfolioPoint && result ? portfolioPoint.equity - result.initialCapital : null} capital={result?.initialCapital ?? null}/>
      {revealed && result && cursor && <><HistoricalStrategyResults result={result} cursorTime={cursor.time} title={strategyTitle} symbol={research!.symbol} complete={date(result.endTime) >= request!.to || Date.parse(request!.to) - Date.parse(date(result.endTime)) < 4 * 86400000}/><details><summary>Ampliar la curva de P/L de {strategyTitle}</summary><PnlPlot values={pnlPoints} cursorTime={cursor.time} onSelect={inspect}/></details></>}
      {point && <HistoricalPointInspector state={point} entryDate={selected} mark={null} capital={null} positionEnabled={false} showPosition={false}/>}
      <details className="replay-model-notes"><summary>Fuentes y reglas de la simulación</summary><p>{demo ? 'Subyacente sintético de demostración.' : `Subyacente histórico de ${provider === 'alpaca' ? 'Alpaca' : 'Webull Sandbox'}.`} Las opciones son contratos teóricos de 100 acciones; no se afirma que fueran contratos listados ni primas históricas observadas. La HV usa hasta 252 retornos previos (mínimo 31 cierres) y permanece fija en cada contrato. Tasa y dividendo se fijan al ejecutar la prueba.</p><p>Los vencimientos se resuelven al cierre de la primera sesión disponible en esa fecha o después. Wheel intercambia acciones al strike; PMCC y Backspread liquidan el intrínseco en efectivo. Gamma utiliza un straddle y ajusta su cobertura en la apertura posterior al cálculo de delta. No se modelan ejercicio anticipado, dividendos en efectivo, financiación de saldos ni préstamo de acciones. Al final del rango disponible se cierran las posiciones pendientes, incluso si el período es parcial.</p><p>Reservas del modelo: nominal de la put en Wheel; débito más nominal de la corta en PMCC; pérdida del valle en Backspread; débito más un nominal de 100 acciones por contrato base en Gamma. No representan el margen de un bróker. Los resultados históricos no garantizan resultados futuros.</p>{historical.error && <p>{historical.error}</p>}<ul>{snapshot?.quality.sources.map(source => <li key={source.source}>{source.source}: {source.message}</li>)}</ul></details>
    </>}
  </section>;
}
