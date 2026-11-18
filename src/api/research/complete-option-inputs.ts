import { knownBy, type CompanyResearch } from '../../features/research/model.ts';
import { equityTerms, valuationExpiry } from '../../features/research/contract-terms.ts';
import { blackScholes } from '../../cores/bsm.ts';
import { binomialPrice } from '../../cores/binomial.ts';

/** Derive IV from received quotes, never from HV or fabricated prices. Bounded CPU. */
export function completeOptionInputs(s:CompanyResearch):void {
  const spot=s.market.spot,rate=s.macro.riskFreeRate,q=s.fundamentals.dividendYield;
  if(![spot,rate,q].every(v=>knownBy(v,s.asOf))||spot.value!<=0||q.value!<0||s.market.stale)return;
  const cutoff=Date.parse(s.asOf);
  const candidates=s.options.contracts.filter(c=>!knownBy(c.impliedVolatility,s.asOf)&&equityTerms(c,s.asOf)&&c.style!=='unknown'
    &&[c.bid,c.ask,c.premium].every(v=>knownBy(v,s.asOf))&&c.bid.value!>=0&&c.ask.value!>c.bid.value!
    &&c.premium.value!>0&&cutoff-Date.parse(c.premium.observedAt!)<=3600000
    &&Math.abs(Date.parse(c.premium.observedAt!)-Date.parse(spot.observedAt!))<=(s.market.spotBasis==='quote'?15*60000:4*86400000)
    &&valuationExpiry(c,s.asOf).time>cutoff);
  const ordered=(target:number)=>[...candidates].sort((a,b)=>{
    const distance=(c:typeof a)=>Math.abs((valuationExpiry(c,s.asOf).time-cutoff)/86400000-target)/target+Math.abs(equityTerms(c,s.asOf)!.effectiveStrike/spot.value!-1)*3;
    return distance(a)-distance(b)||a.symbol.localeCompare(b.symbol);
  });
  const pool=new Set([...ordered(30).slice(0,32),...ordered(365).slice(0,32)]);
  let completed=0;
  for(const c of pool){
    const terms=equityTerms(c,s.asOf)!,target=c.premium.value!*terms.multiplier/terms.shares;
    const base={spot:spot.value!,strike:terms.effectiveStrike,days:(valuationExpiry(c,s.asOf).time-cutoff)/86400000,rate:rate.value!,dividendYield:q.value!,type:c.type};
    const price=(volatility:number)=>c.style==='american'?binomialPrice({...base,volatility},'american',100):blackScholes({...base,volatility}).price;
    try{
      // CRR needs |r-q|*sqrt(dt) <= sigma for a valid risk-neutral probability.
      let low=c.style==='american'?Math.max(.0001,Math.abs(base.rate-base.dividendYield)*Math.sqrt(base.days/365/100)*1.001):.0001,high=5;
      if(low>=high)continue;
      if(target<=price(low)+1e-6||target>=price(high))continue;
      let volatility=0,error=Infinity;
      for(let i=0;i<40;i++){
        volatility=(low+high)/2;const difference=price(volatility)-target;error=Math.abs(difference);
        if(error<1e-5)break;
        if(difference>0)high=volatility;else low=volatility;
      }
      if(error>=1e-5)continue;
      c.impliedVolatility={value:volatility,kind:'estimated',source:`IV calculada de bid/ask Alpaca mediante ${c.style==='american'?'CRR americano':'BSM europeo'}`,
        observedAt:c.premium.observedAt,availableAt:s.asOf,reason:'Calibrada al punto medio recibido, tasa y dividendo del modelo. No es IV publicada ni evidencia independiente de infravaloración.'};
      completed++;
    }catch{/* An infeasible inversion stays missing. */}
  }
  if(completed)s.warnings.push(`${completed} IV calculadas automáticamente con cotizaciones recibidas; no se utilizó HV como IV.`);
  if(pool.size<candidates.length)s.warnings.push(`Cálculo automático de IV limitado a ${pool.size} de ${candidates.length} candidatos próximos a 30 y 365 días.`);
}
