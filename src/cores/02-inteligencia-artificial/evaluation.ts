import { forecastMarket, type ForecastValidationPeriod } from './forecast.ts';
import type { Candle } from '../../features/market/chart-history.ts';

function errors(periods: ForecastValidationPeriod[]) {
  const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const modelMae = average(periods.map(p => Math.abs(p.actualReturn - p.predictedReturn)));
  const noChangeMae = average(periods.map(p => Math.abs(p.actualReturn)));
  const historicalMeanMae = average(periods.map(p => Math.abs(p.actualReturn - p.historicalMeanReturn)));
  return { periods: periods.length, modelMae, noChangeMae, historicalMeanMae,
    improvementVsNoChange: noChangeMae && modelMae !== null ? 1 - modelMae / noChangeMae : null,
    improvementVsHistoricalMean: historicalMeanMae && modelMae !== null ? 1 - modelMae / historicalMeanMae : null };
}

/** Audit the production model with fixed parameters, without tuning on test outcomes. */
export function evaluateForecastHistory(input: {
  symbol: string; bars: readonly Candle[]; asOf: string; source: string; horizonSessions: 5 | 20 | 60;
}) {
  const forecast = forecastMarket(input);
  const periods = forecast.validation.periods;
  const years = [...new Set(periods.map(p => p.outcomeAt.slice(0, 4)))];
  return {
    symbol: input.symbol, horizonSessions: input.horizonSessions, asOf: input.asOf, source: input.source,
    status: forecast.status, reason: forecast.reason, passed: forecast.validation.passed,
    firstDecisionAt: periods[0]?.decisionAt ?? null, lastOutcomeAt: periods.at(-1)?.outcomeAt ?? null,
    metrics: errors(periods),
    byOutcomeYear: years.map(year => ({ year, ...errors(periods.filter(p => p.outcomeAt.startsWith(year))) })),
    periods,
  };
}
