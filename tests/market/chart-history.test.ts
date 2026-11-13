import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCandles, generateHistory, historyIssue } from '../../src/features/market/chart-history.ts';

test('inclusive single session uses actual interval and partial final hourly bar',()=>{
  for(const [interval,count] of [['5m',78],['15m',26],['1h',7],['1d',1]] as const){
    const rows=generateHistory('NVDA',147.22,'2026-11-09','2026-11-09',interval);
    assert.equal(rows.length,count);
    assert.equal(new Date(rows[0].time).toISOString(),'2026-11-09T14:30:00.000Z');
    assert.ok(rows.every(c=>c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)&&c.volume>0));
  }
});
test('New York sessions respect DST and exclude weekends',()=>{
  const rows=generateHistory('NVDA',147.22,'2026-10-30','2026-11-02','1d');
  assert.equal(rows.length,2);
  assert.equal(new Date(rows[0].time).toISOString(),'2026-10-30T13:30:00.000Z');
  assert.equal(new Date(rows[1].time).toISOString(),'2026-11-02T14:30:00.000Z');
  assert.deepEqual(generateHistory('NVDA',147.22,'2026-11-07','2026-11-08','5m'),[]);
});
test('interval aggregation and overlapping requests preserve underlying series',()=>{
  const short=generateHistory('NVDA',147.22,'2026-11-09','2026-11-09','5m');
  const long=generateHistory('NVDA',147.22,'2026-11-06','2026-11-09','5m');
  assert.deepEqual(short,long.slice(-78));
  const daily=generateHistory('NVDA',147.22,'2026-11-09','2026-11-09','1d')[0];
  assert.equal(daily.open,short[0].open);assert.equal(daily.close,short.at(-1)?.close);
  assert.equal(daily.high,Math.max(...short.map(c=>c.high)));
  assert.equal(daily.low,Math.min(...short.map(c=>c.low)));
  assert.equal(daily.volume,short.reduce((s,c)=>s+c.volume,0));
});
test('SVG aggregation preserves extremes, endpoints, volume and bounded rendering',()=>{
  const rows=generateHistory('AAPL',228.42,'2026-10-01','2026-11-09','5m');
  const grouped=aggregateCandles(rows);
  assert.ok(grouped.length<=180);
  assert.equal(grouped[0].open,rows[0].open);assert.equal(grouped.at(-1)?.close,rows.at(-1)?.close);
  assert.equal(Math.max(...grouped.map(c=>c.high)),Math.max(...rows.map(c=>c.high)));
  assert.equal(Math.min(...grouped.map(c=>c.low)),Math.min(...rows.map(c=>c.low)));
  assert.equal(grouped.reduce((s,c)=>s+c.volume,0),rows.reduce((s,c)=>s+c.volume,0));
});
test('invalid dates and excessive ranges are explicit, without fabricated fallback history',()=>{
  for(const [start,end] of [['','2026-11-09'],['2026-02-30','2026-11-09'],['2026-11-10','2026-11-09'],['2000-01-01','2026-11-09']]){
    assert.ok(historyIssue(start,end));assert.deepEqual(generateHistory('AAPL',100,start,end,'1h'),[]);
  }
  assert.equal(historyIssue('2026-11-09','2026-11-09'),'');
  assert.deepEqual(generateHistory('AAPL',100,'2026-11-09','2026-11-09','invalid'),[]);
});
