import test from 'node:test';
import assert from 'node:assert/strict';
import {WebullClient,readWebullConfig} from '../../src/api/brokers/webull/client.ts';
import {WebullDesk} from '../../src/api/brokers/webull/desk.ts';
import {createWebullService,type WebullOperation} from '../../services/trading-runner/webull-service.ts';
import type {WebullOptionsInput} from '../../src/cores/compartido/webull-model.ts';
const config=readWebullConfig({WEBULL_APP_KEY:'fixture-key',WEBULL_APP_SECRET:'fixture-secret',WEBULL_ACCOUNT_ID:'account',WEBULL_REGION:'us',WEBULL_ENVIRONMENT:'sandbox',WEBULL_MANUAL_ENABLED:'true'})!;
const meta={symbol:'AAPL270115C00100000',underlying_symbol:'AAPL',option_type:'CALL',status:'LISTING',tradable_status:'OC',expiration_date:'2027-01-15',style:'AMERICAN',strike_price:'100',multiplier:'100',deliverables:[{asset_type:'EQUITY',symbol:'AAPL',amount:'100'}]};
const ticket:WebullOptionsInput={symbol:'AAPL',side:'BUY',quantity:1,limitPrice:2,intent:'OPEN',strategy:'SINGLE',legs:[{symbol:meta.symbol,side:'BUY',ratio:1}]};
function setup(){
  const state={cash:20000,positions:[] as unknown[],metadata:[structuredClone(meta)] as Record<string,unknown>[],mutations:[] as {path:string;payload:Record<string,unknown>;category:string|null}[],previews:0,uncertain:false,cancelPending:false,
    detail:{client_order_id:'existing',combo_type:'NORMAL',orders:[{client_order_id:'existing',symbol:'AAPL',side:'BUY',status:'SUBMITTED',order_type:'LIMIT',instrument_type:'EQUITY',time_in_force:'DAY',total_quantity:'5',filled_quantity:'0',limit_price:'100',place_time_at:'2026-11-24T18:00:00Z',legs:[] as Record<string,unknown>[],option_strategy:'SINGLE'}]}};
  const client=new WebullClient({...config},async(url,init)=>{
    const target=new URL(String(url)),path=target.pathname,payload=init?.body?JSON.parse(String(init.body)):{};
    if(path==='/auth/tokens/create')return Response.json({token:'fixture-private-session',status:'NORMAL'});
    if(path==='/trading/accounts/list')return Response.json([{account_id:'account',account_type:'CASH'}]);
    if(path.includes('/contracts/'))return Response.json({data:state.metadata.filter(m=>m.symbol===target.searchParams.get('option_symbols'))});
    if(path.includes('/balances/'))return Response.json({total_asset_currency:'USD',account_currency_assets:[{currency:'USD',settled_cash:String(state.cash)}]});
    if(path.includes('/positions/'))return Response.json(state.positions);
    if(path==='/trading/orders/preview'){state.previews++;assert.equal(new Headers(init?.headers).get('category'),'US_OPTION');assert.ok(payload.new_orders[0].client_order_id.length<=32);return Response.json({estimated_cost:'200'});}
    if(path==='/trading/orders/get'){assert.equal(target.searchParams.get('account_id'),'account');return Response.json(state.detail);}
    if(['/trading/orders/place','/trading/orders/cancel','/trading/orders/replace'].includes(path)){
      state.mutations.push({path,payload,category:new Headers(init?.headers).get('category')});
      if(state.uncertain)throw Error('fixture response lost');
      if(path.endsWith('/place')){const order=payload.new_orders[0];state.detail={client_order_id:order.client_order_id,combo_type:'NORMAL',orders:[{...order,total_quantity:order.quantity,filled_quantity:'0',status:'SUBMITTED'}]};}
      if(path.endsWith('/cancel')&&!state.cancelPending)state.detail.orders[0].status='CANCELLED';
      if(path.endsWith('/replace')){const order=payload.modify_orders[0];state.detail.orders[0].total_quantity=order.quantity;state.detail.orders[0].limit_price=order.limit_price;}
      return Response.json({client_order_id:payload.client_order_id??payload.new_orders?.[0]?.client_order_id??payload.modify_orders?.[0]?.client_order_id});
    }
    throw Error('Unexpected fixture endpoint: '+path);
  });
  return {client,state};
}
const operation=(result:Awaited<ReturnType<ReturnType<typeof createWebullService>['handle']>>)=>{assert.equal(result.status,200,JSON.stringify(result.value));return (result.value as {operation:WebullOperation}).operation;};
test('Webull standard option review binds actual contracts, preserves net price and sends one atomic order after confirmation',async t=>{
  const {client,state}=setup(),service=createWebullService({filename:':memory:',ownerId:'owner',client});t.after(()=>service.close());
  const op=operation(await service.handle('POST','/webull/preview-options','owner',ticket));
  assert.equal(state.mutations.length,0);assert.equal(state.previews,1);assert.equal(op.clientOrderId.length,32);assert.equal(op.optionReview?.legs[0].shares,100);assert.equal(op.optionReview?.cashRequired,200);
  const request={operationId:op.id};const [a,b]=await Promise.all([service.handle('POST','/webull/submit','owner',request),service.handle('POST','/webull/submit','owner',request)]);
  assert.ok([a.status,b.status].includes(200));assert.ok([200,409].includes(a.status)&&[200,409].includes(b.status));assert.equal(state.mutations.length,1);assert.equal(state.mutations[0].category,'US_OPTION');
  const payload=state.mutations[0].payload.new_orders as Record<string,unknown>[];assert.equal(payload.length,1);assert.equal(payload[0].position_intent,'BUY_TO_OPEN');assert.equal(payload[0].limit_price,'2.00');assert.equal((payload[0].legs as Record<string,unknown>[])[0].symbol,'AAPL');
  assert.equal(operation(await service.handle('POST','/webull/reconcile','owner',request)).order?.state,'SUBMITTED');assert.equal(state.mutations.length,1);
});
test('Webull refuses adjusted, missing, expired and different-underlying contracts before provider preview',async()=>{
  for(const replacement of [{multiplier:'10'},{deliverables:[]},{expiration_date:'2020-01-01'},{underlying_symbol:'MSFT'},{tradable_status:'CLOSE'},{style:'EUROPEAN'}]){
    const {client,state}=setup();state.metadata=[{...meta,...replacement}];await assert.rejects(()=>new WebullDesk(client).reviewOptions(ticket));assert.equal(state.previews,0);assert.equal(state.mutations.length,0);
  }
});
test('Webull CSP requires settled assignment cash and CC requires available shares, not merely account equity',async()=>{
  const {client,state}=setup(),desk=new WebullDesk(client),sell={...ticket,side:'SELL' as const,legs:[{...ticket.legs[0],side:'SELL' as const}]};
  await assert.rejects(()=>desk.reviewOptions(sell),/100 acciones/);
  state.positions=[{symbol:'AAPL',instrument_type:'EQUITY',quantity:'200',legs:[{symbol:'AAPL',quantity:'80'}]}];await assert.rejects(()=>desk.reviewOptions(sell));
  state.positions=[{symbol:'AAPL',instrument_type:'EQUITY',quantity:'100',available_quantity:'100'}];assert.equal((await desk.reviewOptions(sell)).sharesRequired,100);
  state.metadata=[{...meta,option_type:'PUT',symbol:'AAPL270115P00100000'}];const put={...sell,legs:[{...sell.legs[0],symbol:'AAPL270115P00100000'}]};
  state.cash=9999;await assert.rejects(()=>desk.reviewOptions(put),/efectivo liquidado/);state.cash=10000;assert.equal((await desk.reviewOptions(put)).cashRequired,10000);
});
test('Webull multi-leg review verifies geometry and creates one strategy payload rather than sequential naked legs',async()=>{
  const {client,state}=setup(),desk=new WebullDesk(client);state.metadata.push({...meta,symbol:'AAPL270115C00110000',strike_price:'110'});
  const spread:WebullOptionsInput={...ticket,strategy:'VERTICAL',legs:[ticket.legs[0],{symbol:'AAPL270115C00110000',side:'SELL',ratio:1}]};
  const review=await desk.reviewOptions(spread),payload=desk.optionsPayload(spread,review,'fixture');assert.equal(payload.new_orders.length,1);assert.equal(payload.new_orders[0].legs.length,2);assert.equal(payload.new_orders[0].option_strategy,'VERTICAL');
  await assert.rejects(()=>desk.reviewOptions({...spread,strategy:'CALENDAR'}));
  client.config.region='mx';await assert.rejects(()=>desk.reviewOptions(spread),/sandbox US/);
});
test('Webull closing verifies the actual option terms and held direction before allowing close intent',async()=>{
  const {client,state}=setup(),desk=new WebullDesk(client),closing={...ticket,intent:'CLOSE' as const,side:'SELL' as const,legs:[{...ticket.legs[0],side:'SELL' as const}]};
  await assert.rejects(()=>desk.reviewOptions(closing));
  state.positions=[{symbol:'AAPL',instrument_type:'OPTION',quantity:'1',option_strategy:'SINGLE',legs:[{symbol:'AAPL',quantity:'1',option_type:'CALL',option_expire_date:'2027-01-15',option_exercise_price:'100'}]}];
  const review=await desk.reviewOptions(closing);assert.equal(desk.optionsPayload(closing,review,'fixture').new_orders[0].position_intent,'SELL_TO_CLOSE');
  await assert.rejects(()=>desk.reviewOptions({...closing,side:'BUY',legs:[ticket.legs[0]]}));
});
test('Webull cancel has its own immutable review, requires confirmation once and reconciles pending cancellation without resending',async t=>{
  const {client,state}=setup(),service=createWebullService({filename:':memory:',ownerId:'owner',client});t.after(()=>service.close());state.cancelPending=true;
  const op=operation(await service.handle('POST','/webull/preview-change','owner',{kind:'cancel',reference:'existing'}));assert.equal(state.mutations.length,0);
  const request={operationId:op.id};assert.equal(operation(await service.handle('POST','/webull/submit','owner',request)).state,'ambiguous');assert.equal(state.mutations.length,1);
  await service.handle('POST','/webull/submit','owner',request);assert.equal(state.mutations.length,1);
  state.detail.orders[0].status='CANCELLED';assert.equal(operation(await service.handle('POST','/webull/reconcile','owner',request)).state,'submitted');assert.equal(state.mutations.length,1);
});
test('Webull management rejects a changed order, invalid reductions and concurrent fills before sending a mutation',async t=>{
  const {client,state}=setup(),service=createWebullService({filename:':memory:',ownerId:'owner',client});t.after(()=>service.close());state.detail.orders[0].status='PARTIAL_FILLED';state.detail.orders[0].filled_quantity='2';
  for(const quantity of [2,6])assert.equal((await service.handle('POST','/webull/preview-change','owner',{kind:'replace',reference:'existing',quantity,limitPrice:99})).status,409);
  const op=operation(await service.handle('POST','/webull/preview-change','owner',{kind:'replace',reference:'existing',quantity:4,limitPrice:99}));state.detail.orders[0].filled_quantity='3';
  assert.equal((await service.handle('POST','/webull/submit','owner',{operationId:op.id})).status,409);assert.equal(state.mutations.length,0);
  const fresh=operation(await service.handle('POST','/webull/preview-change','owner',{kind:'replace',reference:'existing',quantity:4,limitPrice:99}));
  assert.equal(operation(await service.handle('POST','/webull/submit','owner',{operationId:fresh.id})).state,'submitted');assert.equal(state.mutations.length,1);assert.equal(state.mutations[0].payload.account_id,'account');
});
test('Webull option replacement uses actual leg IDs and preserves their quantity ratios',async()=>{
  const {client,state}=setup(),desk=new WebullDesk(client);Object.assign(state.detail.orders[0],{instrument_type:'OPTION',option_strategy:'VERTICAL',legs:[{id:'leg1',symbol:'AAPL',side:'BUY',quantity:'5'},{id:'leg2',symbol:'AAPL',side:'SELL',quantity:'5'}]});
  const review=await desk.reviewChange({kind:'replace',reference:'existing',quantity:3,limitPrice:2});assert.deepEqual(review.legIds,[{id:'leg1',quantity:'3'},{id:'leg2',quantity:'3'}]);
  await desk.executeChange(review);assert.equal(state.mutations[0].category,'US_OPTION');assert.deepEqual((state.mutations[0].payload.modify_orders as Record<string,unknown>[])[0].legs,review.legIds);
  delete state.detail.orders[0].legs[0].id;await assert.rejects(()=>desk.reviewChange({kind:'replace',reference:'existing',quantity:3,limitPrice:2}));
});
test('Webull new actions respect server disable, owner binding and account binding, including reconciliation',async t=>{
  const {client,state}=setup(),service=createWebullService({filename:':memory:',ownerId:'owner',client});t.after(()=>service.close());
  assert.equal((await service.handle('POST','/webull/preview-options','other',ticket)).status,403);
  const op=operation(await service.handle('POST','/webull/preview-options','owner',ticket));client.config.enabled=false;
  assert.equal((await service.handle('POST','/webull/submit','owner',{operationId:op.id})).status,409);assert.equal(state.mutations.length,0);
  client.config.enabled=true;client.config.accountId='other-account';assert.equal((await service.handle('POST','/webull/submit','owner',{operationId:op.id})).status,409);assert.equal((await service.handle('POST','/webull/reconcile','owner',{operationId:op.id})).status,409);assert.equal(state.mutations.length,0);
});
