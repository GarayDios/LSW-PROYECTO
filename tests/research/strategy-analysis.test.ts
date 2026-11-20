import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStrategy, selectStrategyLegs } from '../../src/cores/evaluacion/strategy-analysis.ts';
import { rankObservedCompanies } from '../../src/cores/evaluacion/observed-ranking.ts';
import { missingFundamentals } from '../../src/api/research/sec.ts';
import { missingMacro } from '../../src/api/research/fred.ts';
import { missingNews, missingOptions } from '../../src/api/research/alpaca.ts';
import { deriveObservedMarket } from '../../src/cores/01-analisis-tecnico/market-analysis.ts';
import { analysisPolicy, defaultAnalysisSettings } from '../../src/features/research/analysis-settings.ts';
import type { CompanyResearch, ObservedOptionContract, ResearchVariable } from '../../src/cores/compartido/research-model.ts';
import { easternTime, equityTerms, valuationExpiry } from '../../src/features/research/contract-terms.ts';
import { evaluationTuningSchema } from '../../src/cores/evaluacion/evaluation-policy.ts';
const asOf='2026-11-17T16:00:00Z';
const v=(value:number):ResearchVariable=>({value,source:'fixture',observedAt:asOf,availableAt:asOf,kind:'observed'});
function option(type:'call'|'put',strike:number,bid:number,ask:number,expiration='2026-12-18'):ObservedOptionContract {
  return {symbol:`XYZ-${expiration}-${type}-${strike}`,underlyingSymbol:'XYZ',multiplier:v(100),deliverableShares:v(100),deliverableType:'single_equity',type,strike:v(strike),expiration,style:'european',bid:v(bid),ask:v(ask),premium:v((bid+ask)/2),impliedVolatility:v(.3),delta:v(.5),gamma:v(.02),theta:v(-.04),vega:v(.1),openInterest:v(1000)};
}
function snapshot(contracts:ObservedOptionContract[]):CompanyResearch {
  const market=deriveObservedMarket('XYZ',[],asOf);market.spot=v(100);market.stale=false;
  market.historicalVolatility=v(.25);market.momentum20=v(.03);market.momentum60=v(.1);market.averageDollarVolume20=v(1e8);market.maxDrawdown=v(.2);market.downsideVolatility=v(.2);
  return {symbol:'XYZ',asOf,generatedAt:asOf,market,options:{...missingOptions(),contracts,complete:true,feed:'opra'},fundamentals:{...missingFundamentals(),dividendYield:v(0)},macro:{...missingMacro(),riskFreeRate:v(.04)},news:missingNews(),quality:{historicalOnly:false,missing:[],stale:[],sources:[]},warnings:[]};
}
test('Wheel reserves full cash, receives bid less fees and has exact put payoff and breakeven',()=>{
  const s=snapshot([option('put',95,2,2.2)]),a=analyzeStrategy(s,'wheel',30,{capital:10000,feePerContract:1});
  assert.equal(a.status,'available');assert.equal(a.entryDebit,-199);assert.equal(a.capitalRequired,9501);
  assert.equal(a.maxLoss,9301);assert.equal(a.maxGain,199);assert.deepEqual(a.breakevens,[93.01]);
  assert.ok(a.probability!>0&&a.probability!<1);assert.equal(a.scenarios.find(x=>x.change===0)!.pnl,199);
  assert.equal(analyzeStrategy(s,'wheel',30,{capital:9000}).status,'unavailable');
});
test('Backspread evaluates -1 lower +2 upper, including valley loss and both roots',()=>{
  const s=snapshot([option('call',95,8,9),option('call',105,2,3)]),a=analyzeStrategy(s,'backspread',30);
  assert.equal(a.status,'available');assert.deepEqual(a.legs.map(l=>l.quantity),[-1,2]);
  assert.equal(a.entryDebit,-200);assert.equal(a.maxLoss,800);assert.equal(a.maxGain,null);
  assert.deepEqual(a.breakevens,[97,113]);assert.equal(a.capitalRequired,800);
  const expensive=analyzeStrategy(s,'backspread',30,{feePerContract:10});
  assert.ok(expensive.probability!<a.probability!);assert.ok(Math.abs(expensive.maxLoss!-830)<1e-8);
});
test('PMCC needs two different expiries and never publishes a single-leg probability as strategy probability',()=>{
  const s=snapshot([option('call',80,23,24,'2027-12-17'),option('call',105,2,3)]),a=analyzeStrategy(s,'pmcc',30);
  assert.equal(a.status,'available');assert.equal(a.legs.length,2);assert.equal(a.entryDebit,2200);
  assert.equal(a.probability,null);assert.equal(a.maxLoss,null);assert.match(a.probabilityMethod,/vencimientos distintos/);
  assert.equal(rankObservedCompanies([s],['probability'],'pmcc',30)[0].score,null);
  assert.equal(analyzeStrategy(snapshot([s.options.contracts[0]]),'pmcc',30).status,'unavailable');
});
test('Gamma requires matched call and put; static straddle is never labeled as hedged probability',()=>{
  const s=snapshot([option('call',100,3,4),option('put',100,3,4)]),a=analyzeStrategy(s,'gamma',30);
  assert.equal(a.legs.length,2);assert.equal(a.maxLoss,800);assert.deepEqual(a.breakevens,[92,108]);
  assert.equal(a.probability,null);assert.match(a.probabilityMethod,/trayectorias/);
  assert.equal(selectStrategyLegs(snapshot([option('call',100,3,4),option('put',105,3,4)]),'gamma',30).length,0);
});
test('missing q stays missing; per-company explicit assumptions preserve provenance and never mutate snapshot',()=>{
  const s=snapshot([option('put',95,2,2.2)]);s.fundamentals=missingFundamentals();
  assert.equal(analyzeStrategy(s,'wheel',30).status,'unavailable');
  const settings={...defaultAnalysisSettings,dividendPercentBySymbol:{XYZ:0}};
  const policy=analysisPolicy(settings,s);assert.equal(policy.dividendYield?.kind,'assumed');
  assert.equal(analyzeStrategy(s,'wheel',30,policy).status,'available');assert.equal(s.fundamentals.dividendYield.value,null);
  assert.equal(analysisPolicy(settings,{...s,symbol:'OTHER'}).dividendYield,undefined);
});
test('future, stale or crossed quotes and spread limits prevent artificial multi-leg calculations',()=>{
  const c=option('put',95,2,2.2),s=snapshot([c]);
  assert.equal(analyzeStrategy(s,'wheel',30,{maxSpreadPercent:1}).status,'unavailable');
  c.bid=v(3);assert.equal(analyzeStrategy(s,'wheel',30).status,'unavailable');c.bid=v(2);
  c.premium.availableAt='2027-01-01T00:00:00Z';assert.equal(analyzeStrategy(s,'wheel',30).status,'unavailable');
  c.premium=v(2.1);c.premium.observedAt='2026-11-16T16:00:00Z';assert.equal(analyzeStrategy(s,'wheel',30).status,'unavailable');
});
test('option liquidity uses the worst leg spread, not the underlying stock volume',()=>{
  const s=snapshot([option('call',95,8,9),option('call',105,2,3)]);
  const a=rankObservedCompanies([s],['liquidity'],'backspread',30)[0];
  assert.equal(a.score,60);s.market.averageDollarVolume20=v(1);
  assert.equal(rankObservedCompanies([s],['liquidity'],'backspread',30)[0].score,60);
});

test('verified multiplier scales capital and payoff; adjusted single equity delivery changes effective strike',()=>{
  const c=option('put',95,2,2.2);c.multiplier=v(10);c.deliverableShares=v(10);
  const s=snapshot([c]),a=analyzeStrategy(s,'wheel',30,{feePerContract:1,capital:1000});
  assert.equal(a.entryDebit,-19);assert.equal(a.capitalRequired,951);assert.equal(a.maxLoss,931);assert.equal(a.maxGain,19);
  c.deliverableShares=v(15);
  const adjusted=analyzeStrategy(s,'wheel',30,{feePerContract:1,capital:1000});
  assert.equal(adjusted.maxLoss,931);
  assert.ok(Math.abs(adjusted.breakevens[0]-931/15)<1e-8);
  assert.equal(equityTerms(c,asOf)?.effectiveStrike,950/15);
  c.deliverableType='unsupported';assert.equal(analyzeStrategy(s,'wheel',30).status,'unavailable');
  c.deliverableType='single_equity';delete c.multiplier;
  assert.equal(analyzeStrategy(s,'wheel',30).status,'unavailable');
});

test('different multipliers or delivered share counts cannot be combined as a fictitious 1:2 structure',()=>{
  const short=option('call',95,8,9),long=option('call',105,2,3);
  long.multiplier=v(10);long.deliverableShares=v(10);
  assert.equal(selectStrategyLegs(snapshot([short,long]),'backspread',30).length,0);
});

test('expiry uses DST and known calendar metadata, with an explicitly labeled fallback',()=>{
  assert.equal(easternTime('2026-07-17','16:00'),'2026-07-17T20:00:00.000Z');
  assert.equal(easternTime('2026-12-18','16:00'),'2026-12-18T21:00:00.000Z');
  assert.equal(easternTime('2026-02-30','16:00'),null);
  const c=option('call',100,3,4);c.valuationExpiry={at:'2026-12-18T18:00:00Z',availableAt:asOf,source:'calendar fixture'};
  assert.equal(valuationExpiry(c,asOf).time,Date.parse('2026-12-18T18:00:00Z'));
  c.valuationExpiry.availableAt='2027-01-01T00:00:00Z';
  assert.match(valuationExpiry(c,asOf).source,/Supuesto/);
  assert.equal(valuationExpiry(c,asOf).time,Date.parse('2026-12-18T21:00:00Z'));
});

test('tuning actually changes scenario grid and quote freshness, and invalid numerical budgets fail explicitly',()=>{
  const c=option('put',95,2,2.2),s=snapshot([c]);
  const a=analyzeStrategy(s,'wheel',30,{tuning:{scenarioChanges:[-.5,0,.5]}});
  assert.deepEqual(a.scenarios.map(v=>v.change),[-.5,0,.5]);
  c.premium.observedAt='2026-11-17T15:50:00Z';
  assert.equal(analyzeStrategy(s,'wheel',30).status,'available');
  assert.equal(analyzeStrategy(s,'wheel',30,{tuning:{quoteMaxAgeMinutes:5}}).status,'unavailable');
  assert.equal(analyzeStrategy(s,'wheel',30,{tuning:{binomialSteps:1000000}}).status,'unavailable');
  for(const input of [{quoteMaxAgeMinutes:61},{scenarioChanges:[-1,0]},{scenarioChanges:[0,0]},{tenorWeight:0,spreadWeight:0},{riskDrawdownWeight:2}])
    assert.equal(evaluationTuningSchema.safeParse(input).success,false);
});

test('ranking normalizes positive selected weights and never averages away a missing weighted core',()=>{
  const s=snapshot([option('put',95,2,2.2)]);
  const a=rankObservedCompanies([s],['trend','risk'],'wheel',30,{tuning:{coreWeights:{trend:3,risk:1}}})[0];
  const trend=a.coreResults.find(c=>c.core==='trend')!.score!,risk=a.coreResults.find(c=>c.core==='risk')!.score!;
  assert.equal(a.score,Math.round((3*trend+risk)/4));
  const b=rankObservedCompanies([s],['trend','risk'],'wheel',30,{tuning:{trendBase:0,trend20Coefficient:0,trend60Coefficient:0,coreWeights:{risk:0}}})[0];
  assert.equal(b.score,0);assert.equal(b.availableCoreCount,1);
  s.options.contracts=[];
  assert.equal(rankObservedCompanies([s],['trend','probability'],'wheel',30,{tuning:{coreWeights:{trend:100,probability:1}}})[0].score,null);
  assert.throws(()=>rankObservedCompanies([s],['trend'],'wheel',30,{tuning:{coreWeights:{trend:0}}}),/peso positivo/);
});

test('tree steps and selection weights affect their intended calculations without changing payoff extrema',()=>{
  const c=option('put',95,2,2.2);c.style='american';
  const s=snapshot([c]);
  const coarse=analyzeStrategy(s,'wheel',30,{tuning:{binomialSteps:20}});
  const fine=analyzeStrategy(s,'wheel',30,{tuning:{binomialSteps:200}});
  assert.equal(coarse.status,'available');assert.equal(fine.status,'available');
  assert.ok(Math.abs(coarse.theoreticalDebit!-fine.theoreticalDebit!)>1e-8);
  assert.equal(coarse.maxLoss,fine.maxLoss);
  const nearer=option('put',95,1.99,2.01),tighter=option('put',95,2,2,'2026-11-27');
  const chain=snapshot([nearer,tighter]);
  assert.equal(selectStrategyLegs(chain,'wheel',30,{tuning:{tenorWeight:10,spreadWeight:0}})[0].contract.symbol,nearer.symbol);
  assert.equal(selectStrategyLegs(chain,'wheel',30,{tuning:{tenorWeight:0,spreadWeight:10}})[0].contract.symbol,tighter.symbol);
  chain.market.maxDrawdown=v(.8);chain.market.downsideVolatility=v(.1);
  const drawdown=rankObservedCompanies([chain],['risk'],'wheel',30,{tuning:{riskDrawdownWeight:1}})[0].score;
  const downside=rankObservedCompanies([chain],['risk'],'wheel',30,{tuning:{riskDrawdownWeight:0}})[0].score;
  assert.ok(drawdown!<downside!);
});
