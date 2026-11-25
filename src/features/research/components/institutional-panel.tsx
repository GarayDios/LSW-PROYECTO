import type { InstitutionalResearch } from '../../../cores/02-flujo-institucional/sec-13f';
const shares=(value:number)=>value.toLocaleString('en-US',{maximumFractionDigits:3});
export default function InstitutionalPanel({data}:{data?:InstitutionalResearch}){
  return <details open className="institutional-research fundamental-analysis">
    <summary>Participación institucional · SEC 13F · {data?.comparable??0}/{data?.configured??2} gestores comparables</summary>
    <p className="research-message">{data?.status.message??'Se consultan posiciones de Geode y State Street al actualizar variables actuales con SEC y Alpaca configurados.'}</p>
    <p className="research-message">Se comparan posiciones trimestrales publicadas. El core utiliza su variación y peso seleccionado; no atribuye operaciones a instituciones a partir del volumen de mercado. CUSIP: {data?.cusip??'sin correspondencia'}.</p>
    <div className="research-grid">{data?.managers.map(manager=><div className="research-variable" key={manager.cik}>
      <div><span>{manager.name}</span><strong>{manager.direction===undefined?'No comparable':manager.change===undefined?'Sin base porcentual':`${(manager.change*100).toFixed(2)}%`}</strong></div>
      <p>{manager.message}</p>
      {manager.previous&&manager.current&&<>
        <small>{manager.previous.period}: {shares(manager.previous.shares)} acciones · {manager.current.period}: {shares(manager.current.shares)} acciones.</small>
        <small>Factor de split aplicado a la posición anterior: {manager.splitFactor??'no verificado'}.</small>
        {[manager.previous,manager.current].map(report=><p key={report.accession}><a href={report.url} target="_blank" rel="noopener noreferrer">Reporte {report.period}{report.amended?' · enmienda de reemplazo':''}</a> · Publicado: {new Date(report.availableAt).toLocaleString('es-MX',{timeZone:'America/New_York'})} ET.</p>)}
      </>}
    </div>)}</div>
    {data?.warnings.map(warning=><p className="research-message" key={warning}>{warning}</p>)}
  </details>;
}
