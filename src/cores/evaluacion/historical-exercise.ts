import { deriveObservedMarket } from '../01-analisis-tecnico/market-analysis.ts';
import { analyzeHistory,type StockRule } from '../05-indicadores-y-senales/signals.ts';
import {calculateTechnicalIndicators} from '../01-analisis-tecnico/indicators.ts';
import {analyzeSupportResistance} from '../01-analisis-tecnico/support-resistance.ts';
import { blackScholes } from '../nucleo-cuantitativo/bsm.ts';
import { strategyPnlAtSpot } from './strategy-outlook.ts';
import type { MonteCarloBasis } from './monte-carlo-scenario.ts';
import type { StrategyId } from '../compartido/types.ts';
import type { Candle } from '../../features/market/chart-history.ts';

/** State at a decision cutoff. Later candles never enter the technical state. */
export function historicalState(symbol:string,bars:readonly Candle[],asOf:string,rule:StockRule='sma-rsi'){
  const market=deriveObservedMarket(symbol,bars,asOf);
  const analysis=market.bars.length>=50?analyzeHistory(market.bars,{rule}):null;
  const indicators=analysis?.indicators??calculateTechnicalIndicators(market.bars);
  const structure=analysis?.structure??analyzeSupportResistance(market.bars);
  const bar=market.bars.at(-1)??null,previous=market.bars.at(-2)??null;
  return {market,analysis,indicators,bar,previous,indicator:indicators.at(-1)??null,structure:structure.points.at(-1)??null,events:analysis?.technicalEvents.filter(event=>event.time===bar?.time)??[]};
}

/** Close availability is identical for chart inspection, research and P/L. */
export const historicalCloseAvailableAt=(time:number)=>Date.parse(new Date(time).toISOString().slice(0,10))+86400000+6*3600000;

/** A theoretical liquidation at the selected point, including funded entry and
 * both entry/exit fees. Quantities and LEAPS maturities remain fixed at entry. */
export function historicalPositionMark(basis:MonteCarloBasis,spot:number,elapsedDays:number){
  const pnl=strategyPnlAtSpot(basis,spot,elapsedDays);
  const legs=basis.legs.map(leg=>{
    const remainingDays=Math.max(0,(leg.daysToExpiry??basis.days)-elapsedDays);
    const model=blackScholes({spot,strike:leg.strike,days:remainingDays,volatility:leg.volatility??basis.volatility,rate:basis.rate,dividendYield:basis.dividendYield,type:leg.type});
    const signedUnits=leg.quantity*leg.units,fee=Math.abs(leg.quantity)*basis.feePerContract;
    return {...leg,remainingDays,mark:model.price,value:signedUnits*model.price,pnl:signedUnits*model.price-(signedUnits*leg.premium+fee)*Math.exp(basis.rate*elapsedDays/365)-fee,
      delta:signedUnits*model.delta,gamma:signedUnits*model.gamma,theta:signedUnits*model.theta,vega:signedUnits*model.vega};
  });
  return {spot,elapsedDays,pnl,daysRemaining:Math.max(0,basis.days-elapsedDays),value:legs.reduce((sum,l)=>sum+l.value,0),legs,
    delta:legs.reduce((sum,l)=>sum+l.delta,0),gamma:legs.reduce((sum,l)=>sum+l.gamma,0),theta:legs.reduce((sum,l)=>sum+l.theta,0),vega:legs.reduce((sum,l)=>sum+l.vega,0)};
}

/** User-defined theoretical exercise; no listed contract or past quote is claimed.
 * Future closes are supplied separately, only after revealing the outcome. */
export function historicalExercise(input:{strategy:StrategyId;spot:number;volatility:number;rate:number;dividendYield:number;days:number;longDays:number;shortStrike:number;longStrike:number;feePerContract:number;capital:number;asOf:string;futureBars:readonly Candle[];contracts?:number}){
  const {spot,volatility,rate,dividendYield,days,longDays,shortStrike,longStrike,feePerContract,capital}=input;
  if(![spot,volatility,rate,dividendYield,days,longDays,shortStrike,longStrike,feePerContract,capital].every(Number.isFinite)||spot<=0||volatility<=0||volatility>3||days<=0||days>3650||longDays<=0||longDays>3650||shortStrike<=0||longStrike<=0||feePerContract<0||capital<=0||rate<-.2||rate>1||dividendYield<0||dividendYield>1)throw new RangeError('Revisa las entradas del ejercicio.');
  if(input.strategy==='pmcc'&&(longDays<=days||longStrike>=shortStrike))throw new RangeError('PMCC requiere una call larga con menor strike y mayor vencimiento.');
  if(input.strategy==='backspread'&&longStrike<=shortStrike)throw new RangeError('Backspread requiere que el strike largo sea superior al corto.');
  const contracts=input.contracts??1;
  if(!Number.isInteger(contracts)||contracts<1||contracts>100)throw new RangeError('Usa entre 1 y 100 unidades de la estrategia.');
  if(!['wheel','pmcc','backspread','gamma'].includes(input.strategy))throw new RangeError('Estrategia no reconocida.');
  const leg=(type:'call'|'put',strike:number,quantity:number,maturity=days)=>({type,strike,quantity:quantity*contracts,units:100,premium:blackScholes({spot,strike,days:maturity,volatility,rate,dividendYield,type}).price,daysToExpiry:maturity,volatility});
  const legs=input.strategy==='wheel'?[leg('put',shortStrike,-1)]:input.strategy==='pmcc'?[leg('call',longStrike,1,longDays),leg('call',shortStrike,-1)]:input.strategy==='backspread'?[leg('call',shortStrike,-1),leg('call',longStrike,2)]:[leg('call',shortStrike,1),leg('put',shortStrike,1)];
  const debit=legs.reduce((sum,l)=>sum+l.quantity*l.units*l.premium+Math.abs(l.quantity)*feePerContract,0);
  const required=input.strategy==='wheel'?(shortStrike*100+feePerContract)*contracts:input.strategy==='pmcc'?Math.max(0,debit)+shortStrike*100*contracts:input.strategy==='backspread'?Math.max(0,(longStrike-shortStrike)*100*contracts+debit):Math.max(0,debit);
  if(required>capital)throw new RangeError(`El ejercicio requiere USD ${required.toFixed(2)}; capital disponible USD ${capital.toFixed(2)}.`);
  const basis:MonteCarloBasis={spot,volatility,rate,dividendYield,days,feePerContract,legs};
  const cutoff=Date.parse(input.asOf);
  if(!Number.isFinite(cutoff))throw new RangeError('Corte histórico inválido.');
  // Close availability follows the same conservative next-day rule as research.
  const points=[...input.futureBars].sort((a,b)=>a.time-b.time).flatMap(bar=>{
    const available=historicalCloseAvailableAt(bar.time);
    const elapsed=(available-cutoff)/86400000;
    return elapsed>0&&elapsed<=days&&bar.close>0&&Number.isFinite(bar.close)?[{time:bar.time,days:elapsed,spot:bar.close,pnl:strategyPnlAtSpot(basis,bar.close,elapsed)}]:[];
  });
  return {basis,required,debit,points,complete:points.length>0&&days-points.at(-1)!.days<4};
}
