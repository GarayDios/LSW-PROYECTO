import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readWebullConfig,webullSignature,WebullClient,type WebullInput,type WebullOrder } from '../../src/api/brokers/webull/client.ts';
import { createWebullService,type WebullOperation } from '../../services/trading-runner/webull-service.ts';
import { createWebullHandlers } from '../../src/api/brokers/webull/handlers.ts';
import { createTradingHandlers } from '../../src/api/trading/handlers.ts';
import { createF5Handlers } from '../../src/api/f5/handlers.ts';
import { createRunnerService } from '../../services/trading-runner/server.ts';
import { openRunnerStore } from '../../services/trading-runner/store.ts';
const env={WEBULL_APP_KEY:'fixture-key',WEBULL_APP_SECRET:'fixture-private',WEBULL_ACCOUNT_ID:'account',WEBULL_REGION:'mx',WEBULL_ENVIRONMENT:'sandbox',WEBULL_MANUAL_ENABLED:'true'};
const config=readWebullConfig(env)!;
const input:WebullInput={symbol:'AAPL',side:'BUY',quantity:1,limitPrice:100};
const operation=(result:Awaited<ReturnType<ReturnType<typeof createWebullService>['handle']>>)=>(result.value as {operation:WebullOperation}).operation;

test('Webull signature matches the published official vector including encoded spaces and compact body',()=>{
  const headers={'x-app-key':'776da210ab4a452795d74e726ebd74b6','x-timestamp':'2022-01-04T03:55:31Z','x-signature-version':'1.0','x-signature-algorithm':'HMAC-SHA1','x-signature-nonce':'48ef5afed43d4d91ae514aaeafbc29ba',host:'api.webull.com'};
  assert.equal(webullSignature('/trade/place_order',{a1:'webull',a2:'123',a3:'xxx',q1:'yyy'},JSON.stringify({k1:123,k2:'this is the api request body',k3:true,k4:{foo:[1,2]}}),headers,'0f50a2e853334a9aae1a783bee120c1f'),'kvlS6opdZDhEBo5jq40nHYXaLvM=');
});
test('Webull requires explicit sandbox config and never accepts a production endpoint',()=>{
  assert.equal(readWebullConfig({}),null);
  for(const invalid of [{...env,WEBULL_ENVIRONMENT:'production'},{...env,WEBULL_APP_SECRET:''},{...env,WEBULL_REGION:'xx'}])assert.throws(()=>readWebullConfig(invalid));
  assert.equal(readWebullConfig({...env,WEBULL_REGION:'us'})?.host,'api.sandbox.webull.com');
  assert.equal(config.host,'us-openapi-alb.uat.webullbroker.com');
});
test('Webull signs the exact v3 order body and hides provider diagnostics on denied or redirected requests',async()=>{
  const client=new WebullClient(config,async(url,init)=>{
    assert.equal(new URL(String(url)).host,config.host);assert.equal(init?.redirect,'manual');
    const body=JSON.parse(String(init?.body));assert.equal(body.account_id,'account');assert.equal(body.new_orders[0].support_trading_session,'CORE');assert.equal(body.new_orders[0].quantity,'1');
    assert.ok(new Headers(init?.headers).get('x-signature'));assert.ok(!new Headers(init?.headers).has('x-app-secret'));
    return Response.json({client_order_id:'fixture'});
  });
  await client.submit(input,'fixture');
  for(const status of [302,401,403,429,500]){
    const denied=new WebullClient(config,async()=>new Response('private-'+config.appSecret,{status}));
    await assert.rejects(()=>denied.verifyAccount(),error=>error instanceof Error&&!error.message.includes(config.appSecret));
  }
});
class FakeClient extends WebullClient{
  posts=0;fail=false;reviews=0;
  async verifyAccount(){}
  async preview(){this.reviews++;}
  async submit(){this.posts++;if(this.fail)throw Error('private unknown HTTP result');}
  async lookup(order:WebullInput,id:string):Promise<WebullOrder>{return {...order,clientOrderId:id,state:'FILLED',filledQuantity:order.quantity};}
}
test('Webull manual review is owner scoped, immutable, expires, and simultaneous confirmations issue one order',async t=>{
  let now=Date.now();const client=new FakeClient(config);const service=createWebullService({filename:':memory:',ownerId:'owner',client,now:()=>now});t.after(()=>service.close());
  assert.equal((await service.handle('POST','/webull/preview','other',input)).status,403);
  const op=operation(await service.handle('POST','/webull/preview','owner',input));assert.equal(client.posts,0);
  assert.equal((await service.handle('POST','/webull/submit','owner',{operationId:op.id,limitPrice:1})).status,400);
  const results=await Promise.all([service.handle('POST','/webull/submit','owner',{operationId:op.id}),service.handle('POST','/webull/submit','owner',{operationId:op.id})]);
  assert.equal(client.posts,1);assert.equal(operation(results[0]).input.limitPrice,100);
  await service.handle('POST','/webull/submit','owner',{operationId:op.id});assert.equal(client.posts,1);
  const expired=operation(await service.handle('POST','/webull/preview','owner',input));now+=60001;
  assert.equal((await service.handle('POST','/webull/submit','owner',{operationId:expired.id})).status,409);assert.equal(client.posts,1);
});
test('uncertain Webull submissions persist across restart and reconcile the same reference without resending',async()=>{
  const filename=path.join(tmpdir(),'tepic-webull-'+randomUUID()+'.sqlite');const client=new FakeClient(config);client.fail=true;
  let service=createWebullService({filename,ownerId:'owner',client});
  try{
    const op=operation(await service.handle('POST','/webull/preview','owner',input));
    assert.equal(operation(await service.handle('POST','/webull/submit','owner',{operationId:op.id})).state,'ambiguous');
    service.close();service=createWebullService({filename,ownerId:'owner',client});
    assert.equal(operation(await service.handle('POST','/webull/submit','owner',{operationId:op.id})).state,'ambiguous');assert.equal(client.posts,1);
    const checked=operation(await service.handle('POST','/webull/reconcile','owner',{operationId:op.id}));
    assert.equal(checked.clientOrderId,op.clientOrderId);assert.equal(checked.order?.filledQuantity,1);assert.equal(client.posts,1);
  }finally{service.close();rmSync(filename,{force:true});}
});
test('unconfigured Webull reports pending honestly and disabled execution never sends',async t=>{
  const absent=createWebullService({filename:':memory:',ownerId:'owner',client:null});t.after(()=>absent.close());
  const status=await absent.handle('GET','/webull/status','owner');assert.equal((status.value as {connected:boolean}).connected,false);
  const client=new FakeClient({...config,enabled:false});const service=createWebullService({filename:':memory:',ownerId:'owner',client});t.after(()=>service.close());
  const op=operation(await service.handle('POST','/webull/preview','owner',input));
  assert.equal((await service.handle('POST','/webull/submit','owner',{operationId:op.id})).status,409);assert.equal(client.posts,0);
});
const terminalEnv={ALPACA_API_KEY:'fixture',ALPACA_SECRET_KEY:'fixture',BROKER_OWNER_USER_ID:'owner',TRADING_RUNNER_URL:'http://127.0.0.1:8790',TRADING_RUNNER_TOKEN:'fixture-token-at-least-32-characters',ALPACA_AUTOMATION_ENABLED:'true',ALPACA_F5_ENABLED:'true',ALPACA_F5_AUTOMATION_ENABLED:'true'};
const post=(body:unknown,origin='https://terminal.test')=>new Request('https://terminal.test/api/webull',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('manual mode rejects automation even when legacy environment flags are enabled',async()=>{
  let calls=0;const deps={environment:()=>terminalEnv,owner:async()=>({userId:'owner'}),fetcher:async()=>{calls++;return Response.json({});}};
  const stocks=createTradingHandlers(deps),options=createF5Handlers(deps);
  for(const action of ['tick','resume'])assert.equal((await stocks.automationPost(post({action}))).status,409);
  for(const action of ['tick','enable-plan'])assert.equal((await options.post(post({action:'control',request:{action}}))).status,409);
  assert.equal(calls,0);
});
test('manual production service cannot start background execution or accept a legacy tick',async t=>{
  const store=openRunnerStore(':memory:');
  const service=createRunnerService({store,ownerId:'owner',token:terminalEnv.TRADING_RUNNER_TOKEN,enabled:true,manualOnly:true,broker:null,history:async()=>[]});
  await new Promise<void>(resolve=>service.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{service.stopLoop();await new Promise<void>(resolve=>service.server.close(()=>resolve()));store.close();});
  service.startLoop();assert.equal(service.runner.status().enabled,false);
  const address=service.server.address();assert.ok(address&&typeof address!=='string');
  const response=await fetch(`http://127.0.0.1:${address.port}/tick`,{method:'POST',headers:{Authorization:'Bearer '+terminalEnv.TRADING_RUNNER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({ownerId:'owner'})});
  assert.equal(response.status,409);assert.equal((await response.json() as {error:string}).error,'manual_orders_only');
});
test('Webull proxy rejects untrusted origins and owners, enforces enable flag and does not leak service errors',async()=>{
  let calls=0;const deps={environment:()=>terminalEnv,owner:async()=>({userId:'owner'}),fetcher:async()=>{calls++;return Response.json({error:{code:'unknown',message:'private-key-and-service-token'}},{status:500});}};
  const api=createWebullHandlers(deps);
  assert.equal((await api.post(post({action:'preview',input},'https://other.test'))).status,403);
  assert.equal((await createWebullHandlers({...deps,owner:async()=>({userId:'other'})}).get()).status,403);
  assert.equal((await api.post(post({action:'submit',operationId:randomUUID()}))).status,409);assert.equal(calls,0);
  const response=await api.get();assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private-key-and-service-token/);
});
