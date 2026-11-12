"use client";

import { useMemo, useState, type PointerEvent } from "react";
import { aggregateCandles, generateHistory, historyIssue } from '../lib/chart-history';
import { blackScholes, profitMetrics, type CoreId } from '../lib/quant';
import { cores } from '../lib/market-data';

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
};

type Candle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number;
};

const WIDTH = 900;
const HEIGHT = 270;
const LEFT = 10;
const RIGHT = 826;
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
    : { timeZone: "America/New_York", day: "2-digit", month: "short" }).format(new Date(time));
}

export default function MarketChart(props: MarketChartProps) {
  const { symbol, price, range, interval, startDate = '2026-10-09', endDate = '2026-11-09', chartType = "candles", selectedCores = [], volatility = .3, days = 30, rate = .04, dividendYield = 0 } = props;
  const history = useMemo(() => generateHistory(symbol, price, startDate, endDate, interval), [symbol, price, interval, startDate, endDate]);
  const candles = useMemo(() => aggregateCandles(history), [history]);
  const issue = historyIssue(startDate, endDate);
  if (!candles.length) return <div className="history-empty" role="status">{issue || 'No hay sesiones entre estas fechas. Elige un rango que incluya lunes a viernes.'}</div>;
  return <HistoryChart {...{ symbol, price, range, interval, startDate, endDate, chartType, selectedCores, volatility, days, rate, dividendYield }} candles={candles} history={history}/>;
}

function HistoryChart({ candles, history, symbol, range, interval, startDate, endDate, chartType, selectedCores = [], volatility = .3, days = 30, rate = .04, dividendYield = 0 }: MarketChartProps & {candles: Candle[]; history: Candle[]}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const index = hovered === null ? null : Math.min(candles.length - 1, hovered);
  const current = index === null ? null : candles[index];
  const enabled = (id: CoreId) => selectedCores.includes(id);
  const sigma = volatility * Math.sqrt(Math.max(1, days) / 365);
  const lastClose = candles[candles.length - 1].close;
  const strike = Math.round(lastClose / 5) * 5 || lastClose;
  const option = blackScholes({spot:lastClose,strike,days:Math.max(1,days),volatility,rate,dividendYield,type:'call'});
  const metrics = profitMetrics({spot:lastClose,strike,days:Math.max(1,days),volatility,rate,dividendYield,type:'call',premium:option.price,side:'buy'});
  const levels = [
    ...(enabled('bsm') ? [{value:strike,label:'BSM · strike ATM',color:'#bca2ff'}] : []),
    ...(enabled('probability') ? [{value:metrics.breakeven,label:'Equilibrio call comprada',color:'#67ceee'}] : []),
    ...(enabled('volatility') ? [{value:lastClose*(1+sigma),label:'+1σ',color:'#d6b66c'},{value:lastClose*Math.max(.01,1-sigma),label:'−1σ',color:'#d6b66c'}] : []),
    ...(enabled('risk') ? [{value:lastClose*Math.max(.01,1-2*sigma),label:'Escenario −2σ',color:DOWN}] : []),
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
  const maxVolume = Math.max(...candles.map(candle => candle.volume));
  const movingAverage = candles.map((_, i) => {
    const sample = candles.slice(Math.max(0, i - 8), i + 1);
    return sample.reduce((sum, candle) => sum + candle.close, 0) / sample.length;
  });
  const linePath = candles.map((candle, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(candle.close).toFixed(2)}`).join(" ");
  const averagePath = movingAverage.map((value, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
  const slowPath = candles.map((_,i)=>{const sample=candles.slice(Math.max(0,i-20),i+1);return `${i?'L':'M'}${x(i)},${y(sample.reduce((s,c)=>s+c.close,0)/sample.length)}`;}).join(' ');
  const deltaPath = candles.map((c,i)=>{const value=blackScholes({spot:c.close,strike,days:Math.max(1,days),volatility,rate,dividendYield,type:'call'});return `${i?'L':'M'}${x(i)},${BOTTOM-value.delta*45}`;}).join(' ');
  const intraday = candles[candles.length - 1].time - candles[0].time < 86400000;
  const last = candles[candles.length - 1];
  const lastY = y(last.close);
  const grid = Array.from({ length: 5 }, (_, i) => high - extent * i / 4);
  const ticks = Array.from({ length: 7 }, (_, i) => Math.round(i * (candles.length - 1) / 6));

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
    <div className="market-chart" style={{ width: "100%", minWidth: 0, position: "relative" }}>
      <div className="history-summary"><strong>{startDate} → {endDate}</strong><span>{history.length.toLocaleString('es-MX')} velas · {interval} · ET</span><button className="secondary-button" onClick={()=>{
        const csv='Fecha UTC,Apertura,Maximo,Minimo,Cierre,Volumen\r\n'+history.map(c=>[new Date(c.time).toISOString(),c.open,c.high,c.low,c.close,c.volume].join(',')).join('\r\n');
        const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`${symbol}-${startDate}-${endDate}-simulado.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }}>Exportar velas CSV</button></div>
      <div className="core-chart-legend">{selectedCores.map(id=><span key={id} data-core={id}>{cores.find(c=>c.id===id)?.title}</span>)}{!selectedCores.length&&<span>Activa cores para ver indicadores</span>}</div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Gráfico ${chartType === "line" ? "de línea" : "de velas"} de ${symbol}. Datos simulados. ${startDate} a ${endDate}, rango ${range}, intervalo ${interval}. ${selectedCores.length} cores activos. Usa las flechas para explorar las velas.`}
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
        <title>{`${symbol} · Histórico de velas simulado`}</title>
        <desc>Serie ilustrativa y reproducible, no corresponde a cotizaciones de mercado. Velas verdes para alzas y rojas para bajas; línea naranja de media móvil de nueve períodos.</desc>
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="transparent" />
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
        {enabled('liquidity') && candles.map((candle, i) => {
          const color = candle.close >= candle.open ? UP : DOWN;
          const volumeHeight = candle.volume / maxVolume * 26;
          return <rect key={i} x={x(i) - candleWidth / 2} y={239 - volumeHeight} width={candleWidth} height={volumeHeight} fill={color} opacity="0.16" rx="0.5" />;
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
        {enabled('trend') && <g data-indicator="trend"><path d={averagePath} fill="none" stroke={ORANGE} strokeWidth="1.8"/><path d={slowPath} fill="none" stroke="#73aafa" strokeWidth="1.8"/></g>}
        {enabled('greeks') && <path data-indicator="greeks" d={deltaPath} fill="none" stroke="#e7a4cf" strokeWidth="1.5" strokeDasharray="4 3"/>}
        {levels.map(level=><g key={level.label} data-indicator={level.label}><line x1={LEFT} x2={RIGHT} y1={y(level.value)} y2={y(level.value)} stroke={level.color} strokeDasharray="6 4"/><text x={LEFT+5} y={y(level.value)-4} fill={level.color} fontSize="10" stroke="#141618" strokeWidth="2" paintOrder="stroke">{level.label} · {formatPrice(level.value)}</text></g>)}
        <line x1={LEFT} x2={RIGHT} y1={lastY} y2={lastY} stroke={ORANGE} strokeWidth="0.8" strokeDasharray="3 4" opacity="0.72" />
        <rect x={RIGHT + 3} y={lastY - 10} width="67" height="21" rx="3" fill={ORANGE} />
        <text x={RIGHT + 36.5} y={lastY + 3.5} textAnchor="middle" fill="#171513" fontSize="10" fontWeight="700" fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace">{formatPrice(last.close)}</text>
        {current && index !== null && (
          <g pointerEvents="none">
            <line x1={x(index)} x2={x(index)} y1={TOP} y2="240" stroke="#8c939c" strokeWidth="0.8" strokeDasharray="3 3" />
            <line x1={LEFT} x2={RIGHT} y1={y(current.close)} y2={y(current.close)} stroke="#8c939c" strokeWidth="0.8" strokeDasharray="3 3" />
            <circle cx={x(index)} cy={y(current.close)} r="3" fill={ORANGE} stroke="#111315" strokeWidth="1.5" />
            <rect x={12} y={2} width="465" height="27" rx="4" fill="#1a1d21" stroke="#33373d" strokeWidth="0.7" />
            <text x="22" y="19" fill="#a0a7b1" fontSize="10" fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace">
              <tspan fill="#e4e7ec">{formatTime(current.time, intraday)}</tspan>
              <tspan dx="15">O </tspan><tspan fill="#e4e7ec">{formatPrice(current.open)}</tspan>
              <tspan dx="12">H </tspan><tspan fill={UP}>{formatPrice(current.high)}</tspan>
              <tspan dx="12">L </tspan><tspan fill={DOWN}>{formatPrice(current.low)}</tspan>
              <tspan dx="12">C </tspan><tspan fill={current.close >= current.open ? UP : DOWN}>{formatPrice(current.close)}</tspan>
            </text>
          </g>
        )}
      </svg>
      <div className="chart-core-values" aria-live="polite">
        {enabled('bsm')&&<span>BSM call ATM: ${option.price.toFixed(2)} / acción</span>}
        {enabled('greeks')&&<span>Δ {option.delta.toFixed(3)} · Γ {option.gamma.toFixed(4)} · línea rosa: Δ en escala 0–1</span>}
        {enabled('probability')&&<span>Prob. beneficio call comprada: {(metrics.probabilityOfProfit*100).toFixed(1)}% · neutral al riesgo</span>}
        {enabled('volatility')&&<span>IV {(volatility*100).toFixed(1)}% · banda ±1σ a {Math.max(1,days)} días</span>}
        {enabled('trend')&&<span>Media 9: {movingAverage.at(-1)?.toFixed(2)} · media 21 azul</span>}
        {enabled('liquidity')&&<span>Volumen última vela{history.length>candles.length?' agrupada':''}: {candles.at(-1)?.volume.toLocaleString('es-MX')}</span>}
        {enabled('risk')&&<span>Caída ilustrativa 2σ: {(2*sigma*100).toFixed(1)}% · no es pérdida máxima</span>}
      </div>
      <p className="history-footnote">Datos sintéticos · sesiones lunes–viernes, sin festivos ni medias sesiones.{history.length>candles.length?` Vista agrupada en ${candles.length} velas; el CSV conserva las ${history.length} velas originales.`:''} Indicadores sobre la serie visible; niveles BSM y riesgo calculados al cierre, no señales históricas ni backtest.</p>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }} aria-live="polite">
        {current ? `${symbol}: apertura ${formatPrice(current.open)}, máximo ${formatPrice(current.high)}, mínimo ${formatPrice(current.low)}, cierre ${formatPrice(current.close)}. Datos simulados.` : ""}
      </span>
    </div>
  );
}
