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
  const cutoff=Date.parse(asOf),spot=original.market.spot.value??1;
  const descriptors=new Map(original.options.contracts.flatMap(c=>{const terms=equityTerms(c,asOf);if(!terms)return [];const time=valuationExpiry(c,asOf).time;return time>cutoff?[[c,{days:(time-cutoff)/86400000,strike:terms.effectiveStrike}] as const]:[];}));
  const candidates=[...descriptors.keys()];
  const near=(tenor:number)=>[...candidates].sort((a,b)=>{
    const distance=(c:typeof a)=>Math.abs(descriptors.get(c)!.days-tenor)/Math.max(1,tenor)+Math.abs(descriptors.get(c)!.strike/spot-1);
    return distance(a)-distance(b)||a.symbol.localeCompare(b.symbol);
  });
  const short=near(policy.estimateDays??30),long=near(policy.longDays??365);
  // Reserve distinct long-call candidates for PMCC. ATM puts/calls must not
  // consume the bounded reconstruction budget before a deep ITM LEAPS is tried.
  const longDelta=(c:typeof candidates[number])=>{
    const r=policy.riskFreeRate??original.macro.riskFreeRate,q=modelDividendYield(original,policy);
    const sigma=knownBy(c.impliedVolatility,asOf)&&c.impliedVolatility.value!>0?c.impliedVolatility:original.market.historicalVolatility;
    if(!knownBy(r,asOf)||!knownBy(q,asOf)||!knownBy(sigma,asOf)||!knownBy(original.market.spot,asOf))return -Infinity;
    try{return blackScholes({spot:original.market.spot.value!,strike:descriptors.get(c)!.strike,days:descriptors.get(c)!.days,volatility:sigma.value!,rate:r.value!,dividendYield:q.value!,type:'call'}).delta;}catch{return -Infinity;}
  };
  const groups=policy.estimateStrategy==='pmcc'?[short.filter(c=>c.type==='call'),long.filter(c=>c.type==='call'&&descriptors.get(c)!.strike<(original.market.spot.value??0)&&longDelta(c)>=(policy.pmccMinLongDelta??.81))]:[short,long];
  const pool=new Set<typeof candidates[number]>();
  // Round-robin fills the budget without wasting slots on overlapping groups.
  for(let i=0;pool.size<limit&&groups.some(group=>i<group.length);i++)for(const group of groups)if(group[i]&&pool.size<limit)pool.add(group[i]);
  for(const c of short){if(pool.size>=limit)break;pool.add(c);}
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
    if((!knownBy(c.impliedVolatility,asOf)||c.impliedVolatility.value!<=0) && knownBy(s.market.historicalVolatility,asOf) && s.market.historicalVolatility.value!>0)
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
      const greeks=blackScholes(input);
      c.delta=assumed(greeks.delta,'delta europea BSM de las entradas estimadas');
      c.gamma=assumed(greeks.gamma,'gamma europea BSM de las entradas estimadas');
      c.theta=assumed(greeks.theta,'theta europea BSM de las entradas estimadas');
      c.vega=assumed(greeks.vega,'vega europea BSM de las entradas estimadas');
    }catch{/* Infeasible models stay missing; no fabricated result. */}
  }
  s.warnings.push('Modo estimado autorizado: puede usar HV y precios teóricos; no valida datos históricos ni prepara órdenes Paper.');
  if(pool.size<candidates.length){s.options.complete=false;s.warnings.push(`Reconstrucción limitada a ${pool.size} candidatos de ${candidates.length}, próximos al plazo solicitado y al plazo largo${policy.estimateStrategy==='pmcc'?'; se reservan calls largas ITM con delta compatible para PMCC':''}. No es una búsqueda exhaustiva.`);}
  return s;
}
