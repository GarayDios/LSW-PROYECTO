"use client";
import {useId} from 'react';
import {useChartZoom,useChartWheelZoom} from '../../market/hooks/use-chart-zoom';
import ChartZoomControls from '../../market/components/chart-zoom-controls';
const money=(n:number)=>n.toLocaleString('en-US',{style:'currency',currency:'USD'});
const date=(n:number)=>new Date(n).toISOString().slice(0,10);

export default function ReplayPnlPlot({values:allValues,cursorTime,onSelect:onInspect}:{values:{time:number;value:number}[];cursorTime:number;onSelect:(time:number)=>void}){
  const id=useId().replace(/:/g,'');
  const zoom=useChartZoom(allValues,`pnl-${allValues[0]?.time}`,3,cursorTime);
  const viewport=useChartWheelZoom(zoom.change,85,875);
  function onSelect(time:number){const target=allValues.findIndex(row=>row.time===time);if(target<zoom.start)zoom.pan(target);else if(target>=zoom.end)zoom.pan(target-zoom.count+1);onInspect(time);}
  const values=zoom.visible;
  if(!values.length)return null;
  const low=Math.min(0,...values.map(p=>p.value)),high=Math.max(0,...values.map(p=>p.value)),range=Math.max(1,high-low);
  const x=(i:number)=>85+i/Math.max(1,values.length-1)*790,y=(v:number)=>245-(v-low)/range*190;
  const selectedIndex=values.findIndex(p=>p.time===cursorTime),index=selectedIndex<0?0:selectedIndex;
  const path=values.map((p,i)=>(i?'L':'M')+x(i)+','+y(p.value)).join(' '),zero=y(0);
  return <figure className="replay-chart replay-pnl-card"><figcaption className="replay-chart-heading"><div><span className="replay-kicker">EVOLUCIÓN DE LA ESTRATEGIA</span><div className="replay-price-heading"><strong className={allValues.at(-1)!.value>=0?'positive':'negative'}>{money(allValues.at(-1)!.value)}</strong></div><span>Última marca disponible · {date(allValues.at(-1)!.time)}</span></div><span className="neutral-badge">P/L teórico · neto de comisiones</span></figcaption>
    <ChartZoomControls zoom={zoom} label="gráfica de resultado" id="pnl"/>
    <div className="replay-chart-viewport" ref={viewport}><svg viewBox="0 0 960 300" role="slider" tabIndex={0} aria-label="Pérdida o ganancia teórica sobre precios posteriores" aria-valuemin={0} aria-valuemax={allValues.length-1} aria-valuenow={Math.max(0,allValues.findIndex(row=>row.time===cursorTime))} aria-valuetext={selectedIndex>=0?`${date(values[index].time)}: ${money(values[index].value)}`:'Selecciona un punto en el tramo visible'} onPointerDown={event=>{const matrix=event.currentTarget.getScreenCTM();if(!matrix)return;const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());onSelect(values[Math.max(0,Math.min(values.length-1,Math.round((point.x-85)/790*(values.length-1))))].time);}} onKeyDown={event=>{const globalIndex=Math.max(0,allValues.findIndex(row=>row.time===cursorTime));const next=event.key==='ArrowLeft'?globalIndex-1:event.key==='ArrowRight'?globalIndex+1:event.key==='Home'?0:event.key==='End'?allValues.length-1:null;if(next!==null){event.preventDefault();onSelect(allValues[Math.max(0,Math.min(allValues.length-1,next))].time);}}}>
      <title>Resultado neto teórico de la estrategia</title><defs><linearGradient id={`${id}-gain`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#42c9a1" stopOpacity=".3"/><stop offset="1" stopColor="#42c9a1" stopOpacity=".03"/></linearGradient><linearGradient id={`${id}-loss`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#f07883" stopOpacity=".03"/><stop offset="1" stopColor="#f07883" stopOpacity=".3"/></linearGradient><clipPath id={`${id}-positive`}><rect x="85" y="40" width="790" height={Math.max(0,zero-40)}/></clipPath><clipPath id={`${id}-negative`}><rect x="85" y={zero} width="790" height={Math.max(0,255-zero)}/></clipPath></defs>
      {[low,low+range*.5,high].map((v,i)=><g key={i}><line x1="85" x2="875" y1={y(v)} y2={y(v)} stroke="#243141" strokeDasharray="3 5"/><text x="75" y={y(v)+4} textAnchor="end" fill="#91a3ba">{money(v)}</text></g>)}
      <line x1="85" x2="875" y1={zero} y2={zero} stroke="#75869a" strokeDasharray="4 5"/>
      {(['positive','negative'] as const).map(side=><g key={side} clipPath={`url(#${id}-${side})`}><path d={`${path} L${x(values.length-1)},${zero} L85,${zero} Z`} fill={`url(#${id}-${side==='positive'?'gain':'loss'})`}/><path d={path} fill="none" stroke={side==='positive'?'#42c9a1':'#f07883'} strokeWidth="2.5"/></g>)}
      {selectedIndex>=0&&<g><line x1={x(index)} x2={x(index)} y1="40" y2="255" stroke="#c5d4e5" strokeDasharray="3 4"/><circle cx={x(index)} cy={y(values[index].value)} r="5" fill="#e3eefb" stroke="#0c131d" strokeWidth="2"/><text x={Math.max(150,Math.min(810,x(index)))} y="28" textAnchor="middle" fill="#dce6f3">{date(values[index].time)} · {money(values[index].value)}</text></g>}
      <text x="85" y="283" fill="#91a3ba">{date(values[0].time)}</text><text x="875" y="283" textAnchor="end" fill="#91a3ba">{date(values.at(-1)!.time)}</text>
    </svg></div><div className="replay-pnl-extremes"><span>Mejor marca <strong className="positive">{money(Math.max(...allValues.map(p=>p.value)))}</strong></span><span>Peor marca <strong className="negative">{money(Math.min(...allValues.map(p=>p.value)))}</strong></span><span>Selecciona un cierre para inspeccionar su posición.</span></div>
  </figure>;
}
