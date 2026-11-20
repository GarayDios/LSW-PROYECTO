import { blackScholes } from '../nucleo-cuantitativo/bsm.ts';
import { binomialPrice } from '../nucleo-cuantitativo/binomial.ts';
import { evaluationTuning } from './evaluation-policy.ts';
import { equityTerms, valuationExpiry,modelDividendYield,cashDividendPv } from '../../features/research/contract-terms.ts';
import { knownBy, type CompanyResearch, type ResearchVariable } from '../compartido/research-model.ts';
import type { AnalysisPolicy } from './strategy-analysis.ts';

/** Explicit educational reconstruction of missing IV/quotes on EXISTING contracts.
 * Originals are untouched. An assumed quote is never an execution instruction. */
export function estimatedSnapshot(original:CompanyResearch,policy:AnalysisPolicy):CompanyResearch {
  if(policy.modelMode!=='estimated')return original;
  const asOf=original.asOf;
  const limit=Number.isInteger(policy.estimatedCandidateLimit)&&policy.estimatedCandidateLimit!>=10&&policy.estimatedCandidateLimit!<=500?policy.estimatedCandidateLimit!:128;
  const candidates=original.options.contracts.filter(c=>equityTerms(c,asOf)&&valuationExpiry(c,asOf).time>Date.parse(asOf));
  const near=(tenor:number)=>[...candidates].sort((a,b)=>{
    const distance=(c:typeof a)=>Math.abs((valuationExpiry(c,asOf).time-Date.parse(asOf))/86400000-tenor)/Math.max(1,tenor)+Math.abs(equityTerms(c,asOf)!.effectiveStrike/(original.market.spot.value??1)-1);
    return distance(a)-distance(b)||a.symbol.localeCompare(b.symbol);
  });
  const pool=new Set([...near(policy.estimateDays??30).slice(0,Math.ceil(limit/2)),...near(policy.longDays??365).slice(0,Math.floor(limit/2))]);
  // Share untouched provider values, clone only the contracts we may reconstruct.
  const s={...original,options:{...original.options,contracts:original.options.contracts.map(c=>pool.has(c)?{...c}:c)},warnings:[...original.warnings]};
  const q=modelDividendYield(s,policy),r=policy.riskFreeRate??s.macro.riskFreeRate;
  if(!knownBy(s.market.spot,asOf)||!knownBy(q,asOf)||!knownBy(r,asOf))return s;
  const assumed=(value:number,label:string):ResearchVariable=>({value,kind:'assumed',source:`Escenario estimado: ${label}`,observedAt:asOf,availableAt:asOf,reason:'Reconstrucción educativa; no es una observación ni una cotización ejecutable.'});
  let tuning;try{tuning=evaluationTuning(policy.tuning);}catch{return s;}
  for(const [index,c] of s.options.contracts.entries()){
    if(!pool.has(original.options.contracts[index]))continue;
    const terms=equityTerms(c,asOf),days=(valuationExpiry(c,asOf).time-Date.parse(asOf))/86400000;
    if(!terms||days<=0)continue;
    if(!knownBy(c.impliedVolatility,asOf) && knownBy(s.market.historicalVolatility,asOf) && s.market.historicalVolatility.value!>0)
      c.impliedVolatility=assumed(s.market.historicalVolatility.value!,'HV como volatilidad supuesta, no IV observada');
    if(!knownBy(c.impliedVolatility,asOf)||c.impliedVolatility.value!<=0)continue;
    if([c.bid,c.ask,c.premium].every(v=>knownBy(v,asOf)) && c.bid.value!>=0 && c.ask.value!>0 && c.bid.value!<=c.ask.value!
      && Date.parse(asOf)-Date.parse(c.premium.observedAt!)<=tuning.quoteMaxAgeMinutes*60000)continue;
    try{
      const input={spot:Math.max(1e-8,s.market.spot.value!-(policy.dividendModel==='declared-cash'?cashDividendPv(s,valuationExpiry(c,asOf).time,r.value!):0)),strike:terms.effectiveStrike,days,volatility:c.impliedVolatility.value!,rate:r.value!,dividendYield:q.value!,type:c.type};
      const price=(c.style==='american'?binomialPrice(input,'american',tuning.binomialSteps):blackScholes(input).price)*terms.shares/terms.multiplier;
      // A modeled spread, explicitly identified, prevents a zero-friction fill assumption.
      const half=Math.max((policy.estimatedSpreadFloor??.02)/2,price*(policy.estimatedSpreadPercent??5)/200);
      c.bid=assumed(Math.max(0,price-half),`bid teórico; spread supuesto ${policy.estimatedSpreadPercent??5}% o mínimo USD ${policy.estimatedSpreadFloor??.02}`);
      c.ask=assumed(price+half,`ask teórico; spread supuesto ${policy.estimatedSpreadPercent??5}% o mínimo USD ${policy.estimatedSpreadFloor??.02}`);
      c.premium=assumed((c.bid.value!+c.ask.value!)/2,'punto medio teórico');
    }catch{/* Infeasible models stay missing; no fabricated result. */}
  }
  s.warnings.push('Modo estimado autorizado: puede usar HV y precios teóricos; no valida datos históricos ni prepara órdenes Paper.');
  if(pool.size<candidates.length){s.options.complete=false;s.warnings.push(`Reconstrucción limitada a ${pool.size} candidatos de ${candidates.length}, próximos al plazo solicitado y al plazo largo. No es una búsqueda exhaustiva.`);}
  return s;
}
