import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readBrokerConfig } from '../src/api/brokers/config.ts';
import { fetchAlpacaHistory, newYorkDate } from '../src/api/market/alpaca-history.ts';
import { fetchCompanyResearch } from '../src/api/research/company.ts';
import { modelMacroContext } from '../src/features/research/model-macro.ts';
import { analysisPolicy, defaultAnalysisSettings } from '../src/features/research/analysis-settings.ts';
import { observedOptionInputs, selectObservedOption, rankObservedCompanies } from '../src/cores/observed-ranking.ts';

const environmentFile = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);
try {
  const config = readBrokerConfig(process.env);
  if (!config) throw new Error('unconfigured');
  const now = new Date(), end = newYorkDate(now.getTime()), startDate = new Date(end + 'T12:00:00Z');
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 3);
  const history = await fetchAlpacaHistory(config, { symbol: 'AAPL', start: startDate.toISOString().slice(0, 10), end, interval: '1d' });
  const research = await fetchCompanyResearch({ symbol: 'AAPL', bars: history.bars, asOf: now.toISOString(), historySource: `alpaca:${history.feed}`,
    alpaca: { apiKey: config.apiKey, secretKey: config.secretKey, stockFeed: config.dataFeed, optionsFeed: process.env.ALPACA_OPTIONS_FEED === 'opra' ? 'opra' : 'indicative' },
    ...(process.env.SEC_USER_AGENT ? { sec: { userAgent: process.env.SEC_USER_AGENT } } : {}),
    ...(process.env.FRED_API_KEY ? { fred: { apiKey: process.env.FRED_API_KEY } } : {}),
  }, fetch, now);
  const policy = analysisPolicy(defaultAnalysisSettings, research);
  const macro = modelMacroContext(research, policy);
  const contract = selectObservedOption(research, 'wheel', 30, policy);
  const valuation = observedOptionInputs(research, contract, policy);
  const rateEvidence = valuation.evidence.find(item => item.input === 'riskFreeRate')?.variable;
  if (rateEvidence?.value !== macro.rate.value || (valuation.input && valuation.input.rate !== macro.rate.value)) throw new Error('rate integration mismatch');
  const ranking = rankObservedCompanies([research], ['bsm','greeks','probability'], 'wheel', 30, policy)[0];
  console.log(JSON.stringify({ symbol: research.symbol, cutoff: research.asOf, observations: research.market.observations,
    historicalVolatilityAvailable: research.market.historicalVolatility.value !== null, optionContracts: research.options.contracts.length,
    optionFeed: research.options.feed, newsArticles: research.news.articles.length,
    contractsWithMultiplier: research.options.contracts.filter(c=>c.multiplier?.value!==null&&c.multiplier?.value!==undefined).length,
    verifiedEquityDeliverables: research.options.contracts.filter(c=>c.deliverableType==='single_equity').length,
    calendarValuationHorizons: research.options.contracts.filter(c=>c.valuationExpiry).length,
    underlyingPriceBasis:research.market.spotBasis??'daily-close',
    declaredCashDividendEvents:research.cashDividends?.events.length??0,
    macroIntegration: { status:research.macro.status.status, rateAvailable:macro.rateAvailable, annualContinuousRatePercent:macro.rate.value===null?null:macro.rate.value*100,
      source:macro.rate.source, observedAt:macro.rate.observedAt, availableAt:macro.rate.availableAt, manualOverride:macro.manualRate,
      rateEvidenceMatches:true, valuationComplete:valuation.input!==null, valuationMissing:valuation.missing,
      wheelModelStatus:ranking.strategyAnalysis.status, wheelModelMissing:ranking.strategyAnalysis.missing,
      optionCores:ranking.coreResults.map(({core,status})=>({core,status})), contextOnly:['inflationYearOverYear','realGdpGrowth'] },
    sources: research.quality.sources.map(({ source, status }) => ({ source, status })),
    missing: research.quality.missing, readOnly: true,
  }, null, 2));
} catch {
  console.error('No se pudo comprobar la investigación. Revisa las fuentes y la configuración del servidor.');
  process.exitCode = 1;
}
