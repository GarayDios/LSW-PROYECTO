import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchHandlers} from '../../src/api/analysis/handlers.ts';
import {fetchCompanyResearch} from '../../src/api/research/company.ts';
import type {CompanyResearch} from '../../src/cores/compartido/research-model.ts';
const env={BROKER_OWNER_USER_ID:'owner',TRADING_RUNNER_URL:'http://127.0.0.1:8790',TRADING_RUNNER_TOKEN:'fixture-private-token-at-least-32-characters'};
const initial=Date.parse('2026-11-24T18:00:00Z');
const request=(extra='')=>new Request('https://terminal.test/api/research/company?symbol=NVDA&start=2026-07-01&end=2026-11-24&provider=webull'+extra);
const noNetwork:typeof fetch=async()=>{throw Error('Unexpected external provider');};
const research:typeof fetchCompanyResearch=(input,_fetcher,time)=>fetchCompanyResearch({...input,alpaca:undefined},noNetwork,time);
function setup({failOptions=false}:{failOptions?:boolean}={}){
  let clock=initial;const paths:string[]=[];
  const api=createResearchHandlers({environment:()=>env,owner:async()=>({userId:'owner'}),now:()=>clock,research,
    history:async()=>{throw Error('Alpaca must not replace Webull market data');},
    fetcher:async(input,init)=>{
      const url=new URL(String(input));assert.equal(url.origin,'http://127.0.0.1:8790');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+env.TRADING_RUNNER_TOKEN);assert.equal(url.searchParams.get('ownerId'),'owner');paths.push(url.pathname);clock+=500;
      if(url.pathname.endsWith('market-history'))return Response.json({source:'webull',feed:'sandbox',warnings:['QA sandbox history with unverified split adjustment'],bars:Array.from({length:100},(_,i)=>({time:Date.parse('2026-07-01T04:00:00Z')+i*86400000,open:100+i,high:102+i,low:99+i,close:101+i,volume:1000})),asOf:new Date(clock).toISOString()});
      if(url.pathname.endsWith('market-options'))return failOptions?Response.json({error:{code:'unavailable'}},{status:503}):Response.json({contracts:[],feed:'webull-sandbox',complete:false,status:{source:'Webull Sandbox options',status:'partial',message:'QA chain'},warnings:[]});
      if(url.pathname.endsWith('market-quote'))return Response.json([{symbol:'NVDA',bid:'199',ask:'201',quote_time:initial-900000}]);
      throw Error('Unexpected gateway action');
    }});
  return {api,paths,time:()=>clock};
}
test('Webull company analysis works without Alpaca credentials, keeps provenance and timestamps inputs after receipt',async()=>{
  const {api,paths,time}=setup();const response=await api.company(request());assert.equal(response.status,200);
  const raw=await response.text(),{research}=JSON.parse(raw);assert.equal(research.dataMode,'sandbox');assert.equal(research.options.feed,'webull-sandbox');assert.equal(research.market.spot.value,200);assert.match(research.market.spot.source,/Webull/);assert.equal(Date.parse(research.asOf),time());assert.ok(research.quality.sources.some((s:{source:string})=>s.source==='webull:sandbox'));assert.ok(!raw.includes(env.TRADING_RUNNER_TOKEN));assert.equal(paths.length,5);
  await api.company(request());assert.equal(paths.length,5,'coalesced current snapshots use their own provider cache');
});
test('Webull historical cutoffs never import current option chains or quotes into the past',async()=>{
  const {api,paths}=setup();const response=await api.company(request('&cutoff=2026-08-01T18%3A00%3A00Z'));assert.equal(response.status,200);
  const {research}=await response.json() as {research:CompanyResearch};assert.equal(research.asOf,'2026-08-01T18:00:00.000Z');assert.deepEqual(paths,['/webull/market-history','/webull/market-news']);assert.equal(research.options.contracts.length,0);assert.equal(research.options.status.status,'unavailable');assert.equal(research.market.spotBasis,'daily-close');assert.match(research.market.spot.source,/webull:sandbox/);
});
test('an unavailable Webull options entitlement leaves daily market cores available without changing broker or inserting demo contracts',async()=>{
  const {api}=setup({failOptions:true});const response=await api.company(request());assert.equal(response.status,200);
  const {research}=await response.json() as {research:CompanyResearch};assert.ok(research.market.observations>50);assert.equal(research.options.contracts.length,0);assert.equal(research.options.status.status,'unavailable');assert.equal(research.market.spot.value,200);
});
test('Webull research rejects foreign owners and malformed providers before making gateway requests',async()=>{
  let calls=0;const deps={environment:()=>env,owner:async()=>({userId:'other'}),fetcher:async()=>{calls++;throw Error('Must not request');}};
  assert.equal((await createResearchHandlers(deps).company(request())).status,403);assert.equal(calls,0);
  assert.equal((await createResearchHandlers({...deps,owner:async()=>null}).company(request())).status,401);assert.equal(calls,0);
  const api=createResearchHandlers({...deps,owner:async()=>({userId:'owner'})});assert.equal((await api.company(request('&unknown=value'))).status,400);assert.equal(calls,0);
});
