import type { ScannerCoreId } from '../../cores/evaluacion/scanner-settings.ts';

export type ChartStudies = { averages: boolean; crosses: boolean; rsi: boolean; macd: boolean; supportResistance: boolean; trends: boolean; gaps: boolean; news: boolean; volume: boolean; labels: boolean; events: boolean; volatilityBands: boolean; riskScenario: boolean };
export const defaultChartStudies: ChartStudies = { averages: true, crosses: true, rsi: true, macd: true, supportResistance: true, trends: true, gaps: true, news: true, volume: true, labels: true, events: true, volatilityBands: false, riskScenario: false };
export const studyCore: Record<Exclude<keyof ChartStudies, 'labels'>, ScannerCoreId> = {
  averages: 'technical', crosses: 'technical', rsi: 'technical', macd: 'technical',
  supportResistance: 'structure', trends: 'technical', gaps: 'technical', events: 'structure',
  news: 'news', volume: 'institutional', volatilityBands: 'monteCarlo', riskScenario: 'monteCarlo',
};
export function coreChartStudies(studies: ChartStudies, cores: readonly ScannerCoreId[]): ChartStudies {
  return Object.fromEntries(Object.entries(studies).map(([key, enabled]) => [key,
    enabled && (key === 'labels' || cores.includes(studyCore[key as keyof typeof studyCore])),
  ])) as ChartStudies;
}
