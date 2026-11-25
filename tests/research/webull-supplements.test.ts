import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsHandler} from '../../src/api/analysis/news.ts';
import {createComparisonHandler} from '../../src/api/analysis/comparison.ts';
import {fetchCompanyResearch} from '../../src/api/research/company.ts';
import {WebullClient,readWebullConfig} from '../../src/api/brokers/webull/client.ts';
import {WebullResearchData,webullSplitFactor,webullSpot} from '../../src/api/brokers/webull/research-data.ts';
import type {NewsTimelinePage} from '../../src/cores/compartido/research-model.ts';

const environment={BROKER_OWNER_USER_ID:'owner',TRADING_RUNNER_URL:'http://127.0.0.1:8790',TRADING_RUNNER_TOKEN:'private-fixture-token-with-at-least-32-bytes',FINNHUB_API_KEY:'private-finnhub-fixture'};
test('Webull news uses an identified Finnhub complement without Alpaca, filters future stories and keeps New York dates',async()=>{
  const calls:string[]=[],now=Date.parse('2026-11-25T05:00:00Z');
  const api=createNewsHandler({environment:()=>environment,owner:async()=>({userId:'owner'}),now:()=>now,fetcher:async(input,init)=>{
    const url=new URL(String(input));calls.push(url.hostname);
    if(url.hostname==='127.0.0.1'){assert.equal(url.pathname,'/webull/market-news');return Response.json({error:{}},{status:503});}
    assert.equal(url.hostname,'finnhub.io');assert.equal(new Headers(init?.headers).get('X-Finnhub-Token'),environment.FINNHUB_API_KEY);
    return Response.json([{id:1,datetime:Date.parse('2026-11-25T01:00:00Z')/1000,headline:'Sesión anterior',url:'https://news.example/article',source:'Fixture',related:'NVDA'},{id:2,datetime:(now+86400000)/1000,headline:'Futuro',related:'NVDA'}]);
  }});
  const response=await api(new Request('https://terminal.test/api/research/news?symbol=NVDA&start=2026-11-24&end=2026-11-24&provider=webull'));assert.equal(response.status,200);const page=await response.json() as NewsTimelinePage;assert.equal(page.news.articles.length,1);assert.match(page.news.status.source,/Finnhub/);assert.equal(page.news.articles[0].publishedAt,'2026-11-25T01:00:00.000Z');assert.deepEqual(calls,['127.0.0.1','finnhub.io']);assert.ok(!JSON.stringify(page).includes(environment.FINNHUB_API_KEY));
});
test('Webull comparison reads its own history with owner gates and never requires an Alpaca key',async()=>{
  let calls=0;const now=Date.parse('2026-11-25T05:00:00Z');
  const api=createComparisonHandler({environment:()=>environment,owner:async()=>({userId:'owner'}),now:()=>now,fetcher:async(input)=>{calls++;const url=new URL(String(input));assert.equal(url.pathname,'/webull/market-history');assert.equal(url.searchParams.get('ownerId'),'owner');const start=Date.parse(url.searchParams.get('start')!),end=Date.parse(url.searchParams.get('end')!);const bars=[];for(let t=start;t<=end;t+=86400000){const close=100+(t-start)/86400000*.1;bars.push({time:t,open:close,high:close+1,low:close-1,close,volume:10000});}return Response.json({source:'webull',feed:'sandbox',bars,warnings:['QA sandbox'],adjustment:'forward'});}});
  const response=await api(new Request('https://terminal.test/api/research/comparison',{method:'POST',headers:{Origin:'https://terminal.test','Content-Type':'application/json'},body:JSON.stringify({symbols:['NVDA'],years:[1],end:'2026-11-24',feeBps:10,slippageBps:5,provider:'webull'})}));assert.equal(response.status,200);const value=await response.json() as {source:string;rows:unknown[];warnings:string[]};assert.equal(value.source,'webull:sandbox');assert.equal(value.rows.length,2);assert.equal(calls,1);assert.ok(value.warnings.some(w=>w.includes('pruebas')));
});
test('Webull dividends remain partial, trade timestamps do not become quote timestamps, and split coverage is mandatory',async()=>{
  const now=Date.parse('2026-11-25T05:00:00Z'),config=readWebullConfig({WEBULL_APP_KEY:'fixture',WEBULL_APP_SECRET:'fixture',WEBULL_ACCOUNT_ID:'account',WEBULL_REGION:'us',WEBULL_ENVIRONMENT:'sandbox'})!;
  class Client extends WebullClient{async request(path:string){return path.includes('snapshots')?[{symbol:'NVDA',price:'150',bid:'149',ask:'153',last_trade_time:Date.parse('2026-11-24T20:59:00Z')}]:[{symbol:'NVDA',currency:'USD',div_type:'CASH_DIVIDEND',ex_div_date:'2026-12-01',amount:'.1'}];}}
  const context=await new WebullResearchData(new Client(config),()=>now).context('NVDA');assert.equal(context.spot.value,150);assert.match(context.spot.source,/última operación/);assert.equal(context.dividends.complete,false);assert.equal(context.annualDividend.value,null);assert.equal(context.dividends.events.length,1);
  assert.equal(webullSpot({bid:'10',ask:'11',last_trade_time:now-1000},new Date(now).toISOString()).value,null,'A trade time cannot timestamp an un-timestamped bid/ask');
  const split={symbol:'NVDA',event_id:1,event_type:'FORWARD_SPLIT',ratio_old:'1',ratio_new:'10',event_date:'2026-06-01'};assert.equal(webullSplitFactor({data:[split,split],complete:true},'NVDA','2026-01-01','2026-11-24'),10);assert.throws(()=>webullSplitFactor({data:[split],complete:false},'NVDA','2026-01-01','2026-11-24'));assert.throws(()=>webullSplitFactor({data:[{...split,event_type:'NAME_CHANGE'}],complete:true},'NVDA','2026-01-01','2026-11-24'));
});
test('A published Finnhub indicated dividend yield completes the current Webull model without presuming a zero or backdating it',async()=>{
  const now=new Date('2026-11-24T18:00:00Z');
  const response=await fetchCompanyResearch({symbol:'NVDA',bars:[],asOf:now.toISOString(),dataMode:'sandbox',finnhub:{apiKey:'fixture-private'},options:{contracts:[],complete:false,feed:'webull-sandbox',status:{source:'Webull',status:'partial',message:'fixture'},warnings:[]}},async input=>{const url=new URL(String(input));if(url.pathname.endsWith('/metric'))return Response.json({symbol:'NVDA',metric:{dividendYieldIndicatedAnnual:1.2}});if(url.pathname.endsWith('/profile2'))return Response.json({ticker:'NVDA'});return Response.json([]);},now);
  assert.equal(response.fundamentals.dividendYield.value,.012);assert.match(response.fundamentals.dividendYield.source,/Finnhub/);assert.equal(response.fundamentals.dividendYield.availableAt,now.toISOString());assert.match(response.fundamentals.dividendYield.reason!,/indicado/);
});
