import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { access, chmod, mkdir, readFile, readdir, lstat, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const backupName = /^tepic-trading-\d{8}T\d{9}Z-[a-f0-9]{8}\.sqlite$/;
const exists = filename => access(filename).then(() => true, () => false);

/** Online SQLite backup includes committed WAL state without copying an open file. */
export async function backupTradingDatabase({ source, directory, keep = 28, now = new Date() }) {
  if (!Number.isInteger(keep) || keep < 1 || keep > 365) throw Error('backup_retention_invalid');
  const input = path.resolve(source), destination = path.resolve(directory);
  if (!await exists(input)) throw Error('backup_source_missing');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const name = `tepic-trading-${now.toISOString().replace(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}.sqlite`;
  const filename = path.join(destination, name);
  const database = new DatabaseSync(input, { readOnly: true });
  try { await backup(database, filename); } finally { database.close(); }
  await chmod(filename, 0o600);
  const snapshot = new DatabaseSync(filename, { readOnly: true });
  let integrity;
  try { integrity = snapshot.prepare('pragma integrity_check').get(); } finally { snapshot.close(); }
  if (!integrity || Object.values(integrity)[0] !== 'ok') throw Error('backup_integrity_failed');
  const bytes = await readFile(filename), sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(filename + '.json', JSON.stringify({ version: 1, createdAt: now.toISOString(), bytes: bytes.length, sha256, integrity: 'ok' }) + '\n', { mode: 0o600 });
  const files = (await readdir(destination)).filter(name => backupName.test(name)).sort().reverse();
  let removed = 0;
  for (const oldName of files.slice(keep)) {
    const old = path.resolve(destination, oldName);
    // Retention can only remove this tool's regular files directly inside the
    // explicitly selected directory. It never recurses or follows symlinks.
    if (path.dirname(old) !== destination || !(await lstat(old)).isFile() || (await lstat(old)).isSymbolicLink()) continue;
    await unlink(old); removed++;
    const manifest = old + '.json';
    if (await exists(manifest) && (await lstat(manifest)).isFile() && !(await lstat(manifest)).isSymbolicLink()) await unlink(manifest);
  }
  return { filename, bytes: bytes.length, sha256, integrity: 'ok', removed };
}

export async function verifyTradingBackup(filename) {
  const target = path.resolve(filename), manifest = JSON.parse(await readFile(target + '.json', 'utf8'));
  const bytes = await readFile(target), digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== manifest.sha256 || bytes.length !== manifest.bytes) throw Error('backup_checksum_mismatch');
  const database = new DatabaseSync(target, { readOnly: true });
  try { if (Object.values(database.prepare('pragma integrity_check').get())[0] !== 'ok') throw Error('backup_integrity_failed'); }
  finally { database.close(); }
  return { valid: true, bytes: bytes.length, createdAt: manifest.createdAt };
}

/** One parent supervises one runner. No plans or broker requests originate here. */
export async function startTradingSupervisor({ root, entry = 'services/trading-runner/server.ts', environment = process.env,
  port = Number(environment.TRADING_RUNNER_PORT || 8790), intervalMs = 30000, graceMs = 45000, failures = 3,
  backoffMs = 1000, fetcher = fetch, log = message => console.log(message), backupSource = undefined, backupDirectory = undefined,
  backupIntervalMs = 6 * 3600000, backupKeep = 28 }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || intervalMs < 20 || failures < 1) throw Error('supervisor_settings_invalid');
  const runtime = path.resolve(root, '.sites-runtime'); await mkdir(runtime, { recursive: true });
  const lockfile = path.join(runtime, 'trading-supervisor.json'), token = randomUUID();
  try {
    const previous = JSON.parse(await readFile(lockfile, 'utf8'));
    let alive = false;
    try { if (Number.isInteger(previous.pid) && previous.pid > 0) { process.kill(previous.pid, 0); alive = true; } } catch {}
    if (alive) throw Error('supervisor_already_running');
    await unlink(lockfile);
  } catch (error) { if (error.message === 'supervisor_already_running') throw error; if (error.code && error.code !== 'ENOENT') throw error; }
  await writeFile(lockfile, JSON.stringify({ pid: process.pid, token, port, startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  let child, stopping = false, checking = false, restarting = false, failed = 0, restarts = 0, startedAt = 0, lastHealthyAt = null, lastBackupAt = 0;
  let restartTimer;
  const launch = () => {
    if (stopping) return;
    failed = 0; startedAt = Date.now();
    child = spawn(process.execPath, [path.resolve(root, entry)], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', () => log('No se pudo iniciar el proceso de ejecucion.'));
    child.once('exit', () => { if (!stopping && !restarting) scheduleRestart(); });
  };
  const scheduleRestart = () => {
    if (stopping || restartTimer) return;
    const wait = Math.min(60000, backoffMs * 2 ** Math.min(restarts, 6)); restarts++;
    log('El supervisor reiniciara el proceso de ejecucion.');
    restartTimer = setTimeout(() => { restartTimer = undefined; launch(); }, wait);
  };
  const terminate = async () => {
    const running = child;
    if (!running || running.exitCode !== null || running.signalCode !== null) return;
    await new Promise(resolve => {
      const force = setTimeout(() => { running.kill('SIGKILL'); }, 10000);
      running.once('exit', () => { clearTimeout(force); resolve(); }); running.kill('SIGTERM');
    });
  };
  const check = async () => {
    if (checking || stopping || restarting || !child || child.exitCode !== null || child.signalCode !== null) return;
    checking = true;
    try {
      let healthy = false;
      try { const response = await fetcher(`http://127.0.0.1:${port}/healthz`, { redirect: 'manual', signal: AbortSignal.timeout(5000), cache: 'no-store' }); healthy = response.ok; } catch {}
      if (healthy) { failed = 0; lastHealthyAt = new Date().toISOString(); }
      else if (Date.now() - startedAt >= graceMs) failed++;
      if (failed >= failures) { restarting = true; await terminate(); restarting = false; scheduleRestart(); return; }
      if (healthy && backupSource && backupDirectory && Date.now() - lastBackupAt >= backupIntervalMs && await exists(backupSource)) {
        try { await backupTradingDatabase({ source: backupSource, directory: backupDirectory, keep: backupKeep }); lastBackupAt = Date.now(); log('Copia SQLite verificada.'); }
        catch { log('No se pudo verificar la copia SQLite; se reintentara.'); }
      }
    } finally { checking = false; }
  };
  launch();
  const timer = setInterval(() => { void check().catch(() => log('Fallo la comprobacion del supervisor.')); }, intervalMs);
  return {
    state: () => ({ pid: child?.pid ?? null, restarts, failed, lastHealthyAt, lastBackupAt: lastBackupAt ? new Date(lastBackupAt).toISOString() : null }),
    check,
    async stop() {
      if (stopping) return; stopping = true; clearInterval(timer); clearTimeout(restartTimer); await terminate();
      try { const lock = JSON.parse(await readFile(lockfile, 'utf8')); if (lock.token === token) await unlink(lockfile); } catch {}
    },
  };
}
