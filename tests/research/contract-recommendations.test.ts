import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendContracts} from '../../src/cores/evaluacion/contract-recommendations.ts';
import {researchFixture} from './research-fixture.ts';
import {defaultAnalysisSettings} from '../../src/features/research/analysis-settings.ts';
import {defaultScannerSettings} from '../../src/cores/evaluacion/scanner-settings.ts';
import {missingVariable} from '../../src/cores/compartido/research-model.ts';
const settings={...defaultAnalysisSettings,pmccMinLongDelta:.5,scanner:{...defaultScannerSettings,monteCarlo:{...defaultScannerSettings.monteCarlo,paths:100}}};

test('recommender returns actual distinct contract combinations with the correct signed structure for all four strategies',()=>{
  for(const strategy of ['wheel','pmcc','backspread','gamma'] as const){
    const research=researchFixture(),before=structuredClone(research);
    const result=recommendContracts({research,strategy,days:30,settings,limit:10});
    assert.ok(result.candidates.length>1,`${strategy}: ${result.missing.join('; ')}`);
    assert.equal(new Set(result.candidates.map(row=>row.id)).size,result.candidates.length);
    for(const row of result.candidates){
      const legs=row.analysis.legs;assert.ok(legs.every(leg=>research.options.contracts.some(c=>c.symbol===leg.contract.symbol)));assert.equal(row.analysis.status,'available');assert.ok(row.analysis.capitalRequired!<=settings.capital);assert.ok(row.evaluation.monteCarloPop!==null);
      if(strategy==='wheel'){assert.deepEqual(legs.map(l=>l.quantity),[-1]);assert.equal(legs[0].contract.type,'put');}
      if(strategy==='pmcc'){assert.deepEqual(legs.map(l=>l.quantity),[1,-1]);assert.ok(legs[0].contract.expiration>legs[1].contract.expiration);assert.ok(legs[0].contract.strike.value!<legs[1].contract.strike.value!);}
      if(strategy==='backspread'){assert.deepEqual(legs.map(l=>l.quantity),[-1,2]);assert.ok(legs[0].contract.strike.value!<legs[1].contract.strike.value!);assert.equal(legs[0].contract.expiration,legs[1].contract.expiration);}
      if(strategy==='gamma'){assert.deepEqual(legs.map(l=>l.quantity),[1,1]);assert.notEqual(legs[0].contract.type,legs[1].contract.type);assert.equal(legs[0].contract.strike.value,legs[1].contract.strike.value);assert.equal(legs[0].contract.expiration,legs[1].contract.expiration);assert.equal(row.profitability.expectedPnl,null);}
    }
    assert.deepEqual(research,before);
  }
});
test('contract recommendations rank the per-combination core analysis, apply its threshold and remain reproducible',()=>{
  const input={research:researchFixture(),strategy:'wheel' as const,days:30,settings,limit:10};
  const result=recommendContracts(input);assert.deepEqual(recommendContracts(input),result);
  assert.ok(result.candidates.every((row,i)=>!i||row.evaluation.score!<=result.candidates[i-1].evaluation.score!));
  const threshold=recommendContracts({...input,settings:{...settings,scanner:{...settings.scanner,scan:{...settings.scanner.scan,minConfluence:100}}}});assert.equal(threshold.candidates.length,0);assert.match(threshold.missing[0],/100%/);
  const capital=recommendContracts({...input,order:'capital'});assert.ok(capital.candidates.every((row,i)=>!i||row.analysis.capitalRequired!>=capital.candidates[i-1].analysis.capitalRequired!));
  const onlyMonteCarlo={...settings.scanner,cores:Object.fromEntries(Object.entries(settings.scanner.cores).map(([id,entry])=>[id,{...entry,enabled:id==='monteCarlo'}])) as typeof settings.scanner.cores};
  const selected=recommendContracts({...input,settings:{...settings,scanner:onlyMonteCarlo}});for(const c of selected.candidates){assert.equal(c.evaluation.score,c.evaluation.monteCarloPop!*100);assert.deepEqual(c.evaluation.results.map(r=>r.core),['monteCarlo']);}
});
test('contract recommendations keep stale quotes, missing metadata, insufficient capital and missing macro distinct',()=>{
  const research=researchFixture();for(const c of research.options.contracts)for(const field of ['bid','ask','premium','impliedVolatility'] as const)c[field]=missingVariable('Provider','Stale quote');
  const input={research,strategy:'wheel' as const,days:30,settings};
  const estimated=recommendContracts(input);assert.ok(estimated.candidates.length);assert.equal(estimated.dataMode,'estimated');assert.ok(estimated.candidates.every(c=>!c.executionReady&&c.analysis.legs.every(leg=>leg.contract.bid.kind==='assumed')));
  const strict=recommendContracts({...input,settings:{...settings,scanner:{...settings.scanner,monteCarlo:{...settings.scanner.monteCarlo,dataMode:'observed'}}}});assert.equal(strict.candidates.length,0);
  assert.equal(recommendContracts({...input,settings:{...settings,capital:100}}).candidates.length,0);
  const noRate=structuredClone(research);noRate.macro.riskFreeRate=missingVariable('FRED','Missing');assert.equal(recommendContracts({...input,research:noRate}).candidates.length,0);
  const noTerms=structuredClone(research);for(const c of noTerms.options.contracts)c.deliverableShares=missingVariable('Provider','Unknown');assert.equal(recommendContracts({...input,research:noTerms}).candidates.length,0);
});
test('thousands of contracts produce a bounded search and at most the requested distinct recommendations',()=>{
  const research=researchFixture(),base=research.options.contracts;research.options.contracts=Array.from({length:4368},(_,i)=>({...base[i%base.length],symbol:base[i%base.length].symbol+'-QA'+i}));
  const result=recommendContracts({research,strategy:'pmcc',days:30,settings,limit:3});assert.equal(result.candidates.length,3);assert.ok(result.checked<=40);assert.ok(result.poolSize<=128);assert.equal(result.bounded,true);assert.equal(result.totalContracts,4368);
});

test('empty historical chains expose the provider reason instead of only a Monte Carlo prerequisite',()=>{
  const research=researchFixture();
  research.options.contracts=[];
  research.options.status={source:'Provider',status:'unavailable',message:'La cadena actual no reconstruye cotizaciones al corte histórico.'};
  const result=recommendContracts({research,strategy:'wheel',days:32,settings});
  assert.equal(result.candidates.length,0);assert.equal(result.totalContracts,0);
  assert.ok(result.missing.includes(research.options.status.message));
});

test('quality diagnostics and eligible counts remain available when another prerequisite blocks proposals',()=>{
  const research=researchFixture();research.macro.riskFreeRate=missingVariable('FRED','Missing rate');
  const result=recommendContracts({research,strategy:'wheel',days:32,settings});
  assert.equal(result.candidates.length,0);assert.ok(result.diagnostics);
  assert.ok(result.eligibleContracts>0,'Missing macro must not report that every received contract failed quality');
  const invalid=researchFixture();for(const contract of invalid.options.contracts)contract.deliverableShares=missingVariable('Provider','Unknown deliverable');
  const rejected=recommendContracts({research:invalid,strategy:'wheel',days:32,settings});
  assert.ok(rejected.diagnostics?.rejected.some(reason=>reason.code==='terms'&&reason.count>0));
});
