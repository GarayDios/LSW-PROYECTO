import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStrategy } from '../../src/cores/strategy-analysis.ts';
import { estimatedSnapshot } from '../../src/cores/estimated-snapshot.ts';
import { rankObservedCompanies } from '../../src/cores/observed-ranking.ts';
import { simulateGammaPath } from '../../src/cores/gamma-path.ts';
import { validateOptionRanking } from '../../src/cores/option-validation.ts';
import { optionValidationExample } from '../../src/features/research/validation-example.ts';
import { cashDividendPv } from '../../src/features/research/contract-terms.ts';
import { orderContext } from '../../src/features/orders/order-context.ts';
import { defaultAnalysisSettings } from '../../src/features/research/analysis-settings.ts';
import { missingVariable } from '../../src/features/research/model.ts';
import { researchFixture,fixtureTime,fixtureVariable as v } from './research-fixture.ts';

test('estimated mode completes existing contracts transparently, preserves sources and neutralizes circular BSM comparisons',()=>{
  const s=researchFixture();s.options.contracts=s.options.contracts.filter(c=>c.type==='put'&&c.strike.value===95);
  for(const c of s.options.contracts){c.bid=missingVariable('provider','stale');c.ask=missingVariable('provider','stale');c.premium=missingVariable('provider','stale');c.impliedVolatility=missingVariable('provider','missing');}
  const original=structuredClone(s);
  const result=rankObservedCompanies([s],['bsm','greeks','probability'],'wheel',30,{modelMode:'estimated'})[0];
  assert.equal(result.availableCoreCount,3);assert.equal(result.coreResults[0].score,50);assert.match(result.reason,/ESTIMADO/);
  assert.equal(result.strategyAnalysis.legs[0].contract.impliedVolatility.kind,'assumed');
  assert.deepEqual(s,original);
  s.options.contracts=[];assert.equal(analyzeStrategy(s,'wheel',30,{modelMode:'estimated'}).status,'unavailable');
  s.macro.riskFreeRate=missingVariable('FRED','missing');assert.equal(estimatedSnapshot(s,{modelMode:'estimated'}).options.contracts.length,0);
});

test('estimated reconstruction bounds expensive trees and reports a partial candidate universe',()=>{
  const s=researchFixture(),base=s.options.contracts[0];
  s.options.contracts=Array.from({length:40},(_,i)=>({...base,symbol:'XYZ-put-'+i,strike:v(80+i),bid:missingVariable('provider','stale'),ask:missingVariable('provider','stale'),premium:missingVariable('provider','stale')}));
  const result=estimatedSnapshot(s,{modelMode:'estimated',estimatedCandidateLimit:10});
  assert.ok(result.options.contracts.filter(c=>c.bid.kind==='assumed').length<=10);assert.equal(result.options.complete,false);
  assert.match(result.warnings.join(' '),/Reconstrucción limitada/);
  assert.ok(s.options.contracts.every(c=>c.bid.kind==='missing'));
});

test('PMCC reserves assignment capital and reports financing and long-leg IV sensitivity',()=>{
  const s=researchFixture();
  const a=analyzeStrategy(s,'pmcc',30,{capital:20000,feePerContract:1,financingRate:.1,ivShock:.3,pmccMinLongDelta:.8});
  assert.equal(a.status,'available');assert.ok(a.assignmentReserve!>0);assert.ok(a.financingCost>0);
  assert.ok(a.capitalRequired!>a.entryDebit!);assert.equal(a.ivScenarios.length,15);
  const flat=a.ivScenarios.filter(x=>x.change===0);
  assert.ok(flat[0].pnl<flat[2].pnl);
  const debit=analyzeStrategy(s,'pmcc',30,{pmccCapitalMode:'debit-only'});
  assert.equal(debit.capitalRequired,debit.entryDebit);assert.match(debit.warnings.join(' '),/reserva no|no acredita/);
  assert.equal(analyzeStrategy(s,'pmcc',30,{capital:5000}).status,'unavailable');
});

test('quoted stock/option synchronization is enforced in minutes, not by a permissive daily-close gap',()=>{
  const s=researchFixture();s.market.spot.observedAt='2026-11-17T15:00:00Z';
  assert.equal(analyzeStrategy(s,'wheel',30).status,'unavailable');
  s.market.spotBasis='daily-close';assert.equal(analyzeStrategy(s,'wheel',30).status,'available');
});

test('declared dividends adjust prices without double-counting continuous yield or inventing a probability',()=>{
  const s=researchFixture();s.cashDividends={events:[{id:'d1',exDate:'2026-12-01',payableDate:'2026-12-05',amount:2,currency:'USD',availableAt:fixtureTime,source:'TEST declaration'}],complete:false,status:{source:'TEST',status:'partial',message:'partial'},warnings:[]};
  assert.ok(cashDividendPv(s,Date.parse('2026-12-18T21:00:00Z'),.04)>1.9);
  const continuous=analyzeStrategy(s,'wheel',30),discrete=analyzeStrategy(s,'wheel',30,{dividendModel:'declared-cash'});
  assert.equal(discrete.status,'available');assert.notEqual(discrete.theoreticalDebit,continuous.theoreticalDebit);assert.equal(discrete.probability,null);
  s.cashDividends.events[0].availableAt='2027-01-01T00:00:00Z';assert.equal(cashDividendPv(s,Date.parse('2026-12-18T21:00:00Z'),.04),0);
});

function path(){return {source:'TEST PATH, not historical evidence',kind:'scenario',points:[100,115,90,120,100].map((spot,i)=>({at:new Date(Date.parse(fixtureTime)+i*86400000).toISOString(),spot,bid:spot-.05,ask:spot+.05}))};}
test('Gamma rebalances delta with explicit short permission and reconciles costs and flat exit',()=>{
  const s=researchFixture(),policy={capital:20000,feePerContract:1};
  const result=simulateGammaPath(s,30,policy,path(),{allowShortStock:true,deltaTolerance:0});
  assert.ok(result.hedgeTrades>=2);assert.ok(result.spreadCost>0);assert.ok(result.stockFees>0);assert.ok(result.borrowCost>0);
  assert.equal(result.events.at(-1)!.shares,0);assert.equal(result.events.at(-1)!.deltaAfter,0);
  for(const e of result.events.slice(0,-1).filter(e=>e.trade!==0))assert.ok(Math.abs(e.deltaAfter)<=.5+1e-8);
  const baseline=simulateGammaPath(s,30,policy,path(),{deltaTolerance:1e5});assert.ok(Math.abs(baseline.pnl-baseline.unhedgedPnl)<1e-8);
  const expensive=simulateGammaPath(s,30,policy,path(),{allowShortStock:true,deltaTolerance:0,feePerShare:1});assert.ok(expensive.pnl<result.pnl);
  assert.throws(()=>simulateGammaPath(s,30,{capital:1},path()),/Faltan entradas|Capital/);
  const invalid=path();invalid.points[2].at=invalid.points[0].at;assert.throws(()=>simulateGammaPath(s,30,policy,invalid),/avanzar/);
});

test('historical replay is chronological, purges unknown outcomes, rejects assumed history and tags fixtures',()=>{
  const example=optionValidationExample();
  const report=validateOptionRanking(example,['trend','risk','liquidity'],'wheel',30,{feePerContract:1});
  assert.ok(report.folds.length>0);assert.ok(report.testedPeriods>0);assert.equal(report.sufficientSample,false);assert.equal(report.kind,'fixture');
  const delayed=structuredClone(example);for(const sample of delayed.samples)for(const quote of sample.exits)quote.availableAt='2099-01-01T00:00:00Z';
  assert.equal(validateOptionRanking(delayed,['trend'],'wheel',30).folds.length,0);
  const bad=structuredClone(example);bad.samples[0].snapshot.fundamentals.dividendYield.kind='assumed' as 'observed';
  assert.ok(validateOptionRanking(bad,['trend'],'wheel',30).excluded.some(x=>x.symbol===bad.samples[0].snapshot.symbol));
});

test('order context preserves missing real inputs instead of using demo IV or dividends',()=>{
  const s=researchFixture();for(const c of s.options.contracts)c.impliedVolatility=missingVariable('provider','missing');s.fundamentals.dividendYield=missingVariable('SEC','no forward yield');
  const result=orderContext(s,'wheel',30,defaultAnalysisSettings);assert.equal(result.volatility.value,null);assert.equal(result.dividendYield.value,null);
  const estimated=orderContext(s,'wheel',30,{...defaultAnalysisSettings,modelMode:'estimated',defaultDividendPercent:0});
  assert.equal(estimated.volatility.kind,'assumed');assert.equal(estimated.dividendYield.kind,'assumed');
});

test('historical stock screening remains usable with a capital policy while incomplete options cannot be called eligible',()=>{
  const s=researchFixture();s.options.contracts=[];s.macro.riskFreeRate=missingVariable('FRED','missing');
  const row=rankObservedCompanies([s],['trend','risk','volatility'],'wheel',30,{capital:20000})[0];
  assert.notEqual(row.score,null);assert.equal(row.strategyAnalysis.status,'unavailable');
  assert.match(row.reason,/PERFIL HISTÓRICO/);
  assert.equal(rankObservedCompanies([s],['trend','bsm'],'wheel',30,{capital:20000})[0].score,null);
});
