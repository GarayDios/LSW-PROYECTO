import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { readLocalEnvironment,localBrokerPort,isListening } from '../../scripts/local-services.mjs';

test('local services preserve explicit environment precedence and use separate private service config',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'tepic-startup-'));
  const files=['app.env','service.env'];
  try{
    writeFileSync(path.join(root,files[0]),'BROKER_OWNER_USER_ID=owner\nTRADING_RUNNER_TOKEN=shared\nALPACA_API_KEY=terminal-key\n');
    writeFileSync(path.join(root,files[1]),'ALPACA_API_KEY=service-key\nSERVICE_ONLY=private\n');
    const app=readLocalEnvironment(root,[files[0]],{}),service=readLocalEnvironment(root,files,{});
    assert.equal(app.ALPACA_API_KEY,'terminal-key');assert.equal(app.SERVICE_ONLY,undefined);
    assert.equal(service.ALPACA_API_KEY,'service-key');assert.equal(service.TRADING_RUNNER_TOKEN,app.TRADING_RUNNER_TOKEN);
    assert.equal(readLocalEnvironment(root,files,{ALPACA_API_KEY:'explicit'}).ALPACA_API_KEY,'explicit');
  }finally{for(const file of files)unlinkSync(path.join(root,file));rmdirSync(root);}
});
test('development only starts brokers for a configured local origin, never remote or userinfo URLs',()=>{
  assert.equal(localBrokerPort({}),null);
  for(const url of ['https://remote.test','http://name:secret@localhost:8790','http://localhost:8790/private','http://localhost:8790?token=value'])assert.equal(localBrokerPort({TRADING_RUNNER_URL:url,TRADING_RUNNER_TOKEN:'shared'}),null);
  assert.deepEqual(localBrokerPort({TRADING_RUNNER_URL:'http://127.0.0.1:8790',TRADING_RUNNER_TOKEN:'shared'}),{port:8790,host:'127.0.0.1'});
});
test('development detects an existing listener so it does not launch a duplicate local service',async()=>{
  const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  try{assert.equal(await isListening(address.port),true);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  assert.equal(await isListening(address.port),false);
});
