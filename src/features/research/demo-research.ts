import { deriveObservedMarket } from '../../cores/01-analisis-tecnico/market-analysis.ts';
import { blackScholes } from '../../cores/nucleo-cuantitativo/bsm.ts';
import { missingVariable, type CompanyResearch, type ResearchVariable } from '../../cores/compartido/research-model.ts';
import { generateHistory, type Candle } from '../market/chart-history.ts';
import type { Company } from '../market/data.ts';
import { researchHistoryStart } from './research-history.ts';

/** Isolated synthetic scenario. It never supplies real research or broker orders. */
export function demoResearch(company: Company, start: string, end: string, days: number, rate: number, bars?: readonly Candle[]): CompanyResearch {
  const asOf = `${end}T23:59:59.999Z`, source = 'Demostración sintética · no es una fuente de mercado';
  const market = deriveObservedMarket(company.symbol, bars ?? generateHistory(company.symbol, company.price, researchHistoryStart(start, end), end, '1d'), asOf, source);
  const v = (value: number): ResearchVariable => ({ value, source, kind: 'assumed', observedAt: asOf, availableAt: asOf });
  const missing = missingVariable(source, 'Sin fuente disponible en demostración.');
  const status = { source, status: 'ready' as const, message: 'Ejemplo sintético para probar los cores; no acredita datos de mercado.' };
  const seed = [...company.symbol].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  const margin = .08 + (seed % 15) / 100, assets = 1e10 + seed * 1e8, leverage = .25 + (seed % 35) / 100;
  const newsDate = new Date(Date.parse(asOf) - 2 * 86400000).toISOString();
  const headline = seed % 2 ? `DEMO: ${company.symbol} beats earnings estimates and raises guidance` : `DEMO: ${company.symbol} misses earnings estimates and cuts guidance`;
  const spot = market.spot.value ?? company.price;
  const contracts = [Math.max(1, days), Math.max(365, days + 30)].flatMap(tenor => [.6, .8, .95, 1, 1.05].flatMap(ratio => (['call', 'put'] as const).map(type => {
    const strike = Math.floor(spot * ratio * 100) / 100;
    const expiresAt = new Date(Date.parse(asOf) + tenor * 86400000).toISOString(), expiration = expiresAt.slice(0, 10);
    const premium = blackScholes({ spot, strike, type, days: tenor, volatility: company.iv, rate, dividendYield: company.dividendYield }).price;
    const half = Math.max(.005, premium * .025);
    return { symbol: `DEMO-${company.symbol}-${expiration}-${type}-${strike}`, underlyingSymbol: company.symbol, type, expiration,
      valuationExpiry: { at: expiresAt, availableAt: asOf, source }, style: 'european' as const,
      strike: v(strike), multiplier: v(100), deliverableShares: v(100), deliverableType: 'single_equity' as const,
      impliedVolatility: v(company.iv), bid: v(Math.max(0, premium - half)), ask: v(premium + half), premium: v(premium),
      openInterest: missing, delta: missing, gamma: missing, theta: missing, vega: missing };
  })));
  return { symbol: company.symbol, dataMode: 'demo', asOf, generatedAt: asOf, market,
    options: { contracts, feed: null, complete: true, status, warnings: [source] },
    fundamentals: { cik: null, companyName: company.name, annualRevenue: v(assets * .6), annualNetIncome: v(assets * .6 * margin), assets: v(assets), liabilities: v(assets * leverage),
      cash: v(assets * .15), sharesOutstanding: v(assets / spot), netMargin: v(margin), liabilitiesToAssets: v(leverage), dividendYield: v(company.dividendYield), status, warnings: [source] },
    macro: { treasury3MonthPercent: missing, riskFreeRate: v(rate), inflationYearOverYear: missing, realGdpGrowth: missing, status, warnings: [source] },
    news: { articles: [{ id: `demo-${company.symbol}-${end}`, headline, source, url: null, publishedAt: newsDate, availableAt: newsDate }], complete: true, status, warnings: ['Titular sintético identificado como DEMO; nunca se usa como noticia real.'] },
    quality: { historicalOnly: true, missing: [], stale: [], sources: [status] }, warnings: [source] };
}
