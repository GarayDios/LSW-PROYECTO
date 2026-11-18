import { missingFundamentals } from '../../src/api/research/sec.ts';
import { missingMacro } from '../../src/api/research/fred.ts';
import { missingNews,missingOptions } from '../../src/api/research/alpaca.ts';
import { deriveObservedMarket } from '../../src/features/research/derive.ts';
import type { CompanyResearch,ObservedOptionContract,ResearchVariable } from '../../src/features/research/model.ts';
export const fixtureTime='2026-11-17T16:00:00.000Z';
export const fixtureVariable=(value:number):ResearchVariable=>({value,source:'TEST FIXTURE',observedAt:fixtureTime,availableAt:fixtureTime,kind:'observed'});
export function fixtureContract(type:'call'|'put',strike:number,bid=2,ask=2.2,expiration='2026-12-18'):ObservedOptionContract {
  const v=fixtureVariable;
  return {symbol:`XYZ-${type}-${strike}-${expiration}`,underlyingSymbol:'XYZ',type,strike:v(strike),expiration,style:'european',bid:v(bid),ask:v(ask),premium:v((bid+ask)/2),impliedVolatility:v(.3),multiplier:v(100),deliverableShares:v(100),deliverableType:'single_equity',openInterest:v(1000),delta:v(type==='call'?.8:-.25),gamma:v(.02),theta:v(-.03),vega:v(.1)};
}
export function researchFixture():CompanyResearch {
  const v=fixtureVariable,market=deriveObservedMarket('XYZ',[],fixtureTime);
  Object.assign(market,{spot:v(100),historicalVolatility:v(.25),momentum20:v(.03),momentum60:v(.1),averageDollarVolume20:v(1e8),maxDrawdown:v(.2),downsideVolatility:v(.1),stale:false,spotBasis:'quote'});
  return {symbol:'XYZ',asOf:fixtureTime,generatedAt:fixtureTime,market,options:{...missingOptions(),feed:'opra',complete:true,contracts:[fixtureContract('put',95),fixtureContract('call',95,8,8.2),fixtureContract('call',105,2,2.2),fixtureContract('call',100,3,3.2),fixtureContract('put',100,3,3.2),fixtureContract('call',80,23,24,'2027-12-17')]},fundamentals:{...missingFundamentals(),dividendYield:v(0)},macro:{...missingMacro(),riskFreeRate:v(.04)},news:missingNews(),quality:{historicalOnly:false,missing:[],stale:[],sources:[]},warnings:[]};
}
