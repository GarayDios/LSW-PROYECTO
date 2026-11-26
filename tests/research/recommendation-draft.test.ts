import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStrategy } from '../../src/cores/evaluacion/strategy-analysis.ts';
import { recommendationDraft, resolveRecommendation } from '../../src/features/f5/recommendation-draft.ts';
import type { F5Contract } from '../../src/features/f5/types.ts';
import { researchFixture } from './research-fixture.ts';

function analysis(strategy: 'wheel' | 'pmcc' | 'backspread' | 'gamma') {
  const research=researchFixture();
  for(const contract of research.options.contracts)contract.style='american';
  return analyzeStrategy(research,strategy,30);
}
const chain = (draft: NonNullable<ReturnType<typeof recommendationDraft>>):F5Contract[] => draft.legs.map(leg=>({
  ...leg,underlying:draft.underlying,size:100,tradable:true,style:'american',bid:1,ask:2,quoteTime:null,delta:null,
}));

test('both brokers receive the exact recommended legs, strategy units and short/long expiries',()=>{
  for(const broker of ['alpaca','webull'] as const)for(const strategy of ['wheel','pmcc','backspread','gamma'] as const){
    const a=analysis(strategy);
    assert.equal(a.status,'available',strategy);
    const draft=recommendationDraft(a,broker,20000)!;
    assert.ok(draft,strategy);assert.equal(draft.broker,broker);assert.equal(draft.quantity,1);assert.equal(draft.maxCapitalUsd,20000);
    assert.deepEqual(draft.legs.map(leg=>leg.symbol),a.legs.map(leg=>leg.contract.symbol));
    assert.equal(draft.expiry,a.legs[strategy==='pmcc'?1:0].contract.expiration);
    if(strategy==='pmcc')assert.equal(draft.longExpiry,a.legs[0].contract.expiration);
    assert.deepEqual(resolveRecommendation(draft,chain(draft)),{selection:draft.legs.map(leg=>leg.symbol),missing:[]});
    for(const leg of a.legs)leg.quantity*=3;
    assert.equal(recommendationDraft(a,broker,20000)?.quantity,3,'strategy units preserve the 1:2 backspread ratio');
  }
});

test('unavailable, untradable or changed contract terms never select a replacement',()=>{
  const draft=recommendationDraft(analysis('pmcc'),'alpaca',20000)!;
  for(const patch of [{symbol:'SIMILAR-CONTRACT'},{expiry:'2099-01-01'},{strike:1},{underlying:'OTHER'},{type:'put' as const},{tradable:false},{size:10},{style:'european'}]){
    const contracts=chain(draft);Object.assign(contracts[0],patch);
    assert.deepEqual(resolveRecommendation(draft,contracts),{selection:['',draft.legs[1].symbol],missing:[draft.legs[0].symbol]});
  }
});

test('unsupported deliverables and nonrepresentable ratios are not passed to F5',()=>{
  const a=analysis('backspread');
  a.legs[1].quantity=3;assert.equal(recommendationDraft(a,'webull',20000),null);
  a.legs[1].quantity=2;a.legs[0].contract.multiplier!.value=10;
  assert.equal(recommendationDraft(a,'alpaca',20000),null);
});
