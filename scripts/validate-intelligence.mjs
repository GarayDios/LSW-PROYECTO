import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { readBrokerConfig } from '../src/api/brokers/config.ts';
import { fetchAlpacaHistory, newYorkDate, symbolSchema } from '../src/api/market/alpaca-history.ts';
import { evaluateForecastHistory } from '../src/cores/02-inteligencia-artificial/evaluation.ts';

// Freeze provider data once; replay uses neither the network nor credentials.
const candle = z.object({ time: z.number().finite(), open: z.number().positive(), high: z.number().positive(),
  low: z.number().positive(), close: z.number().positive(), volume: z.number().nonnegative() })
  .refine(b => Number.isFinite(new Date(b.time).getTime()) && b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close));
const snapshotSchema = z.object({ version: z.literal(1), histories: z.array(z.object({
  symbol: symbolSchema, source: z.literal('alpaca'), feed: z.enum(['iex', 'sip']), adjustment: z.literal('split'),
  interval: z.literal('1d'), start: z.string().date(), end: z.string().date(), asOf: z.string().datetime(),
  bars: z.array(candle).min(1), warnings: z.array(z.string()),
})).min(1) });

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('npm run intelligence:validate -- [--symbols AAPL,MSFT,SPY] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--out outputs/intelligence]\nReplay: npm run intelligence:validate -- --snapshot outputs/intelligence/snapshot.json [--out outputs/intelligence-replay]');
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--symbols', '--start', '--end', '--out', '--snapshot'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i]]) throw new Error('Argumentos inválidos; usa --help.');
    options[args[i]] = args[i + 1];
  }
  if (options['--snapshot'] && ['--symbols', '--start', '--end'].some(key => options[key])) throw new Error('Replay usa las fechas y símbolos del snapshot.');
  let snapshot;
  if (options['--snapshot']) {
    snapshot = snapshotSchema.parse(JSON.parse(await readFile(options['--snapshot'], 'utf8')));
  } else {
    if (existsSync('.env.local')) process.loadEnvFile('.env.local');
    const config = readBrokerConfig(process.env);
    if (!config) throw new Error('Falta configuración de Alpaca en .env.local.');
    const now = new Date();
    const end = options['--end'] ?? newYorkDate(now.getTime() - 86400000);
    const start = options['--start'] ?? `${Number(end.slice(0, 4)) - 10}${end.slice(4)}`;
    const symbols = [...new Set((options['--symbols'] ?? 'AAPL,MSFT,SPY').split(',').map(s => symbolSchema.parse(s.trim().toUpperCase())))];
    const histories = [];
    for (const symbol of symbols) {
      console.log(`Consultando ${symbol}: ${start} a ${end} (solo lectura).`);
      histories.push(await fetchAlpacaHistory(config, { symbol, start, end, interval: '1d' }, fetch, now.getTime()));
    }
    snapshot = snapshotSchema.parse({ version: 1, histories });
  }
  const serialized = JSON.stringify(snapshot, null, 2) + '\n';
  const reports = snapshot.histories.flatMap(history => {
    // Historical runs use the requested end, never today's clock to assess staleness.
    const asOf = new Date(Math.min(Date.parse(history.asOf), Date.parse(history.end + 'T00:00:00Z') + 30 * 3600000)).toISOString();
    return [5, 20, 60].map(horizonSessions => ({ ...evaluateForecastHistory({ symbol: history.symbol,
      bars: history.bars, source: `alpaca:${history.feed}:split`, asOf, horizonSessions }),
      observations: history.bars.length, warnings: history.warnings }));
  });
  const modelFiles = ['src/cores/02-inteligencia-artificial/forecast.ts', 'src/cores/02-inteligencia-artificial/evaluation.ts', 'src/cores/01-analisis-tecnico/market-analysis.ts'];
  const modelHash = createHash('sha256');
  for (const file of modelFiles) modelHash.update(file).update(await readFile(file));
  let revision = null;
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Hashes identify the actual evaluated source even without git. */ }
  const report = { version: 1, snapshotSha256: createHash('sha256').update(serialized).digest('hex'),
    modelSha256: modelHash.digest('hex'), revision, node: process.version,
    protocol: 'Production kNN; fixed parameters; chronological expanding training; non-overlapping outcomes; at most 60 evaluation periods per horizon; minimum 8 periods and >2% MAE improvement over both baselines.',
    limitations: ['Retrospective evaluation, not an untouched prospective holdout or proof of profitability.',
      'Split-adjusted price returns exclude dividends, execution costs and option performance.',
      'Selected surviving symbols do not represent the full market. Year groups can have few observations.',
      'Provider history may be revised; replay freezes supplied data but cannot reconstruct historical data vintages.'], reports };
  const out = resolve(options['--out'] ?? 'outputs/intelligence');
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'snapshot.json'), serialized);
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.table(reports.map(r => ({ symbol: r.symbol, horizon: r.horizonSessions, status: r.status,
    periods: r.metrics.periods, modelMAE: r.metrics.modelMae, noChangeMAE: r.metrics.noChangeMae,
    meanMAE: r.metrics.historicalMeanMae, passed: r.passed })));
  console.log(`Snapshot y reporte guardados en ${out}. MAE en fracción de retorno; passed=false no es un fallo del programa.`);
}

main().catch(error => {
  // Never print provider bodies, credentials, or environment values.
  console.error(error instanceof z.ZodError ? 'Datos o argumentos inválidos; revisa el snapshot y las fechas.' : error.message);
  process.exitCode = 1;
});
