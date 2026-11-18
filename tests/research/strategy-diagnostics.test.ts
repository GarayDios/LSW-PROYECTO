import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStrategy } from '../../src/cores/strategy-analysis.ts';
import { inspectContracts } from '../../src/cores/strategy-eligibility.ts';
import { rankObservedCompanies, type ObservedRankedCompany } from '../../src/cores/observed-ranking.ts';
import { analysisPolicy, defaultAnalysisSettings } from '../../src/features/research/analysis-settings.ts';
import { missingVariable, type CompanyResearch } from '../../src/features/research/model.ts';
import { researchFixture, fixtureContract } from './research-fixture.ts';
import { createResearchHandlers } from '../../src/api/analysis/handlers.ts';

test('selection diagnoses missing quotes, IV, metadata, freshness and synchronization independently',()=>{
  const s=researchFixture();
  s.options.contracts=[fixtureContract('put',95)];
  const c=s.options.contracts[0];
  c.multiplier=missingVariable('provider','absent');
  c.impliedVolatility=missingVariable('provider','absent');
  c.bid=missingVariable('provider','absent');
  let a=analyzeStrategy(s,'wheel',30);
  assert.equal(a.diagnostics?.blocker,'quality');
  assert.deepEqual(new Set(a.diagnostics?.rejected.map(r=>r.code)),new Set(['terms','iv','quote']));
  s.options.contracts=[fixtureContract('put',95)];
  s.options.contracts[0].premium.observedAt='2026-11-17T12:00:00Z';
  a=analyzeStrategy(s,'wheel',30);
  assert.ok(a.diagnostics?.rejected.some(r=>r.code==='stale'));
  assert.ok(a.diagnostics?.rejected.some(r=>r.code==='synchronization'));
  assert.equal(inspectContracts(s).eligible.length,0);
});

test('capital blocker reports a funded example rather than pretending metadata is missing',()=>{
  const s=researchFixture();s.options.contracts=[fixtureContract('put',95)];
  const a=analyzeStrategy(s,'wheel',30,{capital:1000,feePerContract:.65});
  assert.equal(a.diagnostics?.blocker,'capital');
  assert.equal(a.diagnostics?.eligibleContracts,1);
  assert.equal(a.diagnostics?.exampleCapitalRequired,9500.65);
  assert.match(a.missing.join(' '),/Capital insuficiente/);
  assert.equal(analyzeStrategy(s,'wheel',30,{capital:9500.65,feePerContract:.65}).status,'available');
});

test('spread, missing chain and missing multi-leg structure are distinct blockers',()=>{
  const s=researchFixture();s.options.contracts=[fixtureContract('put',95,1,3)];
  assert.equal(analyzeStrategy(s,'wheel',30,{maxSpreadPercent:10}).diagnostics?.blocker,'spread');
  assert.equal(analyzeStrategy(s,'gamma',30).diagnostics?.blocker,'structure');
  s.options.contracts=[];
  assert.equal(analyzeStrategy(s,'wheel',30).diagnostics?.blocker,'contracts');
});

test('explicit estimated recovery completes ranking without modifying data or silently assuming dividends',()=>{
  const s=researchFixture();s.fundamentals.dividendYield=missingVariable('provider','absent');
  for(const c of s.options.contracts){c.impliedVolatility=missingVariable('provider','absent');c.bid=missingVariable('provider','absent');}
  const original=structuredClone(s);
  const rank=(settings:typeof defaultAnalysisSettings)=>rankObservedCompanies([s],['bsm','greeks','probability'],'wheel',30,analysisPolicy(settings,s))[0];
  assert.equal(rank(defaultAnalysisSettings).score,null);
  const incomplete=rank({...defaultAnalysisSettings,modelMode:'estimated'});
  assert.equal(incomplete.score,null);
  assert.doesNotMatch(incomplete.reason,/No se usa HV como IV/);
  const complete=rank({...defaultAnalysisSettings,modelMode:'estimated',defaultDividendPercent:1.5});
  assert.notEqual(complete.score,null);
  assert.equal(complete.strategyAnalysis.dataMode,'estimated');
  assert.deepEqual(s,original);
});

test('estimated mode never repairs unknown contract deliverables',()=>{
  const s=researchFixture();for(const c of s.options.contracts)c.deliverableType='unknown';
  const a=analyzeStrategy(s,'wheel',30,{modelMode:'estimated'});
  assert.equal(a.status,'unavailable');
  assert.equal(a.diagnostics?.rejected.find(r=>r.code==='terms')?.count,s.options.contracts.length);
});

test('ranking API returns diagnostics and honors explicit recovery settings from the interface',async()=>{
  const s=researchFixture();s.fundamentals.dividendYield=missingVariable('provider','absent');
  for(const c of s.options.contracts)c.impliedVolatility=missingVariable('provider','absent');
  const api=createResearchHandlers({environment:()=>({ALPACA_API_KEY:'fixture',ALPACA_SECRET_KEY:'fixture',BROKER_OWNER_USER_ID:'qa-owner'}),owner:async()=>({userId:'qa-owner'}),now:()=>Date.parse(s.asOf),
    history:async(_config,query)=>({...query,source:'alpaca',adjustment:'split',asOf:s.asOf,bars:[],feed:'iex',warnings:[],coverage:{firstBar:null,lastBar:null,requestedStart:query.start,requestedEnd:query.end}}),research:async()=>structuredClone(s)});
  const request=(analysis:typeof defaultAnalysisSettings)=>new Request('https://terminal.test/api/research/ranking',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://terminal.test'},body:JSON.stringify({symbols:['XYZ'],selectedCores:['bsm','greeks','probability'],strategy:'wheel',days:30,start:'2023-11-17',end:'2026-11-17',analysis})});
  const first=await api.ranking(request(defaultAnalysisSettings));
  assert.equal(first.status,200);
  const incomplete=await first.json() as {ranked:ObservedRankedCompany[]};
  assert.equal(incomplete.ranked[0].score,null);
  assert.equal(incomplete.ranked[0].strategyAnalysis.diagnostics?.blocker,'quality');
  const second=await api.ranking(request({...defaultAnalysisSettings,modelMode:'estimated',defaultDividendPercent:1.5}));
  assert.equal(second.status,200);
  const complete=await second.json() as {ranked:ObservedRankedCompany[];snapshots:Record<string,CompanyResearch>};
  assert.notEqual(complete.ranked[0].score,null);
  assert.equal(complete.snapshots.XYZ.fundamentals.dividendYield.value,null);
  assert.equal(complete.ranked[0].strategyAnalysis.dataMode,'estimated');
});
