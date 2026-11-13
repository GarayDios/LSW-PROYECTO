import { observedOptionInputs as getObservedInputs, selectObservedOption } from '../../cores/observed-ranking';
import type { StrategyId } from '../../cores/types';
import type { ResearchSnapshot } from './model';

/** UI and ranking share the same contract selection and completeness rules. */
export function observedOptionInputs(research: ResearchSnapshot | null, strategy: StrategyId = 'wheel', days = 30) {
  if (!research) return null;
  const contract = selectObservedOption(research, strategy, Math.max(1, days));
  const observed = getObservedInputs(research, contract);
  return observed.input && observed.premium !== null && contract ? { ...observed.input, dividendYield: observed.input.dividendYield!, premium: observed.premium, side: strategy === 'wheel' ? 'sell' as const : 'buy' as const, contract } : null;
}

export function displayedContract(research: ResearchSnapshot, strategy: StrategyId = 'wheel', days = 30) {
  return selectObservedOption(research, strategy, Math.max(1, days));
}
