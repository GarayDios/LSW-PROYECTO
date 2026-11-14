import { existsSync } from 'node:fs';
import { startTradingSupervisor } from '../services/trading-runner/operations.mjs';
if (existsSync('.env.trading.local')) process.loadEnvFile('.env.trading.local');
try {
  const hours = Number(process.env.TRADING_BACKUP_INTERVAL_HOURS || 6);
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw Error('invalid_backup_interval');
  const supervisor = await startTradingSupervisor({ root: process.cwd(),
    backupSource: process.env.TRADING_RUNNER_DB || '.sites-runtime/trading-runner.sqlite',
    backupDirectory: process.env.TRADING_BACKUP_DIRECTORY || '.sites-runtime/backups',
    backupIntervalMs: hours * 3600000, backupKeep: Number(process.env.TRADING_BACKUP_KEEP || 28),
  });
  const shutdown = () => { void supervisor.stop().then(() => process.exit(0)); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  console.log('Supervisor de ejecucion iniciado; revisa la salud y los planes en F5.');
} catch { console.error('No se pudo iniciar el supervisor. Revisa si ya existe una instancia y verifica la configuracion.'); process.exitCode = 1; }
