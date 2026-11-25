import type { CompanyResearch } from '../compartido/research-model.ts';
import type { StrategyId } from '../compartido/types.ts';
import { forecastMarket, type MarketForecast } from '../02-inteligencia-artificial/forecast.ts';
import { strategyMonteCarloScenario, type MonteCarloBasis } from './monte-carlo-scenario.ts';
import { analysisPolicy, type AnalysisSettings } from '../../features/research/analysis-settings.ts';
import { blackScholes } from '../nucleo-cuantitativo/bsm.ts';
import type {ScannerEvaluation} from './scanner.ts';

/** A mark of the selected position, with entry/exit fees and funded cash.
 * This is a conditional European mark, never an observed historical fill. */
export function strategyPnlAtSpot(basis:MonteCarloBasis,spot:number,elapsedDays:number):number {
  if(!Number.isFinite(spot)||spot<=0||!Number.isFinite(elapsedDays)||elapsedDays<0||elapsedDays>basis.days)throw new RangeError('Horizonte o precio del escenario inválido.');
  const debit=basis.legs.reduce((sum,leg)=>sum+leg.quantity*leg.units*leg.premium+Math.abs(leg.quantity)*basis.feePerContract,0);
  const mark=basis.legs.reduce((sum,leg)=>sum+leg.quantity*leg.units*blackScholes({spot,strike:leg.strike,days:Math.max(0,(leg.daysToExpiry??basis.days)-elapsedDays),volatility:leg.volatility??basis.volatility,rate:basis.rate,dividendYield:basis.dividendYield,type:leg.type}).price,0);
  const exitFees=basis.legs.reduce((sum,leg)=>sum+Math.abs(leg.quantity)*basis.feePerContract,0);
  const result=mark-debit*Math.exp(basis.rate*elapsedDays/365)-exitFees;
  if(!Number.isFinite(result))throw new RangeError('Resultado fuera del rango numérico.');
  return result;
}

const forecasts=new WeakMap<CompanyResearch,Map<number,MarketForecast>>();
function forecastFor(snapshot:CompanyResearch,horizon:5|20|60){
  let cache=forecasts.get(snapshot);if(!cache){cache=new Map();forecasts.set(snapshot,cache);}
  let forecast=cache.get(horizon);
  if(!forecast){forecast=forecastMarket({symbol:snapshot.symbol,bars:snapshot.market.bars,asOf:snapshot.asOf,source:snapshot.market.historicalVolatility.source,horizonSessions:horizon,demo:snapshot.dataMode==='demo'});cache.set(horizon,forecast);}
  return forecast;
}

export function strategyOutlook(snapshot:CompanyResearch,strategy:StrategyId,days:number,settings:AnalysisSettings,referenceForecast?:MarketForecast|null){
  const resolved=strategyMonteCarloScenario(snapshot,strategy,days,analysisPolicy(settings,snapshot));
  const basis=resolved.scenario?.basis;
  const horizon=([60,20,5] as const).find(h=>h*365/252<=Math.min(days,basis?.days??days));
  const shared=referenceForecast&&referenceForecast.symbol===snapshot.symbol&&referenceForecast.asOf===snapshot.asOf&&referenceForecast.horizonSessions===horizon&&referenceForecast.lastClose===snapshot.market.bars.at(-1)?.close&&referenceForecast.lastCloseAt===new Date(snapshot.market.bars.at(-1)?.time??NaN).toISOString()?referenceForecast:null;
  const forecast=horizon?shared??forecastFor(snapshot,horizon):null;
  const unavailable={status:'unavailable' as const,reason:resolved.error??forecast?.reason??'El vencimiento es demasiado cercano para los horizontes de 5, 20 o 60 sesiones.',expectedPnl:null,returnOnCapital:null,p10:null,p90:null,positiveFraction:null};
  let profitability:typeof unavailable|{status:'experimental'|'validated';reason:string;expectedPnl:number;returnOnCapital:number|null;p10:number;p90:number;positiveFraction:number}=unavailable;
  if(basis&&forecast?.status==='available'&&forecast.comparables?.length&&horizon&&strategy!=='gamma'){
    const elapsed=horizon*365/252;
    const outcomes=forecast.comparables.map(row=>({...row,pnl:strategyPnlAtSpot(basis,forecast.lastClose!*(1+row.return),elapsed)})).sort((a,b)=>a.pnl-b.pnl);
    const percentile=(q:number)=>{let total=0;for(const row of outcomes){total+=row.weight;if(total>=q)return row.pnl;}return outcomes.at(-1)!.pnl;};
    const expectedPnl=outcomes.reduce((sum,row)=>sum+row.weight*row.pnl,0),capital=resolved.analysis?.capitalRequired;
    profitability={status:forecast.validation.passed?'validated':'experimental',reason:forecast.reason,expectedPnl,returnOnCapital:capital&&capital>0?expectedPnl/capital:null,p10:percentile(.1),p90:percentile(.9),positiveFraction:outcomes.reduce((sum,row)=>sum+(row.pnl>0?row.weight:0),0)};
  }else if(strategy==='gamma')profitability={...unavailable,reason:'Gamma Scalping necesita una trayectoria de coberturas y sus costes. La rentabilidad del straddle estático no acredita el resultado de esa gestión.'};
  const executionReady=!!basis&&resolved.scenario?.dataMode==='observed'&&resolved.analysis?.legs.every(leg=>leg.contract.bid.kind!=='assumed'&&leg.contract.ask.kind!=='assumed'&&leg.contract.premium.kind!=='assumed')===true&&snapshot.options.feed==='opra'&&snapshot.dataMode!=='demo'&&snapshot.dataMode!=='sandbox';
  return {strategy,resolved,forecast,horizonSessions:horizon??null,profitability,executionReady};
}
export type StrategyOutlook=ReturnType<typeof strategyOutlook>;

/** Review priority is an explicit heuristic over analysis, not a predicted win. */
export function strategyRecommendation(outlook:StrategyOutlook,evaluation:ScannerEvaluation|null,minimumScore=60){
  const reasons:string[]=[];
  if(!Number.isFinite(minimumScore)||minimumScore<0||minimumScore>100)return {action:'wait' as const,reasons:['El umbral de confluencia debe estar entre 0 y 100.']};
  if(!outlook.resolved.scenario)reasons.push(outlook.resolved.error??'No se pudo formar la estrategia.');
  if(evaluation?.score===null||!evaluation)reasons.push('No hay cores evaluables para respaldar la revisión.');
  else if(evaluation.score<minimumScore)reasons.push(`Confluencia ${evaluation.score.toFixed(1)}% inferior al umbral elegido de ${minimumScore}%.`);
  if(outlook.profitability.expectedPnl!==null&&outlook.profitability.expectedPnl<=0)reasons.push('El P/L medio de los comparables es negativo o nulo con los costes configurados.');
  if(reasons.length)return {action:'wait' as const,reasons};
  reasons.push(`La estructura de ${outlook.strategy} alcanza la confluencia requerida con los cores disponibles.`);
  if(outlook.profitability.status!=='validated')reasons.push(outlook.profitability.reason);
  if(!outlook.executionReady)reasons.push('Las entradas son exploratorias: se necesitan cotizaciones ejecutables para revisar una orden.');
  return {action:outlook.executionReady&&outlook.profitability.status==='validated'?'review' as const:'explore' as const,reasons};
}
