import type { Candle } from '../market/chart-history.ts';
import type { CoreId, OptionType } from '../../cores/types.ts';

/** A numeric input always carries its origin and the date it became knowable. */
export type ResearchVariable = {
  value: number | null;
  source: string;
  observedAt: string | null;
  availableAt: string | null;
  kind: 'observed' | 'estimated' | 'missing' | 'assumed';
  reason?: string;
  /** Display-only previous quote; never an input to current valuation. */
  lastReceived?: { value: number; observedAt: string; receivedAt: string };
};

export type ProviderStatus = {
  source: string;
  status: 'ready' | 'partial' | 'missing_config' | 'unavailable' | 'error';
  message: string;
};

export type ObservedMarket = {
  symbol: string;
  bars: Candle[];
  spot: ResearchVariable;
  lastDailyClose?:ResearchVariable;
  spotBasis?:'daily-close'|'quote';
  /** Annualized sample standard deviation of daily log returns, NOT option IV. */
  historicalVolatility: ResearchVariable;
  momentum20: ResearchVariable;
  momentum60: ResearchVariable;
  averageVolume20: ResearchVariable;
  averageDollarVolume20: ResearchVariable;
  maxDrawdown: ResearchVariable;
  downsideVolatility: ResearchVariable;
  observations: number;
  stale: boolean;
  warnings: string[];
};

export type ObservedOptionContract = {
  symbol: string;
  underlyingSymbol: string;
  type: OptionType;
  expiration: string;
  /** Provider premium/exercise multiplier; size is a different field. */
  multiplier?: ResearchVariable;
  deliverableShares?: ResearchVariable;
  deliverableType?: 'single_equity' | 'unsupported' | 'unknown';
  /** Valuation horizon from trading calendar, not a legal exercise deadline. */
  valuationExpiry?: { at: string; source: string; availableAt: string };
  style: 'american' | 'european' | 'unknown';
  strike: ResearchVariable;
  impliedVolatility: ResearchVariable;
  bid: ResearchVariable;
  ask: ResearchVariable;
  /** Quote midpoint, not an executable price or theoretical BSM premium. */
  premium: ResearchVariable;
  openInterest: ResearchVariable;
  delta: ResearchVariable;
  gamma: ResearchVariable;
  theta: ResearchVariable;
  vega: ResearchVariable;
};

export type ResearchOptions = {
  contracts: ObservedOptionContract[];
  feed: 'indicative' | 'opra' | null;
  complete: boolean;
  status: ProviderStatus;
  warnings: string[];
};

export type ResearchFundamentals = {
  cik: string | null;
  companyName: string | null;
  annualRevenue: ResearchVariable;
  annualNetIncome: ResearchVariable;
  assets: ResearchVariable;
  liabilities: ResearchVariable;
  cash: ResearchVariable;
  sharesOutstanding: ResearchVariable;
  /** Calculated only from matching annual periods. */
  netMargin: ResearchVariable;
  /** Calculated only from matching balance-sheet dates. */
  liabilitiesToAssets: ResearchVariable;
  /** Forward continuous dividend yield is not implied by historical payouts. */
  dividendYield: ResearchVariable;
  status: ProviderStatus;
  warnings: string[];
};

export type ResearchMacro = {
  treasury3MonthPercent: ResearchVariable;
  /** log(1 + DGS3MO / 100): explicit modeling approximation, not a zero curve. */
  riskFreeRate: ResearchVariable;
  inflationYearOverYear: ResearchVariable;
  realGdpGrowth: ResearchVariable;
  status: ProviderStatus;
  warnings: string[];
};

export type ResearchNews = {
  articles: { id: string; headline: string; url: string | null; source: string; publishedAt: string; availableAt: string }[];
  complete: boolean;
  /** News is evidence for inspection; no fabricated sentiment/profit likelihood. */
  status: ProviderStatus;
  warnings: string[];
};

export type CompanyResearch = {
  symbol: string;
  /** Decision cutoff. Inputs published after this instant are excluded. */
  asOf: string;
  generatedAt: string;
  market: ObservedMarket;
  options: ResearchOptions;
  fundamentals: ResearchFundamentals;
  macro: ResearchMacro;
  news: ResearchNews;
  cashDividends?:{events:{id:string;exDate:string;payableDate:string|null;amount:number;currency:'USD';availableAt:string;source:string}[];complete:boolean;status:ProviderStatus;warnings:string[]};
  quality: { historicalOnly: boolean; missing: string[]; stale: string[]; sources: ProviderStatus[] };
  warnings: string[];
};
export type ResearchSnapshot = CompanyResearch;

export type CoreEvidence = { input: string; variable: ResearchVariable };
export type ObservedCoreResult = {
  core: CoreId;
  status: 'available' | 'unavailable';
  score: number | null;
  reason: string;
  evidence: CoreEvidence[];
};

export function missingVariable(source: string, reason: string): ResearchVariable {
  return { value: null, source, observedAt: null, availableAt: null, kind: 'missing', reason };
}

export function knownBy(variable: ResearchVariable, asOf: string): boolean {
  const cutoff = Date.parse(asOf);
  return variable.value !== null && Number.isFinite(variable.value) && variable.kind !== 'missing'
    && variable.observedAt !== null && Number.isFinite(Date.parse(variable.observedAt))
    && variable.availableAt !== null && Number.isFinite(Date.parse(variable.availableAt))
    && Date.parse(variable.observedAt) <= cutoff && Date.parse(variable.availableAt) <= cutoff;
}

export function beforeCutoff(variable: ResearchVariable, asOf: string): ResearchVariable {
  return knownBy(variable, asOf) ? variable : missingVariable(variable.source, variable.reason ?? 'El dato no estaba disponible en la fecha de decisión.');
}
