import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMarketContext } from '../../src/api/research/market-context.ts';
import { fetchCompanyResearch } from '../../src/api/research/company.ts';
import { fixtureTime } from './research-fixture.ts';
const config={apiKey:'TEST-KEY',secretKey:'TEST-SECRET',stockFeed:'iex' as const};
const now=new Date(fixtureTime);
test('current stock quote and prospective cash events preserve timestamps and do not fabricate continuous yield',async()=>{
  const fetcher:typeof fetch=async input=>{
    const url=new URL(String(input));
    return Response.json(url.pathname.includes('/quotes/latest')?{quote:{bp:99,ap:101,t:'2026-11-17T15:59:00Z'}}:{corporate_actions:{cash_dividends:[{id:'declared',symbol:'XYZ',rate:1,currency:'USD',ex_date:'2026-12-01',payable_date:'2026-12-05',foreign:false,special:false}]}});
  };
  const result=await fetchMarketContext(config,'XYZ',fixtureTime,fetcher,now);
  assert.equal(result.spot.value,100);assert.equal(result.spot.kind,'estimated');assert.match(result.spot.source,/cotización de la acción/);
  assert.equal(result.dividends.events.length,1);assert.equal(result.dividends.complete,false);assert.equal(result.dividends.events[0].availableAt,fixtureTime);
});
test('past cutoffs never query current dividends or quotes, and future/crossed/stale quotes remain unusable',async()=>{
  let requests=0;
  const historical=await fetchMarketContext(config,'XYZ','2026-10-01T16:00:00Z',async()=>{requests++;throw Error('must not fetch');},now);
  assert.equal(requests,0);assert.equal(historical.spot.value,null);
  for(const quote of [{bp:101,ap:99,t:fixtureTime},{bp:99,ap:101,t:'2026-11-18T16:00:00Z'},{bp:99,ap:101,t:'2026-11-16T16:00:00Z'}]){
    const value=await fetchMarketContext(config,'XYZ',fixtureTime,async input=>Response.json(String(input).includes('/quotes/latest')?{quote}:{corporate_actions:{cash_dividends:[]}}),now);
    assert.equal(value.spot.value,null);
  }
});
test('provider denials stay isolated, never expose credentials and never silently replace API dividends with zero',async()=>{
  const result=await fetchMarketContext(config,'XYZ',fixtureTime,async()=>Response.json({message:config.secretKey},{status:403}),now);
  assert.equal(result.spot.value,null);assert.equal(result.dividends.status.status,'error');assert.equal(result.dividends.complete,false);
  assert.ok(!JSON.stringify(result).includes(config.secretKey));
  const snapshot=await fetchCompanyResearch({symbol:'XYZ',bars:[],asOf:fixtureTime},async()=>{throw Error();},now);
  assert.equal(snapshot.fundamentals.dividendYield.value,null);
});
test('an empty corporate-actions object is a successful partial calendar, never proof of zero future dividends',async()=>{
  const result=await fetchMarketContext(config,'XYZ',fixtureTime,async()=>Response.json({corporate_actions:{},next_page_token:null}),now);
  assert.equal(result.dividends.status.status,'partial');assert.equal(result.dividends.events.length,0);assert.equal(result.dividends.complete,false);
  assert.match(result.dividends.warnings.join(' '),/lista vacía no demuestra/);
});
