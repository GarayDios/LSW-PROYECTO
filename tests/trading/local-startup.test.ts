import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { readLocalEnvironment,localBrokerPort,isListening } from '../../scripts/local-services.mjs';
import { createDevProcessSupervisor } from '../../scripts/dev-processes.mjs';

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

const httpFixture = `const server=require('node:http').createServer((_,response)=>response.end('terminal available'));server.listen(0,'127.0.0.1',()=>process.stdout.write(String(server.address().port)+'\\n'));`;

test('an auxiliary service failure preserves the live terminal HTTP server', { timeout: 10000 }, async t => {
  const exitCodes: number[] = [], warnings: string[] = [];
  const supervisor = createDevProcessSupervisor({ cwd: process.cwd(), onExit: (code: number) => exitCodes.push(code),
    stdio: 'pipe', log: () => {}, warn: (message: string) => warnings.push(message) });
  t.after(() => supervisor.stop());
  const frontend = supervisor.start(['--input-type=commonjs', '-e', httpFixture], process.env, 'La interfaz');
  assert.ok(frontend.stdout);
  const [output] = await once(frontend.stdout, 'data');
  const address = `http://127.0.0.1:${Number(String(output).trim())}`;
  const auxiliary = supervisor.start(['-e', 'process.exit(1)'], process.env, 'El servicio MongoDB', { required: false });
  await once(auxiliary, 'exit');
  const response = await fetch(address, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200); assert.equal(await response.text(), 'terminal available');
  assert.deepEqual(exitCodes, []); assert.equal(warnings.length, 1); assert.match(warnings[0], /terminal sigue disponible/);
  const stopped = once(frontend, 'exit'); supervisor.stop(); await stopped;
});

test('failure of the required frontend still stops owned auxiliary services', { timeout: 10000 }, async t => {
  const exitCodes: number[] = [];
  const supervisor = createDevProcessSupervisor({ cwd: process.cwd(), onExit: (code: number) => exitCodes.push(code), stdio: 'pipe', log: () => {}, warn: () => {} });
  t.after(() => supervisor.stop());
  const auxiliary = supervisor.start(['--input-type=commonjs', '-e', httpFixture], process.env, 'El servicio auxiliar', { required: false });
  assert.ok(auxiliary.stdout); await once(auxiliary.stdout, 'data');
  const closed = once(auxiliary, 'exit');
  const frontend = supervisor.start(['-e', 'process.exit(2)'], process.env, 'La interfaz');
  await once(frontend, 'exit'); await closed;
  assert.deepEqual(exitCodes, [2]);
});
