"use client";
import './chart-zoom-controls.css';

type Zoom={start:number;end:number;total:number;count:number;isZoomed:boolean;canZoomIn:boolean;canZoomOut:boolean;
  change:(factor:number,anchor?:number)=>void;pan:(start:number)=>void;reset:()=>void};

export default function ChartZoomControls({zoom,label,id}:{zoom:Zoom;label:string;id:string}){
  const step=Math.max(1,Math.round(zoom.count/3));
  return <div className="chart-zoom-controls" data-chart-zoom={id} data-visible-start={zoom.start} data-visible-end={zoom.end} data-total={zoom.total}>
    <div className="chart-zoom-buttons" role="group" aria-label={`Zoom de ${label}`}>
      <button type="button" aria-label={`Alejar ${label}`} title="Alejar" disabled={!zoom.canZoomOut} onClick={()=>zoom.change(1/.65)}>−</button>
      <span aria-live="polite">{zoom.count?`${(zoom.total/zoom.count).toFixed(1)}×`:'1.0×'}</span>
      <button type="button" aria-label={`Acercar ${label}`} title="Acercar" disabled={!zoom.canZoomIn} onClick={()=>zoom.change(.65)}>+</button>
      <button type="button" className="chart-zoom-reset" aria-label={`Restablecer ${label}`} disabled={!zoom.isZoomed} onClick={zoom.reset}>Restablecer</button>
    </div>
    {zoom.isZoomed&&<div className="chart-zoom-pan"><button type="button" aria-label={`Tramo anterior de ${label}`} disabled={zoom.start===0} onClick={()=>zoom.pan(zoom.start-step)}>Anterior</button><input type="range" aria-label={`Desplazar ${label}`} min="0" max={zoom.total-zoom.count} step="1" value={zoom.start} onChange={event=>zoom.pan(event.currentTarget.valueAsNumber)}/><button type="button" aria-label={`Tramo siguiente de ${label}`} disabled={zoom.end===zoom.total} onClick={()=>zoom.pan(zoom.start+step)}>Siguiente</button></div>}
    <span className="chart-zoom-help">{zoom.count} de {zoom.total} puntos · Ctrl + rueda para zoom</span>
  </div>;
}
