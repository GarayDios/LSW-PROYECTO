import test from 'node:test';
import assert from 'node:assert/strict';
import { WebullClient,readWebullConfig,webullSignature } from '../../src/api/brokers/webull/client.ts';
import {createWebullService} from '../../services/trading-runner/webull-service.ts';

const env={WEBULL_APP_KEY:'fixture-app-key',WEBULL_APP_SECRET:'fixture-secret',WEBULL_ACCOUNT_ID:'fixture-account',WEBULL_REGION:'mx',WEBULL_ENVIRONMENT:'sandbox',WEBULL_MANUAL_ENABLED:'false'};
const config=readWebullConfig(env)!;
const initial=Date.parse('2026-11-24T16:00:00Z');
const normal=(at=initial)=>({token:'fixture-private-token',status:'NORMAL',expires:at+900000});
const account=()=>Response.json([{account_id:config.accountId,account_type:'CASH',account_number:'12345678',account_label:'Cuenta '+config.accountId}]);

test('SHA256 signature matches an independently calculated Python HMAC fixture and legacy vectors stay explicit',()=>{
  const headers={'x-app-key':'776da210ab4a452795d74e726ebd74b6','x-timestamp':'2022-01-04T03:55:31Z','x-signature-version':'1.0','x-signature-algorithm':'HMAC-SHA256','x-signature-nonce':'48ef5afed43d4d91ae514aaeafbc29ba',host:'api.webull.com.mx'};
  const actual=webullSignature('/trade/place_order',{a1:'webull',a2:'123',a3:'xxx',q1:'yyy'},JSON.stringify({k1:123,k2:'this is the api request body',k3:true,k4:{foo:[1,2]}}),headers,'0f50a2e853334a9aae1a783bee120c1f');
  assert.equal(actual,'VrF1lz0AHTrm5HeozzozZ8/qvoJdFK0TYEU4IE/vcR8=');
  assert.throws(()=>webullSignature('/x',{},undefined,{},'fixture'));
  assert.equal(readWebullConfig({...env,WEBULL_ENVIRONMENT:'uat',WEBULL_REGION:' MX '})!.host,config.host);
  assert.equal(readWebullConfig({...env,WEBULL_REGION:undefined,WEBULL_REGION_ID:'us'})!.host,'api.sandbox.webull.com');
});

test('account reads initialize one private token for concurrent calls, sign with SHA256 and reuse the session',async()=>{
  let tokens=0,reads=0,clock=initial;
  const client=new WebullClient(config,async(input,init)=>{
    const url=new URL(String(input)),headers=new Headers(init?.headers);
    assert.equal(url.origin,'https://'+config.host);assert.equal(init?.redirect,'manual');
    assert.equal(headers.get('x-signature-algorithm'),'HMAC-SHA256');assert.ok(!headers.has('x-app-secret'));
    assert.ok(!url.href.includes(config.appKey));
    if(url.pathname==='/auth/tokens/create'){
      tokens++;assert.equal(init?.method,'POST');assert.ok(!headers.has('x-access-token'));assert.ok(!headers.has('category'));
      assert.deepEqual(JSON.parse(String(init?.body)),tokens===1?{}:{token:'fixture-private-token'});
      return Response.json(normal(clock));
    }
    assert.equal(url.pathname,'/trading/accounts/list');assert.equal(init?.method,'GET');assert.equal(headers.get('x-access-token'),'fixture-private-token');reads++;return account();
  },()=>clock);
  await Promise.all([client.verifyAccount(),client.verifyAccount()]);
  assert.equal(tokens,1);assert.equal(reads,1);
  await client.verifyAccount();assert.equal(tokens,1);assert.equal(reads,1,'brief account cache protects the Account List quota');
  assert.equal(client.authenticationState().status,'ready');
  assert.ok(!JSON.stringify(client.authenticationState()).includes('fixture-private-token'));
  assert.equal(client.accountSummary()?.type,'CASH');assert.equal(client.accountSummary()?.maskedNumber,'…5678');
  assert.ok(!JSON.stringify(client.accountSummary()).includes(config.accountId));
  clock+=301000;await client.verifyAccount();assert.equal(tokens,2);
});

test('pending app verification is surfaced without exposing the token, busy loops or recreating SMS requests',async t=>{
  let clock=initial,creates=0,checks=0,reads=0;
  const client=new WebullClient(config,async(input,init)=>{
    const path=new URL(String(input)).pathname;
    if(path==='/auth/tokens/create'){creates++;return Response.json({...normal(clock),status:'PENDING'});}
    if(path==='/auth/tokens/check'){checks++;assert.deepEqual(JSON.parse(String(init?.body)),{token:'fixture-private-token'});return Response.json(normal(clock));}
    reads++;return account();
  },()=>clock);
  const service=createWebullService({filename:':memory:',ownerId:'owner',client});t.after(()=>service.close());
  const status=await service.handle('GET','/webull/status','owner');
  const value=status.value as {connected:boolean;authentication:{status:string};connectionCode:string;message:string};
  assert.equal(value.connected,false);assert.equal(value.authentication.status,'pending');assert.equal(value.connectionCode,'webull_verification_required');assert.match(value.message,/app Webull/);
  assert.ok(!JSON.stringify(value).includes('fixture-private-token'));
  await assert.rejects(()=>client.verifyAccount(),{code:'webull_verification_required'});assert.equal(creates,1);assert.equal(checks,0);assert.equal(reads,0);
  clock+=3001;await client.verifyAccount();assert.equal(creates,1);assert.equal(checks,1);assert.equal(reads,1);
  assert.equal(client.authenticationState().status,'ready');
});

test('authentication rejection is sanitized, rate limited and never changes region or environment',async()=>{
  let calls=0;
  const client=new WebullClient(config,async(input)=>{calls++;assert.equal(new URL(String(input)).host,config.host);return Response.json({error_code:'UNAUTHORIZED',message:config.appSecret},{status:401});},()=>initial);
  for(let i=0;i<2;i++)await assert.rejects(()=>client.verifyAccount(),error=>{assert.ok(error instanceof Error);assert.ok(!error.message.includes(config.appSecret));return 'code'in error&&error.code==='webull_auth_rejected';});
  assert.equal(calls,1);assert.equal(client.authenticationState().status,'error');
});

test('only a confirmed missing token endpoint permits the documented legacy route; expired tokens stay unusable',async()=>{
  const paths:string[]=[];
  const client=new WebullClient(config,async(input)=>{
    const path=new URL(String(input)).pathname;paths.push(path);
    if(path==='/auth/tokens/create')return new Response('',{status:404});
    if(path==='/openapi/auth/token/create')return Response.json(normal());
    return account();
  },()=>initial);
  await client.verifyAccount();assert.deepEqual(paths,['/auth/tokens/create','/openapi/auth/token/create','/trading/accounts/list']);
  const expired=new WebullClient(config,async()=>Response.json({...normal(),expires:initial-1}),()=>initial);
  await assert.rejects(()=>expired.verifyAccount(),{code:'webull_token_invalid'});
});

test('account mismatch remains distinct from authentication and a timed out order is never replayed',async()=>{
  let writes=0;
  const client=new WebullClient(config,async(input)=>{
    const path=new URL(String(input)).pathname;
    if(path==='/auth/tokens/create')return Response.json(normal());
    if(path==='/trading/accounts/list')return Response.json([{account_id:'other-account'}]);
    if(path==='/trading/orders/place'){writes++;throw Error(config.appSecret);}
    throw Error('unexpected request');
  },()=>initial);
  await assert.rejects(()=>client.verifyAccount(),{code:'webull_account'});
  assert.equal(client.authenticationState().status,'ready');
  await assert.rejects(()=>client.submit({symbol:'AAPL',side:'BUY',quantity:1,limitPrice:100},'fixture'),error=>error instanceof Error&&!error.message.includes(config.appSecret));
  assert.equal(writes,1);
});
