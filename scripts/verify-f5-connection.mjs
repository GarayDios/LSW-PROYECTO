import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readBrokerConfig, BrokerConfigError } from '../src/api/brokers/config.ts';
import { BrokerError } from '../src/api/brokers/alpaca/client.ts';
import { AlpacaOptionsClient } from '../src/api/brokers/alpaca/options.ts';

const filename = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(filename)) process.loadEnvFile(filename);
try {
  const config = readBrokerConfig(process.env);
  if (!config) throw new BrokerConfigError();
  const feed = process.env.ALPACA_OPTIONS_FEED || 'indicative';
  if (!['indicative', 'opra'].includes(feed)) throw new BrokerConfigError();
  const client = new AlpacaOptionsClient(config, { feed });
  const [account, marketOpen] = await Promise.all([client.account(), client.clock()]);
  console.log(`Alpaca Paper: cuenta ${account.status}, opciones nivel ${account.optionsLevel}, mercado ${marketOpen ? 'abierto' : 'cerrado'}, feed ${feed}.`);
  const expiry = new Date(); expiry.setUTCDate(expiry.getUTCDate() + ((5 - expiry.getUTCDay() + 7) % 7 || 7));
  const date = expiry.toISOString().slice(0, 10);
  const result = await client.contracts('AAPL', date);
  console.log(`AAPL ${date}: ${result.contracts.length} contratos estándar, ${result.contracts.filter(contract => contract.quoteTime && contract.ask !== null).length} con cotización. Consulta ${result.complete ? 'completa' : 'parcial'}.`);
  if (!result.contracts.length) throw new BrokerError('f5_contracts_empty', 409, 'Alpaca respondió sin contratos verificables para esta comprobación.');
  const sampled = await client.contract(result.contracts[Math.floor(result.contracts.length / 2)].symbol);
  console.log(`Consulta individual de contrato: ${sampled.type}, multiplicador ${sampled.size}, estilo ${sampled.style}.`);
  console.log('Verificación de solo lectura terminada. No se enviaron ni cancelaron órdenes.');
} catch (error) {
  console.error(error instanceof BrokerError || error instanceof BrokerConfigError ? error.message : 'No se pudo verificar F5. Revisa las claves Paper, permisos y conectividad.');
  process.exitCode = 1;
}
