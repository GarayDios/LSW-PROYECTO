import type { PaperOrder } from './order-ticket';
export const orderModeLabel=(mode:NonNullable<PaperOrder['provenance']>['mode'])=>({demo:'Demostración',observed:'Investigación',estimated:'Estimado',manual:'Manual'})[mode];
export default function OrderProvenance({order}:{order:PaperOrder}){
  const p=order.provenance;
  if(!p)return <small>Demostración anterior · sin detalle de fuentes guardado</small>;
  return <details className="order-provenance"><summary>Fuentes y supuestos · {orderModeLabel(p.mode)}</summary>
    <p>Contrato base: {p.contractSymbol??'Hipotético o condiciones editadas'}. Corte: {p.asOf??order.createdAt}.</p>
    <p>Precio: {p.spotSource}. Volatilidad: {p.volatilitySource}. Tasa: {p.rateSource}. Dividendo: {p.dividendSource}.</p>
    {p.inputs&&<p>Entradas BSM guardadas: S={p.inputs.spot.toFixed(4)}, K efectivo={p.inputs.strike.toFixed(4)}, T={p.inputs.days.toFixed(3)} días, σ={(p.inputs.volatility*100).toFixed(2)}%, r={(p.inputs.rate*100).toFixed(2)}%, q={((p.inputs.dividendYield??0)*100).toFixed(2)}%.</p>}
    <p>Multiplicador {order.multiplier??100}; entrega {order.shares??100} acciones. Prima registrada como intención de simulación, no ejecución.</p>
    {p.warnings.map((w,i)=><p key={i}>{w}</p>)}
  </details>;
}
