export function unavailableRankingMessage(ranked: readonly {symbol:string;score:number|null;reason:string;coreResults?:readonly {status:string;reason:string}[]}[], excluded: readonly {symbol:string;reason:string}[]) {
  const incomplete=ranked.filter(item=>item.score===null);
  if(!ranked.length&&!excluded.length)return 'La consulta no devolvió empresas para analizar. Actualiza los datos y vuelve a intentarlo.';
  const reasons=[...incomplete.map(item=>`${item.symbol}: ${item.coreResults?.filter(core=>core.status==='unavailable').map(core=>core.reason).filter((reason,index,array)=>array.indexOf(reason)===index).join(' ')||item.reason}`),...excluded.map(item=>`${item.symbol}: ${item.reason}`)];
  return `No se pudo completar el ranking: ${incomplete.length} empresas con entradas incompletas y ${excluded.length} con consultas fallidas. ${reasons.slice(0,2).join(' ')} Para probar el análisis histórico, selecciona Volatilidad, Tendencia, Liquidez y Riesgo y usa al menos 100 velas diarias recientes. El escenario educativo de las griegas no se utiliza en este ranking.`;
}
