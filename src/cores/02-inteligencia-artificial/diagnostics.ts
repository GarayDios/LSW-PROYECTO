import type { ForecastValidationPeriod } from './forecast.ts';

const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export const FORECAST_FEATURES = ['Momentum · 5 sesiones', 'Momentum · 20 sesiones', 'Momentum · 60 sesiones', 'Volatilidad · 20 sesiones', 'Distancia a SMA20'] as const;

/** All metrics use out-of-sample, resolved outcomes; zero-error baselines have no relative skill. */
export function summarizeForecastValidation(periods: readonly ForecastValidationPeriod[]) {
  const modelMae = average(periods.map(p => Math.abs(p.actualReturn - p.predictedReturn)));
  const noChangeMae = average(periods.map(p => Math.abs(p.actualReturn)));
  const historicalMeanMae = average(periods.map(p => Math.abs(p.actualReturn - p.historicalMeanReturn)));
  const bounded = periods.filter(p => p.lowerReturn !== undefined && p.upperReturn !== undefined);
  return {
    periods: periods.length, modelMae, noChangeMae, historicalMeanMae,
    improvementVsNoChange: noChangeMae && modelMae !== null ? 1 - modelMae / noChangeMae : null,
    improvementVsHistoricalMean: historicalMeanMae && modelMae !== null ? 1 - modelMae / historicalMeanMae : null,
    directionAccuracy: average(periods.map(p => Number(Math.sign(p.actualReturn) === Math.sign(p.predictedReturn)))),
    historicalMeanDirectionAccuracy: average(periods.map(p => Number(Math.sign(p.actualReturn) === Math.sign(p.historicalMeanReturn)))),
    comparableRangeCoverage: average(bounded.map(p => Number(p.actualReturn >= p.lowerReturn! && p.actualReturn <= p.upperReturn!))),
    worstAbsoluteError: periods.length ? Math.max(...periods.map(p => Math.abs(p.actualReturn - p.predictedReturn))) : null,
  };
}

export type ForecastFeatureEvidence = {
  label: string; value: number; comparableMean: number; trainingMin: number; trainingMax: number;
  standardizedGap: number; outsideTrainingRange: boolean;
};

export function diagnoseForecast(input: {
  periods: readonly ForecastValidationPeriod[]; passed: boolean;
  features: ForecastFeatureEvidence[]; weights: number[];
}) {
  const overall = summarizeForecastValidation(input.periods);
  // Fixed, trailing eight non-overlapping outcomes. Never chosen to maximize a score.
  const recent = summarizeForecastValidation(input.periods.slice(-8));
  const recentPassed = recent.periods >= 8 && recent.improvementVsNoChange !== null
    && recent.improvementVsHistoricalMean !== null
    && recent.improvementVsNoChange > 0 && recent.improvementVsHistoricalMean > 0;
  const outsideTrainingRange = input.features.some(feature => feature.outsideTrainingRange);
  const blockers: string[] = [];
  if (!input.passed) blockers.push('La validación global no supera ambas referencias por al menos 2%.');
  if (!recentPassed) blockers.push('Los últimos ocho periodos no mejoran ambas referencias o falta evidencia reciente.');
  if (outsideTrainingRange) blockers.push('Hay variables fuera del rango observado en el entrenamiento; los comparables requieren revisión.');
  const sum = input.weights.reduce((a, b) => a + b, 0);
  const squares = input.weights.reduce((a, b) => a + b * b, 0);
  return { overall, recent, recentPassed, outsideTrainingRange, features: input.features,
    effectiveNeighbors: squares > 0 ? sum * sum / squares : 0,
    ready: blockers.length === 0, blockers };
}

export type ForecastDiagnostics = ReturnType<typeof diagnoseForecast>;
