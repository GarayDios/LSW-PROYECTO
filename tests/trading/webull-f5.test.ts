import test from 'node:test';
import assert from 'node:assert/strict';
import {WebullClient,readWebullConfig} from '../../src/api/brokers/webull/client.ts';
import {WebullF5Adapter} from '../../src/api/brokers/webull/f5-adapter.ts';
import {createF5Service} from '../../services/trading-runner/f5-service.ts';
import {openF5Store} from '../../services/trading-runner/f5-store.ts';
import {webullMarketOpen,webullQuoteUsable} from '../../src/api/brokers/webull/session.ts';
import {createF5Handlers} from '../../src/api/f5/handlers.ts';
import {createWebullService} from '../../services/trading-runner/webull-service.ts';
import type {F5Operation,F5Request,F5Status} from '../../src/features/f5/types.ts';
import type {F5Report} from '../../src/features/f5/report-types.ts';

const initial=Date.parse('2026-11-24T18:00:00Z');
const config=readWebullConfig({WEBULL_APP_KEY:'fixture',WEBULL_APP_SECRET:'private-fixture',WEBULL_ACCOUNT_ID:'account',WEBULL_ENVIRONMENT:'sandbox',WEBULL_REGION:'us',WEBULL_MANUAL_ENABLED:'true'})!;
const option=(type:'CALL'|'PUT',strike:number,expiry='2027-01-15')=>({symbol:'AAPL'+expiry.slice(2).replaceAll('-','')+type[0]+String(strike*1000).padStart(8,'0'),underlying_symbol:'AAPL',strike_price:String(strike),option_type:type,expiration_date:expiry,multiplier:'100',style:'AMERICAN',status:'LISTING',tradable_status:'OC',deliverables:[{symbol:'AAPL',asset_type:'EQUITY',amount:'100'}]});
const put=option('PUT',100),call=option('CALL',100),upper=option('CALL',110),long=option('CALL',80,'2027-12-17'),replacement=option('CALL',105,'2027-03-19');
type Raw=Record<string,unknown>;
function setup(){
  let time=initial;
  const state={metadata:[put,call,upper,long,replacement],quotesAt:initial-900000,failLookup:false,loseResponse:false,feeKnown:true,placed:[] as Raw[],previews:[] as Raw[],positions:new Map<string,number>(),orders:new Map<string,Raw>(),calls:[] as string[]};
  const store=openF5Store(':memory:');
  const client=new WebullClient({...config},async(input,init)=>{
    const url=new URL(String(input)),path=url.pathname,body=init?.body?JSON.parse(String(init.body)):{};state.calls.push(path);
    if(path==='/auth/tokens/create')return Response.json({token:'private-fixture-session',status:'NORMAL'});
    if(path==='/trading/accounts/list')return Response.json([{account_id:'account',account_type:'CASH'}]);
    if(path.includes('/balances/'))return Response.json({total_asset_currency:'USD',total_cash_balance:'100000',total_net_liquidation_value:'100000',account_currency_assets:[{currency:'USD',settled_cash:'100000',buying_power:'100000',option_buying_power:'100000'}]});
    if(path.includes('/contracts/'))return Response.json({data:state.metadata.filter(m=>!url.searchParams.has('option_symbols')||url.searchParams.get('option_symbols')===m.symbol)});
    if(path==='/market-data/options/snapshots/list')return Response.json(url.searchParams.get('symbols')!.split(',').map(symbol=>({symbol,bid:'1',ask:'1.2',delta:symbol.includes('P00')?'-.6':'.4',quote_time:state.quotesAt,imp_vol:'.3'})));
    if(path==='/market-data/stocks/snapshots/list')return Response.json([{symbol:'AAPL',bid:'99',ask:'101',last_trade_time:time-1000,price:'100'}]);
    if(path.includes('/positions/'))return Response.json([...state.positions].filter(([,quantity])=>quantity!==0).map(([symbol,quantity])=>{
      const meta=state.metadata.find(m=>m.symbol===symbol);
      return meta?{symbol:'AAPL',position_id:'position-'+symbol,option_strategy:'SINGLE',instrument_type:'OPTION',quantity:String(quantity),cost_price:'1',legs:[{symbol:'AAPL',quantity:String(quantity),option_type:meta.option_type,option_expire_date:meta.expiration_date,option_exercise_price:meta.strike_price,option_contract_multiplier:'100',option_contract_deliverable:'100'}]}:{symbol,position_id:'equity',instrument_type:'EQUITY',quantity:String(quantity),cost_price:'100',last_price:'100',market_value:String(quantity*100)};
    }));
    if(path.includes('/activities/'))return Response.json({data:[]});
    if(path==='/trading/orders/open-orders/list')return Response.json({data:[...state.orders.values()].filter(row=>row.status==='SUBMITTED').map(row=>({orders:[row]}))});
    if(path==='/trading/orders/get'){
      if(state.failLookup)throw Error('lookup unavailable');
      const order=state.orders.get(url.searchParams.get('client_order_id')!);return order?Response.json({orders:[order]}):Response.json({orders:[]});
    }
    if(path==='/trading/orders/preview'){assert.equal(body.new_orders.length,1);state.previews.push(body.new_orders[0]);return Response.json({estimated_cost:'100',estimated_commission:'0'});}
    if(path==='/trading/orders/place'){
      assert.equal(body.new_orders.length,1);const row=body.new_orders[0];assert.ok(row.client_order_id.length<=32);state.placed.push(row);
      const detail={...row,total_quantity:row.quantity,filled_quantity:row.quantity,filled_price:row.limit_price,status:'FILLED',commission:state.feeKnown?{actual_commission:'0'}:{},fees:state.feeKnown?[]:undefined};
      state.orders.set(row.client_order_id,detail);
      if(row.instrument_type==='OPTION')for(const leg of row.legs){const symbol=state.metadata.find(m=>m.option_type===leg.option_type&&m.expiration_date===leg.option_expire_date&&Number(m.strike_price)===Number(leg.strike_price))!.symbol;state.positions.set(symbol,(state.positions.get(symbol)??0)+Number(leg.quantity)*(leg.side==='BUY'?1:-1));}
      else state.positions.set(row.symbol,(state.positions.get(row.symbol)??0)+Number(row.quantity)*(row.side==='BUY'?1:-1));
      if(state.loseResponse)throw Error('response lost');return Response.json({client_order_id:row.client_order_id});
    }
    throw Error('Unexpected fixture endpoint '+path);
  },()=>time);
  const adapter=new WebullF5Adapter(client,{now:()=>time,knownInputs:()=>store.list('owner').map(op=>op.input),knownOrders:()=>store.list('owner').filter(op=>op.state!=='preview').map(op=>op.clientOrderId)});
  const service=createF5Service({store,broker:adapter,ownerId:'owner',enabled:true,provider:'webull',feed:'webull-sandbox',now:()=>time});
  const preview=async(request:F5Request)=>{const response=await service.handle('POST','/f5/preview','owner',request);assert.equal(response.status,201,JSON.stringify(response.value));return (response.value as {operation:F5Operation}).operation;};
  const submit=async(op:F5Operation)=>{const response=await service.handle('POST','/f5/submit','owner',{previewId:op.id});assert.equal(response.status,200,JSON.stringify(response.value));return (response.value as {operation:F5Operation}).operation;};
  const status=async()=>{const response=await service.handle('GET','/f5/status','owner');assert.equal(response.status,200,JSON.stringify(response.value));return response.value as F5Status;};
  return {state,store,client,adapter,service,preview,submit,status,advance:(ms:number)=>{time+=ms;}};
}
const open=(strategy:'wheel'|'pmcc'|'backspread'|'gamma'):F5Request=>({action:'open',strategy,underlying:'AAPL',quantity:1,contracts:strategy==='wheel'?[put.symbol]:strategy==='pmcc'?[long.symbol,call.symbol]:strategy==='backspread'?[call.symbol,upper.symbol]:[call.symbol,put.symbol],...(strategy==='wheel'?{wheelPhase:'put' as const}:{}),limitPrice:strategy==='backspread'?-1:2,maxCapitalUsd:50000});

test('Webull F5 runs all four strategies through the shared risk engine and one reviewed atomic provider order',async t=>{
  for(const strategy of ['wheel','pmcc','backspread','gamma'] as const){const f=setup();t.after(()=>f.store.close());const draft=await f.preview(open(strategy));assert.equal(f.state.placed.length,0);assert.ok(f.state.previews.length>0);const op=await f.submit(draft);assert.equal(op.state,'filled');assert.equal(f.state.placed.length,1);assert.equal((await f.submit(draft)).state,'filled');assert.equal(f.state.placed.length,1);const status=await f.status();assert.equal(status.mode,'sandbox');assert.equal(status.feed,'webull-sandbox');assert.equal(status.account?.optionsLevel,null);assert.equal(status.account?.optionsPermissionSource,'preview');assert.ok(status.operations.find(o=>o.id===op.id)?.lifecycle?.canClose);if(strategy==='backspread'){const row=f.state.placed[0];assert.equal(row.side,'SELL');assert.equal(row.limit_price,'1.00');assert.deepEqual((row.legs as Raw[]).map(l=>l.quantity),['1','2']);assert.equal(op.brokerOrder?.limit_price,'-1');}}
});
test('Webull F5 unknown order outcome is reconciled with a deterministic reference after adapter restart and never resent',async t=>{
  const f=setup();t.after(()=>f.store.close());const draft=await f.preview(open('gamma'));f.state.failLookup=true;f.state.loseResponse=true;const result=await f.service.handle('POST','/f5/submit','owner',{previewId:draft.id});assert.equal(result.status,202);assert.equal(f.store.get('owner',draft.id)?.state,'ambiguous');
  f.state.failLookup=false;const adapter=new WebullF5Adapter(f.client,{now:()=>initial,knownInputs:()=>f.store.list('owner').map(op=>op.input)}),service=createF5Service({store:f.store,broker:adapter,ownerId:'owner',enabled:true,provider:'webull',feed:'webull-sandbox',now:()=>initial});
  const status=await service.handle('GET','/f5/status','owner');assert.equal(status.status,200);assert.equal(f.store.get('owner',draft.id)?.state,'filled');assert.equal((await service.handle('POST','/f5/submit','owner',{previewId:draft.id})).status,200);assert.equal(f.state.placed.length,1);
});
test('Webull PMCC renewal closes the short first and requires a second explicit review after the confirmed fill',async t=>{
  const f=setup();t.after(()=>f.store.close());const parent=await f.submit(await f.preview(open('pmcc')));
  const base={action:'roll' as const,operationId:parent.id,newShortContract:replacement.symbol,limitPrice:1,maxCapitalUsd:50000};
  assert.equal((await f.service.handle('POST','/f5/preview','owner',{...base,step:'open-short'})).status,409);
  const close=await f.preview({...base,step:'close-short'});assert.equal(close.legs.length,1);assert.equal(close.legs[0].intent,'buy_to_close');await f.submit(close);assert.equal(f.state.placed.length,2);assert.equal(f.state.positions.get(call.symbol),0);assert.equal(f.state.positions.get(long.symbol),1);
  const status=await f.status();assert.equal(status.operations.find(op=>op.id===parent.id)?.lifecycle?.rollPhase,'open-short');
  const reopen=await f.preview({...base,step:'open-short'});assert.equal(reopen.legs[0].intent,'sell_to_open');assert.equal(f.state.placed.length,2);await f.submit(reopen);assert.equal(f.state.placed.length,3);assert.equal(f.state.placed[2].leg_in_or_out,'LEG_IN');assert.equal(f.state.positions.get(replacement.symbol),-1);
});
test('Webull Gamma hedge, unwind, close and report use confirmed quantities and preserve unknown fees',async t=>{
  const f=setup();t.after(()=>f.store.close());const parent=await f.submit(await f.preview(open('gamma')));
  const hedge=await f.preview({action:'hedge',operationId:parent.id,side:'buy',quantity:10,limitPrice:100,maxCapitalUsd:2000});await f.submit(hedge);assert.equal(f.state.positions.get('AAPL'),10);
  assert.equal((await f.service.handle('POST','/f5/preview','owner',{action:'close',operationId:parent.id,limitPrice:-1,maxCapitalUsd:50000})).status,409);
  await f.submit(await f.preview({action:'hedge',operationId:parent.id,side:'sell',quantity:10,limitPrice:101,maxCapitalUsd:2000}));
  f.state.feeKnown=false;const close=await f.submit(await f.preview({action:'close',operationId:parent.id,limitPrice:-1,maxCapitalUsd:50000}));assert.equal(close.state,'filled');const status=await f.status();assert.equal(status.operations.find(op=>op.id===parent.id)?.lifecycle?.phase,'closed');
  const report=await f.service.handle('GET','/f5/report','owner');assert.equal(report.status,200);const value=report.value as F5Report;assert.match(value.source,/Webull/);assert.equal(value.cycles.length,1);assert.equal(value.totals.feesUsd,null);assert.equal(value.totals.netPnlUsd,null);
});
test('Webull F5 refuses stale quotes, wrong owners, unconfirmed permissions and closed-market sends',async t=>{
  const f=setup();t.after(()=>f.store.close());assert.equal((await f.service.handle('GET','/f5/status','other')).status,403);f.state.quotesAt=initial-3600000;assert.equal((await f.service.handle('POST','/f5/preview','owner',open('wheel'))).status,409);assert.equal(f.state.placed.length,0);
  const g=setup();t.after(()=>g.store.close());const draft=await g.preview(open('wheel'));g.advance(6*3600000);assert.notEqual((await g.service.handle('POST','/f5/submit','owner',{previewId:draft.id})).status,200);assert.equal(g.state.placed.length,0);
});
test('Webull F5 proxy works without Alpaca credentials and isolates its endpoint, flags and owner',async()=>{
  const environment={BROKER_OWNER_USER_ID:'owner',TRADING_RUNNER_URL:'http://127.0.0.1:8790',TRADING_RUNNER_TOKEN:'private-fixture-token-with-at-least-32-bytes',WEBULL_MANUAL_ENABLED:'true'};let calls=0;
  const api=createF5Handlers({provider:'webull',environment:()=>environment,owner:async()=>({userId:'owner'}),fetcher:async(input,init)=>{calls++;assert.equal(new URL(String(input)).pathname,'/webull/f5/status');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+environment.TRADING_RUNNER_TOKEN);return Response.json({enabled:true,provider:'webull',mode:'sandbox'});}});
  assert.equal((await api.get(new Request('https://terminal.test/api/webull-f5'))).status,200);assert.equal(calls,1);
  const denied=createF5Handlers({provider:'webull',environment:()=>environment,owner:async()=>({userId:'other'}),fetcher:async()=>{throw Error('must not call');}});assert.equal((await denied.get(new Request('https://terminal.test/api/webull-f5'))).status,403);
});
test('Webull sessions distinguish delayed last-session analysis from execution and observe holidays, early closes and DST',()=>{
  assert.equal(webullMarketOpen(Date.parse('2026-11-26T18:00:00Z')),false);assert.equal(webullMarketOpen(Date.parse('2026-11-27T17:59:59Z')),true);assert.equal(webullMarketOpen(Date.parse('2026-11-27T18:00:00Z')),false);assert.equal(webullMarketOpen(Date.parse('2026-07-03T16:00:00Z')),false);assert.equal(webullMarketOpen(Date.parse('2026-06-18T13:30:00Z')),true);
  assert.equal(webullQuoteUsable('2026-11-24T20:59:00Z',Date.parse('2026-11-25T05:00:00Z')),true);assert.equal(webullQuoteUsable('2026-11-23T20:59:00Z',Date.parse('2026-11-25T05:00:00Z')),false);assert.equal(webullQuoteUsable('2026-11-24T20:59:00Z',Date.parse('2026-11-25T16:00:00Z')),false);
});
test('Webull F5 rejects a provider debit/credit mismatch and never infers partial leg fills from a parent',async t=>{
  const f=setup();t.after(()=>f.store.close());const draft=await f.preview({...open('backspread'),quantity:2} as F5Request);await f.submit(draft);
  const raw=[...f.state.orders.values()][0];raw.side='BUY';await assert.rejects(()=>f.adapter.orderByClientId(draft.clientOrderId),/débito\/crédito/);assert.equal(f.state.placed.length,1);
  raw.side='SELL';raw.status='PARTIAL_FILLED';raw.filled_quantity='1';const partial=await f.adapter.orderByClientId(draft.clientOrderId);assert.equal(partial?.status,'partially_filled');assert.ok(partial?.legs?.every(leg=>leg.filled_qty==='unknown'));
});
test('Webull generic and F5 desks share account leases and the F5 ledger refuses a different account binding',async t=>{
  const f=setup();t.after(()=>f.store.close());f.store.bind('owner','account-a');assert.throws(()=>f.store.bind('owner','account-b'),/otra cuenta/);
  const desk=createWebullService({filename:':memory:',ownerId:'owner',client:f.client,coordination:f.store,now:()=>initial});t.after(()=>desk.close());
  const lease=f.store.acquire('owner',initial)!;assert.ok(lease);assert.equal((await desk.handle('POST','/webull/preview','owner',{symbol:'AAPL',side:'BUY',quantity:1,limitPrice:100})).status,409);assert.equal(f.state.previews.length,0);f.store.release('owner',lease);
  assert.equal((await desk.handle('POST','/webull/preview','owner',{symbol:'AAPL',side:'BUY',quantity:1,limitPrice:100})).status,200);assert.equal(f.state.placed.length,0);
});
