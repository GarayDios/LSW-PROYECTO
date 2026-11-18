import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFredMacro, missingMacro } from '../../src/api/research/fred.ts';
import { analysisPolicy, defaultAnalysisSettings } from '../../src/features/research/analysis-settings.ts';
import { modelMacroContext } from '../../src/features/research/model-macro.ts';
import { observedOptionInputs, selectObservedOption, rankObservedCompanies } from '../../src/cores/observed-ranking.ts';
import { researchFixture, fixtureVariable } from './research-fixture.ts';

test('ALFRED rate reaches option inputs and ranked strategy valuation; manual override stays separate', async () => {
  const s = researchFixture();
  s.macro = await fetchFredMacro({apiKey:'test-only'},s.asOf,async input => {
    const id = new URL(String(input)).searchParams.get('series_id');
    return new Response(JSON.stringify({observations:id==='DGS3MO'?[{date:'2026-11-13',value:'4'}]:[]}),{headers:{'content-type':'application/json'}});
  });
  const policy = analysisPolicy(defaultAnalysisSettings,s);
  const macro = modelMacroContext(s,policy);
  const contract = selectObservedOption(s,'wheel',30,policy);
  const valuation = observedOptionInputs(s,contract,policy);
  assert.equal(macro.rateAvailable,true);
  assert.equal(macro.manualRate,false);
  assert.match(macro.rate.source,/FRED.*vintage/);
  assert.equal(valuation.input?.rate,Math.log1p(.04));
  const rank = (p:typeof policy) => rankObservedCompanies([s],['bsm','greeks','probability'],'wheel',30,p)[0];
  const automatic = rank(policy);
  assert.equal(automatic.strategyAnalysis.status,'available');
  const manualPolicy = analysisPolicy({...defaultAnalysisSettings,riskFreePercent:12},s);
  const manual = modelMacroContext(s,manualPolicy);
  assert.equal(manual.manualRate,true);
  assert.equal(manual.rate.kind,'assumed');
  assert.equal(manual.externalRate, s.macro.riskFreeRate);
  assert.equal(observedOptionInputs(s,contract,manualPolicy).input?.rate,.12);
  const changed = rank(manualPolicy);
  assert.notEqual(automatic.strategyAnalysis.theoreticalDebit,changed.strategyAnalysis.theoreticalDebit);
  assert.notEqual(automatic.strategyAnalysis.probability,changed.strategyAnalysis.probability);
  assert.equal(modelMacroContext(s,analysisPolicy(defaultAnalysisSettings,s)).rate,macro.rate);
});

test('missing or not-yet-known rate blocks valuation without a hidden zero-rate fallback', () => {
  const s = researchFixture();
  s.macro = missingMacro();
  for (const rate of [s.macro.riskFreeRate,{...fixtureVariable(.04),availableAt:'2026-11-18T16:00:00Z'}]) {
    s.macro.riskFreeRate=rate;
    assert.equal(modelMacroContext(s).rateAvailable,false);
    const result=observedOptionInputs(s,selectObservedOption(s,'wheel',30));
    assert.equal(result.input,null);
    assert.ok(result.missing.includes('riskFreeRate'));
    assert.equal(rankObservedCompanies([s],['bsm'],'wheel',30)[0].score,null);
  }
});

test('inflation and GDP are context and do not silently change investment scores', () => {
  const s=researchFixture();
  const rank=()=>rankObservedCompanies([s],['bsm','greeks','probability','trend','risk'],'wheel',30)[0];
  const before=rank();
  s.macro.inflationYearOverYear=fixtureVariable(.5);
  s.macro.realGdpGrowth=fixtureVariable(-.2);
  assert.deepEqual(rank(),before);
});
