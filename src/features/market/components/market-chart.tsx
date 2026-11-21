"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { aggregateCandles, generateHistory, historyIssue, type Candle } from '../chart-history';
import { blackScholes, profitMetrics, type OptionType } from '../../../cores/index';
import type { AnalysisSignal, AnalysisResult } from '../../../cores/05-indicadores-y-senales/signals';
import { calculateTechnicalIndicators } from '../../../cores/01-analisis-tecnico/indicators';
import { analyzeSupportResistance } from '../../../cores/01-analisis-tecnico/support-resistance';
import { detectTechnicalEvents, detectOpeningGaps, type TechnicalEvent } from '../../../cores/05-indicadores-y-senales/technical-events';
import { placeChartLabels } from '../chart-annotations';
import ChartStudyToolbar, { defaultChartStudies, type ChartStudies } from './chart-study-toolbar';
import TechnicalIndicatorPanels from './technical-indicator-panels';
import { groupChartNews, newsSessionDate } from '../chart-news';
import { ChartNewsRail, ChartNewsDetails } from './chart-news-timeline';
import type { ChartNewsState } from '../hooks/use-chart-news';
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
  optionLevels?: boolean;
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
  news?: ChartNewsState;
};

const DEFAULT_WIDTH = 900;
const HEIGHT = 440;
const LEFT = 10;
const TOP = 36;
const BOTTOM = 344;
const VOLUME_BOTTOM = 405;
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
  const { symbol, price, range, interval, startDate = '2026-10-09', endDate = '2026-11-09', chartType = "candles", optionLevels = false, volatility = .3, days = 30, rate = .04, dividendYield = 0 } = props;
  const generated = useMemo(() => props.history === undefined ? generateHistory(symbol, price, startDate, endDate, interval) : [], [props.history, symbol, price, interval, startDate, endDate]);
  const loadedHistory = props.history ?? generated;
  const [viewWindow, setViewWindow] = useState<'all' | '6m' | '3m'>('all');
  const history = useMemo(() => viewWindow === 'all' ? loadedHistory : loadedHistory.filter(bar => bar.time >= (loadedHistory.at(-1)?.time ?? 0) - (viewWindow === '6m' ? 183 : 93) * 86400000), [loadedHistory, viewWindow]);
  const candles = useMemo(() => aggregateCandles(history), [history]);
  const issue = historyIssue(startDate, endDate);
  if (props.loading) return <div className="history-loading" role="status">Consultando las velas del rango seleccionado…</div>;
  if (props.error) return <div className="history-query-error" role="alert"><p>{props.error}</p>{props.error.includes("Inicia sesión") && <a className="primary-button small" href="/signin-with-chatgpt?return_to=%2F" target="_self">Iniciar sesión para consultar datos</a>}{props.onRetry && <button className="secondary-button" onClick={props.onRetry}>Volver a consultar</button>}</div>;
  if (!candles.length) return <div className="history-empty" role="status">{issue || 'No hay sesiones entre estas fechas. Elige un rango que incluya lunes a viernes.'}</div>;
  return <HistoryChart {...props} {...{ symbol, price, range, interval, startDate, endDate, chartType, optionLevels, volatility, days, rate, dividendYield }} candles={candles} history={history} loadedHistory={loadedHistory} viewWindow={viewWindow} onViewWindow={setViewWindow}/>;
}

function HistoryChart({ candles, history, loadedHistory, viewWindow, onViewWindow, symbol, range, interval, startDate, endDate, chartType, optionLevels = false, volatility = .3, days = 30, rate = .04, dividendYield = 0, source = 'demo', feed, signals = [], validationStartTime = null, observedOption = null, historicalVolatility = null, strategyLevels=[], technicalAnalysis, studyHistory, studies=defaultChartStudies, onStudyToggle, news }: MarketChartProps & {candles: Candle[]; history: Candle[]; loadedHistory: Candle[]; viewWindow: 'all' | '6m' | '3m'; onViewWindow: (value: 'all' | '6m' | '3m') => void}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [selectedNews, setSelectedNews] = useState<string | null>(null);
  const newsDetailsId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setViewportWidth(Math.max(320, Math.round(entries[0].contentRect.width))));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  const WIDTH = Math.max(720, viewportWidth), RIGHT = WIDTH - 88;
  const newsHeight = studies.news ? 64 : 0, volumeBottom = VOLUME_BOTTOM + newsHeight, height = HEIGHT + newsHeight;
  const newsSnapshot = source === 'alpaca' && news?.snapshot?.symbol === symbol ? news.snapshot : null;
  const newsViewStart = viewWindow === 'all' ? startDate! : newsSessionDate(history[0].time);
  const newsGroups = useMemo(() => studies.news && newsSnapshot ? groupChartNews({ articles: newsSnapshot.news.articles,
    history, interval, asOf: newsSnapshot.asOf, startDate: newsViewStart, endDate: endDate!, left: LEFT, right: RIGHT }) : [],
    [studies.news, newsSnapshot, history, interval, newsViewStart, endDate, RIGHT]);
  const technicalBars = studyHistory ?? loadedHistory;
  const technical = useMemo(() => technicalAnalysis?.indicators ?? calculateTechnicalIndicators(technicalBars), [technicalAnalysis, technicalBars]);
  const structure = useMemo(() => technicalAnalysis?.structure ?? analyzeSupportResistance(technicalBars), [technicalAnalysis, technicalBars]);
  const technicalEvents = useMemo(() => technicalAnalysis?.technicalEvents ?? detectTechnicalEvents(technicalBars, technical, structure.points), [technicalAnalysis, technicalBars, technical, structure]);
  const gaps = useMemo(() => detectOpeningGaps(technicalBars, interval), [technicalBars, interval]);
  const index = hovered === null ? null : Math.min(candles.length - 1, hovered);
  const current = index === null ? null : candles[index];
  const modelAvailable = source === 'demo' || observedOption !== null;
  const bandVolatility = source === 'demo' ? volatility : historicalVolatility;
  const sigma = bandVolatility === null ? null : bandVolatility * Math.sqrt(Math.max(1, days) / 365);
  const lastClose = history[history.length - 1].close;
  const strike = source === 'demo' ? Math.round(lastClose / 5) * 5 || lastClose : observedOption?.strike ?? 0;
  const inputs = {spot:observedOption?.spot??lastClose,strike,days:observedOption?.days??Math.max(1,days),volatility:observedOption?.volatility??volatility,rate:observedOption?.rate??rate,dividendYield:observedOption?.dividendYield??dividendYield,type:observedOption?.type??'call' as OptionType};
  const demoPremium = optionLevels && source === 'demo' ? blackScholes(inputs).price : null;
  const metrics = optionLevels && modelAvailable ? profitMetrics({...inputs,premium:observedOption?.premium??demoPremium!,side:observedOption?.side??'buy'}) : null;
  const levels: {value:number;label:string;color:string;fromTime?:number;labelVisible?:boolean;inlineLabel?:boolean}[] = [
    ...strategyLevels.filter(level=>Number.isFinite(level.value)&&level.value>0).map(level => ({ ...level, labelVisible: true, inlineLabel: level.kind !== 'strategy' })),
    ...(studies.supportResistance ? structure.levels.map(level => ({ value: level.price,
      label: `${level.kind === 'support' ? 'Soporte' : 'Resistencia'} confirmado · ${level.touches} contactos`,
      color: level.kind === 'support' ? UP : DOWN, fromTime: level.confirmedAt, labelVisible: true, inlineLabel: true })) : []),
    ...(optionLevels && modelAvailable ? [{value:strike,label:source==='demo'?'Contrato demo · strike ATM':'Contrato observado · strike',color:'#bca2ff',labelVisible:true,inlineLabel:true}] : []),
    ...(optionLevels && metrics ? [{value:metrics.breakeven,label:`Equilibrio ${inputs.type} ${observedOption?.side==='sell'?'vendida':'comprada'}`,color:'#67ceee',labelVisible:true,inlineLabel:true}] : []),
    ...(studies.volatilityBands && sigma !== null ? [{value:lastClose*(1+sigma),label:source==='demo'?'+1σ demo':'+1σ HV',color:'#d6b66c',labelVisible:true,inlineLabel:true},{value:lastClose*Math.max(.01,1-sigma),label:source==='demo'?'−1σ demo':'−1σ HV',color:'#d6b66c',labelVisible:true,inlineLabel:true}] : []),
    ...(studies.riskScenario && sigma !== null ? [{value:lastClose*Math.max(.01,1-2*sigma),label:source==='demo'?'Escenario −2σ demo':'Escenario HV −2σ',color:DOWN,labelVisible:true,inlineLabel:true}] : []),
  ];
  const technicalByTime = new Map(technical.map(point => [point.time, point]));
  const averageValues = studies.averages ? history.flatMap(bar => {
    const point = technicalByTime.get(bar.time);
    return [point?.smaFast, point?.smaSlow].filter((value): value is number => value !== null && value !== undefined);
  }) : [];
  const gapPrices = studies.gaps ? gaps.filter(event => event.time >= history[0].time && event.time <= history.at(-1)!.time)
    .flatMap(event => [event.price, event.previousClose ?? event.price]) : [];
  const minimum = Math.min(...candles.map(candle => candle.low), ...levels.map(l=>l.value), ...averageValues, ...gapPrices);
  const maximum = Math.max(...candles.map(candle => candle.high), ...levels.map(l=>l.value), ...averageValues, ...gapPrices);
  const padding = Math.max(maximum - minimum, maximum * .005) * 0.18;
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
  const visibleEvents = [...technicalEvents, ...gaps].filter(event => {
    if (event.time < history[0].time || event.time > history.at(-1)!.time) return false;
    return event.kind === 'average' ? studies.crosses : event.kind === 'gap' ? studies.gaps
      : event.kind === 'macd' ? studies.macd : event.kind === 'rsi' ? studies.rsi : studies.events;
  }).sort((a, b) => a.time - b.time);
  // Keep every event in the detail list; group same-kind markers only when the view aggregates candles.
  const eventBuckets = new Map<string, { id: string; event: TechnicalEvent; bucket: number; events: TechnicalEvent[] }>();
  for (const event of visibleEvents) {
    const bucket = bucketForTime(event.time), id = `${bucket}:${event.kind}:${event.direction}`;
    const group = eventBuckets.get(id);
    if (group) { group.event = event; group.events.push(event); }
    else eventBuckets.set(id, { id, event, bucket, events: [event] });
  }
  const markerLanes = new Map<string, number>();
  const eventMarkers = [...eventBuckets.values()].map(marker => {
    const key = `${marker.bucket}:${marker.event.direction}`, lane = markerLanes.get(key) ?? 0;
    markerLanes.set(key, lane + 1);
    const below = marker.event.direction === 'up';
    const markerY = below ? Math.min(BOTTOM - 8, y(candles[marker.bucket].low) + 22 + lane * 12)
      : Math.max(TOP + 8, y(candles[marker.bucket].high) - 22 - lane * 12);
    return { ...marker, markerY, text: `${marker.event.label}${marker.events.length > 1 ? ` ×${marker.events.length}` : ''}` };
  });
  const signalMarkers = [...markerBuckets.entries()].map(([id, marker]) => {
    const buy = marker.signal.action === 'buy';
    return { ...marker, id: `signal:${id}`, buy, markerY: buy ? Math.min(BOTTOM - 9, y(candles[marker.index].low) + 8) : Math.max(TOP + 9, y(candles[marker.index].high) - 8) };
  });
  const labelCandidates = [
    ...eventMarkers.map(marker => ({ id: marker.id, x: x(marker.bucket), y: marker.markerY, text: marker.text, direction: marker.event.direction, time: marker.event.time })),
    ...signalMarkers.map(marker => ({ id: marker.id, x: x(marker.index), y: marker.markerY, text: marker.buy ? 'COMPRA' : 'VENTA', direction: marker.buy ? 'up' as const : 'down' as const, time: marker.signal.time })),
  ].sort((a, b) => b.time - a.time);
  // Reserve breathing room around candles, even if more text would technically fit.
  const labelColumns: Record<'up' | 'down', number[]> = { up: [], down: [] };
  const sparseLabels = labelCandidates.filter(label => {
    if (labelColumns[label.direction].some(location => Math.abs(location - label.x) < 76)) return false;
    labelColumns[label.direction].push(label.x); return true;
  });
  const annotationLabels = placeChartLabels([
    ...levels.flatMap((level, i) => level.inlineLabel ? [{ id: `level:${i}`, x: RIGHT - 130, y: y(level.value), text: level.label.replace(' confirmado', ''), direction: 'down' as const }] : []),
    ...sparseLabels,
  ], { left: LEFT + 3, right: RIGHT - 3, top: TOP, bottom: BOTTOM });
  const drawAnnotation = (id: string, text: string, color: string) => {
    const label = annotationLabels.get(id);
    return studies.labels && label ? <g pointerEvents="none"><rect x={label.x - label.width / 2} y={label.y - 12} width={label.width} height={17} rx="3" fill="#11171d" opacity=".94"/><text x={label.x} y={label.y} textAnchor="middle" fill={color} fontSize="12">{text}</text></g> : null;
  };
  // Price badges share a right-hand rail; shift nearby badges without shifting their actual level lines.
  const priceBadges = [...levels.map((level, i) => ({ id: `level:${i}`, value: level.value, color: level.color, show: level.inlineLabel })),
    { id: 'last', value: last.close, color: ORANGE, show: true }].filter(badge => badge.show).sort((a, b) => y(a.value) - y(b.value));
  const badgeY = new Map<string, number>();
  let priorBadgeY = TOP - 23;
  for (let i = 0; i < priceBadges.length; i++) {
    const badge = priceBadges[i];
    const location = Math.min(BOTTOM - (priceBadges.length - i - 1) * 23, Math.max(y(badge.value), priorBadgeY + 23));
    badgeY.set(badge.id, location); priorBadgeY = location;
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
      <div className="history-signal-legend"><span>{sourceLabel}</span>{signals.length > 0 && <><span className="buy">▲ Entrada por regla</span><span className="sell">▼ Salida por regla</span></>}{validationX !== null && <span className="validation">Zona azul: validación temporal</span>}</div>
      {onStudyToggle && <ChartStudyToolbar studies={studies} onToggle={onStudyToggle}/>}
      <div className="history-view-controls" role="group" aria-label="Ventana visible de la gráfica"><span>Vista</span>{([['all', 'Todo el rango'], ['6m', '6 meses'], ['3m', '3 meses']] as const).map(([value, label]) => <button key={value} className="secondary-button" aria-pressed={viewWindow === value} onClick={() => onViewWindow(value)}>{label}</button>)}<small>{history.length} velas en vista; el análisis y CSV conservan el rango cargado.</small></div>
      <div className="chart-overlay-legend" aria-label="Leyenda de capas visibles">
        {studies.averages && <><span><i style={{background:'#e2bf80'}}/>Media 20</span><span><i style={{background:'#d8e2ee'}}/>Media 50</span></>}
        {studies.crosses && <span>◇ Cruce 20/50</span>}{studies.macd && <span>◇ MACD</span>}
        {studies.gaps && <span>GAP · apertura vs. cierre anterior · ≥ 0.5%</span>}
        {studies.news && <span style={{color:'#d6b66c'}}><i/>Noticias · N / cantidad de titulares</span>}
      </div>
      {viewportWidth < 720 && <p className="chart-scroll-hint">Desliza la gráfica horizontalmente para explorar las velas y los indicadores.</p>}
      <div className="chart-price-surface" role="region" aria-label="Gráfica de precio e indicadores" tabIndex={0}>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="group"
        aria-label={`Gráfico ${chartType === "line" ? "de línea" : "de velas"} de ${symbol}. ${sourceLabel}. Vista ${formatTime(history[0].time,false)} a ${formatTime(history.at(-1)!.time,false)}, rango cargado ${range}, intervalo ${interval}. Usa las flechas para explorar las velas.`}
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
        style={{ display: "block", width: "100%", height: "auto", fontFamily: "inherit", cursor: "crosshair" }}
      >
        <title>{`${symbol} · Histórico de velas ${source === 'demo' ? 'simulado' : 'real'}`}</title>
        <desc>{source === 'demo' ? 'Serie ilustrativa y reproducible, no corresponde a cotizaciones de mercado.' : 'Velas históricas del proveedor seleccionado; la cobertura y el feed se indican sobre la gráfica.'} Velas verdes para alzas y rojas para bajas. Las flechas marcan cruces históricos, no predicciones futuras.</desc>
        <rect x="0" y="0" width={WIDTH} height={height} fill="transparent" />
        {validationX !== null && <g data-validation-region="true"><rect x={validationX} y={TOP} width={Math.max(0,RIGHT-validationX)} height={BOTTOM-TOP} fill="#638bcc" opacity=".07"/><line x1={validationX} x2={validationX} y1={TOP} y2={BOTTOM} stroke="#638bcc" strokeDasharray="4 4" opacity=".6"/></g>}
        {grid.map((value, i) => (
          <g key={i}>
            <line x1={LEFT} x2={RIGHT} y1={y(value)} y2={y(value)} stroke="#24272b" strokeWidth="0.7" />
            <text x={RIGHT + 14} y={y(value) + 3} fill="#929ba6" fontSize="12" fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace">{formatPrice(value)}</text>
          </g>
        ))}
        {ticks.map(i => (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={TOP} y2={volumeBottom} stroke="#24272b" strokeWidth="0.7" strokeDasharray="2 5" opacity="0.65" />
            <text x={x(i)} y={height - 10} textAnchor={i === 0 ? "start" : i === candles.length - 1 ? "end" : "middle"} fill="#929ba6" fontSize="12">{formatTime(candles[i].time, intraday)}</text>
          </g>
        ))}
        {studies.volume && candles.map((candle, i) => {
          const color = candle.close >= candle.open ? UP : DOWN;
          const volumeHeight = candle.volume / maxVolume * 42;
          return <rect key={i} data-volume-bar="true" x={x(i) - candleWidth / 2} y={volumeBottom - volumeHeight} width={candleWidth} height={volumeHeight} fill={color} opacity="0.5" rx="0.5" />;
        })}
        {studies.volume && <text x={LEFT} y={BOTTOM + newsHeight + 16} fill="#929ba6" fontSize="11">VOL</text>}
        {eventMarkers.filter(marker => marker.event.kind === 'gap').map(({id, event, bucket}) => event.previousClose !== undefined && <g key={`gap-${id}`} data-gap-zone="true"><title>{event.reason}</title><rect x={Math.max(LEFT, x(bucket) - step / 2)} y={Math.min(y(event.price), y(event.previousClose))} width={Math.max(4, step)} height={Math.max(1, Math.abs(y(event.price) - y(event.previousClose)))} fill={event.direction === 'up' ? UP : DOWN} opacity=".14"/><line x1={x(bucket)} x2={x(bucket)} y1={y(event.price)} y2={y(event.previousClose)} stroke={event.direction === 'up' ? UP : DOWN} strokeDasharray="2 2"/></g>)}
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
        {studies.averages&&<g data-analysis-indicator="sma20-50"><path d={indicatorPath('smaFast')} fill="none" stroke="#e2bf80" strokeWidth="2"/><path d={indicatorPath('smaSlow')} fill="none" stroke="#d8e2ee" strokeWidth="2"/></g>}
        {signalMarkers.map(({id,signal,index:markerIndex,count,buy,markerY}) => {
          return <g key={id} data-signal={signal.action} data-signal-time={signal.time}>
            <title>{`${buy?'Entrada':'Salida'} · ${formatTime(signal.time,false)} · $${formatPrice(signal.price)} · ${signal.reason}${count>1?` · ${count} señales en este grupo`:''}`}</title>
            <path d={buy?`M${x(markerIndex)},${markerY-5}l-4,7h8Z`:`M${x(markerIndex)},${markerY+5}l-4,-7h8Z`} fill={buy?UP:DOWN} stroke="#0e1012" strokeWidth="1"/>
            {drawAnnotation(id, buy ? 'COMPRA' : 'VENTA', buy ? UP : DOWN)}
          </g>;
        })}
        {eventMarkers.map(({id,event,bucket,events,markerY,text}) => {
          const color = event.direction === 'up' ? UP : DOWN;
          return <g key={id} data-technical-event={event.kind} data-event-count={events.length}><title>{events.map(item => `${item.label} · ${formatTime(item.time, false)}${interval !== '1d' ? ` ${formatTime(item.time, true)}` : ''} · ${item.reason}`).join('\n')}</title><circle cx={x(bucket)} cy={markerY} r="8" fill="transparent"/><path d={`M${x(bucket)},${markerY-4}l4,4l-4,4l-4,-4Z`} fill="#11171d" stroke={color} strokeWidth="1.5"/>{drawAnnotation(id, text, color)}</g>;
        })}
        {levels.map((level, levelIndex)=><g key={`${level.label}-${levelIndex}`} data-indicator={level.fromTime === undefined ? level.label : undefined} data-price-level={level.fromTime === undefined ? 'manual-or-model' : 'confirmed'}><title>{level.label} · {formatPrice(level.value)}{level.fromTime ? ` · conocido desde ${formatTime(level.fromTime, false)}` : ''}</title><line x1={level.fromTime === undefined ? LEFT : x(bucketForTime(level.fromTime))} x2={RIGHT} y1={y(level.value)} y2={y(level.value)} stroke={level.color} strokeDasharray="6 4" opacity={level.labelVisible ? .8 : .4}/>{level.inlineLabel && drawAnnotation(`level:${levelIndex}`, level.label.replace(' confirmado', ''), level.color)}</g>)}
        <line x1={LEFT} x2={RIGHT} y1={lastY} y2={lastY} stroke={ORANGE} strokeWidth="0.8" strokeDasharray="3 4" opacity="0.72" />
        {priceBadges.filter(badge => studies.labels || badge.id === 'last').map(badge => <g key={badge.id} data-price-badge={badge.id}><title>{badge.id === 'last' ? 'Último precio' : levels[Number(badge.id.split(':')[1])].label} · {formatPrice(badge.value)}</title><line x1={RIGHT} x2={RIGHT + 5} y1={y(badge.value)} y2={badgeY.get(badge.id)} stroke={badge.color}/><rect x={RIGHT + 5} y={badgeY.get(badge.id)! - 10} width="79" height="21" rx="3" fill={badge.color}/><text x={RIGHT + 44} y={badgeY.get(badge.id)! + 4} textAnchor="middle" fill="#10171b" fontSize="12" fontWeight="700" fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace">{formatPrice(badge.value)}</text></g>)}
        {current && index !== null && (
          <g pointerEvents="none">
            <line x1={x(index)} x2={x(index)} y1={TOP} y2={volumeBottom} stroke="#8c939c" strokeWidth="0.8" strokeDasharray="3 3" />
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
        {studies.news && <ChartNewsRail groups={newsGroups} left={LEFT} right={RIGHT} y={BOTTOM + 35} selectedId={selectedNews} detailsId={newsDetailsId} onSelect={setSelectedNews} demo={source === 'demo'}/>}
      </svg>
      <TechnicalIndicatorPanels points={technicalPoints} rsi={studies.rsi} macd={studies.macd} width={WIDTH}/>
      </div>
      {studies.news && <ChartNewsDetails state={news} groups={newsGroups} selectedId={selectedNews} id={newsDetailsId} demo={source === 'demo'}/>}
      <details className="chart-marker-list chart-event-summary"><summary>Eventos técnicos de la vista · {visibleEvents.length}</summary>
        <p>Los rombos describen eventos; las flechas de entrada/salida dependen de la regla seleccionada. En vistas agrupadas, ×N indica varios eventos del mismo tipo. Las etiquetas se distribuyen según el espacio disponible.</p>
        {studies.gaps && <p>GAP = (apertura / cierre de la sesión anterior − 1) × 100. Se muestran cambios de al menos 0.5%; se omiten comparaciones con sesiones faltantes o cierres intradía incompletos.</p>}
        {visibleEvents.length ? <ul>{[...visibleEvents].reverse().map((event, i) => <li key={`${event.time}-${event.kind}-${i}`}><strong style={{color:event.direction === 'up' ? UP : DOWN}}>{event.label} · {formatTime(event.time, false)}{interval !== '1d' ? ` ${formatTime(event.time, true)} ET` : ''}</strong><span>{event.reason}</span></li>)}</ul> : <p>No hay eventos para las capas activas en esta vista. Los indicadores necesitan suficientes velas cerradas para calcularse.</p>}
      </details>
      {levels.some(level => level.labelVisible) && <div className="chart-level-key">{levels.filter(level => level.labelVisible).map((level, levelIndex) => <span key={levelIndex} style={{borderColor:level.color}}>{level.label} · {formatPrice(level.value)}</span>)}</div>}
      <details className="chart-marker-list"><summary>Consultar señales y motivos de la vista</summary>
        <p>Las flechas describen la acción, no una compra automática de call/put.</p>
        <ul>{signals.filter(signal => signal.action !== 'hold' && signal.time >= history[0].time && signal.time <= history.at(-1)!.time).slice(-10).reverse().map(signal => <li key={signal.time}><strong>{signal.action === 'buy' ? 'COMPRA' : 'VENTA'} · {formatTime(signal.time, false)} · {formatPrice(signal.price)}</strong><span>{signal.reason}</span></li>)}</ul>
      </details>
      <p className="chart-technical-status"><strong>ATR14:</strong> {technical.at(-1)?.atr?.toFixed(2) ?? 'sin datos suficientes'} · <strong>Volumen relativo:</strong> {technical.at(-1)?.relativeVolume?.toFixed(2) ?? '—'}× frente a las 20 velas anteriores. {studies.supportResistance && (structure.levels.length ? `${structure.levels.length} niveles confirmados con al menos dos pivotes; se dibujan desde que fueron conocidos.` : 'Aún no hay soportes/resistencias con dos pivotes confirmados en este rango.')} Las marcas son reglas de análisis; no envían órdenes.</p>
      <div className="history-inspection" aria-live="polite">{current && index !== null ? `${formatTime(current.time,false)}${bucketSize>1?` → ${formatTime(history[sourceIndices[index]].time,false)} · OHLC de hasta ${bucketSize} velas`:''} · O ${formatPrice(current.open)} · H ${formatPrice(current.high)} · L ${formatPrice(current.low)} · C ${formatPrice(current.close)} · V ${current.volume.toLocaleString('es-MX')}` : 'Explora las velas con el cursor o con las flechas del teclado para consultar fecha, OHLC y volumen.'}</div>
      {(optionLevels || studies.volatilityBands || studies.riskScenario) && <div className="chart-model-summary" aria-live="polite">
        {optionLevels && <p>{modelAvailable ? source === 'demo' ? 'Contrato de demostración: strike ATM y equilibrio con prima teórica BSM.' : `Contrato observado: ${observedOption!.contractSymbol}. El equilibrio corresponde a esta opción individual al vencimiento, antes de comisiones.` : 'Faltan datos verificables del contrato para mostrar su strike y equilibrio.'}</p>}
        {(studies.volatilityBands || studies.riskScenario) && <p>{bandVolatility === null ? 'Sin volatilidad histórica disponible para dibujar las bandas y el escenario.' : `${source === 'demo' ? 'Volatilidad supuesta del escenario' : 'Volatilidad histórica observada (HV)'}: ${(bandVolatility * 100).toFixed(1)}% anual. Horizonte: ${Math.max(1, days)} días naturales desde el último cierre de la vista. ${studies.volatilityBands ? 'Bandas ±1σ; describen variabilidad, no un objetivo de precio.' : ''}`}</p>}
        {studies.riskScenario && sigma !== null && <p>Escenario −2σ: caída ilustrativa de {(2 * sigma * 100).toFixed(1)}%. No representa pérdida máxima ni sustituye los límites de riesgo de la operación.</p>}
      </div>}
      <p className="history-footnote">{source === 'demo' ? 'Datos sintéticos · sesiones lunes–viernes, sin festivos ni medias sesiones.' : `Datos históricos ${(feed??'iex').toUpperCase()} · ${feed==='sip'?'cobertura consolidada según permisos de la cuenta':'IEX es una sola bolsa, no todo el volumen del mercado'}.`}{history.length>candles.length?` Vista agrupada en ${candles.length} velas; el CSV conserva las ${history.length} velas originales.`:''} Indicadores calculados sobre la serie original. Ocultar capas conserva los cálculos de señales y ranking.</p>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }} aria-live="polite">
        {current ? `${symbol}: apertura ${formatPrice(current.open)}, máximo ${formatPrice(current.high)}, mínimo ${formatPrice(current.low)}, cierre ${formatPrice(current.close)}. ${sourceLabel}.` : ""}
      </span>
    </div>
  );
}
