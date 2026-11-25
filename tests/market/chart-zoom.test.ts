import test from 'node:test';
import assert from 'node:assert/strict';
import {fitChartWindow,panChartWindow,zoomChartWindow} from '../../src/features/market/chart-zoom.ts';

test('repeated zoom keeps the focused endpoint visible and stops at the minimum detail window',()=>{
  let window={start:0,end:2000};
  for(let i=0;i<30;i++){
    window=zoomChartWindow(2000,window,.65,1,12);
    assert.equal(window.end,2000);assert.ok(window.start>=0);
  }
  assert.equal(window.end-window.start,12);
  for(let i=0;i<30;i++)window=zoomChartWindow(2000,window,1/.65,1,12);
  assert.deepEqual(window,{start:0,end:2000});
});

test('zoom anchors retain their source observation to within one rounding step',()=>{
  for(const anchor of [0,.2,.5,.8,1]){
    const before={start:200,end:800},after=zoomChartWindow(1000,before,.65,anchor,8);
    const originalFocus=before.start+(before.end-before.start-1)*anchor;
    const zoomedFocus=after.start+(after.end-after.start-1)*anchor;
    assert.ok(Math.abs(originalFocus-zoomedFocus)<=1);
    assert.ok(after.end-after.start<before.end-before.start);
  }
});

test('pan preserves visible width and clamps both ends without wrapping or exposing missing points',()=>{
  const window={start:30,end:50};
  assert.deepEqual(panChartWindow(100,window,-500),{start:0,end:20});
  assert.deepEqual(panChartWindow(100,window,500),{start:80,end:100});
  assert.deepEqual(panChartWindow(100,window,41),{start:41,end:61});
});

test('empty, single-point and shortened datasets keep valid nonnegative viewports',()=>{
  assert.deepEqual(zoomChartWindow(0,{start:0,end:0},.65),{start:0,end:0});
  assert.deepEqual(zoomChartWindow(1,{start:0,end:1},.65),{start:0,end:1});
  assert.deepEqual(fitChartWindow(5,{start:200,end:250}),{start:0,end:5});
  assert.deepEqual(fitChartWindow(10,{start:9,end:10},3),{start:7,end:10});
});

test('viewport operations preserve original candle values and the complete export dataset',()=>{
  const candles=Array.from({length:100},(_,i)=>Object.freeze({time:1000+i,open:100+i,high:102+i,low:99+i,close:101+i,volume:1000}));
  const before=JSON.stringify(candles);
  const zoom=zoomChartWindow(candles.length,{start:0,end:candles.length},.4,.5);
  const pan=panChartWindow(candles.length,zoom,0);
  assert.equal(candles.slice(pan.start,pan.end).length,40);
  assert.equal(candles.slice(pan.start,pan.end)[0],candles[0]);
  assert.equal(JSON.stringify(candles),before);assert.equal(candles.length,100);
});
