import { existsSync } from 'node:fs';
import { backupTradingDatabase, verifyTradingBackup } from '../services/trading-runner/operations.mjs';
if (existsSync('.env.trading.local')) process.loadEnvFile('.env.trading.local');
try {
  const check = process.argv.indexOf('--verify');
  const result = check >= 0 ? await verifyTradingBackup(process.argv[check + 1]) : await backupTradingDatabase({
    source: process.env.TRADING_RUNNER_DB || '.sites-runtime/trading-runner.sqlite',
    directory: process.env.TRADING_BACKUP_DIRECTORY || '.sites-runtime/backups', keep: Number(process.env.TRADING_BACKUP_KEEP || 28),
  });
  console.log(JSON.stringify(result));
} catch { console.error('No se pudo crear o verificar el respaldo de SQLite. Revisa rutas, permisos e integridad.'); process.exitCode = 1; }
