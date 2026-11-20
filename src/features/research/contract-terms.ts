import { knownBy, type ObservedOptionContract,type CompanyResearch,type ResearchVariable } from '../../cores/compartido/research-model.ts';
const easternFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const easternCache=new Map<string,string>();

/** Convert an Eastern wall clock to UTC, using IANA rules including DST. */
export function easternTime(date: string, clock: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(clock)) return null;
  const key=date+'|'+clock,cached=easternCache.get(key);
  if(cached)return cached;
  const desired=Date.parse(`${date}T${clock.length===5?clock+':00':clock}Z`);
  if(!Number.isFinite(desired)||new Date(desired).toISOString().slice(0,10)!==date)return null;
  let time=desired;
  for(let i=0;i<3;i++) {
    const parts=Object.fromEntries(easternFormat.formatToParts(new Date(time)).map(p=>[p.type,p.value]));
    const rendered=Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    const difference=desired-rendered;
    if(difference===0){
      const result=new Date(time).toISOString();
      if(easternCache.size>=2048)easternCache.delete(easternCache.keys().next().value!);
      easternCache.set(key,result);return result;
    }
    time+=difference;
  }
  return null;
}

export function valuationExpiry(contract: ObservedOptionContract, asOf?: string): { time: number; source: string; estimated: boolean } {
  const cutoff=asOf===undefined?Infinity:Date.parse(asOf);
  const metadata=contract.valuationExpiry;
  if(metadata && Number.isFinite(Date.parse(metadata.at)) && Number.isFinite(Date.parse(metadata.availableAt))
    && Date.parse(metadata.availableAt)<=cutoff) return {time:Date.parse(metadata.at),source:metadata.source,estimated:true};
  return {time:Date.parse(easternTime(contract.expiration,'16:00')??''),source:'Supuesto: cierre a las 16:00 America/New_York; sin calendario verificado',estimated:true};
}

/** Only a verified, single equity deliverable is supported. Cash, baskets and
 * delayed settlements require a different payoff model and cannot default to 100. */
export function equityTerms(contract: ObservedOptionContract, asOf: string): {multiplier:number; shares:number; effectiveStrike:number} | null {
  if(!contract.multiplier || !contract.deliverableShares || contract.deliverableType!=='single_equity'
    || !knownBy(contract.multiplier,asOf) || !knownBy(contract.deliverableShares,asOf)
    || !knownBy(contract.strike,asOf))return null;
  const multiplier=contract.multiplier.value!,shares=contract.deliverableShares.value!;
  if(multiplier<=0 || shares<=0 || contract.strike.value!<=0)return null;
  const effectiveStrike=contract.strike.value!*multiplier/shares;
  return Number.isFinite(effectiveStrike)?{multiplier,shares,effectiveStrike}:null;
}

export function modelDividendYield(s:CompanyResearch,policy:{dividendModel?:'continuous'|'declared-cash';dividendYield?:ResearchVariable}):ResearchVariable {
  if(policy.dividendModel!=='declared-cash')return policy.dividendYield??s.fundamentals.dividendYield;
  if(!s.cashDividends||['error','unavailable','missing_config'].includes(s.cashDividends.status.status))return {value:null,kind:'missing',source:'Modelo de dividendos discretos',observedAt:null,availableAt:null,reason:'No hay calendario recibido para valorar con dividendos declarados.'};
  return {value:0,kind:'assumed',source:'Modelo elegido: pagos declarados discretos; sin componente continuo adicional',observedAt:s.asOf,availableAt:s.asOf,reason:'No supone que no habrá más anuncios; la cobertura del calendario es parcial.'};
}
export function cashDividendPv(s:Pick<CompanyResearch,'asOf'|'cashDividends'>,expiration:number,rate:number,after=Date.parse(s.asOf)):number {
  return (s.cashDividends?.events??[]).reduce((sum,e)=>{
    const ex=Date.parse(easternTime(e.exDate,'09:30')??'');
    return e.currency==='USD'&&Number.isFinite(e.amount)&&e.amount>0&&Date.parse(e.availableAt)<=Date.parse(s.asOf)&&ex>after&&ex<=expiration
      ? sum+e.amount*Math.exp(-rate*(ex-after)/(365*86400000)):sum;
  },0);
}
