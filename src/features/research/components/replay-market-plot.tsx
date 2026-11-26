"use client";
import {useId,useState,type PointerEvent} from 'react';
import type {Candle} from '../../market/chart-history';
import type {TechnicalIndicator} from '../../../cores/01-analisis-tecnico/indicators';
import {useChartZoom,useChartWheelZoom} from '../../market/hooks/use-chart-zoom';
import ChartZoomControls from '../../market/components/chart-zoom-controls';

import type { ChartStudies } from '../../market/chart-core-layers';
import type { PriceLevel } from '../../../cores/01-analisis-tecnico/support-resistance';
import type { TrendLine } from '../../../cores/01-analisis-tecnico/trend-lines';
import { layoutPriceLevelLabels } from '../../market/price-level-labels';
const LEFT=60,RIGHT=1000,WIDTH=1280,PRICE_TOP=44,PRICE_BOTTOM=476;
const format=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:2});
const date=(time:number)=>new Date(time).toISOString().slice(0,10);
type Study='volume'|'rsi'|'macd'|'pnl';

export default function ReplayMarketPlot({studies:coreStudies,levels,trends,bars:allBars,lookup,entryTime,cursorTime,onSelect:onInspect,pnl}:{studies:ChartStudies;levels:PriceLevel[];trends:TrendLine[];bars:readonly Candle[];lookup:Map<number,TechnicalIndicator>;entryTime:number;cursorTime:number;onSelect:(time:number)=>void;pnl?:readonly {time:number;pnl:number}[];}){
  const id=useId().replace(/:/g,'');
  const [view,setView]=useState<'candles'|'line'>('candles');
  const [study,setStudy]=useState<Study|'none'>('rsi');
  const [levelMode,setLevelMode]=useState<'nearby'|'all'|'none'>('nearby');
  const [selectedLevel,setSelectedLevel]=useState<string|null>(null);
  const [averages,setAverages]=useState(true),[showTrends,setShowTrends]=useState(true);
  const zoom=useChartZoom(allBars,`replay-${entryTime}`,8,cursorTime);
  const viewport=useChartWheelZoom(zoom.change,LEFT+8,RIGHT-8);
  function onSelect(time:number){const target=allBars.findIndex(row=>row.time===time);if(target<zoom.start)zoom.pan(target);else if(target>=zoom.end)zoom.pan(target-zoom.count+1);onInspect(time);}
  const bars=zoom.visible;
  const levelNames = new Map<string, string>();
  for (const kind of ['support', 'resistance'] as const) levels.filter(level => level.kind === kind).forEach((level, index) => levelNames.set(level.id, `${kind === 'support' ? 'S' : 'R'}${index + 1}`));
  const index=bars.findIndex(bar=>bar.time===cursorTime),bar=allBars.find(row=>row.time===cursorTime)??bars[0],previous=allBars[allBars.findIndex(row=>row.time===bar.time)-1];
  const change=previous?(bar.close/previous.close-1)*100:null;
  const x=(i:number)=>LEFT+8+i/Math.max(1,bars.length-1)*(RIGHT-LEFT-16);
  const timeX=(time:number)=>{const i=bars.findIndex(row=>row.time>=time);return x(i<0?bars.length-1:Math.max(0,i));};
  const values=bars.flatMap(row=>[row.low,row.high,...(coreStudies.averages&&averages?[lookup.get(row.time)?.smaFast??row.close,lookup.get(row.time)?.smaSlow??row.close]:[])]);
  const low=Math.min(...values),high=Math.max(...values),pad=Math.max(.5,(high-low)*.12);
  const py=(v:number)=>PRICE_BOTTOM-(v-low+pad)/(high-low+2*pad)*(PRICE_BOTTOM-PRICE_TOP);
  const knownLevels=coreStudies.supportResistance?levels.filter(level=>level.confirmedAt<=bars.at(-1)!.time):[];
  const inViewLevels=knownLevels.filter(level=>level.price>=low-pad&&level.price<=high+pad);
  const nearbyLevels=(['support','resistance'] as const).flatMap(kind=>inViewLevels.filter(level=>level.kind===kind).sort((a,b)=>Math.abs(a.price-bar.close)-Math.abs(b.price-bar.close)).slice(0,2));
  const drawnLevels=levelMode==='none'?[]:levelMode==='all'?inViewLevels:inViewLevels.filter(level=>nearbyLevels.includes(level)||level.id===selectedLevel);
  const levelLabels=layoutPriceLevelLabels(drawnLevels.map(level=>({id:level.id,y:py(level.price),priority:level.id===selectedLevel?-1:Math.abs(level.price-bar.close)})),PRICE_TOP+14,PRICE_BOTTOM-14);
  const activeStudy=study==='none'?'none':study==='pnl'?(pnl?.length?'pnl':'none'):(coreStudies[study]?study:'none');
  let bottom=PRICE_BOTTOM+20;
  const panels=new Map<Study|'pnl',{top:number;bottom:number}>();
  if(activeStudy!=='none'){panels.set(activeStudy,{top:bottom,bottom:bottom+140});bottom+=156;}
  const volume=panels.get('volume'),rsi=panels.get('rsi'),macd=panels.get('macd'),profit=panels.get('pnl');
  const maxVolume=Math.max(1,...bars.map(row=>row.volume));
  const macdMax=Math.max(1e-6,...bars.flatMap(row=>{const t=lookup.get(row.time);return [t?.macd??0,t?.macdSignal??0,t?.macdHistogram??0].map(Math.abs);}));
  const my=(v:number)=>(macd?.top??0)+84-v/macdMax*43;
  const line=(value:(bar:Candle)=>number|null|undefined,y:(n:number)=>number)=>{let drawing=false;return bars.map((row,i)=>{const v=value(row);if(v===null||v===undefined||!Number.isFinite(v)){drawing=false;return '';}const command=drawing?'L':'M';drawing=true;return `${command}${x(i)},${y(v)}`;}).join(' ');};
  const priceLine=line(row=>row.close,py),candleWidth=Math.max(1,Math.min(10,(RIGHT-LEFT)/bars.length*.65));
  const selectAt=(event:PointerEvent<SVGSVGElement>)=>{const matrix=event.currentTarget.getScreenCTM();if(!matrix)return;const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());const at=(point.x-LEFT-8)/(RIGHT-LEFT-16);onSelect(bars[Math.max(0,Math.min(bars.length-1,Math.round(at*(bars.length-1))))].time);};
  const pnlMap=new Map(pnl?.map(p=>[p.time,p.pnl])),pnlNumbers=[0,...(pnl??[]).filter(p=>p.time>=bars[0].time&&p.time<=bars.at(-1)!.time).map(p=>p.pnl)],pnlMin=Math.min(...pnlNumbers),pnlRange=Math.max(1,Math.max(...pnlNumbers)-pnlMin);
  const pnlY=(v:number)=>(profit?.bottom??0)-12-(v-pnlMin)/pnlRange*90;
  const entryIndex=bars.findIndex(row=>row.time===entryTime);
  const ticks=[...new Set(Array.from({length:6},(_,i)=>Math.round(i*(bars.length-1)/5)))];
  function toggle(value:Study){setStudy(current=>current===value?'none':value);}
  return <>
    <div className="replay-chart-heading"><div><span className="replay-kicker">MERCADO · HISTÓRICO DIARIO</span><div className="replay-price-heading"><strong>${format(bar.close)}</strong><span className={change!==null&&change<0?'negative':'positive'}>{change===null?'Primera sesión':`${change>=0?'+':''}${format(change)}%`}</span></div><span>{date(bar.time)} · cierre seleccionado</span></div><div className="replay-view-switch" role="group" aria-label="Tipo de gráfica histórica"><button type="button" aria-pressed={view==='candles'} onClick={()=>setView('candles')}>Velas</button><button type="button" aria-pressed={view==='line'} onClick={()=>setView('line')}>Línea</button></div></div>
    <div className="replay-chart-toolbar"><div className="replay-chart-legend">{coreStudies.averages&&averages&&<><span><i style={{background:'#f4b66c'}}/>SMA 20</span><span><i style={{background:'#ad9cf4'}}/>SMA 50</span></>}<span><i style={{background:'#ff934f'}}/>Entrada</span></div><div className="replay-study-switch" role="group" aria-label="Indicadores históricos"><span>Panel inferior</span><button type="button" aria-pressed={activeStudy==='none'} onClick={()=>setStudy('none')}>Solo precio</button>{([['volume','Volumen'],['rsi','RSI'],['macd','MACD']] as const).filter(([key])=>coreStudies[key]).map(([key,label])=><button type="button" key={key} aria-pressed={activeStudy===key} onClick={()=>toggle(key)}>{label}</button>)}{!!pnl?.length&&<button type="button" aria-pressed={activeStudy==='pnl'} onClick={()=>toggle('pnl')}>P/L</button>}</div></div>
    <div className="replay-overlay-controls"><div className="replay-study-switch" role="group" aria-label="Capas sobre el precio">{coreStudies.averages&&<button type="button" aria-pressed={averages} onClick={()=>setAverages(value=>!value)}>Medias</button>}{coreStudies.trends&&<button type="button" aria-pressed={showTrends} onClick={()=>setShowTrends(value=>!value)}>Tendencias</button>}</div>{coreStudies.supportResistance&&<label>Niveles<select aria-label="Niveles en la gráfica histórica" value={levelMode} onChange={event=>setLevelMode(event.target.value as typeof levelMode)}><option value="nearby">Cercanos · 2 soportes y 2 resistencias</option><option value="all">Todos los niveles</option><option value="none">Ocultar niveles</option></select></label>}<span>{drawnLevels.length} niveles en vista · consulta todos en la tabla inferior</span></div>
    <ChartZoomControls zoom={zoom} label="gráfica histórica" id="historical"/>
    <div className="replay-chart-viewport" ref={viewport}><svg viewBox={`0 0 ${WIDTH} ${bottom+40}`} fill="#8e9cad" role="slider" tabIndex={0} aria-label="Seleccionar punto en la gráfica histórica" aria-valuemin={0} aria-valuemax={allBars.length-1} aria-valuenow={Math.max(0,allBars.findIndex(row=>row.time===cursorTime))} aria-valuetext={`${date(bar.time)}, cierre $${format(bar.close)}`} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);selectAt(event);}} onPointerMove={event=>{if(event.buttons===1)selectAt(event);}} onKeyDown={event=>{const globalIndex=Math.max(0,allBars.findIndex(row=>row.time===cursorTime));const next=event.key==='ArrowLeft'?globalIndex-1:event.key==='ArrowRight'?globalIndex+1:event.key==='Home'?0:event.key==='End'?allBars.length-1:null;if(next!==null){event.preventDefault();onSelect(allBars[Math.max(0,Math.min(allBars.length-1,next))].time);}}}>
      <title>Precio e indicadores históricos; selecciona con clic, arrastre o flechas</title>
      <defs><linearGradient id={`${id}-price`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff934f" stopOpacity=".25"/><stop offset="100%" stopColor="#ff934f" stopOpacity="0"/></linearGradient><clipPath id={`${id}-plot`}><rect x={LEFT} y={PRICE_TOP} width={RIGHT-LEFT} height={PRICE_BOTTOM-PRICE_TOP}/></clipPath></defs>
      <rect x={LEFT} y={PRICE_TOP} width={RIGHT-LEFT} height={PRICE_BOTTOM-PRICE_TOP} fill="#0c131d"/>
      {ticks.map(i=><line key={i} x1={x(i)} x2={x(i)} y1={PRICE_TOP} y2={bottom} stroke="#1b2633" strokeDasharray="2 6"/>)}
      {Array.from({length:5},(_,i)=>low-pad+(high-low+2*pad)*i/4).map((value,i)=><g key={i}><line x1={LEFT} x2={RIGHT} y1={py(value)} y2={py(value)} stroke="#202b38" strokeDasharray="3 5"/><text x={RIGHT+12} y={py(value)+4}>{format(value)}</text></g>)}
      <g clipPath={`url(#${id}-plot)`}>{view==='line'?<><path d={`${priceLine} L${x(bars.length-1)},${PRICE_BOTTOM} L${x(0)},${PRICE_BOTTOM} Z`} fill={`url(#${id}-price)`}/><path data-replay-series="price" d={priceLine} fill="none" stroke="#ffad72" strokeWidth="2.2"/></>:bars.map((row,i)=>{const color=row.close>=row.open?'#42c9a1':'#f07883';return <g key={row.time} data-replay-candle={row.time} data-close={row.close}><line x1={x(i)} x2={x(i)} y1={py(row.high)} y2={py(row.low)} stroke={color}/><rect x={x(i)-candleWidth/2} y={Math.min(py(row.open),py(row.close))} width={candleWidth} height={Math.max(1,Math.abs(py(row.open)-py(row.close)))} fill={color} rx=".7"/></g>;})}
      {coreStudies.averages&&averages&&<><path data-replay-series="sma20" d={line(row=>lookup.get(row.time)?.smaFast,py)} fill="none" stroke="#f4b66c" strokeWidth="1.6"/><path data-replay-series="sma50" d={line(row=>lookup.get(row.time)?.smaSlow,py)} fill="none" stroke="#ad9cf4" strokeWidth="1.6"/></>}
      {drawnLevels.map(level=><g key={level.id} data-replay-level={level.id}><title>{levelNames.get(level.id)} · {level.kind==='support'?'Soporte':'Resistencia'} · {format(level.price)} · {level.touches} contactos · confirmado {date(level.confirmedAt)}</title><line x1={timeX(level.confirmedAt)} x2={RIGHT} y1={py(level.price)} y2={py(level.price)} stroke={level.kind==='support'?'#42c9a1':'#f07883'} opacity={selectedLevel===level.id?1:.45} strokeWidth={selectedLevel===level.id?2:1} strokeDasharray="5 5"/></g>)}
      {coreStudies.trends&&showTrends&&trends.filter(line=>line.endTime>=bars[0].time&&line.confirmedAt<=bars.at(-1)!.time).map(line=>{const from=Math.max(line.confirmedAt,bars[0].time),until=Math.min(line.endTime,bars.at(-1)!.time);const at=(time:number)=>line.startPrice+(line.pivotPrice-line.startPrice)*(time-line.startTime)/(line.pivotTime-line.startTime);return <g key={line.id} data-replay-trend={line.direction}><title>Tendencia {line.direction==='up'?'alcista':'bajista'} · confirmada {date(line.confirmedAt)}</title><line x1={timeX(from)} x2={timeX(until)} y1={py(at(from))} y2={py(at(until))} stroke={line.direction==='up'?'#42c9a1':'#f07883'} strokeWidth="2" strokeDasharray={line.broken?'4 4':undefined}/></g>;})}</g>
      {drawnLevels.map(level=>{const labelY=levelLabels.get(level.id);if(labelY===undefined)return null;const color=level.kind==='support'?'#42c9a1':'#f07883';return <g key={level.id} data-replay-level-label={level.id} role="button" tabIndex={0} aria-label={`Resaltar ${levelNames.get(level.id)} a ${format(level.price)}`} onPointerDown={event=>{event.stopPropagation();setSelectedLevel(level.id);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelectedLevel(level.id);}}}><path d={`M${RIGHT},${py(level.price)} H${RIGHT+84} L${RIGHT+98},${labelY}`} fill="none" stroke={color} opacity=".45"/><rect x={RIGHT+100} y={labelY-11} width="168" height="22" rx="4" fill={selectedLevel===level.id?'#263949':'#101b27'}/><text x={RIGHT+107} y={labelY+5} fill={color}>{levelNames.get(level.id)} · {format(level.price)}</text></g>;})}
      <text x={LEFT} y="24">PRECIO / USD</text><text x={RIGHT} y="24" textAnchor="end">{bars.length} sesiones</text>
      {[...panels].map(([key,panel])=><g key={key}><rect x={LEFT} y={panel.top} width={RIGHT-LEFT} height="140" fill="#0c131d"/><line x1={LEFT} x2={RIGHT} y1={panel.top} y2={panel.top} stroke="#263241"/><text x={LEFT+10} y={panel.top+19}>{key==='volume'?'VOLUMEN':key==='rsi'?'RSI · 14':key==='macd'?'MACD · 12 / 26 / 9':'RESULTADO TEÓRICO · USD'}</text></g>)}
      {volume&&bars.map((row,i)=>{const h=row.volume/maxVolume*90;return <rect key={row.time} x={x(i)-candleWidth/2} y={volume.bottom-7-h} width={candleWidth} height={h} fill={row.close>=row.open?'#42c9a1':'#f07883'} opacity=".45"/>;})}
      {rsi&&<>{[30,70].map(value=><g key={value}><line x1={LEFT} x2={RIGHT} y1={rsi.bottom-12-value*.98} y2={rsi.bottom-12-value*.98} stroke="#3b3b55" strokeDasharray="4 5"/><text x={RIGHT+12} y={rsi.bottom-8-value*.98}>{value}</text></g>)}<path data-replay-series="rsi" d={line(row=>lookup.get(row.time)?.rsi,value=>rsi.bottom-12-value*.98)} fill="none" stroke="#b4a0ef" strokeWidth="1.8"/></>}
      {macd&&<><line x1={LEFT} x2={RIGHT} y1={my(0)} y2={my(0)} stroke="#293847"/>{bars.map((row,i)=>{const value=lookup.get(row.time)?.macdHistogram;return value!==null&&value!==undefined&&<rect key={row.time} x={x(i)-candleWidth/2} y={Math.min(my(0),my(value))} width={candleWidth} height={Math.max(.5,Math.abs(my(0)-my(value)))} fill={value>=0?'#42c9a1':'#f07883'} opacity=".5"/>;})}<path data-replay-series="macd" d={line(row=>lookup.get(row.time)?.macd,my)} fill="none" stroke="#69cfe8" strokeWidth="1.6"/><path d={line(row=>lookup.get(row.time)?.macdSignal,my)} fill="none" stroke="#f4b66c" strokeWidth="1.5"/></>}
      {profit&&<><line x1={LEFT} x2={RIGHT} y1={pnlY(0)} y2={pnlY(0)} stroke="#42515c" strokeDasharray="4 5"/><path data-replay-series="pnl" d={line(row=>pnlMap.get(row.time),pnlY)} fill="none" stroke="#f4bd63" strokeWidth="2"/><text x={RIGHT+12} y={pnlY(0)+4}>0</text></>}
      {entryIndex>=0&&<g><line data-replay-entry x1={x(entryIndex)} x2={x(entryIndex)} y1={PRICE_TOP} y2={bottom} stroke="#ff934f" strokeDasharray="4 5" opacity=".75"/><text x={Math.max(LEFT+35,Math.min(RIGHT-35,x(entryIndex)))} y={PRICE_TOP+18} textAnchor="middle" fill="#ffad72">Entrada</text></g>}
      {index>=0&&<><line data-replay-cursor x1={x(index)} x2={x(index)} y1={PRICE_TOP} y2={bottom} stroke="#b9cbd9" strokeDasharray="3 4" opacity=".7"/><line x1={LEFT} x2={RIGHT} y1={py(bar.close)} y2={py(bar.close)} stroke="#b9cbd9" strokeDasharray="3 4" opacity=".3"/><circle cx={x(index)} cy={py(bar.close)} r="4" fill="#eff6fc" stroke="#0c131d" strokeWidth="2"/>
      <rect x={RIGHT+5} y={py(bar.close)-11} width="89" height="23" rx="4" fill="#dce6ef"/><text x={RIGHT+49} y={py(bar.close)+5} textAnchor="middle" fill="#0b1420">{format(bar.close)}</text></>}
      {ticks.map(i=><text key={i} x={x(i)} y={bottom+26} textAnchor={i===0?'start':i===bars.length-1?'end':'middle'}>{date(bars[i].time)}</text>)}
    </svg></div>
    {coreStudies.supportResistance&&<details className="replay-level-list"><summary>Consultar todos los soportes y resistencias conocidos: {knownLevels.length}</summary><p>Selecciona un nivel visible para resaltarlo. Las etiquetas se separan del precio para evitar superposiciones; las líneas conservan su valor exacto.</p><div className="table-scroll"><table><thead><tr><th>Nivel</th><th>Precio USD</th><th>Contactos</th><th>Confirmado</th><th>Vista</th></tr></thead><tbody>{knownLevels.map(level=><tr key={level.id}><td>{levelNames.get(level.id)} {level.kind==='support'?'Soporte':'Resistencia'}</td><td>{format(level.price)}</td><td>{level.touches}</td><td>{date(level.confirmedAt)}</td><td><button type="button" className="secondary-button" disabled={!inViewLevels.includes(level)} aria-pressed={selectedLevel===level.id} onClick={()=>{setSelectedLevel(level.id);if(levelMode==='none')setLevelMode('nearby');}}>Resaltar {levelNames.get(level.id)}</button></td></tr>)}</tbody></table></div></details>}
  </>;
}
