import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastMarket, type MarketForecast } from '../../src/cores/02-inteligencia-artificial/forecast.ts';
import { evaluateForecastHistory } from '../../src/cores/02-inteligencia-artificial/evaluation.ts';
import { recommendForPreferences } from '../../src/cores/02-inteligencia-artificial/recommendations.ts';
import { defaultInvestorPreferences, investorPreferencesSchema, type InvestorPreferences } from '../../src/cores/02-inteligencia-artificial/preferences.ts';
import { defaultAnalysisSettings } from '../../src/features/research/analysis-settings.ts';
import { deriveObservedMarket } from '../../src/cores/01-analisis-tecnico/market-analysis.ts';
import type { Candle } from '../../src/features/market/chart-history.ts';
import type { CompanyResearch, ObservedOptionContract, ResearchVariable } from '../../src/cores/compartido/research-model.ts';
import { missingFundamentals } from '../../src/api/research/sec.ts';
import { missingMacro } from '../../src/api/research/fred.ts';
import { missingNews, missingOptions } from '../../src/api/research/alpaca.ts';

function history(length: number): Candle[] {
  const bars: Candle[] = [];
  let day = Date.parse('2021-01-04T05:00:00Z');
  let price = 100;
  for (let index = 0; index < length; day += 86400000) {
    if ([0, 6].includes(new Date(day).getUTCDay())) continue;
    price *= Math.exp(.0002 + .008 * Math.sin(index / 7) + .004 * Math.cos(index / 31));
    bars.push({ time: day, open: price, high: price + 1, low: price - 1, close: price, volume: 100000 });
    index++;
  }
  return bars;
}

test('kNN forecast uses resolved labels, purges overlapping outcomes and excludes future and unfinished closes', () => {
  const bars = history(1000);
  const asOf = new Date(bars[850].time + 86400000 + 7 * 3600000).toISOString();
  const input = { symbol: 'XYZ', bars: bars.slice(0, 851), asOf, source: 'Observed fixture, not financial evidence', horizonSessions: 20 as const };
  const baseline = forecastMarket(input);
  assert.equal(baseline.status, 'available');
  assert.ok(baseline.neighbors >= 8);
  assert.ok(baseline.validation.periods.length >= 8);
  assert.ok(Number.isFinite(baseline.expectedReturn));
  const contaminated = bars.map((bar, index) => index <= 850 ? bar : { ...bar, open: 1e7, high: 1e7 + 1, low: 1e7 - 1, close: 1e7 });
  assert.deepEqual(forecastMarket({ ...input, bars: contaminated }), baseline, 'unknown future labels and scaler inputs cannot change a past forecast');
  for (const [index, period] of baseline.validation.periods.entries()) {
    assert.ok(Date.parse(period.lastTrainingOutcomeAt) <= Date.parse(period.decisionAt));
    assert.ok(Date.parse(period.decisionAt) < Date.parse(period.outcomeAt));
    if (index) assert.ok(Date.parse(baseline.validation.periods[index - 1].outcomeAt) <= Date.parse(period.decisionAt));
  }
  const unfinished = forecastMarket({ ...input, asOf: new Date(bars[850].time + 3600000).toISOString() });
  assert.equal(unfinished.lastCloseAt, new Date(bars[849].time).toISOString());
});

test('forecast refuses demo, inadequate daily history, intraday data, stale closes and coverage holes', () => {
  const bars = history(1000);
  const asOf = new Date(bars.at(-1)!.time + 2 * 86400000).toISOString();
  const input = { symbol: 'XYZ', bars, asOf, source: 'Observed fixture', horizonSessions: 20 as const };
  assert.equal(forecastMarket({ ...input, demo: true }).status, 'demo');
  assert.equal(forecastMarket({ ...input, bars: bars.slice(-10) }).status, 'insufficient');
  assert.equal(forecastMarket({ ...input, bars: [...bars, { ...bars.at(-1)!, time: bars.at(-1)!.time + 60000 }] }).status, 'invalid');
  assert.equal(forecastMarket({ ...input, asOf: new Date(bars.at(-1)!.time + 15 * 86400000).toISOString() }).status, 'stale');
  assert.equal(forecastMarket({ ...input, bars: [...bars.slice(0, 100), ...bars.slice(120)] }).status, 'invalid');
  assert.equal(forecastMarket({ ...input, asOf: 'invalid' }).status, 'invalid');
});

test('long horizon needs more independent history; validation remains bounded for ten-year data', () => {
  const bars = history(2600);
  const asOf = new Date(bars.at(-1)!.time + 2 * 86400000).toISOString();
  const long = forecastMarket({ symbol: 'XYZ', bars: bars.slice(-300), asOf, source: 'fixture', horizonSessions: 60 });
  assert.equal(long.status, 'insufficient');
  const full = forecastMarket({ symbol: 'XYZ', bars, asOf, source: 'fixture', horizonSessions: 5 });
  assert.equal(full.status, 'available');
  assert.ok(full.validation.periods.length <= 60);
});

test('evaluation reports reproduce production errors and yearly groups without future contamination', () => {
  const bars = history(1000);
  const input = { symbol: 'XYZ', bars: bars.slice(0, 851),
    asOf: new Date(bars[850].time + 31 * 3600000).toISOString(), source: 'synthetic test only', horizonSessions: 20 as const };
  const report = evaluateForecastHistory(input);
  const forecast = forecastMarket(input);
  assert.equal(report.metrics.modelMae, forecast.validation.modelMae);
  assert.equal(report.metrics.noChangeMae, forecast.validation.noChangeMae);
  assert.equal(report.metrics.historicalMeanMae, forecast.validation.historicalMeanMae);
  assert.equal(report.passed, forecast.validation.passed);
  assert.equal(report.byOutcomeYear.reduce((sum, row) => sum + row.periods, 0), report.metrics.periods);
  const weightedError = report.byOutcomeYear.reduce((sum, row) => sum + row.modelMae! * row.periods, 0) / report.metrics.periods;
  assert.ok(Math.abs(weightedError - report.metrics.modelMae!) < 1e-12);
  assert.deepEqual(evaluateForecastHistory({ ...input, bars }), report);
});

test('evaluation keeps missing evidence and zero-error baselines distinct from a passing model', () => {
  const bars = history(1000).map(bar => ({ ...bar, open: 100, high: 100, low: 100, close: 100 }));
  const input = { symbol: 'XYZ', bars, asOf: new Date(bars.at(-1)!.time + 31 * 3600000).toISOString(),
    source: 'synthetic test only', horizonSessions: 5 as const };
  const flat = evaluateForecastHistory(input);
  assert.equal(flat.metrics.modelMae, 0);
  assert.equal(flat.metrics.improvementVsNoChange, null);
  assert.equal(flat.passed, false);
  const missing = evaluateForecastHistory({ ...input, bars: bars.slice(-5) });
  assert.equal(missing.status, 'insufficient');
  assert.equal(missing.metrics.modelMae, null);
  assert.equal(missing.firstDecisionAt, null);
  assert.equal(missing.passed, false);
});

const asOf = '2026-11-17T16:00:00.000Z';
function variable(value: number): ResearchVariable {
  return { value, source: 'Observed fixture', kind: 'observed', observedAt: asOf, availableAt: asOf };
}
function option(type: 'call' | 'put', strike: number, bid: number, ask: number): ObservedOptionContract {
  return { symbol: `XYZ-2026-12-18-${type}-${strike}`, underlyingSymbol: 'XYZ', multiplier: variable(100),
    deliverableShares: variable(100), deliverableType: 'single_equity', type, strike: variable(strike),
    expiration: '2026-12-18', style: 'european', bid: variable(bid), ask: variable(ask), premium: variable((bid + ask) / 2),
    impliedVolatility: variable(.3), delta: variable(.5), gamma: variable(.02), theta: variable(-.04), vega: variable(.1), openInterest: variable(1000) };
}
function snapshot(): CompanyResearch {
  const market = deriveObservedMarket('XYZ', history(100), asOf);
  market.spot = variable(100); market.stale = false;
  market.bars[market.bars.length - 1] = { ...market.bars.at(-1)!, open: 100, close: 100, high: 101, low: 99 };
  return { symbol: 'XYZ', asOf, generatedAt: asOf, market,
    options: { ...missingOptions(), contracts: [option('put', 95, 2, 2.2), option('call', 95, 8, 9), option('call', 105, 2, 2.2)], complete: true, feed: 'opra' },
    fundamentals: { ...missingFundamentals(), dividendYield: variable(0) }, macro: { ...missingMacro(), riskFreeRate: variable(.04) },
    news: missingNews(), quality: { historicalOnly: false, missing: [], stale: [], sources: [] }, warnings: [] };
}
function fixtureForecast(research: CompanyResearch): MarketForecast {
  // Deliberately injected evidence tests policy separately, not predictive skill.
  return { symbol: research.symbol, status: 'available', asOf, source: 'fixture', reason: 'fixture', horizonSessions: 20,
    lastClose: 100, lastCloseAt: new Date(research.market.bars.at(-1)!.time).toISOString(), expectedReturn: .04, lowerReturn: -.1,
    upperReturn: .2, risingComparableFraction: .6, neighbors: 16, trainingExamples: 500,
    validation: { periods: [], modelMae: .01, noChangeMae: .02, historicalMeanMae: .02, passed: true } };
}
const preferences: InvestorPreferences = { ...defaultInvestorPreferences, capital: 100000, maxAllocationPercent: 25,
  maxLossPercent: 20, riskTolerance: 'medium', experience: 'intermediate', objective: 'income' };

test('preferences change suitability without changing the market forecast and constraints always dominate scores', () => {
  const research = snapshot(), forecast = fixtureForecast(research), copy = structuredClone(forecast);
  const input = { research, forecast, preferences, settings: defaultAnalysisSettings };
  const income = recommendForPreferences(input);
  assert.equal(income.action, 'review');
  assert.equal(income.best?.strategy, 'wheel');
  const growth = recommendForPreferences({ ...input, preferences: { ...preferences, objective: 'growth' } });
  assert.equal(growth.best?.strategy, 'backspread');
  assert.deepEqual(forecast, copy);
  for (const recommendation of [income, growth]) {
    assert.ok(recommendation.best!.capitalRequired! <= recommendation.capitalLimit);
    assert.ok(recommendation.best!.maxLoss! <= recommendation.lossLimit);
  }
  const tight = recommendForPreferences({ ...input, preferences: { ...preferences, maxLossPercent: .001 } });
  assert.equal(tight.action, 'wait'); assert.equal(tight.best, null);
  assert.ok(tight.alternatives.every(alternative => !alternative.eligible));
  const disabled = recommendForPreferences({ ...input, preferences: { ...preferences, allowedStrategies: [] } });
  assert.equal(disabled.action, 'wait');
  assert.equal(recommendForPreferences({ ...input, preferences: { ...preferences, experience: 'learning' } }).action, 'wait');
});

test('unvalidated predictions, wrong company/cutoff/horizon, missing closes and indicative quotes cannot trigger a recommendation', () => {
  const research = snapshot(), forecast = fixtureForecast(research);
  const input = { research, forecast, preferences, settings: defaultAnalysisSettings };
  const unvalidated = recommendForPreferences({ ...input, forecast: { ...forecast, validation: { ...forecast.validation, passed: false } } });
  assert.equal(unvalidated.action, 'wait'); assert.equal(unvalidated.best, null);
  for (const changed of [{ ...forecast, symbol: 'OTHER' }, { ...forecast, asOf: '2026-11-16T16:00:00.000Z' },
    { ...forecast, horizonSessions: 5 }, { ...forecast, expectedReturn: -.2 }]) {
    assert.equal(recommendForPreferences({ ...input, forecast: changed }).action, 'wait');
  }
  assert.equal(recommendForPreferences({ ...input, research: { ...research, market: { ...research.market, bars: [] } } }).action, 'wait');
  assert.equal(recommendForPreferences({ ...input, research: { ...research, options: { ...research.options, feed: 'indicative' } } }).action, 'wait');
  assert.equal(recommendForPreferences({ ...input, research: { ...research, market: { ...research.market, spot: variable(110) } } }).action, 'wait', 'A forecast above yesterday close can still be below the current quote');
  assert.equal(recommendForPreferences({ ...input, preferences: { ...preferences, capital: NaN } }).action, 'wait');
});

test('preference schema rejects invalid risk budgets and repeated strategies', () => {
  assert.equal(investorPreferencesSchema.safeParse(defaultInvestorPreferences).success, true);
  assert.equal(investorPreferencesSchema.safeParse({ ...preferences, maxLossPercent: -1 }).success, false);
  assert.equal(investorPreferencesSchema.safeParse({ ...preferences, allowedStrategies: ['wheel', 'wheel'] }).success, false);
});
