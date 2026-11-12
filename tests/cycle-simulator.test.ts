import test from 'node:test';
import assert from 'node:assert/strict';
import { createCycle, advanceCycle, writeNextOption, assignShortOption, closeCycle, runScenario, cycleValue, defaultCycleConfig, accountSummary, isSimCycle, type CycleConfig } from '../lib/cycle-simulator.ts';
import { companies } from '../lib/market-data.ts';

const nvda = companies.find(c => c.symbol === 'NVDA')!;
const config = (strategy: CycleConfig['strategy'], overrides: Partial<CycleConfig> = {}): CycleConfig => ({ ...defaultCycleConfig(nvda, strategy, .04), id: 'test-cycle', feePerContract: 0, feePerShare: 0, ...overrides });
const close = (a: number, b: number) => assert.ok(Math.abs(a-b) < .06, `${a} != ${b}`);
const conserved = (c: ReturnType<typeof createCycle>) => { const v=cycleValue(c);close(v.pnl,v.realized+v.unrealized);close(v.equity,c.cash+c.shares*c.spot+v.optionsValue); };

test('wheel completes physical put assignment, covered call and return to cash', () => {
  let c=createCycle(config('wheel'));
  close(c.cash,20400);assert.equal(c.phase,'put');
  c=advanceCycle(c,{date:'2026-12-11',spot:130});
  assert.equal(c.phase,'shares');assert.equal(c.shares,100);close(c.cash,6400);close(cycleValue(c).pnl,-600);conserved(c);
  c=writeNextOption(c);assert.equal(c.phase,'covered-call');close(c.cash,6700);
  c=advanceCycle(c,{date:c.legs[0].expiry,spot:150});
  assert.equal(c.phase,'closed');assert.equal(c.shares,0);assert.equal(c.legs.length,0);close(c.cash,21200);close(cycleValue(c).pnl,1200);conserved(c);
  assert.ok(c.events.some(e=>e.kind==='assignment'));assert.ok(c.events.some(e=>e.kind==='complete'));
});

test('wheel worthless put is a completed premium round; stock loss is not hidden',()=>{
  const expired=advanceCycle(createCycle(config('wheel')),{date:'2026-12-11',spot:160});
  assert.equal(expired.phase,'closed');close(cycleValue(expired).pnl,400);
  let losing=advanceCycle(createCycle(config('wheel')),{date:'2026-12-11',spot:100});
  losing=closeCycle(losing);close(cycleValue(losing).pnl,-3600);assert.equal(losing.shares,0);conserved(losing);
});

test('covered call expiry leaves shares available for another call',()=>{
  let c=advanceCycle(createCycle(config('wheel')),{date:'2026-12-11',spot:130});c=writeNextOption(c);
  c=advanceCycle(c,{date:c.legs[0].expiry,spot:135});assert.equal(c.phase,'shares');assert.equal(c.shares,100);
  c=writeNextOption(c);assert.equal(c.phase,'covered-call');assert.equal(c.legs[0].quantity,-1);conserved(c);
});

test('early assignment is explicit, removes the short once and preserves accounting',()=>{
  let c=advanceCycle(createCycle(config('wheel')),{date:'2026-11-10',spot:130});
  c=assignShortOption(c);assert.equal(c.shares,100);assert.equal(c.phase,'shares');conserved(c);
  assert.throws(()=>assignShortOption(c));assert.throws(()=>assignShortOption(createCycle(config('wheel'))));
});

test('PMCC assignment creates short shares plus long call, then resolves to flat',()=>{
  let c=createCycle(config('pmcc'));close(c.cash,15200);
  c=advanceCycle(c,{date:'2026-12-11',spot:170});assert.equal(c.phase,'pmcc-assigned');assert.equal(c.shares,-100);assert.equal(c.legs.length,1);assert.equal(c.legs[0].quantity,1);conserved(c);
  c=closeCycle(c);assert.equal(c.phase,'closed');assert.equal(c.shares,0);assert.equal(c.legs.length,0);conserved(c);
});

test('PMCC can renew a short call without exceeding long expiry',()=>{
  let c=advanceCycle(createCycle(config('pmcc')),{date:'2026-12-11',spot:145});assert.equal(c.phase,'pmcc-long');
  c=writeNextOption(c);assert.equal(c.legs.length,2);assert.ok(c.legs.find(l=>l.quantity<0)!.expiry<c.legs.find(l=>l.quantity>0)!.expiry);conserved(c);
  c=advanceCycle(c,{date:'2027-11-19',spot:170});assert.equal(c.phase,'closed');assert.equal(c.shares,0);conserved(c);
});

test('backspread settles every leg and shares to correct expiration payoff',()=>{
  for(const [spot,pnl] of [[130,-200],[150,-1200],[162,0],[170,800]]){
    const c=advanceCycle(createCycle(config('backspread')),{date:'2026-12-11',spot});
    assert.equal(c.phase,'closed');assert.equal(c.shares,0);assert.equal(c.legs.length,0);close(cycleValue(c).pnl,pnl);conserved(c);
  }
});

test('gamma holds a delta hedge, adjusts it and closes all exposures',()=>{
  let c=createCycle(config('gamma'));assert.equal(c.shares,-49);assert.ok(c.events.some(e=>e.kind==='hedge'));conserved(c);
  c=advanceCycle(c,{date:'2026-11-10',spot:157.22});assert.ok(c.shares<-49);conserved(c);
  c=advanceCycle(c,{date:'2026-11-11',spot:147.22});assert.ok(c.events.filter(e=>e.kind==='hedge').length>=3);conserved(c);
  c=closeCycle(c);assert.equal(c.shares,0);assert.equal(c.legs.length,0);conserved(c);
});

test('fees lower the completed wheel cash exactly and cannot create phantom profit',()=>{
  let c=advanceCycle(createCycle(config('wheel',{feePerContract:.65})),{date:'2026-12-11',spot:130});c=writeNextOption(c);c=advanceCycle(c,{date:c.legs[0].expiry,spot:150});close(c.fees,1.30);close(cycleValue(c).pnl,1198.70);conserved(c);
});

test('all four strategies complete all four deterministic scenarios',()=>{
  for(const strategy of ['wheel','pmcc','backspread','gamma'] as const)for(const route of ['up','down','flat','recovery'] as const){
    const original=createCycle(config(strategy));const c=runScenario(original,route);
    assert.equal(c.phase,'closed',strategy+route);assert.equal(c.legs.length,0);assert.equal(c.shares,0);conserved(c);
    assert.deepEqual(c,runScenario(original,route));assert.equal(original.phase,strategy==='wheel'?'put':'active');
  }
  assert.ok(cycleValue(runScenario(createCycle(config('wheel')),'down')).pnl<0);
});

test('rejects insufficient capital, invalid dates, malformed numbers and backwards clock',()=>{
  assert.throws(()=>createCycle(config('wheel',{capital:1000})));
  assert.throws(()=>createCycle(config('pmcc',{longDays:5})));
  assert.throws(()=>createCycle(config('backspread',{longStrike:130})));
  assert.throws(()=>createCycle(config('gamma',{capital:900})));
  for(const n of [NaN,Infinity,-1,0])assert.throws(()=>createCycle(config('wheel',{spot:n})));
  assert.throws(()=>createCycle(config('wheel',{startDate:'2026-02-30'})));
  const c=createCycle(config('wheel'));assert.throws(()=>advanceCycle(c,{date:'2026-11-08',spot:100}));
  const done=closeCycle(c);assert.throws(()=>advanceCycle(done,{date:'2026-12-11',spot:130}));assert.throws(()=>closeCycle(done));
});

test('capital is allocated once and returns with realized profit after completion',()=>{
  const first=createCycle(config('wheel',{id:'first'})),second=createCycle(config('backspread',{id:'second'}));
  const initial=accountSummary([first,second]);close(initial.available,75000);close(initial.committed,25000);
  const completed=runScenario(first,'recovery'),next=accountSummary([completed,second]);
  close(next.available,95000+cycleValue(completed).pnl);assert.equal(next.active,1);assert.equal(next.closed,1);
  close(next.equity,100000+cycleValue(completed).pnl+cycleValue(second).pnl);
});

test('saved cycles validate after JSON round trip and malformed state is rejected',()=>{
  for(const strategy of ['wheel','pmcc','backspread','gamma'] as const){
    const c=runScenario(createCycle(config(strategy,{feePerContract:.65,feePerShare:.01})),'recovery');
    assert.ok(isSimCycle(JSON.parse(JSON.stringify(c))));conserved(c);
  }
  const valid=createCycle(config('wheel'));assert.equal(isSimCycle({...valid,cash:NaN}),false);assert.equal(isSimCycle({...valid,legs:[{...valid.legs[0],expiry:'bad'}]}),false);assert.equal(isSimCycle(null),false);
});

test('backspread early assignment remains covered by long calls until all exposures close',()=>{
  let c=assignShortOption(createCycle(config('backspread')));assert.equal(c.shares,-100);assert.equal(c.legs.length,1);assert.equal(c.legs[0].quantity,2);conserved(c);
  c=advanceCycle(c,{date:'2026-12-11',spot:170});assert.equal(c.phase,'closed');close(cycleValue(c).pnl,800);conserved(c);
});
