import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readBrokerConfig } from '../src/api/brokers/config.ts';
import { fetchAlpacaHistory, newYorkDate } from '../src/api/market/alpaca-history.ts';
import { fetchCompanyResearch } from '../src/api/research/company.ts';

const environmentFile = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);
try {
  const config = readBrokerConfig(process.env);
  if (!config) throw new Error('unconfigured');
  const now = new Date(), end = newYorkDate(now.getTime()), startDate = new Date(end + 'T12:00:00Z');
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 3);
  const history = await fetchAlpacaHistory(config, { symbol: 'AAPL', start: startDate.toISOString().slice(0, 10), end, interval: '1d' });
  const research = await fetchCompanyResearch({ symbol: 'AAPL', bars: history.bars, asOf: now.toISOString(), historySource: `alpaca:${history.feed}`,
    alpaca: { apiKey: config.apiKey, secretKey: config.secretKey, optionsFeed: process.env.ALPACA_OPTIONS_FEED === 'opra' ? 'opra' : 'indicative' },
    ...(process.env.SEC_USER_AGENT ? { sec: { userAgent: process.env.SEC_USER_AGENT } } : {}),
    ...(process.env.FRED_API_KEY ? { fred: { apiKey: process.env.FRED_API_KEY } } : {}),
  }, fetch, now);
  console.log(JSON.stringify({ symbol: research.symbol, cutoff: research.asOf, observations: research.market.observations,
    historicalVolatilityAvailable: research.market.historicalVolatility.value !== null, optionContracts: research.options.contracts.length,
    optionFeed: research.options.feed, newsArticles: research.news.articles.length,
    sources: research.quality.sources.map(({ source, status }) => ({ source, status })),
    missing: research.quality.missing, readOnly: true,
  }, null, 2));
} catch {
  console.error('No se pudo comprobar la investigación. Revisa las fuentes y la configuración del servidor.');
  process.exitCode = 1;
}
