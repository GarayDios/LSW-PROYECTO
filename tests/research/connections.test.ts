import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionsHandler } from '../../src/api/connections/handler.ts';

const request = (probe = '') => new Request(`https://terminal.test/api/connections${probe ? '?probe=' + probe : ''}`);
const environment = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'sb_secret_XXXXXXXXXXXXXXXXXXXXXXXX', MONGO_BRIDGE_URL: 'http://127.0.0.1:8788', MONGO_BRIDGE_TOKEN: 'mongo-private-token-XXXXXXXXXXXXXXXXXXXXXXXX', ALPACA_API_KEY: 'private-api-key', ALPACA_SECRET_KEY: 'private-secret-key', BROKER_OWNER_USER_ID: 'owner', SEC_USER_AGENT: 'Terminal contact@example.test' };

test('connections report capabilities and authentication without leaking secrets or performing probes automatically', async () => {
  let loads = 0;
  const api = createConnectionsHandler({ environment: () => environment, owner: async () => null, load: async () => { loads++; } });
  const response = await api(request()), text = await response.text(), result = JSON.parse(text);
  assert.equal(response.status,200);
  assert.equal(result.identity,null);
  assert.equal(result.connections.find((c: {id: string}) => c.id === 'supabase').status, 'auth_required');
  assert.equal(result.connections.find((c: {id: string}) => c.id === 'institutional').status, 'missing_config');
  assert.doesNotMatch(text, /private-api-key|private-secret-key|sb_secret_|mongo-private-token|127\.0\.0\.1/);
  assert.equal(loads, 0);
  assert.equal((await api(request('supabase'))).status,401);
  assert.equal(loads, 0);
});

test('database probes read only the authenticated owner and hide backend errors', async () => {
  const calls: string[] = [];
  const api = createConnectionsHandler({ environment: () => environment, owner: async () => ({userId:'owner',displayName:'Test user'}), load: async (_config,ownerId) => { calls.push(ownerId); } });
  const result = await (await api(request('mongodb'))).json() as { connections: {id:string;status:string}[] };
  assert.deepEqual(calls,['owner']);
  assert.equal(result.connections.find(c=>c.id==='mongodb')!.status,'ready');
  assert.equal(result.connections.find(c=>c.id==='supabase')!.status,'configured');
  const failed = createConnectionsHandler({ environment:()=>environment,owner:async()=>({userId:'owner'}),load:async()=>{throw Error('SECRET BACKEND URL');} });
  const response = await failed(request('supabase')), body = await response.text();
  assert.doesNotMatch(body,/SECRET BACKEND URL/);
  assert.equal(JSON.parse(body).connections.find((c: {id:string})=>c.id==='supabase').status,'error');
  assert.equal((await api(request('untrusted'))).status,400);
});

test('incomplete provider configuration stays explicit without falling back to another database', async () => {
  let loads=0;
  const api = createConnectionsHandler({environment:()=>({SUPABASE_URL:'http://unsafe.example.test', ALPACA_API_KEY:'partial'}),owner:async()=>({userId:'owner'}),load:async()=>{loads++;} });
  const result = await (await api(request('supabase'))).json() as {connections:{id:string;status:string}[]};
  assert.equal(result.connections.find(c=>c.id==='supabase')!.status,'invalid_config');
  assert.equal(result.connections.find(c=>c.id==='alpaca')!.status,'invalid_config');
  assert.equal(result.connections.find(c=>c.id==='mongodb')!.status,'missing_config');
  assert.equal(loads,0);
});
