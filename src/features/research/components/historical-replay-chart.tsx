"use client";
import {useMemo} from 'react';
import ReplayMarketPlot from './replay-market-plot';
import type {Candle} from '../../market/chart-history';
import type {TechnicalIndicator} from '../../../cores/01-analisis-tecnico/indicators';
const number=(value:number|null|undefined,digits=2)=>value===null||value===undefined||!Number.isFinite(value)?'Sin dato':value.toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits});
const money=(value:number|null|undefined)=>value===null||value===undefined||!Number.isFinite(value)?'Sin dato':value.toLocaleString('en-US',{style:'currency',currency:'USD'});
export default function HistoricalReplayChart({bars,indicators,entryTime,cursorTime,onSelect,pnl,support,resistance,strategyLabel,selectedPnl,capital}:{bars:readonly Candle[];indicators:readonly TechnicalIndicator[];entryTime:number;cursorTime:number;onSelect:(time:number)=>void;pnl?:readonly {time:number;pnl:number}[];support?:number|null;resistance?:number|null;strategyLabel:string;selectedPnl:number|null;capital:number|null}){
  const lookup=useMemo(()=>new Map(indicators.map(row=>[row.time,row])),[indicators]);
  if(!bars.length)return <p>No hay velas para esta selección.</p>;
  const index=Math.max(0,bars.findIndex(bar=>bar.time===cursorTime)),bar=bars[index];
  const indicator=lookup.get(bar.time);
  const returnOnCapital=selectedPnl!==null&&capital!==null&&capital>0?`${number(selectedPnl/capital*100)}% del capital`:null;
  const pointMetrics:[string,string][]=[
    ['Fecha',new Date(bar.time).toISOString().slice(0,10)],
    ['Apertura',money(bar.open)],['Máximo',money(bar.high)],['Mínimo',money(bar.low)],['Cierre',money(bar.close)],['Volumen',number(bar.volume,0)],
    ['SMA20',money(indicator?.smaFast)],['SMA50',money(indicator?.smaSlow)],['RSI14',number(indicator?.rsi)],
    ['MACD12/26',number(indicator?.macd,4)],['Señal MACD9',number(indicator?.macdSignal,4)],['Histograma MACD',number(indicator?.macdHistogram,4)],
    ['ATR14',money(indicator?.atr)],['Volumen medio previo (20)',number(indicator?.averageVolume,0)],
    ['Volumen relativo',indicator?.relativeVolume===null||indicator?.relativeVolume===undefined?'Sin dato':`${number(indicator.relativeVolume)}×`],
    ['Soporte confirmado',money(support)],['Resistencia confirmada',money(resistance)],
    [`P/L teórico · ${strategyLabel}`,selectedPnl===null?'Calcula el ejercicio y elige un punto válido':`${money(selectedPnl)}${returnOnCapital?` · ${returnOnCapital}`:''}`]
  ];
  return <figure className="replay-chart"><figcaption className="sr-only">Precio, medias e indicadores de la sesión histórica</figcaption>
    <ReplayMarketPlot bars={bars} lookup={lookup} entryTime={entryTime} cursorTime={cursorTime} onSelect={onSelect} pnl={pnl} support={support} resistance={resistance}/>
    <div className="replay-data-grid replay-chart-point" data-replay-chart-point={new Date(bar.time).toISOString().slice(0,10)} aria-label="Valores de la gráfica en el punto seleccionado">
      {pointMetrics.slice(1,7).map(([label,value])=><div key={label} data-replay-metric={label}><span>{label}</span><strong className={label.startsWith('P/L teórico')&&selectedPnl!==null?(selectedPnl>=0?'positive':'negative'):undefined}>{value}</strong></div>)}
    </div>
    <details className="replay-chart-details"><summary>Indicadores, niveles y resultado del punto</summary><div className="replay-data-grid">{[pointMetrics[0],...pointMetrics.slice(7)].map(([label,value])=><div key={label} data-replay-metric={label}><span>{label}</span><strong>{value}</strong></div>)}</div></details>
    <p>Clic o arrastre para inspeccionar; también puedes usar las flechas del teclado o el control de fecha. El cursor blanco inspecciona un punto; la línea naranja conserva la entrada del ejercicio.</p>
  </figure>;
}
