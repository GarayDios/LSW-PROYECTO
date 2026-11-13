import assert from 'node:assert/strict';
import { companies } from '../src/features/market/data.ts';
import { defaultCycleConfig, createCycle, advanceCycle, closeCycle, cycleValue, writeNextOption } from '../src/features/cycles/cycle-simulator.ts';
const nvda = companies.find(c => c.symbol === 'NVDA');
const make = strategy => createCycle({...defaultCycleConfig(nvda,strategy,.04),id:`guide-${strategy}`,capital:strategy==='pmcc'?20000:5000,feePerContract:0,feePerShare:0});
const pmcc = [100,120,145,160,170].map(spot=>{
  const step=advanceCycle(make('pmcc'),{date:'2026-12-11',spot});
  const closed=closeCycle(step);
  assert.equal(closed.shares,0);assert.equal(closed.legs.length,0);
  return {spot,phase:step.phase,shares:step.shares,cashBeforeClose:step.cash,longValue:cycleValue(step).optionsValue,pnl:cycleValue(closed).pnl,finalCash:closed.cash};
});
const renewed=writeNextOption(advanceCycle(make('pmcc'),{date:'2026-12-11',spot:145}));
const backspread=[130,140,145,150,155,160,162,170,180].map(spot=>{
  const closed=advanceCycle(make('backspread'),{date:'2026-12-11',spot});
  const formula=100*(2*Math.max(spot-150,0)-Math.max(spot-140,0)-2);
  assert.equal(cycleValue(closed).pnl,formula);assert.equal(closed.shares,0);assert.equal(closed.legs.length,0);
  return {spot,pnl:cycleValue(closed).pnl,finalCash:closed.cash};
});
console.log(JSON.stringify({settings:{start:'2026-11-09',shortExpiry:'2026-12-11',longExpiry:'2027-11-19',iv:.54,rate:.04,dividendYield:.0003},pmcc,renewedShort:renewed.legs.find(l=>l.quantity<0),backspread},null,2));
