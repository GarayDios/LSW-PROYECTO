import { z } from 'zod';
import { CORE_IDS,type CoreId,type StrategyId } from '../compartido/types.ts';
import { rankObservedCompanies } from './observed-ranking.ts';
import { evaluationTuning,coreWeight } from './evaluation-policy.ts';
import { knownBy,type CompanyResearch } from '../compartido/research-model.ts';
import { wilsonInterval } from '../05-indicadores-y-senales/validation.ts';
import type { AnalysisPolicy } from './strategy-analysis.ts';
import { valuationExpiry } from '../../features/research/contract-terms.ts';

const time=z.string().datetime({offset:true});
const variable=z.object({value:z.number().finite().nullable(),source:z.string().min(1).max(1000),observedAt:time.nullable(),availableAt:time.nullable(),kind:z.enum(['observed','estimated','missing','assumed'])}).passthrough();
const contract=z.object({symbol:z.string().min(1).max(80),underlyingSymbol:z.string().max(16),type:z.enum(['call','put']),expiration:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),style:z.enum(['american','european','unknown']),
  strike:variable,bid:variable,ask:variable,premium:variable,impliedVolatility:variable,openInterest:variable,delta:variable,gamma:variable,theta:variable,vega:variable,
  multiplier:variable,deliverableShares:variable,deliverableType:z.enum(['single_equity','unsupported','unknown']),valuationExpiry:z.object({at:time,availableAt:time,source:z.string().max(1000)}).optional()}).passthrough();
const snapshot=z.object({symbol:z.string().min(1).max(16),asOf:time,generatedAt:time,
  market:z.object({spot:variable,historicalVolatility:variable,momentum20:variable,momentum60:variable,averageDollarVolume20:variable,maxDrawdown:variable,downsideVolatility:variable,stale:z.boolean(),bars:z.array(z.object({time:z.number().finite()} ).passthrough()).max(2000)}).passthrough(),
  options:z.object({contracts:z.array(contract).max(1500),feed:z.enum(['opra','indicative']).nullable()}).passthrough(),
  fundamentals:z.object({dividendYield:variable}).passthrough(),macro:z.object({riskFreeRate:variable}).passthrough(),
}).passthrough();
const exit=z.object({symbol:z.string().min(1).max(80),at:time,availableAt:time,bid:z.number().finite().nonnegative(),ask:z.number().finite().nonnegative()}).strict().refine(v=>v.ask>=v.bid&&Date.parse(v.availableAt)>=Date.parse(v.at));
export const optionDatasetSchema=z.object({version:z.literal(1),source:z.string().min(1).max(1000),kind:z.enum(['observed','fixture']),samples:z.array(z.object({snapshot,exits:z.array(exit).min(1).max(1500)}).strict()).min(1).max(300)}).strict();
type Sample=z.infer<typeof optionDatasetSchema>['samples'][number];
type Prepared={symbol:string;asOf:number;knownOutcomeAt:number;netReturn:number;cores:Partial<Record<CoreId,number>>};
export type OptionValidation={source:string;kind:'observed'|'fixture';strategy:StrategyId;folds:{trainBefore:string;testStart:string;testEnd:string;trainSamples:number;testPeriods:number;meanReturn:number|null;equalWeightReturn:number|null;weights:Partial<Record<CoreId,number>>}[];
  testedPeriods:number;meanReturn:number|null;winRate:number|null;winRateInterval95:{low:number;high:number}|null;sufficientSample:boolean;excluded:{symbol:string;asOf:string;reason:string}[];warnings:string[]};

function prepare(sample:Sample,cores:readonly CoreId[],strategy:StrategyId,days:number,policy:AnalysisPolicy):Prepared {
  const s=sample.snapshot as unknown as CompanyResearch,cutoff=Date.parse(s.asOf);
  if(s.options.feed!=='opra')throw new RangeError('Se requiere cadena OPRA observada, no indicative ni reconstrucción.');
  if(s.market.bars.some(b=>b.time>cutoff))throw new RangeError('La muestra contiene velas posteriores a su corte.');
  const ranked=rankObservedCompanies([s],cores,strategy,days,{...policy,modelMode:'observed',dividendYield:undefined,riskFreeRate:undefined})[0];
  const a=ranked.strategyAnalysis;
  if(ranked.score===null||a.status!=='available'||!a.capitalRequired||a.entryDebit===null)throw new RangeError('Cores, contratos o capital incompletos para reproducir la selección.');
  if(ranked.coreResults.some(c=>c.evidence.some(e=>e.variable?.kind==='assumed')))throw new RangeError('La muestra usa supuestos como entradas históricas.');
  if(!knownBy(s.fundamentals.dividendYield,s.asOf)||s.fundamentals.dividendYield.kind==='assumed'||!knownBy(s.macro.riskFreeRate,s.asOf)||s.macro.riskFreeRate.kind==='assumed')throw new RangeError('Tasa y dividendos deben ser datos documentados de la fecha, sin supuestos actuales.');
  const selected=a.legs.map(l=>{
    const values=sample.exits.filter(e=>e.symbol===l.contract.symbol);
    if(values.length!==1)throw new RangeError('Falta una salida única de cada pierna seleccionada.');
    return {leg:l,quote:values[0]};
  });
  const stamps=selected.map(v=>Date.parse(v.quote.at)),latest=Math.max(...stamps);
  if(Math.min(...stamps)<=cutoff||Math.max(...stamps)-Math.min(...stamps)>60000)throw new RangeError('Las salidas deben ser posteriores al corte y estar sincronizadas dentro de un minuto.');
  if(latest>Math.min(...a.legs.map(l=>valuationExpiry(l.contract,s.asOf).time)))throw new RangeError('No se aceptan cotizaciones de negociación posteriores al primer vencimiento.');
  // Do not pretend a stock path validates a dynamic hedge strategy.
  if(strategy==='gamma')throw new RangeError('Gamma necesita un registro de coberturas; la salida estática del straddle no valida scalping.');
  const fees=(policy.feePerContract??0)*a.legs.reduce((n,l)=>n+Math.abs(l.quantity),0);
  const close=selected.reduce((n,{leg,quote})=>n+leg.quantity*(leg.quantity>0?quote.bid:quote.ask)*a.contractMultiplier!,0)-fees;
  const financing=strategy==='pmcc'?Math.max(0,a.entryDebit)*(policy.financingRate??0)*(latest-cutoff)/(365*86400000):0;
  return {symbol:s.symbol,asOf:cutoff,knownOutcomeAt:Math.max(...selected.map(v=>Date.parse(v.quote.availableAt))),netReturn:(close-a.entryDebit-financing)/a.capitalRequired,
    cores:Object.fromEntries(ranked.coreResults.map(c=>[c.core,c.score!]))};
}

/** Chronological expanding folds. Training labels must have become available
 * before the first decision in each test fold. Candidate weights are predefined. */
export function validateOptionRanking(input:unknown,cores:readonly CoreId[],strategy:StrategyId,days:number,policy:AnalysisPolicy={}):OptionValidation {
  const dataset=optionDatasetSchema.parse(input),tuning=evaluationTuning(policy.tuning);
  const chosen=[...new Set(cores)].filter(c=>coreWeight(tuning,c)>0);
  if(!chosen.length)throw new RangeError('Selecciona cores con peso positivo.');
  const result:OptionValidation={source:dataset.source,kind:dataset.kind,strategy,folds:[],testedPeriods:0,meanReturn:null,winRate:null,winRateInterval95:null,sufficientSample:false,excluded:[],warnings:[
    'Validación por cotizaciones bid/ask importadas, no ejecuciones garantizadas. No modela asignación anticipada ni slippage adicional.',
    'Se comprueba la causalidad de fechas declaradas, no la autenticidad del proveedor ni la ausencia de sesgos en la construcción del universo.',
    'Candidatos de pesos predefinidos; cada selección usa solo entrenamiento con salidas ya conocidas. Ningún resultado garantiza rentabilidad futura.',
    'Los períodos pueden estar correlacionados o superponerse. El intervalo Wilson es descriptivo y no acredita independencia financiera.',
  ]};
  if(dataset.kind==='fixture')result.warnings.unshift('DATOS DE PRUEBA: este informe prueba el flujo, no valida inversiones reales.');
  const values:Prepared[]=[],identities=new Set<string>();
  for(const sample of dataset.samples){const key=sample.snapshot.symbol+'|'+sample.snapshot.asOf;
    try{if(identities.has(key))throw new RangeError('Empresa y corte duplicados.');identities.add(key);values.push(prepare(sample,chosen,strategy,days,policy));}
    catch(error){result.excluded.push({symbol:sample.snapshot.symbol,asOf:sample.snapshot.asOf,reason:error instanceof Error?error.message:'Muestra inválida.'});}}
  const periods=[...new Set(values.map(v=>v.asOf))].sort((a,b)=>a-b),first=Math.max(3,Math.floor(periods.length*.6));
  if(periods.length-first<2){result.warnings.push('Muestra insuficiente: se requieren al menos seis cortes con entrenamiento y prueba.');return result;}
  const equal=Object.fromEntries(chosen.map(c=>[c,1])) as Partial<Record<CoreId,number>>;
  const candidates=[Object.fromEntries(chosen.map(c=>[c,coreWeight(tuning,c)])),equal,...(['risk','liquidity','volatility'] as CoreId[]).filter(c=>chosen.includes(c)).map(favored=>Object.fromEntries(chosen.map(c=>[c,c===favored?3:1])))] as Partial<Record<CoreId,number>>[];
  const pick=(group:Prepared[],weights:Partial<Record<CoreId,number>>)=>[...group].sort((a,b)=>{
    const score=(x:Prepared)=>chosen.reduce((n,c)=>n+x.cores[c]!*(weights[c]??1),0)/chosen.reduce((n,c)=>n+(weights[c]??1),0);
    return score(b)-score(a)||a.symbol.localeCompare(b.symbol);
  })[0];
  const performance=(rows:Prepared[],weights:Partial<Record<CoreId,number>>)=>{
    const groups=new Map<number,Prepared[]>();for(const row of rows){const group=groups.get(row.asOf)??[];group.push(row);groups.set(row.asOf,group);}
    return [...groups.values()].filter(g=>g.length>=2).map(g=>pick(g,weights).netReturn);
  };
  const mean=(v:number[])=>v.length?v.reduce((n,x)=>n+x,0)/v.length:null;
  const allTest:number[]=[],step=Math.max(1,Math.ceil((periods.length-first)/3));
  for(let index=first;index<periods.length;index+=step){
    const cutoff=periods[index],end=periods[Math.min(periods.length-1,index+step-1)];
    const train=values.filter(v=>v.asOf<cutoff&&v.knownOutcomeAt<cutoff);
    if(!train.length){result.warnings.push('Se omitió un bloque: las salidas de entrenamiento aún no eran conocidas.');continue;}
    const ranked=candidates.map((weights,index)=>({weights,index,value:mean(performance(train,weights))??-Infinity})).sort((a,b)=>b.value-a.value||a.index-b.index);
    if(!Number.isFinite(ranked[0].value))continue;
    const weights=ranked[0].weights,test=values.filter(v=>v.asOf>=cutoff&&v.asOf<=end);
    const returns=performance(test,weights),baseline=performance(test,equal);allTest.push(...returns);
    result.folds.push({trainBefore:new Date(cutoff).toISOString(),testStart:new Date(cutoff).toISOString(),testEnd:new Date(end).toISOString(),trainSamples:train.length,testPeriods:returns.length,meanReturn:mean(returns),equalWeightReturn:mean(baseline),weights});
  }
  result.testedPeriods=allTest.length;result.meanReturn=mean(allTest);
  const wins=allTest.filter(v=>v>0).length;result.winRate=allTest.length?wins/allTest.length:null;result.winRateInterval95=wilsonInterval(wins,allTest.length);
  result.sufficientSample=dataset.kind==='observed'&&allTest.length>=30&&result.folds.length>=3&&new Set(values.map(v=>v.symbol)).size>=3;
  if(!result.sufficientSample)result.warnings.push('Evidencia insuficiente: hacen falta al menos 30 períodos de prueba, tres bloques, tres empresas y datos observados.');
  return result;
}
