import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCompanyDetails, normalizeCompanyDetails } from '../../src/api/research/finnhub.ts';
import { fetchCompanyResearch } from '../../src/api/research/company.ts';
import type { ResearchFetch } from '../../src/api/research/http.ts';
import { evaluateScanner } from '../../src/cores/evaluacion/scanner.ts';
import { defaultScannerSettings } from '../../src/cores/evaluacion/scanner-settings.ts';
import { researchFixture, fixtureTime } from './research-fixture.ts';

const now=new Date(fixtureTime), config={apiKey:'fixture-private-token'};
const metrics={symbol:'XYZ',metric:{netProfitMarginTTM:18,netProfitMarginAnnual:12,roeTTM:24,currentRatioQuarterly:1.5,peTTM:0,epsTTM:-2,unknownRawMetric:33,notNumeric:null,infinite:Infinity,bad:true,empty:''}};
const profile={ticker:'XYZ',name:'Fixture company',finnhubIndustry:'Technology',currency:'USD',exchange:'NASDAQ',country:'US',ipo:'2000-01-01',weburl:'https://example.com'};
const recommendation={symbol:'XYZ',period:'2026-11-01',strongBuy:3,buy:5,hold:2,sell:1,strongSell:0};
const json=(value:unknown,status=200)=>Response.json(value,{status});
const bodies=(input:string|URL|Request)=>String(input).includes('/metric?')?metrics:String(input).includes('/profile2?')?profile:[recommendation];

test('Finnhub normalizes actual metrics, zero and percentages, preserves unknown units and validates company identity',()=>{
  const result=normalizeCompanyDetails('XYZ',fixtureTime,metrics,profile,[recommendation]);
  assert.equal(result.status.status,'ready');
  assert.equal(result.metrics.netProfitMarginTTM.value,.18);
  assert.equal(result.metrics.netProfitMarginAnnual.value,.12);
  assert.equal(result.metrics.roeTTM.value,.24);
  assert.equal(result.metrics.currentRatioQuarterly.value,1.5);
  assert.equal(result.metrics.peTTM.value,0);
  assert.equal(result.metrics.epsTTM.value,-2);
  assert.equal(result.metrics.unknownRawMetric.value,33);
  assert.equal(Object.keys(result.metrics).length,7);
  assert.equal(result.metrics.netProfitMarginTTM.availableAt,fixtureTime);
  assert.match(result.metrics.netProfitMarginTTM.source,/TTM/);
  const wrong=normalizeCompanyDetails('AAPL',fixtureTime,metrics,profile,[recommendation]);
  assert.equal(wrong.status.status,'unavailable');
  assert.deepEqual(wrong.metrics,{});
  assert.equal(wrong.profile.name,null);
  assert.deepEqual(wrong.recommendations,[]);
});

test('profile links, calendar dates and analyst recommendations are validated without manufacturing absent facts',()=>{
  const result=normalizeCompanyDetails('XYZ',fixtureTime,{}, {...profile,weburl:'javascript:alert(1)',ipo:'2026-02-30'},[
    recommendation,{...recommendation,period:'2026-12-01'},{...recommendation,period:'2026-02-30'},
    {...recommendation,period:'2026-10-01',buy:-1}, {...recommendation,period:'2026-09-01',sell:1.5},
  ]);
  assert.equal(result.status.status,'partial');
  assert.equal(result.profile.website,null);
  assert.equal(result.profile.ipo,null);
  assert.deepEqual(result.recommendations,[{period:'2026-11-01',strongBuy:3,buy:5,hold:2,sell:1,strongSell:0}]);
  assert.equal(normalizeCompanyDetails('XYZ',fixtureTime,{}, {...profile,weburl:'https://user:pass@example.com'},[]).profile.website,null);
});

test('missing keys and historical requests make no API requests or backdated aggregate metrics',async()=>{
  let calls=0;const fetcher:ResearchFetch=async()=>{calls++;throw Error('unexpected network');};
  assert.equal((await fetchCompanyDetails(undefined,'XYZ',fixtureTime,fetcher,now)).status.status,'missing_config');
  assert.equal((await fetchCompanyDetails(config,'XYZ','2026-11-16T16:00:00Z',fetcher,now)).status.status,'unavailable');
  assert.equal(calls,0);
});

test('free endpoints use private token headers, safe fixed hosts and scoped, isolated caches',async()=>{
  let calls=0;
  const fetcher:ResearchFetch=async(input,init)=>{
    calls++;const url=new URL(String(input));assert.equal(url.origin,'https://finnhub.io');
    assert.ok(['/api/v1/stock/metric','/api/v1/stock/profile2','/api/v1/stock/recommendation'].includes(url.pathname));
    assert.equal(init?.redirect,'manual');assert.equal(new Headers(init?.headers).get('X-Finnhub-Token'),config.apiKey);
    assert.ok(!url.href.includes(config.apiKey));return json(bodies(input));
  };
  const [first,second]=await Promise.all([fetchCompanyDetails(config,'XYZ',fixtureTime,fetcher,now),fetchCompanyDetails(config,'XYZ',fixtureTime,fetcher,now)]);
  assert.equal(calls,3);assert.equal(first.status.status,'ready');assert.notEqual(first,second);
  first.metrics.peTTM.value=123;
  assert.equal((await fetchCompanyDetails(config,'XYZ',fixtureTime,fetcher,now)).metrics.peTTM.value,0);
  assert.ok(!JSON.stringify(second).includes(config.apiKey));
  await fetchCompanyDetails(config,'AAPL',fixtureTime,fetcher,now);assert.equal(calls,6);
  await fetchCompanyDetails(config,'XYZ',new Date(now.getTime()+16*60000).toISOString(),fetcher,new Date(now.getTime()+16*60000));assert.equal(calls,9);
});

test('denials and rate limits preserve independent metrics, never echo response bodies or silently call premium APIs',async()=>{
  const partial=await fetchCompanyDetails(config,'XYZ',fixtureTime,async input=>String(input).includes('/metric?')?json(metrics):json({error:config.apiKey},429),now);
  assert.equal(partial.status.status,'partial');assert.equal(partial.metrics.roeTTM.value,.24);
  assert.match(partial.status.message,/cuota/);assert.ok(!JSON.stringify(partial).includes(config.apiKey));
  const denied=await fetchCompanyDetails(config,'XYZ',fixtureTime,async()=>json({error:config.apiKey},403),now);
  assert.equal(denied.status.status,'error');assert.deepEqual(denied.metrics,{});
  assert.ok(!JSON.stringify(denied).includes(config.apiKey));
  const errorBody=await fetchCompanyDetails(config,'XYZ',fixtureTime,async()=>json({error:config.apiKey}),now);
  assert.equal(errorBody.status.status,'error');assert.ok(!JSON.stringify(errorBody).includes(config.apiKey));
});

test('automatic company metrics reach the real orchestrator and weighted fundamental core; no future data or missing zeros',async()=>{
  const snapshot=await fetchCompanyResearch({symbol:'XYZ',bars:[],asOf:fixtureTime,finnhub:config},async input=>json(bodies(input)),now);
  assert.equal(snapshot.companyDetails!.metrics.roeTTM.value,.24);
  assert.ok(snapshot.quality.sources.some(s=>s.source.includes('Finnhub')&&s.status==='ready'));
  const settings=structuredClone(defaultScannerSettings);
  for(const value of Object.values(settings.cores))value.enabled=false;
  settings.cores.fundamental.enabled=true;settings.cores.fundamental.weight=3;
  const score=evaluateScanner(snapshot,'wheel',30,settings);
  assert.ok(score.score!>50);assert.equal(score.availableWeight,3);
  assert.match(score.results[0].reason,/Finnhub/);
  assert.equal(score.results[0].weight,3);
  const weaker=structuredClone(snapshot);weaker.companyDetails!.metrics.netProfitMarginTTM.value=-.2;
  assert.ok(evaluateScanner(weaker,'wheel',30,settings).score!<score.score!);
  const missing=researchFixture();assert.equal(evaluateScanner(missing,'wheel',30,settings).score,null);
  missing.companyDetails=normalizeCompanyDetails('XYZ','2026-11-18T16:00:00Z',metrics,profile,[]);
  assert.equal(evaluateScanner(missing,'wheel',30,settings).score,null,'later captures cannot complete an earlier analysis');
  assert.ok(!JSON.stringify(snapshot).includes(config.apiKey));
});
