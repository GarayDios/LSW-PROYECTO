import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AlpacaPaperClient, readBrokerConfig, BrokerError, BrokerConfigError } from '../src/api/brokers/index.ts';
import { fetchAlpacaHistory, MarketDataError, newYorkDate } from '../src/api/market/alpaca-history.ts';

const localEnvironment = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(localEnvironment)) process.loadEnvFile(localEnvironment);

try {
  const config = readBrokerConfig(process.env);
  if (!config) throw new BrokerConfigError();
  const client = new AlpacaPaperClient(config);
  const account = await client.getAccount();
  console.log(`Conexión a Alpaca Paper verificada. Estado de cuenta: ${account.status}.`);
  const end = new Date(newYorkDate(Date.now()) + 'T12:00:00Z');
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 3);
  const result = await fetchAlpacaHistory(config, {
    symbol: 'AAPL', start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), interval: '1d',
  });
  if (!result.bars.length) throw new MarketDataError('history_empty', 'La cuenta respondió, pero no se recibieron velas para comprobar el acceso al histórico.');
  console.log(`Histórico AAPL: ${result.bars.length} velas diarias, feed ${result.feed.toUpperCase()}.`);
  console.log(`Cobertura recibida: ${newYorkDate(result.bars[0].time)} a ${newYorkDate(result.bars.at(-1).time)}.`);
  console.log('Comprobación de solo lectura terminada; no se enviaron órdenes.');
} catch (error) {
  const message = error instanceof BrokerError || error instanceof BrokerConfigError || error instanceof MarketDataError
    ? error.message : 'No se pudo comprobar la conexión. Revisa la configuración y la conectividad.';
  console.error(message);
  process.exitCode = 1;
}
