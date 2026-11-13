import type { Company } from '../features/market/data.ts';

export type CoreId = 'bsm' | 'greeks' | 'probability' | 'volatility' | 'trend' | 'liquidity' | 'risk';
export const CORE_IDS: readonly CoreId[] = ['bsm', 'greeks', 'probability', 'volatility', 'trend', 'liquidity', 'risk'];
export type StrategyId = 'wheel' | 'pmcc' | 'backspread' | 'gamma';
export type OptionType = 'call' | 'put';

export interface OptionInputs {
  spot: number;
  strike: number;
  /** Calendar days to expiration. */
  days: number;
  /** Annualized volatility as a decimal, e.g. 0.30. */
  volatility: number;
  /** Continuously compounded annual risk-free rate, as a decimal. */
  rate: number;
  dividendYield?: number;
  type: OptionType;
}

export interface OptionValue {
  price: number;
  delta: number;
  gamma: number;
  /** Price change per calendar day passing. */
  theta: number;
  /** Price change per +1 percentage point of volatility. */
  vega: number;
  /** Price change per +1 percentage point of the interest rate. */
  rho: number;
}

export interface ProfitInputs extends OptionInputs { premium: number; side: 'buy' | 'sell' }
export type RankedCompany = Company & { score: number; reason: string };

/** Shared inputs for the seven independent demo screening scores. */
export interface CoreContext {
  company: Company;
  strategy: StrategyId;
  days: number;
  settings: {
    strike: number;
    targetIv: number;
    targetDays: number;
    targetDelta: number;
    targetYield: number;
    type: OptionType;
    side: 'buy' | 'sell';
  };
  value: OptionValue;
  probabilityOfProfit: number;
  tenor: number;
  liquidity: number;
  ivFit: number;
}

export interface ScreeningCore {
  score(context: CoreContext): number;
  reason(context: CoreContext): string;
}
