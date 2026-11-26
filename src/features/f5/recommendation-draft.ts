import type { StrategyAnalysis } from '../../cores/evaluacion/strategy-analysis.ts';
import type { F5Contract } from './types.ts';

export type F5RecommendationDraft = {
  id: string;
  broker: 'alpaca' | 'webull';
  underlying: string;
  strategy: StrategyAnalysis['strategy'];
  wheelPhase: 'put' | 'call';
  expiry: string;
  longExpiry?: string;
  quantity: number;
  maxCapitalUsd: number;
  legs: { symbol: string; type: 'call' | 'put'; expiry: string; strike: number }[];
};

/** Preserve the analysis leg order used by the broker's F5 strategy builder. */
export function recommendationDraft(analysis: StrategyAnalysis, broker: F5RecommendationDraft['broker'], maxCapitalUsd: number): F5RecommendationDraft | null {
  const { strategy, legs } = analysis;
  const ratios = strategy === 'wheel' ? [-1] : strategy === 'pmcc' ? [1, -1] : strategy === 'backspread' ? [-1, 2] : [1, 1];
  const quantity = legs[0]?.quantity / ratios[0];
  if (legs.length !== ratios.length || !Number.isInteger(quantity) || quantity < 1 || quantity > 100
    || !Number.isFinite(maxCapitalUsd) || maxCapitalUsd <= 0
    || legs.some((leg, index) => leg.quantity !== ratios[index] * quantity
      || leg.contract.underlyingSymbol !== legs[0].contract.underlyingSymbol
      || leg.contract.style !== 'american' || leg.contract.multiplier?.value !== 100
      || leg.contract.deliverableType !== 'single_equity' || leg.contract.deliverableShares?.value !== 100
      || leg.contract.strike.value === null)) return null;
  return {
    id: legs.map(leg => leg.contract.symbol).join('|'), broker,
    underlying: legs[0].contract.underlyingSymbol, strategy, quantity, maxCapitalUsd,
    wheelPhase: strategy === 'wheel' ? legs[0].contract.type : 'put',
    expiry: legs[strategy === 'pmcc' ? 1 : 0].contract.expiration,
    ...(strategy === 'pmcc' ? { longExpiry: legs[0].contract.expiration } : {}),
    legs: legs.map(({ contract }) => ({ symbol: contract.symbol, type: contract.type, expiry: contract.expiration, strike: contract.strike.value! })),
  };
}

/** An unavailable contract stays empty: never substitute a similar strike or expiry. */
export function resolveRecommendation(draft: F5RecommendationDraft, contracts: F5Contract[]) {
  const selection = draft.legs.map(leg => contracts.some(contract =>
    contract.symbol === leg.symbol && contract.underlying === draft.underlying
    && contract.type === leg.type && contract.expiry === leg.expiry && contract.strike === leg.strike
    && contract.tradable && contract.size === 100 && contract.style === 'american') ? leg.symbol : '');
  return { selection, missing: draft.legs.filter((_, index) => !selection[index]).map(leg => leg.symbol) };
}
