import { forecastMarket, type ForecastValidationPeriod } from './forecast.ts';
import type { Candle } from '../../features/market/chart-history.ts';
import { summarizeForecastValidation } from './diagnostics.ts';

const errors = (periods: ForecastValidationPeriod[]) => summarizeForecastValidation(periods);

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
    diagnostics: forecast.diagnostics ?? null,
    firstDecisionAt: periods[0]?.decisionAt ?? null, lastOutcomeAt: periods.at(-1)?.outcomeAt ?? null,
    metrics: errors(periods),
    byOutcomeYear: years.map(year => ({ year, ...errors(periods.filter(p => p.outcomeAt.startsWith(year))) })),
    periods,
  };
}
