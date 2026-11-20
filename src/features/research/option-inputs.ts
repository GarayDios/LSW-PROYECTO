import { observedOptionInputs as getObservedInputs, selectObservedOption } from '../../cores/evaluacion/observed-ranking';
import type { StrategyId } from '../../cores/compartido/types';
import type { ResearchSnapshot } from '../../cores/compartido/research-model';
import type { ObservedInputOverrides } from '../../cores/evaluacion/observed-ranking';
import { estimatedSnapshot } from '../../cores/evaluacion/estimated-snapshot';

/** UI and ranking share the same contract selection and completeness rules. */
export function observedOptionInputs(research: ResearchSnapshot | null, strategy: StrategyId = 'wheel', days = 30,overrides:ObservedInputOverrides={}) {
  if (!research) return null;
  const snapshot=estimatedSnapshot(research,{...overrides,estimateDays:days});
  const contract = selectObservedOption(snapshot, strategy, Math.max(1, days),{...overrides,modelMode:'observed'});
  const observed = getObservedInputs(snapshot, contract,overrides);
  return observed.input && observed.premium !== null && contract ? { ...observed.input, dividendYield: observed.input.dividendYield!, premium: observed.premium, side: strategy === 'wheel' ? 'sell' as const : 'buy' as const, contract,
    volatilityLabel:contract.impliedVolatility.kind==='assumed'?'Volatilidad supuesta, no IV observada':'IV publicada del contrato',warnings:observed.warnings } : null;
}

export function displayedContract(research: ResearchSnapshot, strategy: StrategyId = 'wheel', days = 30) {
  return selectObservedOption(research, strategy, Math.max(1, days));
}
