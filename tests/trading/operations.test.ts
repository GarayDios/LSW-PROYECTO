import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { backupTradingDatabase, verifyTradingBackup, startTradingSupervisor } from '../../services/trading-runner/operations.mjs';

const temporary = () => mkdtemp(path.join(os.tmpdir(), 'tepic-operations-'));
async function removeTemporary(root: string) {
  const absolute = path.resolve(root);
  assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
  assert.ok(path.basename(absolute).startsWith('tepic-operations-'));
  await rm(absolute, { recursive: true, force: true });
}
async function waitFor(predicate: () => Promise<boolean> | boolean) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw Error('supervisor_fixture_timeout');
}
async function freePort() {
  const server = net.createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const port = address.port; await new Promise<void>(resolve => server.close(() => resolve())); return port;
}

test('online backup captures committed WAL data and verifies checksums while the runner database stays open', async t => {
  const root = await temporary();
  const source = path.join(root, 'runner.sqlite'), directory = path.join(root, 'backups'), db = new DatabaseSync(source);
  t.after(async () => { db.close(); await removeTemporary(root); });
  db.exec("pragma journal_mode=WAL; create table orders(id text primary key,state text); insert into orders values('stable-id','reserved')");
  const result = await backupTradingDatabase({ source, directory });
  assert.equal((await verifyTradingBackup(result.filename)).valid, true);
  const snapshot = new DatabaseSync(result.filename, { readOnly: true });
  try { assert.equal(snapshot.prepare('select state from orders where id=?').get('stable-id')?.state, 'reserved'); }
  finally { snapshot.close(); }
  db.exec("update orders set state='filled'");
  const intact = new DatabaseSync(result.filename, { readOnly: true });
  try { assert.equal(intact.prepare('select state from orders').get()?.state, 'reserved'); } finally { intact.close(); }
  const bytes = await readFile(result.filename); bytes[bytes.length - 1] ^= 1; await writeFile(result.filename, bytes);
  await assert.rejects(verifyTradingBackup(result.filename), /checksum/);
});

test('backup retention removes only its own verified naming namespace and leaves unrelated files', async t => {
  const root = await temporary(); t.after(() => removeTemporary(root));
  const source = path.join(root, 'runner.sqlite'), directory = path.join(root, 'backups'), db = new DatabaseSync(source);
  db.exec('create table sample(value text)'); db.close();
  for (let index = 0; index < 3; index++) await backupTradingDatabase({ source, directory, keep: 2, now: new Date(Date.UTC(2026, 10, 14 + index)) });
  await writeFile(path.join(directory, 'other.sqlite'), 'user file');
  await backupTradingDatabase({ source, directory, keep: 2, now: new Date(Date.UTC(2026, 10, 18)) });
  const files = await readdir(directory);
  assert.equal(files.filter(file => file.startsWith('tepic-trading-') && file.endsWith('.sqlite')).length, 2);
  assert.equal(await readFile(path.join(directory, 'other.sqlite'), 'utf8'), 'user file');
  await assert.rejects(backupTradingDatabase({ source, directory, keep: 0 }), /retention/);
});

test('supervisor rejects a second instance and restarts an unhealthy owned process after consecutive failures', async t => {
  const root = await temporary();
  const port = await freePort();
  await writeFile(path.join(root, 'fixture.mjs'), "import{createServer}from'node:http';const server=createServer((_,response)=>{response.writeHead(503);response.end('stalled');});server.listen(Number(process.env.TEST_PORT),'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));\n");
  const supervisor = await startTradingSupervisor({ root, entry: 'fixture.mjs', environment: { ...process.env, TEST_PORT: String(port) }, port, intervalMs: 10000, graceMs: 0, failures: 2, backoffMs: 20, log: () => {} });
  t.after(async () => { await supervisor.stop(); await removeTemporary(root); });
  await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${port}/healthz`)).status === 503; } catch { return false; } });
  await assert.rejects(startTradingSupervisor({ root, entry: 'fixture.mjs', port }), /already_running/);
  const previous = supervisor.state().pid;
  await supervisor.check(); assert.equal(supervisor.state().restarts, 0);
  await supervisor.check(); assert.equal(supervisor.state().restarts, 1);
  await waitFor(() => !!supervisor.state().pid && supervisor.state().pid !== previous);
  await supervisor.stop();
  const files = await readdir(path.join(root, '.sites-runtime'));
  assert.equal(files.includes('trading-supervisor.json'), false);
});
