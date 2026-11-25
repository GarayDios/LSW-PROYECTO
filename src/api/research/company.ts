import type { Candle } from '../../features/market/chart-history.ts';
import { deriveObservedMarket } from '../../cores/01-analisis-tecnico/market-analysis.ts';
import type { CompanyResearch, ResearchVariable,ResearchOptions,ResearchNews } from '../../cores/compartido/research-model.ts';
import { fetchAlpacaNews, fetchAlpacaOptions, type AlpacaResearchConfig } from './alpaca.ts';
import { fetchFredMacro, type FredResearchConfig } from './fred.ts';
import { fetchSecFundamentals, type SecResearchConfig } from './sec.ts';
import { validateResearchRequest, type ResearchFetch } from './http.ts';
import { fetchMarketContext } from './market-context.ts';
import { completeOptionInputs } from './complete-option-inputs.ts';
import { enrichFundamentalValuation } from '../../cores/04-analisis-fundamental/fundamental-metrics.ts';
import { fetchCompanyDetails, type FinnhubConfig } from './finnhub.ts';
import { fetchInstitutionalResearch,type SplitFactorProvider } from './institutional.ts';

export type CompanyResearchRequest = {
  symbol: string;
  bars: readonly Candle[];
  asOf: string;
  historySource?: string;
  alpaca?: AlpacaResearchConfig;
  sec?: SecResearchConfig;
  fred?: FredResearchConfig;
  finnhub?: FinnhubConfig;
  options?:ResearchOptions;
  marketQuote?:ResearchVariable;
  dataMode?:'sandbox';
  news?:ResearchNews;
  marketContext?:Awaited<ReturnType<typeof fetchMarketContext>>;
  splitFactor?:SplitFactorProvider;
};

/** Server orchestration only; credentials never appear in the serializable result. */
export async function fetchCompanyResearch(request: CompanyResearchRequest, fetcher: ResearchFetch = fetch, now = new Date()): Promise<CompanyResearch> {
  const { symbol, bars, asOf } = request;
  validateResearchRequest(symbol, asOf);
  const market = deriveObservedMarket(symbol, bars, asOf, request.historySource);
  const [options, fundamentals, macro, news,context,companyDetails,institutional] = await Promise.all([
    request.options??fetchAlpacaOptions(request.alpaca, symbol, asOf, fetcher, now),
    fetchSecFundamentals(request.sec, symbol, asOf, fetcher),
    fetchFredMacro(request.fred, asOf, fetcher),
    request.news??fetchAlpacaNews(request.alpaca, symbol, asOf, fetcher),
    request.marketContext??fetchMarketContext(request.alpaca,symbol,asOf,fetcher,now),
    fetchCompanyDetails(request.finnhub,symbol,asOf,fetcher,now),
    fetchInstitutionalResearch(request.sec,request.alpaca,symbol,asOf,fetcher,now,request.splitFactor),
  ]);
  market.lastDailyClose=market.spot;market.spotBasis='daily-close';
  if(context.spot.value!==null){market.spot=context.spot;market.spotBasis='quote';}
  if(request.marketQuote){market.spot=market.lastDailyClose;if(request.marketQuote.value!==null){market.spot=request.marketQuote;market.spotBasis='quote';}else market.spotBasis='daily-close';}
  fundamentals.analysis = enrichFundamentalValuation(fundamentals, market.spot, asOf);
  if(context.annualDividend.value!==null&&market.spot.value!==null&&market.spot.value>0){
    fundamentals.dividendYield={...context.annualDividend,value:context.annualDividend.value/market.spot.value,
      source:context.annualDividend.source+' / precio de la acción · rendimiento continuo estimado',
      reason:context.annualDividend.reason+' Aproximación automática basada en pagos pasados, no dividendo futuro garantizado.'};
  }
  const indicatedYield=companyDetails.metrics.dividendYieldIndicatedAnnual;
  if(fundamentals.dividendYield.value===null&&indicatedYield?.value!==null&&indicatedYield?.value!==undefined&&indicatedYield.value>=0&&indicatedYield.availableAt&&Date.parse(indicatedYield.availableAt)<=Date.parse(asOf))fundamentals.dividendYield={...indicatedYield,kind:'estimated',reason:(indicatedYield.reason??'')+' Rendimiento indicado del proveedor para el modelo; no acredita pagos futuros ni un historial de doce meses.'};
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
  const result:CompanyResearch = {
    symbol, asOf: new Date(asOf).toISOString(), generatedAt: now.toISOString(), market, options, fundamentals, macro, news,cashDividends:context.dividends,companyDetails,institutional,...(request.dataMode?{dataMode:request.dataMode}:{}),
    quality: { historicalOnly: Date.parse(asOf) < now.getTime(), missing, stale: market.stale ? ['market'] : [],
      sources: [{ source: request.historySource ?? 'Alpaca histórico diario', status: market.observations ? 'ready' : 'unavailable', message: `${market.observations} velas diarias cerradas antes del corte.` }, options.status, fundamentals.status, macro.status, news.status,context.dividends.status,companyDetails.status,institutional.status] },
    warnings: [...new Set(warnings)],
  };
  completeOptionInputs(result);
  return result;
}
