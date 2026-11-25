import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalState,historicalExercise,historicalPositionMark,historicalCloseAvailableAt} from '../../src/cores/evaluacion/historical-exercise.ts';
import {calculateTechnicalIndicators} from '../../src/cores/01-analisis-tecnico/indicators.ts';
import type {Candle} from '../../src/features/market/chart-history.ts';

function fixture():Candle[]{const rows:Candle[]=[];for(let time=Date.parse('2025-01-02T15:00:00Z');rows.length<200;time+=86400000){if([0,6].includes(new Date(time).getUTCDay()))continue;const close=100+3*Math.sin(rows.length/7),open=close-.4;rows.push({time,open,high:close+1,low:open-1,close,volume:1000+rows.length*7});}return rows;}
const exerciseInput={strategy:'wheel' as const,spot:100,volatility:.25,rate:.04,dividendYield:.01,days:32,longDays:365,shortStrike:100,longStrike:80,feePerContract:.65,capital:50000,asOf:'2025-06-03T06:00:00Z',futureBars:fixture()};

test('historical point exposes its actual OHLCV, causal indicators, structure and selected rule without future contamination',()=>{
  const bars=fixture(),cursor=bars[100],asOf=new Date(historicalCloseAvailableAt(cursor.time)).toISOString();
  const state=historicalState('XYZ',bars,asOf,'technical-confluence');
  assert.deepEqual(state.bar,cursor);assert.deepEqual(state.previous,bars[99]);assert.equal(state.analysis!.rule,'technical-confluence');
  assert.deepEqual(state.indicator,calculateTechnicalIndicators(bars.slice(0,101)).at(-1));assert.equal(state.structure?.time,cursor.time);assert.ok(state.events.every(event=>event.time===cursor.time));
  const contaminated=bars.map(bar=>bar.time<=cursor.time?bar:{...bar,open:1e6,high:1e6+1,low:1e6-1,close:1e6,volume:1e9});
  assert.deepEqual(historicalState('XYZ',contaminated,asOf,'technical-confluence'),state);
  assert.equal(historicalState('XYZ',bars,new Date(historicalCloseAvailableAt(cursor.time)-1).toISOString()).bar!.time,bars[99].time);
});
test('short historical windows show available RSI/ATR while leaving SMA50 and HV genuinely missing',()=>{
  const bars=fixture().slice(0,20),state=historicalState('XYZ',bars,new Date(historicalCloseAvailableAt(bars.at(-1)!.time)).toISOString());
  assert.ok(state.indicator!.rsi!==null);assert.ok(state.indicator!.atr!==null);assert.equal(state.indicator!.smaSlow,null);assert.equal(state.market.historicalVolatility.value,null);assert.equal(state.analysis,null);
});
test('marking the point conserves entry legs, signs, cost attribution and remaining PMCC maturity',()=>{
  for(const strategy of ['wheel','pmcc','backspread','gamma'] as const){
    const result=historicalExercise({...exerciseInput,strategy,longStrike:strategy==='backspread'?110:80}),before=structuredClone(result.basis);
    for(const elapsed of [0,16,32]){
      const mark=historicalPositionMark(result.basis,105,elapsed);assert.ok(Math.abs(mark.legs.reduce((sum,leg)=>sum+leg.pnl,0)-mark.pnl)<1e-8);assert.ok(Math.abs(mark.legs.reduce((sum,leg)=>sum+leg.delta,0)-mark.delta)<1e-8);assert.equal(mark.daysRemaining,32-elapsed);
      if(strategy==='pmcc'){assert.ok(mark.legs[0].remainingDays>0);assert.ok(mark.legs[0].mark>Math.max(0,105-80));}
    }
    assert.deepEqual(result.basis,before);
    assert.throws(()=>historicalPositionMark(result.basis,105,-1));assert.throws(()=>historicalPositionMark(result.basis,105,33));
  }
});
test('strategy units scale required capital, premiums, fees, P/L and Greeks without changing entry prices',()=>{
  for(const strategy of ['wheel','pmcc','backspread','gamma'] as const){
    const input={...exerciseInput,strategy,longStrike:strategy==='backspread'?110:80};
    const one=historicalExercise(input),two=historicalExercise({...input,contracts:2});
    assert.ok(Math.abs(two.required-one.required*2)<1e-9);assert.ok(Math.abs(two.debit-one.debit*2)<1e-9);
    const first=historicalPositionMark(one.basis,90,10),second=historicalPositionMark(two.basis,90,10);
    assert.ok(Math.abs(second.pnl-first.pnl*2)<1e-8);assert.ok(Math.abs(second.delta-first.delta*2)<1e-8);assert.equal(two.basis.legs[0].premium,one.basis.legs[0].premium);
  }
  assert.throws(()=>historicalExercise({...exerciseInput,contracts:0}));assert.throws(()=>historicalExercise({...exerciseInput,contracts:1.5}));assert.throws(()=>historicalExercise({...exerciseInput,contracts:101}));
  assert.throws(()=>historicalExercise({...exerciseInput,contracts:2,capital:15000}),/capital disponible/);
});
test('scenario P/L reflects each strategy payoff and revealed closing points use the same mark as the inspector',()=>{
  const wheel=historicalExercise(exerciseInput);assert.ok(historicalPositionMark(wheel.basis,150,32).pnl>0);assert.ok(historicalPositionMark(wheel.basis,50,32).pnl<0);
  const backspread=historicalExercise({...exerciseInput,strategy:'backspread',longStrike:110});assert.ok(historicalPositionMark(backspread.basis,170,32).pnl>historicalPositionMark(backspread.basis,110,32).pnl);
  const gamma=historicalExercise({...exerciseInput,strategy:'gamma'});assert.ok(historicalPositionMark(gamma.basis,100,32).pnl<0);assert.ok(historicalPositionMark(gamma.basis,150,32).pnl>0);
  for(const point of wheel.points)assert.ok(Math.abs(historicalPositionMark(wheel.basis,point.spot,point.days).pnl-point.pnl)<1e-8);
  assert.deepEqual(historicalExercise({...exerciseInput,futureBars:[]}).points,[]);
});
