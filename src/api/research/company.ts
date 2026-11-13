import type { Candle } from '../../features/market/chart-history.ts';
import { deriveObservedMarket } from '../../features/research/derive.ts';
import type { CompanyResearch, ResearchVariable } from '../../features/research/model.ts';
import { fetchAlpacaNews, fetchAlpacaOptions, type AlpacaResearchConfig } from './alpaca.ts';
import { fetchFredMacro, type FredResearchConfig } from './fred.ts';
import { fetchSecFundamentals, type SecResearchConfig } from './sec.ts';
import { validateResearchRequest, type ResearchFetch } from './http.ts';

export type CompanyResearchRequest = {
  symbol: string;
  bars: readonly Candle[];
  asOf: string;
  historySource?: string;
  alpaca?: AlpacaResearchConfig;
  sec?: SecResearchConfig;
  fred?: FredResearchConfig;
};

/** Server orchestration only; credentials never appear in the serializable result. */
export async function fetchCompanyResearch(request: CompanyResearchRequest, fetcher: ResearchFetch = fetch, now = new Date()): Promise<CompanyResearch> {
  const { symbol, bars, asOf } = request;
  validateResearchRequest(symbol, asOf);
  const market = deriveObservedMarket(symbol, bars, asOf, request.historySource);
  const [options, fundamentals, macro, news] = await Promise.all([
    fetchAlpacaOptions(request.alpaca, symbol, asOf, fetcher, now),
    fetchSecFundamentals(request.sec, symbol, asOf, fetcher),
    fetchFredMacro(request.fred, asOf, fetcher),
    fetchAlpacaNews(request.alpaca, symbol, asOf, fetcher),
  ]);
  const variables: [string, ResearchVariable][] = [
    ['market.spot', market.spot], ['market.historicalVolatility', market.historicalVolatility],
    ['market.momentum20', market.momentum20], ['market.momentum60', market.momentum60],
    ['market.averageDollarVolume20', market.averageDollarVolume20], ['market.maxDrawdown', market.maxDrawdown],
    ['fundamentals.annualRevenue', fundamentals.annualRevenue], ['fundamentals.annualNetIncome', fundamentals.annualNetIncome],
    ['fundamentals.assets', fundamentals.assets], ['fundamentals.liabilities', fundamentals.liabilities],
    ['fundamentals.dividendYield', fundamentals.dividendYield], ['macro.riskFreeRate', macro.riskFreeRate],
    ['macro.inflationYearOverYear', macro.inflationYearOverYear], ['macro.realGdpGrowth', macro.realGdpGrowth],
  ];
  const missing = variables.filter(([, value]) => value.value === null).map(([name]) => name);
  if (!options.contracts.length) missing.push('options.contracts');
  const warnings = [...market.warnings, ...options.warnings, ...fundamentals.warnings, ...macro.warnings, ...news.warnings];
  if (market.bars.length && market.bars.at(-1)!.time - market.bars[0].time < 1095 * 86_400_000) warnings.push('La muestra cargada cubre menos de tres años; el proveedor puede tener más datos fuera del rango seleccionado.');
  warnings.push('Los núcleos de selección son heurísticas explicables. Los datos de empresa y macro aportan contexto y no garantizan un pronóstico ni una rentabilidad.');
  return {
    symbol, asOf: new Date(asOf).toISOString(), generatedAt: now.toISOString(), market, options, fundamentals, macro, news,
    quality: { historicalOnly: Date.parse(asOf) < now.getTime(), missing, stale: market.stale ? ['market'] : [],
      sources: [{ source: request.historySource ?? 'Alpaca histórico diario', status: market.observations ? 'ready' : 'unavailable', message: `${market.observations} velas diarias cerradas antes del corte.` }, options.status, fundamentals.status, macro.status, news.status] },
    warnings: [...new Set(warnings)],
  };
}
