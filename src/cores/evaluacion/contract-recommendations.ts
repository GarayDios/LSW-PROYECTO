import type {CompanyResearch,ObservedOptionContract} from '../compartido/research-model.ts';
import type {StrategyId} from '../compartido/types.ts';
import {analysisPolicy,type AnalysisSettings} from '../../features/research/analysis-settings.ts';
import {equityTerms,valuationExpiry} from '../../features/research/contract-terms.ts';
import {strategyOutlook} from './strategy-outlook.ts';
import {estimatedSnapshot} from './estimated-snapshot.ts';
import {analyzeStrategy} from './strategy-analysis.ts';
import {inspectContracts} from './strategy-eligibility.ts';
import {evaluateScanner} from './scanner.ts';
import {defaultScannerSettings} from './scanner-settings.ts';

export type ContractRecommendationRequest={research:CompanyResearch;strategy:StrategyId;days:number;settings:AnalysisSettings;limit?:number;order?:'analysis'|'pnl'|'capital'};
export type ContractCandidate={
  id:string;analysis:ReturnType<typeof analyzeStrategy>;evaluation:ReturnType<typeof evaluateScanner>;
  profitability:ReturnType<typeof strategyOutlook>['profitability'];horizonSessions:number|null;executionReady:boolean;
};
export type ContractRecommendations={symbol:string;strategy:StrategyId;asOf:string;dataMode:'observed'|'estimated';candidates:ContractCandidate[];checked:number;totalContracts:number;eligibleContracts:number;poolSize:number;bounded:boolean;missing:string[]};

/** Enumerate bounded alternative contract structures, sharing the existing
 * geometry/capital/quote validator. Excluding selected legs explores alternatives
 * without a Cartesian product of thousands of contracts. No order side effects. */
export function recommendContracts(input:ContractRecommendationRequest):ContractRecommendations{
  const {research,strategy,days,settings}=input;
  const initial=strategyOutlook(research,strategy,days,settings),mode=initial.resolved.scenario?.dataMode??'observed';
  const output:ContractRecommendations={symbol:research.symbol,strategy,asOf:research.asOf,dataMode:mode,candidates:[],checked:0,totalContracts:research.options.contracts.length,eligibleContracts:0,poolSize:0,bounded:false,missing:[]};
  if(!initial.resolved.scenario||!initial.resolved.analysis){output.missing=[initial.resolved.error??'No hay contratos compatibles con los datos y el capital configurados.'];return output;}
  const policy={...analysisPolicy(settings,research),modelMode:mode,estimateDays:days,estimateStrategy:strategy};
  const snapshot=estimatedSnapshot(research,policy),eligible=inspectContracts(snapshot,policy).eligible;
  output.eligibleContracts=eligible.length;
  const descriptors=new Map(eligible.map(c=>[c,{days:(valuationExpiry(c,research.asOf).time-Date.parse(research.asOf))/86400000,spread:(c.ask.value!-c.bid.value!)/Math.max(.01,c.premium.value!),strike:equityTerms(c,research.asOf)!.effectiveStrike}]));
  const near=(tenor:number,items=eligible)=>[...items].sort((a,b)=>{
    const distance=(c:ObservedOptionContract)=>Math.abs(descriptors.get(c)!.days-tenor)/Math.max(1,tenor)+descriptors.get(c)!.spread;
    return distance(a)-distance(b)||Math.abs(descriptors.get(a)!.strike-research.market.spot.value!)-Math.abs(descriptors.get(b)!.strike-research.market.spot.value!)||a.symbol.localeCompare(b.symbol);
  });
  const initialSymbols=new Set(initial.resolved.analysis.legs.map(leg=>leg.contract.symbol));
  const pool=new Set(eligible.filter(c=>initialSymbols.has(c.symbol)));
  const short=near(days);
  if(strategy==='pmcc')for(const c of near(settings.longDays,eligible.filter(c=>c.type==='call'&&descriptors.get(c)!.days>days&&descriptors.get(c)!.strike<research.market.spot.value!)).slice(0,32))pool.add(c);
  for(const c of short){if(pool.size>=128)break;pool.add(c);}
  const contracts=[...pool];output.poolSize=contracts.length;output.bounded=contracts.length<eligible.length;
  const queue:Set<string>[]=[new Set()],visited=new Set<string>(),structures=new Set<string>();
  const scanner=settings.scanner??defaultScannerSettings;
  const candidates:ContractCandidate[]=[];
  while(queue.length&&output.checked<40&&candidates.length<24){
    const excluded=queue.shift()!,key=[...excluded].sort().join('|');if(visited.has(key))continue;visited.add(key);output.checked++;
    const subset={...snapshot,options:{...snapshot.options,contracts:contracts.filter(c=>!excluded.has(c.symbol))}};
    const analysis=analyzeStrategy(subset,strategy,days,policy);
    if(analysis.status!=='available')continue;
    // A branch removes an entire contract, so an atomic structure keeps ratios.
    for(const leg of analysis.legs)queue.push(new Set([...excluded,leg.contract.symbol]));
    const id=analysis.legs.map(leg=>`${leg.quantity}:${leg.contract.symbol}`).sort().join('|');if(structures.has(id))continue;structures.add(id);
    const selected={...snapshot,options:{...snapshot.options,contracts:analysis.legs.map(leg=>leg.contract)}};
    const outlook=strategyOutlook(selected,strategy,days,{...settings,modelMode:mode},initial.forecast);
    if(!outlook.resolved.scenario)continue;
    const evaluation=evaluateScanner(selected,strategy,days,scanner,policy,analysis);
    candidates.push({id,analysis,evaluation,profitability:outlook.profitability,horizonSessions:outlook.horizonSessions,executionReady:outlook.executionReady});
  }
  output.bounded ||= queue.length>0;
  const numberOrder=(a:number|null,b:number|null)=>a===null?b===null?0:1:b===null?-1:b-a;
  candidates.sort((a,b)=>{
    const score=numberOrder(a.evaluation.score,b.evaluation.score),profit=numberOrder(a.profitability.returnOnCapital,b.profitability.returnOnCapital);
    const capital=numberOrder(b.analysis.capitalRequired,a.analysis.capitalRequired);
    const primary=input.order==='pnl'?profit||score:input.order==='capital'?capital||score:score||profit;
    return primary||(a.analysis.spreadCost??Infinity)-(b.analysis.spreadCost??Infinity)||a.id.localeCompare(b.id);
  });
  const filtered=candidates.filter(c=>c.evaluation.score!==null&&c.evaluation.score>=scanner.scan.minConfluence);
  const limit=Number.isInteger(input.limit)&&input.limit!>=1&&input.limit!<=10?input.limit!:5;
  output.candidates=filtered.slice(0,limit);
  if(!output.candidates.length)output.missing=[candidates.length?`Ninguna combinación alcanza la confluencia mínima de ${scanner.scan.minConfluence}% con cores evaluables.`:'No se pudieron valorar combinaciones alternativas compatibles.'];
  return output;
}
