import type { Company } from '../../features/market/data.ts';

export type QuantitativeCriterionId = 'bsm' | 'greeks' | 'probability' | 'volatility' | 'trend' | 'liquidity' | 'risk';
export const QUANTITATIVE_CRITERION_IDS: readonly QuantitativeCriterionId[] = ['bsm', 'greeks', 'probability', 'volatility', 'trend', 'liquidity', 'risk'];
/** Historical API/storage name. These are criteria, not the seven functional cores. */
export type CoreId = QuantitativeCriterionId;
export const CORE_IDS = QUANTITATIVE_CRITERION_IDS;

/** Cores the user can toggle on/off in the UI (quantitative nucleus). */
export type UserSelectableCoreId = 'bsm' | 'greeks' | 'probability';
export const USER_SELECTABLE_CORE_IDS: readonly UserSelectableCoreId[] = ['bsm', 'greeks', 'probability'];

/** Cores that always participate in the ranking automatically — never shown as toggles. */
export type AutoCoreId = 'volatility' | 'trend' | 'liquidity' | 'risk';
export const AUTO_CORE_IDS: readonly AutoCoreId[] = ['volatility', 'trend', 'liquidity', 'risk'];

/** Merges user-selected cores with the always-on auto cores into a full CoreId list. */
export function effectiveCores(userSelected: readonly CoreId[]): CoreId[] {
  return [...new Set([...userSelected.filter(id => USER_SELECTABLE_CORE_IDS.includes(id as UserSelectableCoreId)), ...AUTO_CORE_IDS])];
}
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

/** Shared inputs for the historical demo screening criteria. */
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
