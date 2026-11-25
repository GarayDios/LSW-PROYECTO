"use client";
import {useMemo,type PointerEvent} from 'react';
import type {Candle} from '../../market/chart-history';
import type {TechnicalIndicator} from '../../../cores/01-analisis-tecnico/indicators';
const WIDTH=960,LEFT=78,RIGHT=920;
const number=(value:number|null|undefined,digits=2)=>value===null||value===undefined||!Number.isFinite(value)?'Sin dato':value.toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits});
const money=(value:number|null|undefined)=>value===null||value===undefined||!Number.isFinite(value)?'Sin dato':value.toLocaleString('en-US',{style:'currency',currency:'USD'});
export default function HistoricalReplayChart({bars,indicators,entryTime,cursorTime,onSelect,pnl,support,resistance,strategyLabel,selectedPnl,capital}:{bars:readonly Candle[];indicators:readonly TechnicalIndicator[];entryTime:number;cursorTime:number;onSelect:(time:number)=>void;pnl?:readonly {time:number;pnl:number}[];support?:number|null;resistance?:number|null;strategyLabel:string;selectedPnl:number|null;capital:number|null}){
  const lookup=useMemo(()=>new Map(indicators.map(row=>[row.time,row])),[indicators]);
  if(!bars.length)return <p>No hay velas para esta selección.</p>;
  const index=Math.max(0,bars.findIndex(bar=>bar.time===cursorTime)),bar=bars[index];
  const indicator=lookup.get(bar.time);
  const x=(i:number)=>LEFT+i/Math.max(1,bars.length-1)*(RIGHT-LEFT);
  const priceValues=bars.flatMap(row=>[row.low,row.high,lookup.get(row.time)?.smaFast??row.close,lookup.get(row.time)?.smaSlow??row.close]);
  const low=Math.min(...priceValues),high=Math.max(...priceValues),pad=Math.max(.5,(high-low)*.08);
  const py=(value:number)=>235-(value-low+pad)/(high-low+2*pad)*190;
  const maxVolume=Math.max(1,...bars.map(row=>row.volume)),volumeY=(value:number)=>306-value/maxVolume*44;
  const macdValues=bars.flatMap(row=>{const t=lookup.get(row.time);return [t?.macd??0,t?.macdSignal??0,t?.macdHistogram??0];});
  const macdMax=Math.max(1e-6,...macdValues.map(Math.abs)),my=(value:number)=>444-value/macdMax*30;
  const line=(value:(bar:Candle)=>number|null|undefined,y:(n:number)=>number)=>{let drawing=false;return bars.map((row,i)=>{const v=value(row);if(v===null||v===undefined){drawing=false;return '';}const command=drawing?'L':'M';drawing=true;return `${command}${x(i)},${y(v)}`;}).join(' ');};
  const candleWidth=Math.max(1,Math.min(9,(RIGHT-LEFT)/bars.length*.58));
  const selectAt=(event:PointerEvent<SVGSVGElement>)=>{const rect=event.currentTarget.getBoundingClientRect();const at=((event.clientX-rect.left)/rect.width*WIDTH-LEFT)/(RIGHT-LEFT);onSelect(bars[Math.max(0,Math.min(bars.length-1,Math.round(at*(bars.length-1))))].time);};
  const pnlMap=new Map(pnl?.map(point=>[point.time,point.pnl]));
  const pnlNumbers=[0,...(pnl??[]).map(point=>point.pnl)],pnlMin=Math.min(...pnlNumbers),pnlMax=Math.max(...pnlNumbers),pnlRange=Math.max(1,pnlMax-pnlMin);
  const pnlY=(value:number)=>566-(value-pnlMin)/pnlRange*54;
  const entryIndex=bars.findIndex(row=>row.time===entryTime);
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
  return <figure className="replay-chart"><figcaption>Precio y medias · volumen · RSI14 · MACD{pnl?.length?' · P/L de la estrategia':''}</figcaption>
    <svg fill="#a6b6c9" viewBox={`0 0 ${WIDTH} ${pnl?.length?610:510}`} role="slider" tabIndex={0} aria-label="Seleccionar punto en la gráfica histórica" aria-valuemin={0} aria-valuemax={bars.length-1} aria-valuenow={index} aria-valuetext={new Date(bar.time).toISOString().slice(0,10)}
      onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);selectAt(event);}} onPointerMove={selectAt}
      onKeyDown={event=>{const next=event.key==='ArrowLeft'?index-1:event.key==='ArrowRight'?index+1:event.key==='Home'?0:event.key==='End'?bars.length-1:null;if(next!==null){event.preventDefault();onSelect(bars[Math.max(0,Math.min(bars.length-1,next))].time);}}}>
      <title>Velas diarias e indicadores históricos; selecciona con clic, arrastre o flechas</title>
      {[low,(low+high)/2,high].map(value=><g key={value}><line x1={LEFT} x2={RIGHT} y1={py(value)} y2={py(value)} stroke="#27333d"/><text x={LEFT-10} y={py(value)+4} textAnchor="end">{value.toFixed(2)}</text></g>)}
      {bars.map((row,i)=>{const color=row.close>=row.open?'#42c9a1':'#f07883';return <g key={row.time}><line x1={x(i)} x2={x(i)} y1={py(row.high)} y2={py(row.low)} stroke={color}/><rect x={x(i)-candleWidth/2} y={Math.min(py(row.open),py(row.close))} width={candleWidth} height={Math.max(1,Math.abs(py(row.open)-py(row.close)))} fill={color}/><rect x={x(i)-candleWidth/2} y={volumeY(row.volume)} width={candleWidth} height={306-volumeY(row.volume)} fill={color} opacity=".55"/></g>;})}
      <path data-replay-series="sma20" d={line(row=>lookup.get(row.time)?.smaFast,py)} fill="none" stroke="#e8bc63" strokeWidth="1.7"/><path data-replay-series="sma50" d={line(row=>lookup.get(row.time)?.smaSlow,py)} fill="none" stroke="#ad9cf4" strokeWidth="1.7"/>
      {([['Soporte',support,'#42c9a1'],['Resistencia',resistance,'#f07883']] as const).map(([label,value,color])=>value!==null&&value!==undefined&&value>=low-pad&&value<=high+pad&&<g key={label}><line x1={LEFT} x2={RIGHT} y1={py(value)} y2={py(value)} stroke={color} strokeDasharray="5 5"/><text x={RIGHT-5} y={py(value)-5} textAnchor="end" fill={color}>{label} {value.toFixed(2)}</text></g>)}
      <text x={LEFT} y="24">VELAS DIARIAS</text><text x="590" y="24" fill="#e8bc63">SMA20</text><text x="670" y="24" fill="#ad9cf4">SMA50</text><text x={LEFT} y="258">VOLUMEN</text>
      <text x={LEFT} y="332">RSI14</text>{[30,70].map(value=><g key={value}><line x1={LEFT} x2={RIGHT} y1={391-value*.5} y2={391-value*.5} stroke="#42515c" strokeDasharray="4 5"/><text x={LEFT-10} y={395-value*.5} textAnchor="end">{value}</text></g>)}
      <path data-replay-series="rsi" d={line(row=>lookup.get(row.time)?.rsi,value=>391-value*.5)} fill="none" stroke="#69cfe8" strokeWidth="1.6"/>
      <text x={LEFT} y="414">MACD12/26 · señal9</text><line x1={LEFT} x2={RIGHT} y1="444" y2="444" stroke="#42515c"/>
      {bars.map((row,i)=>{const value=lookup.get(row.time)?.macdHistogram;return value!==null&&value!==undefined&&<rect key={row.time} x={x(i)-candleWidth/2} y={Math.min(444,my(value))} width={candleWidth} height={Math.max(.5,Math.abs(444-my(value)))} fill={value>=0?'#42c9a1':'#f07883'} opacity=".6"/>;})}
      <path data-replay-series="macd" d={line(row=>lookup.get(row.time)?.macd,my)} fill="none" stroke="#69cfe8" strokeWidth="1.5"/><path d={line(row=>lookup.get(row.time)?.macdSignal,my)} fill="none" stroke="#e8bc63" strokeWidth="1.5"/>
      {!!pnl?.length&&<><text x={LEFT} y="501">P/L TEÓRICO · USD</text><line x1={LEFT} x2={RIGHT} y1={pnlY(0)} y2={pnlY(0)} stroke="#42515c" strokeDasharray="4 5"/><path data-replay-series="pnl" d={line(row=>pnlMap.get(row.time),pnlY)} fill="none" stroke="#f4bd63" strokeWidth="2"/></>}
      {entryIndex>=0&&<g><line data-replay-entry x1={x(entryIndex)} x2={x(entryIndex)} y1="33" y2={pnl?.length?575:480} stroke="#f4a05b" strokeDasharray="4 4"/><text x={x(entryIndex)} y="40" fill="#f4a05b" textAnchor="middle">Entrada</text></g>}
      <line data-replay-cursor x1={x(index)} x2={x(index)} y1="45" y2={pnl?.length?575:480} stroke="#dbe9f4" opacity=".75"/><circle cx={x(index)} cy={py(bar.close)} r="4" fill="#edf5fc"/>
      <text x={LEFT} y={pnl?.length?599:500}>{new Date(bars[0].time).toISOString().slice(0,10)}</text><text x={RIGHT} y={pnl?.length?599:500} textAnchor="end">{new Date(bars.at(-1)!.time).toISOString().slice(0,10)}</text>
    </svg>
    <div className="replay-data-grid replay-chart-point" data-replay-chart-point={new Date(bar.time).toISOString().slice(0,10)} aria-label="Valores de la gráfica en el punto seleccionado">
      {pointMetrics.map(([label,value])=><div key={label} data-replay-metric={label}><span>{label}</span><strong className={label.startsWith('P/L teórico')&&selectedPnl!==null?(selectedPnl>=0?'positive':'negative'):undefined}>{value}</strong></div>)}
    </div>
    <p>Clic o arrastre para inspeccionar; también puedes usar las flechas del teclado o el control de fecha. El cursor blanco inspecciona un punto; la línea naranja conserva la entrada del ejercicio.</p>
  </figure>;
}
