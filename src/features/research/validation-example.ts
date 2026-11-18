/** Synthetic, prominently tagged example for the importer. Never evidence. */
export function optionValidationExample(){
  const samples=[];
  for(let period=0;period<12;period++)for(const [index,symbol] of ['AAA','BBB','CCC'].entries()){
    const at=new Date(Date.parse('2024-01-02T16:00:00Z')+period*40*86400000).toISOString();
    const expiration=new Date(Date.parse(at)+32*86400000).toISOString().slice(0,10),exit=new Date(Date.parse(at)+10*86400000).toISOString();
    const v=(value:number)=>({value,source:'FIXTURE SINTÉTICA, no proveedor',observedAt:at,availableAt:at,kind:'observed' as const});
    const contractSymbol=`${symbol}-${expiration}-put-95`;
    samples.push({snapshot:{symbol,asOf:at,generatedAt:at,
      market:{spot:v(100),historicalVolatility:v(.2+index*.1),momentum20:v(.01*(2-index)),momentum60:v(.02*(2-index)),averageDollarVolume20:v(1e8),maxDrawdown:v(.1+index*.1),downsideVolatility:v(.1),stale:false,bars:[]},
      options:{feed:'opra',complete:true,contracts:[{symbol:contractSymbol,underlyingSymbol:symbol,type:'put',expiration,style:'european',strike:v(95),multiplier:v(100),deliverableShares:v(100),deliverableType:'single_equity',bid:v(2),ask:v(2.2),premium:v(2.1),impliedVolatility:v(.3),openInterest:v(1000),delta:v(-.25),gamma:v(.02),theta:v(-.03),vega:v(.1)}]},
      fundamentals:{dividendYield:v(0)},macro:{riskFreeRate:v(.04)}},exits:[{symbol:contractSymbol,at:exit,availableAt:exit,bid:1+index*.1,ask:1.2+index*.1}]});
  }
  return {version:1,source:'EJEMPLO SINTÉTICO: verifica el importador, no la rentabilidad',kind:'fixture',samples};
}
