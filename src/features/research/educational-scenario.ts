import { selectObservedOption } from '../../cores/evaluacion/observed-ranking.ts';
import type { StrategyId } from '../../cores/compartido/types.ts';
import { knownBy, type ResearchSnapshot } from '../../cores/compartido/research-model.ts';
import { equityTerms, valuationExpiry } from './contract-terms.ts';

/** Educational sensitivities only. Never supplies orders, rankings or observed IV. */
export function educationalOptionScenario(snapshot: ResearchSnapshot | null, strategy: StrategyId, days: number, dividendPercent: number) {
  if (!snapshot || !Number.isFinite(dividendPercent) || dividendPercent < 0 || dividendPercent > 100) return null;
  const contract = selectObservedOption(snapshot, strategy, days);
  if (!contract || !knownBy(snapshot.market.spot, snapshot.asOf) || !knownBy(snapshot.macro.riskFreeRate, snapshot.asOf)) return null;
  const terms=equityTerms(contract,snapshot.asOf);
  if(!terms)return null;
  const spot = snapshot.market.spot.value;
  const strike = terms.effectiveStrike;
  const rate = snapshot.macro.riskFreeRate.value;
  const previous = contract.impliedVolatility.lastReceived;
  const recentPrevious = previous && Date.parse(previous.receivedAt) <= Date.parse(snapshot.asOf) && Date.parse(previous.observedAt) <= Date.parse(snapshot.asOf)
    && Date.parse(snapshot.asOf) - Date.parse(previous.observedAt) <= 4 * 86400000 ? previous : null;
  const currentIv = knownBy(contract.impliedVolatility, snapshot.asOf) ? contract.impliedVolatility.value : null;
  const historical = knownBy(snapshot.market.historicalVolatility, snapshot.asOf) ? snapshot.market.historicalVolatility.value : null;
  const volatility = currentIv ?? recentPrevious?.value ?? historical;
  const volatilityLabel = currentIv !== null ? 'IV publicada'
    : recentPrevious ? `IV anterior del ${recentPrevious.observedAt} (UTC)` : 'Volatilidad histórica usada como supuesto; no es IV';
  const remaining = (valuationExpiry(contract,snapshot.asOf).time - Date.parse(snapshot.asOf)) / 86400000;
  if (spot === null || spot <= 0 || strike === null || strike <= 0 || rate === null || volatility === null || volatility <= 0
    || ![spot, strike, rate, volatility, remaining].every(Number.isFinite) || remaining <= 0 || snapshot.market.stale) return null;
  return { spot, strike, rate, volatility, days: remaining, dividendYield: dividendPercent / 100, type: contract.type,
    contract, volatilityLabel };
}
