import { selectObservedOption } from '../../cores/evaluacion/observed-ranking.ts';
import { estimatedSnapshot } from '../../cores/evaluacion/estimated-snapshot.ts';
import { equityTerms,modelDividendYield } from '../research/contract-terms.ts';
import { analysisPolicy,type AnalysisSettings } from '../research/analysis-settings.ts';
import { missingVariable,type CompanyResearch,type ObservedOptionContract,type ResearchVariable } from '../../cores/compartido/research-model.ts';
import type { StrategyId } from '../../cores/compartido/types.ts';
export type OrderContext={mode:'observed'|'estimated';asOf:string|null;spot:ResearchVariable;volatility:ResearchVariable;rate:ResearchVariable;dividendYield:ResearchVariable;contract:ObservedOptionContract|null;multiplier:number;shares:number;warnings:string[];dividendModel?:'continuous'|'declared-cash';cashDividends?:CompanyResearch['cashDividends']};
export function orderContext(research:CompanyResearch|null,strategy:StrategyId,days:number,settings:AnalysisSettings):OrderContext {
  const missing=()=>missingVariable('Investigación de la empresa','Sin entrada verificable; no se sustituye por datos demo.');
  if(!research)return {mode:settings.modelMode??'observed',asOf:null,spot:missing(),volatility:missing(),rate:missing(),dividendYield:missing(),contract:null,multiplier:100,shares:100,warnings:['Sin investigación disponible. El registro será una simulación manual, sin valoración BSM verificable.']};
  const policy=analysisPolicy(settings,research),snapshot=estimatedSnapshot(research,{...policy,estimateDays:days});
  const contract=selectObservedOption(snapshot,strategy,Math.max(1,days),{...policy,modelMode:'observed'}),terms=contract?equityTerms(contract,snapshot.asOf):null;
  return {mode:settings.modelMode??'observed',asOf:snapshot.asOf,spot:snapshot.market.spot,volatility:contract?.impliedVolatility??missing(),rate:policy.riskFreeRate??snapshot.macro.riskFreeRate,
    dividendYield:modelDividendYield(snapshot,policy),contract:terms?contract:null,multiplier:terms?.multiplier??100,shares:terms?.shares??100,dividendModel:policy.dividendModel,cashDividends:snapshot.cashDividends,
    warnings:[terms?'Las condiciones proceden del contrato indicado; strike, tipo, vencimiento y prima siguen siendo editables para simular.':'Sin contrato transferible: se registra un contrato hipotético estándar de 100 acciones.',
      'Las entradas con fuente externa y los supuestos conservan su procedencia. Este formulario no envía órdenes al bróker.']};
}
