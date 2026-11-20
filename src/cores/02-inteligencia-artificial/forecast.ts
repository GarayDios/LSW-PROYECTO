import type { Candle } from '../../features/market/chart-history.ts';
import { deriveObservedMarket } from '../01-analisis-tecnico/market-analysis.ts';

const LOOKBACK = 60;
const MIN_NEIGHBORS = 8;
const MAX_NEIGHBORS = 16;
const MIN_VALIDATION_PERIODS = 8;
const DAY = 86_400_000;

type Example = { origin: number; end: number; features: number[]; outcome: number };
export type ForecastValidationPeriod = {
  decisionAt: string; outcomeAt: string; lastTrainingOutcomeAt: string;
  predictedReturn: number; actualReturn: number; historicalMeanReturn: number;
};
export type MarketForecast = {
  symbol: string;
  status: 'available' | 'insufficient' | 'invalid' | 'stale' | 'demo';
  reason: string; source: string; asOf: string; horizonSessions: number;
  lastClose: number | null; lastCloseAt: string | null;
  expectedReturn: number | null; lowerReturn: number | null; upperReturn: number | null;
  risingComparableFraction: number | null; neighbors: number; trainingExamples: number;
  validation: {
    periods: ForecastValidationPeriod[]; modelMae: number | null;
    noChangeMae: number | null; historicalMeanMae: number | null;
    passed: boolean;
  };
};

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const timestamp = (bar: Candle) => new Date(bar.time).toISOString();

function features(bars: readonly Candle[], index: number): number[] {
  const returns = bars.slice(index - 19, index + 1).map((bar, offset) =>
    Math.log(bar.close / bars[index - 20 + offset].close));
  const average = mean(returns);
  const volatility = Math.sqrt(mean(returns.map(value => (value - average) ** 2)));
  const close = bars[index].close;
  return [5, 20, 60].map(window => Math.log(close / bars[index - window].close))
    .concat(volatility, Math.log(close / mean(bars.slice(index - 19, index + 1).map(bar => bar.close))));
}

/** Both the scaler and neighbor set are fitted only to labels resolved at decision. */
function predict(examples: readonly Example[], target: number[], decision: number) {
  const training = examples.filter(example => example.end <= decision);
  if (training.length < MIN_NEIGHBORS) return null;
  const centers = target.map((_, column) => mean(training.map(row => row.features[column])));
  const scales = centers.map((center, column) => Math.max(1e-8,
    Math.sqrt(mean(training.map(row => (row.features[column] - center) ** 2)))));
  const ordered = training.map(row => ({ row, distance: Math.sqrt(mean(target.map((value, column) =>
    ((value - row.features[column]) / scales[column]) ** 2))) }))
    .sort((a, b) => a.distance - b.distance || b.row.origin - a.row.origin);
  const selected: typeof ordered = [];
  for (const candidate of ordered) {
    // Labels span (origin, end]; sharing a boundary close is allowed, overlap is not.
    if (selected.every(other => candidate.row.end <= other.row.origin || other.row.end <= candidate.row.origin)) {
      selected.push(candidate);
      if (selected.length === MAX_NEIGHBORS) break;
    }
  }
  if (selected.length < MIN_NEIGHBORS) return null;
  const weighted = selected.map(({ row, distance }) => ({ ...row, weight: 1 / (1 + distance) }));
  const totalWeight = weighted.reduce((sum, row) => sum + row.weight, 0);
  const quantile = (q: number) => {
    let cumulative = 0;
    const sorted = [...weighted].sort((a, b) => a.outcome - b.outcome);
    for (const row of sorted) {
      cumulative += row.weight;
      if (cumulative / totalWeight >= q) return row.outcome;
    }
    return sorted.at(-1)!.outcome;
  };
  // The baseline also uses non-overlapping resolved windows, without neighbor selection.
  const baseline = training.filter(row => (row.origin - LOOKBACK) % (row.end - row.origin) === 0);
  return {
    expected: weighted.reduce((sum, row) => sum + row.outcome * row.weight, 0) / totalWeight,
    lower: quantile(.1), upper: quantile(.9),
    rising: weighted.reduce((sum, row) => sum + (row.outcome > 0 ? row.weight : 0), 0) / totalWeight,
    count: selected.length, trainingCount: training.length,
    latestOutcome: Math.max(...selected.map(candidate => candidate.row.end)),
    baseline: mean(baseline.map(row => row.outcome)),
  };
}

/** Experimental kNN return regressor; preferences do not manufacture price forecasts.
 * Daily split-adjusted closes only. Targets and validation windows span H sessions.
 * Comparable quantiles are descriptive, not calibrated confidence intervals.
 */
export function forecastMarket(input: {
  symbol: string; bars: readonly Candle[]; asOf: string; horizonSessions: 5 | 20 | 60;
  source: string; demo?: boolean;
}): MarketForecast {
  const empty: MarketForecast = {
    symbol: input.symbol, status: 'insufficient', reason: '', source: input.source, asOf: input.asOf,
    horizonSessions: input.horizonSessions, lastClose: null, lastCloseAt: null,
    expectedReturn: null, lowerReturn: null, upperReturn: null,
    risingComparableFraction: null, neighbors: 0, trainingExamples: 0,
    validation: { periods: [], modelMae: null, noChangeMae: null, historicalMeanMae: null, passed: false },
  };
  if (![5, 20, 60].includes(input.horizonSessions) || !Number.isFinite(Date.parse(input.asOf))) {
    return { ...empty, status: 'invalid', reason: 'Selecciona un horizonte y una fecha de corte válidos.' };
  }
  if (input.demo) return { ...empty, status: 'demo', reason: 'La IA necesita histórico observado; las velas de demostración no acreditan predicciones.' };
  let market;
  try { market = deriveObservedMarket(input.symbol, input.bars, input.asOf, input.source); }
  catch { return { ...empty, status: 'invalid', reason: 'La IA requiere una vela diaria por sesión.' }; }
  const bars = market.bars.slice(-2600);
  const last = bars.at(-1);
  if (!last) return { ...empty, reason: 'No hay cierres diarios completos conocidos en la fecha de corte.' };
  const base = { ...empty, lastClose: last.close, lastCloseAt: timestamp(last) };
  if (market.stale) return { ...base, status: 'stale', reason: 'El último cierre está desactualizado respecto al corte; actualiza el histórico.' };
  // Large holes cannot silently become adjacent sessions in the training labels.
  if (bars.some((bar, index) => index > 0 && bar.time - bars[index - 1].time > 7 * DAY)) {
    return { ...base, status: 'invalid', reason: 'Hay huecos de más de siete días entre cierres; revisa la cobertura del histórico.' };
  }
  const h = input.horizonSessions;
  const examples: Example[] = [];
  const vectors = bars.map((_, index) => index >= LOOKBACK ? features(bars, index) : []);
  for (let origin = LOOKBACK; origin + h < bars.length; origin++) {
    examples.push({ origin, end: origin + h, features: vectors[origin], outcome: bars[origin + h].close / bars[origin].close - 1 });
  }
  const current = predict(examples, vectors.at(-1)!, bars.length - 1);
  if (!current) return { ...base, reason: `Falta histórico para al menos ${MIN_NEIGHBORS} comparables sin ventanas solapadas de ${h} sesiones. Prueba un rango de 3 o 5 años.` };
  const periods: ForecastValidationPeriod[] = [];
  // Fixed settings; test outcomes never select features, k or model parameters.
  const firstDecision = LOOKBACK + MIN_NEIGHBORS * h;
  const possiblePeriods = Math.max(0, Math.ceil((bars.length - h - firstDecision) / h));
  const validationStart = firstDecision + Math.max(0, possiblePeriods - 60) * h;
  for (let decision = validationStart; decision + h < bars.length; decision += h) {
    const prediction = predict(examples, vectors[decision], decision);
    if (!prediction) continue;
    periods.push({ decisionAt: timestamp(bars[decision]), outcomeAt: timestamp(bars[decision + h]),
      lastTrainingOutcomeAt: timestamp(bars[prediction.latestOutcome]),
      predictedReturn: prediction.expected, actualReturn: bars[decision + h].close / bars[decision].close - 1,
      historicalMeanReturn: prediction.baseline });
  }
  const modelMae = periods.length ? mean(periods.map(period => Math.abs(period.actualReturn - period.predictedReturn))) : null;
  const noChangeMae = periods.length ? mean(periods.map(period => Math.abs(period.actualReturn))) : null;
  const historicalMeanMae = periods.length ? mean(periods.map(period => Math.abs(period.actualReturn - period.historicalMeanReturn))) : null;
  const passed = periods.length >= MIN_VALIDATION_PERIODS && modelMae !== null && noChangeMae !== null && historicalMeanMae !== null
    && modelMae < Math.min(noChangeMae, historicalMeanMae) * .98;
  return { ...base, status: 'available',
    reason: passed ? 'El error histórico del modelo fue menor que ambas referencias. Es evidencia experimental de esta muestra.'
      : `Modelo experimental: requiere ${MIN_VALIDATION_PERIODS} periodos de prueba y mejorar al menos 2% el error de ambas referencias para proponer una estrategia.`,
    expectedReturn: current.expected, lowerReturn: current.lower, upperReturn: current.upper,
    risingComparableFraction: current.rising, neighbors: current.count, trainingExamples: current.trainingCount,
    validation: { periods, modelMae, noChangeMae, historicalMeanMae, passed },
  };
}
