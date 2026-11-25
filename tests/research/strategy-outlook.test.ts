import test from 'node:test';
import assert from 'node:assert/strict';
import {strategyOutlook,strategyPnlAtSpot,strategyRecommendation} from '../../src/cores/evaluacion/strategy-outlook.ts';
import {historicalState,historicalExercise} from '../../src/cores/evaluacion/historical-exercise.ts';
import {researchFixture} from './research-fixture.ts';
import {defaultAnalysisSettings} from '../../src/features/research/analysis-settings.ts';
import {defaultScannerSettings} from '../../src/cores/evaluacion/scanner-settings.ts';
import {evaluateScanner} from '../../src/cores/evaluacion/scanner.ts';
import {missingVariable} from '../../src/cores/compartido/research-model.ts';
import type {Candle} from '../../src/features/market/chart-history.ts';

function bars():Candle[]{
  const rows:Candle[]=[];
  for(let time=Date.parse('2022-01-03T15:00:00Z');time<Date.parse('2026-11-18');time+=86400000){
    if([0,6].includes(new Date(time).getUTCDay()))continue;
    const close=100+3*Math.sin(rows.length/8)+Math.sin(rows.length/25);
    rows.push({time,open:close,high:close+1,low:close-1,close,volume:100000});
  }
  return rows;
}
test('profitability uses resolved comparable returns, preserves the source and discloses validation separately from Q PoP',()=>{
  const s=researchFixture();s.market.bars=bars();const original=structuredClone(s);
  const outlook=strategyOutlook(s,'wheel',30,defaultAnalysisSettings);
  assert.ok(outlook.resolved.scenario);assert.equal(outlook.horizonSessions,20);assert.ok(outlook.profitability.expectedPnl!==null);
  const f=outlook.forecast!;assert.ok(f.comparables!.length>=8);assert.ok(Math.abs(f.comparables!.reduce((sum,row)=>sum+row.weight,0)-1)<1e-12);
  assert.ok(f.comparables!.every(row=>Date.parse(row.outcomeAt)<=Date.parse(s.asOf)));
  const expected=f.comparables!.reduce((sum,row)=>sum+row.weight*strategyPnlAtSpot(outlook.resolved.scenario!.basis,f.lastClose!*(1+row.return),20*365/252),0);
  assert.ok(Math.abs(outlook.profitability.expectedPnl!-expected)<1e-9);assert.deepEqual(s,original);
  const altered=structuredClone(s);altered.market.bars.push({time:Date.parse('2026-12-01'),open:1e6,high:1e6+1,low:1e6-1,close:1e6,volume:100000});
  assert.deepEqual(strategyOutlook(altered,'wheel',30,defaultAnalysisSettings).profitability,outlook.profitability);
});
test('conditional PnL preserves signed ratios, adjusted units, fees and remaining LEAPS value',()=>{
  const o=strategyOutlook(researchFixture(),'pmcc',30,{...defaultAnalysisSettings,capital:100000,pmccMinLongDelta:.5});
  const b=o.resolved.scenario!.basis,pnl=strategyPnlAtSpot(b,100,b.days);
  assert.ok(Number.isFinite(pnl));assert.ok(b.legs.some(leg=>leg.daysToExpiry!>b.days));
  const free={...b,feePerContract:0};assert.ok(strategyPnlAtSpot(free,100,b.days)>pnl);
  const inverse={...free,legs:free.legs.map(leg=>({...leg,quantity:-leg.quantity}))};assert.ok(Math.abs(strategyPnlAtSpot(inverse,100,b.days)+strategyPnlAtSpot(free,100,b.days))<1e-8);
  assert.throws(()=>strategyPnlAtSpot(b,100,b.days+1));assert.throws(()=>strategyPnlAtSpot(b,NaN,1));
});
test('recommendation changes with core evidence and a negative expected outcome, and estimated inputs stay exploratory',()=>{
  const s=researchFixture();for(const c of s.options.contracts){c.bid=missingVariable('Provider','missing');c.ask=missingVariable('Provider','missing');c.premium=missingVariable('Provider','missing');c.impliedVolatility=missingVariable('Provider','missing');}
  const o=strategyOutlook(s,'wheel',30,defaultAnalysisSettings),e=evaluateScanner(s,'wheel',30,defaultScannerSettings);
  assert.equal(o.resolved.scenario?.dataMode,'estimated');assert.equal(strategyRecommendation(o,{...e,score:80},60).action,'explore');
  assert.equal(strategyRecommendation(o,{...e,score:40},60).action,'wait');
  assert.equal(strategyRecommendation({...o,profitability:{status:'experimental',reason:'QA',expectedPnl:-1,returnOnCapital:0,p10:-2,p90:1,positiveFraction:0}},{...e,score:80},60).action,'wait');
  assert.equal(strategyOutlook(researchFixture(),'gamma',30,defaultAnalysisSettings).profitability.status,'unavailable');
});
test('historical state is invariant to hidden future, and an exercise values only later closes within its horizon',()=>{
  const history=bars(),asOf='2025-06-03T06:00:00Z';
  const state=historicalState('XYZ',history,asOf),past=history.filter(row=>row.time<Date.parse('2025-06-03'));
  const pastState=historicalState('XYZ',past,asOf);assert.deepEqual(pastState.analysis,state.analysis);assert.deepEqual({...pastState.market,warnings:[]},{...state.market,warnings:[]});
  const input={strategy:'wheel' as const,spot:100,volatility:.25,rate:.04,dividendYield:0,days:30,longDays:365,shortStrike:95,longStrike:80,feePerContract:.65,capital:20000,asOf,futureBars:history};
  const exercise=historicalExercise(input);assert.ok(exercise.points.length>10);assert.ok(exercise.points.every(row=>row.days>0&&row.days<=30));assert.deepEqual(historicalExercise({...input,futureBars:[]}).points,[]);
  assert.throws(()=>historicalExercise({...input,capital:100}),/capital disponible/);
  assert.throws(()=>historicalExercise({...input,strategy:'backspread'}),/strike largo/);
  const diagonal=historicalExercise({...input,strategy:'pmcc',shortStrike:105,capital:50000});assert.ok(diagonal.basis.legs.some(leg=>leg.daysToExpiry!>diagonal.basis.days));
});
