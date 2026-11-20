"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { aggregateCandles, generateHistory, historyIssue, type Candle } from '../chart-history';
import { blackScholes, profitMetrics, type CoreId, type OptionType } from '../../../cores/index';
import { cores } from '../../../cores/evaluacion/catalog';
import type { AnalysisSignal, AnalysisResult } from '../../../cores/05-indicadores-y-senales/signals';
import { calculateTechnicalIndicators } from '../../../cores/01-analisis-tecnico/indicators';
import { analyzeSupportResistance } from '../../../cores/01-analisis-tecnico/support-resistance';
import ChartStudyToolbar, { defaultChartStudies, type ChartStudies } from './chart-study-toolbar';
import TechnicalIndicatorPanels from './technical-indicator-panels';
import './chart-studies.css';
import type { MarketSource } from '../hooks/use-market-history';

type MarketChartProps = {
  symbol: string;
  price: number;
  range: string;
  interval: string;
  startDate?: string;
  endDate?: string;
  chartType?: "candles" | "line";
  selectedCores?: CoreId[];
  volatility?: number;
  days?: number;
  rate?: number;
  dividendYield?: number;
  historicalVolatility?: number | null;
  observedOption?: { spot: number; strike: number; volatility: number; days: number; rate: number; dividendYield: number; premium: number; type: OptionType; side: 'buy'|'sell'; contractSymbol: string } | null;
  history?: Candle[];
  source?: MarketSource;
  feed?: 'iex' | 'sip';
  signals?: AnalysisSignal[];
  validationStartTime?: number | null;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  strategyLevels?: {value:number;label:string;color:string;kind?:'manual'|'strategy'}[];
  technicalAnalysis?: AnalysisResult | null;
  studyHistory?: readonly Candle[];
  studies?: ChartStudies;
  onStudyToggle?: (key: keyof ChartStudies) => void;
};

const DEFAULT_WIDTH = 900;
const HEIGHT = 270;
const LEFT = 10;
const TOP = 19;
const BOTTOM = 205;
const UP = "#41c9a6";
const DOWN = "#ef787b";
const ORANGE = "#f3813b";

function formatPrice(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTime(time: number, intraday: boolean) {
  return new Intl.DateTimeFormat("es-MX", intraday
    ? { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }
    : { timeZone: "America/New_York", day: "2-digit", month: "short", year: 'numeric' }).format(new Date(time));
}

export default function MarketChart(props: MarketChartProps) {
  const { symbol, price, range, interval, startDate = '2026-10-09', endDate = '2026-11-09', chartType = "candles", selectedCores = [], volatility = .3, days = 30, rate = .04, dividendYield = 0 } = props;
  const generated = useMemo(() => props.history === undefined ? generateHistory(symbol, price, startDate, endDate, interval) : [], [props.history, symbol, price, interval, startDate, endDate]);
  const loadedHistory = props.history ?? generated;
  const [viewWindow, setViewWindow] = useState<'all' | '6m' | '3m'>('all');
  const history = useMemo(() => viewWindow === 'all' ? loadedHistory : loadedHistory.filter(bar => bar.time >= (loadedHistory.at(-1)?.time ?? 0) - (viewWindow === '6m' ? 183 : 93) * 86400000), [loadedHistory, viewWindow]);
  const candles = useMemo(() => aggregateCandles(history), [history]);
  const issue = historyIssue(startDate, endDate);
  if (props.loading) return <div className="history-loading" role="status">Consultando las velas del rango seleccionado…</div>;
  if (props.error) return <div className="history-query-error" role="alert"><p>{props.error}</p>{props.error.includes("Inicia sesión") && <a className="primary-button small" href="/signin-with-chatgpt?return_to=%2F" target="_self">Iniciar sesión para consultar datos</a>}{props.onRetry && <button className="secondary-button" onClick={props.onRetry}>Volver a consultar</button>}</div>;
  if (!candles.length) return <div className="history-empty" role="status">{issue || 'No hay sesiones entre estas fechas. Elige un rango que incluya lunes a viernes.'}</div>;
  return <HistoryChart {...props} {...{ symbol, price, range, interval, startDate, endDate, chartType, selectedCores, volatility, days, rate, dividendYield }} candles={candles} history={history} loadedHistory={loadedHistory} viewWindow={viewWindow} onViewWindow={setViewWindow}/>;
}

function HistoryChart({ candles, history, loadedHistory, viewWindow, onViewWindow, symbol, range, interval, startDate, endDate, chartType, selectedCores = [], volatility = .3, days = 30, rate = .04, dividendYield = 0, source = 'demo', feed, signals = [], validationStartTime = null, observedOption = null, historicalVolatility = null, strategyLevels=[], technicalAnalysis, studyHistory, studies=defaultChartStudies, onStudyToggle }: MarketChartProps & {candles: Candle[]; history: Candle[]; loadedHistory: Candle[]; viewWindow: 'all' | '6m' | '3m'; onViewWindow: (value: 'all' | '6m' | '3m') => void}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setViewportWidth(Math.max(320, Math.round(entries[0].contentRect.width))));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  const WIDTH = viewportWidth, RIGHT = WIDTH - 74;
  const technicalBars = studyHistory ?? loadedHistory;
  const technical = useMemo(() => technicalAnalysis?.indicators ?? calculateTechnicalIndicators(technicalBars), [technicalAnalysis, technicalBars]);
  const structure = useMemo(() => technicalAnalysis?.structure ?? analyzeSupportResistance(technicalBars), [technicalAnalysis, technicalBars]);
  const index = hovered === null ? null : Math.min(candles.length - 1, hovered);
  const current = index === null ? null : candles[index];
  const enabled = (id: CoreId) => selectedCores.includes(id);
  const modelAvailable = source === 'demo' || observedOption !== null;
  const bandVolatility = source === 'demo' ? volatility : historicalVolatility;
  const sigma = bandVolatility === null ? null : bandVolatility * Math.sqrt(Math.max(1, days) / 365);
  const lastClose = history[history.length - 1].close;
  const strike = source === 'demo' ? Math.round(lastClose / 5) * 5 || lastClose : observedOption?.strike ?? 0;
  const inputs = {spot:observedOption?.spot??lastClose,strike,days:observedOption?.days??Math.max(1,days),volatility:observedOption?.volatility??volatility,rate:observedOption?.rate??rate,dividendYield:observedOption?.dividendYield??dividendYield,type:observedOption?.type??'call' as OptionType};
  const option = modelAvailable ? blackScholes(inputs) : null;
  const metrics = option ? profitMetrics({...inputs,premium:observedOption?.premium??option.price,side:observedOption?.side??'buy'}) : null;
  const levels: {value:number;label:string;color:string;fromTime?:number;labelVisible?:boolean;inlineLabel?:boolean}[] = [
    ...strategyLevels.filter(level=>Number.isFinite(level.value)&&level.value>0).map(level => ({ ...level, labelVisible: true, inlineLabel: level.kind !== 'strategy' })),
    ...(studies.supportResistance ? structure.levels.map(level => ({ value: level.price,
      label: `${level.kind === 'support' ? 'Soporte' : 'Resistencia'} confirmado · ${level.touches} contactos`,
      color: level.kind === 'support' ? UP : DOWN, fromTime: level.confirmedAt, labelVisible: true, inlineLabel: true })) : []),
    ...(enabled('bsm') && option ? [{value:strike,label:source==='demo'?'BSM · strike ATM':'Contrato observado · strike',color:'#bca2ff'}] : []),
    ...(enabled('probability') && metrics ? [{value:metrics.breakeven,label:`Equilibrio ${inputs.type} ${observedOption?.side==='sell'?'vendida':'comprada'}`,color:'#67ceee'}] : []),
    ...(enabled('volatility') && sigma !== null ? [{value:lastClose*(1+sigma),label:source==='demo'?'+1σ':'+1σ HV',color:'#d6b66c'},{value:lastClose*Math.max(.01,1-sigma),label:source==='demo'?'−1σ':'−1σ HV',color:'#d6b66c'}] : []),
    ...(enabled('risk') && sigma !== null ? [{value:lastClose*Math.max(.01,1-2*sigma),label:source==='demo'?'Escenario −2σ':'Escenario HV −2σ',color:DOWN}] : []),
  ];
  const minimum = Math.min(...candles.map(candle => candle.low), ...levels.map(l=>l.value));
  const maximum = Math.max(...candles.map(candle => candle.high), ...levels.map(l=>l.value));
  const padding = (maximum - minimum) * 0.13;
  const low = minimum - padding;
  const high = maximum + padding;
  const extent = high - low || 1;
  const y = (value: number) => TOP + (high - value) / extent * (BOTTOM - TOP);
  const step = (RIGHT - LEFT) / candles.length;
  const x = (i: number) => LEFT + step * (i + 0.5);
  const candleWidth = Math.max(3, Math.min(8, step * 0.59));
  const maxVolume = Math.max(1, ...candles.map(candle => candle.volume));
  const bucketSize = history.length <= 180 ? 1 : Math.ceil(history.length / 180);
  const sourceIndices = candles.map((_, i) => Math.min(history.length - 1, (i + 1) * bucketSize - 1));
  const technicalByTime = new Map(technical.map(point => [point.time, point]));
  const technicalPoints = sourceIndices.map((sourceIndex, i) => ({ x: x(i), value: technicalByTime.get(history[sourceIndex].time) }));
  const indicatorPath = (key: 'smaFast' | 'smaSlow') => {
    let started = false;
    return technicalPoints.map(point => {
      const value = point.value?.[key];
      if (value === null || value === undefined) { started = false; return ''; }
      const command = started ? 'L' : 'M'; started = true;
      return `${command}${point.x},${y(value)}`;
    }).join(' ');
  };
  const linePath = candles.map((candle, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(candle.close).toFixed(2)}`).join(" ");
  const deltaPath = modelAvailable ? candles.map((c,i)=>{const value=blackScholes({...inputs,spot:c.close});return `${i?'L':'M'}${x(i)},${BOTTOM-value.delta*45}`;}).join(' ') : '';
  const intraday = candles[candles.length - 1].time - candles[0].time < 86400000;
  const last = candles[candles.length - 1];
  const lastY = y(last.close);
  const grid = Array.from({ length: 5 }, (_, i) => high - extent * i / 4);
  const tickCount = Math.max(2, Math.min(7, Math.floor((RIGHT - LEFT) / 110) + 1));
  const ticks = [...new Set(Array.from({ length: tickCount }, (_, i) => Math.round(i * (candles.length - 1) / (tickCount - 1))))];
  function bucketForTime(time: number) {
    let lo = 0, hi = history.length - 1;
    while (lo < hi) { const middle = Math.floor((lo + hi) / 2); if (history[middle].time < time) lo = middle + 1; else hi = middle; }
    return Math.min(candles.length - 1, Math.floor(lo / bucketSize));
  }
  const markerBuckets = new Map<string, { signal: AnalysisSignal; index: number; count: number }>();
  for (const signal of signals) {
    if (signal.time < history[0].time || signal.time > history.at(-1)!.time) continue;
    if (signal.action === 'hold') continue;
    const markerIndex = bucketForTime(signal.time), key = `${markerIndex}:${signal.action}`;
    markerBuckets.set(key, { signal, index: markerIndex, count: (markerBuckets.get(key)?.count ?? 0) + 1 });
  }
  const signalLabels = new Set<string>();
  const lastSignalX = { buy: Infinity, sell: Infinity };
  for (const marker of [...markerBuckets.values()].reverse()) {
    const action = marker.signal.action;
    if (action !== 'hold' && lastSignalX[action] - x(marker.index) >= (WIDTH < 600 ? Infinity : 80)) {
      signalLabels.add(`${marker.index}:${action}`); lastSignalX[action] = x(marker.index);
    }
  }
  const visibleEvents = (technicalAnalysis?.technicalEvents ?? []).filter(event => event.time >= history[0].time && event.time <= history.at(-1)!.time).slice(-24);
  const eventLabels = new Set<number>();
  const lastEventX = { up: Infinity, down: Infinity };
  for (let i = visibleEvents.length - 1; i >= 0; i--) {
    const event = visibleEvents[i], location = x(bucketForTime(event.time));
    if (lastEventX[event.direction] - location >= (WIDTH < 600 ? Infinity : 100)) { eventLabels.add(i); lastEventX[event.direction] = location; }
  }
  const validationX = validationStartTime === null ? null : Math.max(LEFT, x(bucketForTime(validationStartTime)) - step / 2);
  const sourceLabel = source === 'demo' ? 'Datos simulados' : `Histórico Alpaca · ${(feed ?? 'iex').toUpperCase()} · ajustado por splits`;

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = (event.clientX - bounds.left) / bounds.width * WIDTH;
    if (pointerX < LEFT || pointerX > RIGHT) {
      setHovered(null);
      return;
    }
    setHovered(Math.max(0, Math.min(candles.length - 1, Math.floor((pointerX - LEFT) / step))));
  }

  return (
    <div ref={container} className="market-chart" style={{ width: "100%", minWidth: 0, position: "relative" }}>
      <div className="history-summary"><strong>{startDate} → {endDate}</strong><span>{loadedHistory.length.toLocaleString('es-MX')} velas · {interval} · ET</span><button className="secondary-button" onClick={()=>{
        const csv='Fecha UTC,Apertura,Maximo,Minimo,Cierre,Volumen\r\n'+loadedHistory.map(c=>[new Date(c.time).toISOString(),c.open,c.high,c.low,c.close,c.volume].join(',')).join('\r\n');
        const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`${symbol}-${startDate}-${endDate}-${source==='demo'?'simulado':'alpaca'}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }}>Exportar velas CSV</button></div>
      <div className="history-signal-legend"><span>{sourceLabel}</span><span className="buy">▲ Entrada por regla</span><span className="sell">▼ Salida por regla</span>{signals.length>0&&<><span style={{color:'#72c9e1'}}>Media 20: azul claro</span><span style={{color:'#e2bf80'}}>Media 50: dorada</span></>}{validationX !== null && <span className="validation">Zona azul: validación temporal</span>}</div>
      <div className="core-chart-legend">{selectedCores.map(id=><span key={id} data-core={id}>{cores.find(c=>c.id===id)?.title}</span>)}{!selectedCores.length&&<span>Activa cores para ver indicadores</span>}</div>
      {onStudyToggle && <ChartStudyToolbar studies={studies} onToggle={onStudyToggle}/>}
      <div className="history-view-controls" role="group" aria-label="Ventana visible de la gráfica"><span>Vista</span>{([['all', 'Todo el rango'], ['6m', '6 meses'], ['3m', '3 meses']] as const).map(([value, label]) => <button key={value} className="secondary-button" aria-pressed={viewWindow === value} onClick={() => onViewWindow(value)}>{label}</button>)}<small>{history.length} velas en vista; el análisis y CSV conservan el rango cargado.</small></div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Gráfico ${chartType === "line" ? "de línea" : "de velas"} de ${symbol}. ${sourceLabel}. Vista ${formatTime(history[0].time,false)} a ${formatTime(history.at(-1)!.time,false)}, rango cargado ${range}, intervalo ${interval}. ${selectedCores.length} criterios activos. Usa las flechas para explorar las velas.`}
        tabIndex={0}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHovered(null)}
        onBlur={() => setHovered(null)}
        onKeyDown={event => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const direction = event.key === "ArrowLeft" ? -1 : 1;
            setHovered(previous => Math.max(0, Math.min(candles.length - 1, (previous ?? candles.length - 1) + direction)));
          } else if (event.key === "Escape") setHovered(null);
        }}
        style={{ display: "block", width: "100%", height: "auto", overflow: "visible", touchAction: "pan-y", fontFamily: "inherit", cursor: "crosshair" }}
      >
        <title>{`${symbol} · Histórico de velas ${source === 'demo' ? 'simulado' : 'real'}`}</title>
        <desc>{source === 'demo' ? 'Serie ilustrativa y reproducible, no corresponde a cotizaciones de mercado.' : 'Velas históricas del proveedor seleccionado; la cobertura y el feed se indican sobre la gráfica.'} Velas verdes para alzas y rojas para bajas. Las flechas marcan cruces históricos, no predicciones futuras.</desc>
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="transparent" />
        {validationX !== null && <g data-validation-region="true"><rect x={validationX} y={TOP} width={Math.max(0,RIGHT-validationX)} height={BOTTOM-TOP} fill="#638bcc" opacity=".07"/><line x1={validationX} x2={validationX} y1={TOP} y2={BOTTOM} stroke="#638bcc" strokeDasharray="4 4" opacity=".6"/></g>}
        {grid.map((value, i) => (
          <g key={i}>
            <line x1={LEFT} x2={RIGHT} y1={y(value)} y2={y(value)} stroke="#24272b" strokeWidth="0.7" />
            <text x={RIGHT + 14} y={y(value) + 3} fill="#747a83" fontSize="10" fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace">{formatPrice(value)}</text>
          </g>
        ))}
        {ticks.map(i => (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={TOP} y2="240" stroke="#24272b" strokeWidth="0.7" strokeDasharray="2 5" opacity="0.65" />
            <text x={x(i)} y="258" textAnchor={i === 0 ? "start" : i === candles.length - 1 ? "end" : "middle"} fill="#747a83" fontSize="10">{formatTime(candles[i].time, intraday)}</text>
          </g>
        ))}
        {studies.volume && candles.map((candle, i) => {
          const color = candle.close >= candle.open ? UP : DOWN;
          const volumeHeight = candle.volume / maxVolume * 26;
          return <rect key={i} data-volume-bar="true" x={x(i) - candleWidth / 2} y={239 - volumeHeight} width={candleWidth} height={volumeHeight} fill={color} opacity="0.35" rx="0.5" />;
        })}
        {chartType === "line" ? (
          <path d={linePath} fill="none" stroke={UP} strokeWidth="1.8" strokeLinejoin="round" />
        ) : candles.map((candle, i) => {
          const color = candle.close >= candle.open ? UP : DOWN;
          return (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth="1" />
              <rect x={x(i) - candleWidth / 2} y={Math.min(y(candle.open), y(candle.close))} width={candleWidth} height={Math.max(1.2, Math.abs(y(candle.open) - y(candle.close)))} fill={color} rx="0.6" />
            </g>
          );
        })}
        {enabled('greeks') && modelAvailable && <path data-indicator="greeks" d={deltaPath} fill="none" stroke="#e7a4cf" strokeWidth="1.5" strokeDasharray="4 3"/>}
        {studies.averages&&<g data-analysis-indicator="sma20-50" data-indicator={enabled('trend') ? 'trend' : undefined}><path d={indicatorPath('smaFast')} fill="none" stroke="#72c9e1" strokeWidth="1.6"/><path d={indicatorPath('smaSlow')} fill="none" stroke="#e2bf80" strokeWidth="1.6" strokeDasharray="5 2"/></g>}
        {[...markerBuckets.values()].map(({signal,index:markerIndex,count}) => {
          const buy = signal.action === 'buy', markerY = buy ? Math.min(BOTTOM - 9, y(candles[markerIndex].low) + 9) : Math.max(TOP + 9, y(candles[markerIndex].high) - 9);
          return <g key={`${markerIndex}:${signal.action}`} data-signal={signal.action} data-signal-time={signal.time}>
            <title>{`${buy?'Entrada':'Salida'} · ${formatTime(signal.time,false)} · $${formatPrice(signal.price)} · ${signal.reason}${count>1?` · ${count} señales en este grupo`:''}`}</title>
            <path d={buy?`M${x(markerIndex)},${markerY-5}l-4,7h8Z`:`M${x(markerIndex)},${markerY+5}l-4,-7h8Z`} fill={buy?UP:DOWN} stroke="#0e1012" strokeWidth="1"/>
            {studies.labels && signalLabels.has(`${markerIndex}:${signal.action}`) && <text x={x(markerIndex)} y={buy ? markerY + 16 : markerY - 10} textAnchor="middle" fill={buy ? UP : DOWN} fontSize="10" stroke="#141618" strokeWidth="2" paintOrder="stroke">{buy ? 'COMPRA' : 'VENTA'}</text>}
          </g>;
        })}
        {studies.events && visibleEvents.map((event, eventIndex) => {
          const bucket = bucketForTime(event.time), eventY = event.direction === 'up' ? Math.min(BOTTOM - 5, y(candles[bucket].low) + 25) : Math.max(TOP + 10, y(candles[bucket].high) - 25);
          return <g key={`${event.time}-${event.kind}-${eventIndex}`} data-technical-event={event.kind}><title>{`${event.label} · ${formatTime(event.time, false)} · ${event.reason}`}</title><path d={`M${x(bucket)},${eventY-4}l4,4l-4,4l-4,-4Z`} fill="none" stroke={event.direction === 'up' ? UP : DOWN}/>{studies.labels && eventLabels.has(eventIndex) && <text x={x(bucket)} y={event.direction === 'up' ? eventY + 13 : eventY - 7} textAnchor="middle" fill={event.direction === 'up' ? UP : DOWN} fontSize="10">{event.label}</text>}</g>;
        })}
        {levels.map((level, levelIndex)=><g key={`${level.label}-${levelIndex}`} data-indicator={level.fromTime === undefined ? level.label : undefined} data-price-level={level.fromTime === undefined ? 'manual-or-model' : 'confirmed'}><title>{level.label} · {formatPrice(level.value)}{level.fromTime ? ` · conocido desde ${formatTime(level.fromTime, false)}` : ''}</title><line x1={level.fromTime === undefined ? LEFT : x(bucketForTime(level.fromTime))} x2={RIGHT} y1={y(level.value)} y2={y(level.value)} stroke={level.color} strokeDasharray="6 4" opacity={level.labelVisible ? 1 : .4}/>{studies.labels && level.inlineLabel && <text x={RIGHT - 5} textAnchor="end" y={y(level.value)-4} fill={level.color} fontSize="10" stroke="#141618" strokeWidth="2" paintOrder="stroke">{level.fromTime === undefined ? level.label.slice(0,16) : level.label.startsWith('Soporte') ? 'S' : 'R'} · {formatPrice(level.value)}</text>}</g>)}
        <line x1={LEFT} x2={RIGHT} y1={lastY} y2={lastY} stroke={ORANGE} strokeWidth="0.8" strokeDasharray="3 4" opacity="0.72" />
        <rect x={RIGHT + 3} y={lastY - 10} width="67" height="21" rx="3" fill={ORANGE} />
        <text x={RIGHT + 36.5} y={lastY + 3.5} textAnchor="middle" fill="#171513" fontSize="10" fontWeight="700" fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace">{formatPrice(last.close)}</text>
        {current && index !== null && (
          <g pointerEvents="none">
            <line x1={x(index)} x2={x(index)} y1={TOP} y2="240" stroke="#8c939c" strokeWidth="0.8" strokeDasharray="3 3" />
            <line x1={LEFT} x2={RIGHT} y1={y(current.close)} y2={y(current.close)} stroke="#8c939c" strokeWidth="0.8" strokeDasharray="3 3" />
            <circle cx={x(index)} cy={y(current.close)} r="3" fill={ORANGE} stroke="#111315" strokeWidth="1.5" />
            {WIDTH >= 600 && <rect x={12} y={2} width="465" height="27" rx="4" fill="#1a1d21" stroke="#33373d" strokeWidth="0.7" />}
            {WIDTH >= 600 && <text x="22" y="19" fill="#a0a7b1" fontSize="10" fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace">
              <tspan fill="#e4e7ec">{formatTime(current.time, intraday)}</tspan>
              <tspan dx="15">O </tspan><tspan fill="#e4e7ec">{formatPrice(current.open)}</tspan>
              <tspan dx="12">H </tspan><tspan fill={UP}>{formatPrice(current.high)}</tspan>
              <tspan dx="12">L </tspan><tspan fill={DOWN}>{formatPrice(current.low)}</tspan>
              <tspan dx="12">C </tspan><tspan fill={current.close >= current.open ? UP : DOWN}>{formatPrice(current.close)}</tspan>
            </text>}
          </g>
        )}
      </svg>
      <TechnicalIndicatorPanels points={technicalPoints} rsi={studies.rsi} macd={studies.macd} width={WIDTH}/>
      {levels.some(level => level.labelVisible) && <div className="chart-level-key">{levels.filter(level => level.labelVisible).map((level, levelIndex) => <span key={levelIndex} style={{borderColor:level.color}}>{level.label} · {formatPrice(level.value)}</span>)}</div>}
      <details className="chart-marker-list"><summary>Consultar señales y motivos de la vista</summary>
        <p>Las flechas describen la acción, no una compra automática de call/put.</p>
        <ul>{signals.filter(signal => signal.action !== 'hold' && signal.time >= history[0].time && signal.time <= history.at(-1)!.time).slice(-10).reverse().map(signal => <li key={signal.time}><strong>{signal.action === 'buy' ? 'COMPRA' : 'VENTA'} · {formatTime(signal.time, false)} · {formatPrice(signal.price)}</strong><span>{signal.reason}</span></li>)}</ul>
      </details>
      <p className="chart-technical-status"><strong>ATR14:</strong> {technical.at(-1)?.atr?.toFixed(2) ?? 'sin datos suficientes'} · <strong>Volumen relativo:</strong> {technical.at(-1)?.relativeVolume?.toFixed(2) ?? '—'}× frente a las 20 velas anteriores. {studies.supportResistance && (structure.levels.length ? `${structure.levels.length} niveles confirmados con al menos dos pivotes; se dibujan desde que fueron conocidos.` : 'Aún no hay soportes/resistencias con dos pivotes confirmados en este rango.')} Las marcas son reglas de análisis; no envían órdenes.</p>
      <div className="history-inspection" aria-live="polite">{current && index !== null ? `${formatTime(current.time,false)}${bucketSize>1?` → ${formatTime(history[sourceIndices[index]].time,false)} · OHLC de hasta ${bucketSize} velas`:''} · O ${formatPrice(current.open)} · H ${formatPrice(current.high)} · L ${formatPrice(current.low)} · C ${formatPrice(current.close)} · V ${current.volume.toLocaleString('es-MX')}` : 'Explora las velas con el cursor o con las flechas del teclado para consultar fecha, OHLC y volumen.'}</div>
      <div className="chart-core-values" aria-live="polite">
        {enabled('bsm')&&option&&<span>BSM {inputs.type}{source==='demo'?' ATM':''}: ${option.price.toFixed(2)} / acción</span>}
        {enabled('greeks')&&option&&<span>Δ {option.delta.toFixed(3)} · Γ {option.gamma.toFixed(4)} · línea rosa: escenario de Δ</span>}
        {enabled('probability')&&metrics&&<span>Prob. teórica de beneficio: {(metrics.probabilityOfProfit*100).toFixed(1)}% · {inputs.type} {observedOption?.side==='sell'?'vendida':'comprada'} · neutral al riesgo</span>}
        {!modelAvailable && selectedCores.some(id=>['bsm','greeks','probability'].includes(id))&&<span>BSM, griegas y probabilidad: no disponibles; faltan entradas verificables del contrato.</span>}
        {enabled('volatility')&&bandVolatility!==null&&<span>{source==='demo'?'IV del escenario':'HV observada'} {(bandVolatility*100).toFixed(1)}% · banda ±1σ a {Math.max(1,days)} días</span>}
        {enabled('trend')&&<span>Media 20: {technical.at(-1)?.smaFast?.toFixed(2) ?? '—'} azul · media 50: {technical.at(-1)?.smaSlow?.toFixed(2) ?? '—'} dorada</span>}
        {enabled('liquidity')&&<span>Volumen última vela original: {history.at(-1)?.volume.toLocaleString('es-MX')}</span>}
        {enabled('risk')&&sigma!==null&&<span>Caída ilustrativa 2σ: {(2*sigma*100).toFixed(1)}% · no es pérdida máxima</span>}
      </div>
      <p className="history-footnote">{source === 'demo' ? 'Datos sintéticos · sesiones lunes–viernes, sin festivos ni medias sesiones.' : `Datos históricos ${(feed??'iex').toUpperCase()} · ${feed==='sip'?'cobertura consolidada según permisos de la cuenta':'IEX es una sola bolsa, no todo el volumen del mercado'}.`}{history.length>candles.length?` Vista agrupada en ${candles.length} velas; el CSV conserva las ${history.length} velas originales.`:''} Medias calculadas sobre la serie original. {source==='demo'?'Niveles BSM y riesgo usan la volatilidad del escenario, no una cadena de opciones real.':observedOption?`Contrato: ${observedOption.contractSymbol}. Delta sobre precios pasados es un escenario con entradas fijas, no griegas históricas observadas. BSM aproxima ejercicio europeo; la probabilidad teórica de una sola opción no mide el éxito real de una estrategia.`:'Las bandas HV describen variabilidad histórica; no sustituyen la IV. Las capas de opciones permanecen ocultas sin datos completos.'}</p>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }} aria-live="polite">
        {current ? `${symbol}: apertura ${formatPrice(current.open)}, máximo ${formatPrice(current.high)}, mínimo ${formatPrice(current.low)}, cierre ${formatPrice(current.close)}. ${sourceLabel}.` : ""}
      </span>
    </div>
  );
}
