import { analyzeHistory, type AnalysisOptions } from './signals.ts';
import type { Candle } from '../../features/market/chart-history.ts';

export type ValidationFold = {
  contextBars: number; testBars: number; startTime: number; endTime: number;
  returnPct: number; buyHoldReturnPct: number; maxDrawdownPct: number;
  completedTrades: number; wins: number; openPosition: boolean;
};
export type TemporalValidation = {
  method: 'expanding-window-fixed-rule'; folds: ValidationFold[]; completedTrades: number; wins: number;
  historicalWinRate: number | null; winRateInterval95: { low: number; high: number } | null;
  minimumTrades: number; sufficientSample: boolean; positiveFolds: number;
  compoundedReturnPct: number | null; compoundedBuyHoldReturnPct: number | null;
  feeBps: number; slippageBps: number; warnings: string[];
};

/** Wilson score interval for observed binary outcomes. This is not a forecast interval. */
export function wilsonInterval(wins: number, count: number): { low: number; high: number } | null {
  if (!Number.isInteger(wins) || !Number.isInteger(count) || wins < 0 || count < 0 || wins > count) throw new RangeError('Recuento de operaciones inválido.');
  if (!count) return null;
  const z = 1.959963984540054, p = wins / count, denominator = 1 + z * z / count;
  const center = (p + z * z / (2 * count)) / denominator;
  const width = z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / denominator;
  return { low: Math.max(0, center - width), high: Math.min(1, center + width) };
}

/** Fixed SMA/RSI rule evaluated on consecutive future blocks; no fitted parameters. */
export function walkForwardValidation(input: readonly Candle[], options: Pick<AnalysisOptions, 'feeBps' | 'slippageBps' | 'asOf' | 'rule'> & { testBars?: number; minimumTrades?: number } = {}): TemporalValidation {
  const bars = input.filter(bar => options.asOf === undefined || bar.time <= options.asOf);
  const testBars = options.testBars ?? 63, minimumTrades = options.minimumTrades ?? 30;
  if (!Number.isInteger(testBars) || testBars < 10 || !Number.isInteger(minimumTrades) || minimumTrades < 1) throw new RangeError('Ventana de validación inválida.');
  // Reuse the engine's complete OHLCV, cost and time validation even when no folds fit.
  analyzeHistory(bars, options);
  const folds: ValidationFold[] = [];
  const firstTest = Math.max(50, Math.floor(bars.length * .5));
  for (let start = firstTest; start + 10 <= bars.length; start += testBars) {
    const end = Math.min(bars.length, start + testBars);
    const analysis = analyzeHistory(bars.slice(0, end), { ...options, validationStartIndex: start });
    const completed = analysis.backtest.trades.filter(trade => trade.exitTime !== null);
    folds.push({ contextBars: start, testBars: end - start, startTime: bars[start].time, endTime: bars[end - 1].time,
      returnPct: analysis.backtest.returnPct, buyHoldReturnPct: analysis.backtest.buyHoldReturnPct,
      maxDrawdownPct: analysis.backtest.maxDrawdownPct, completedTrades: completed.length,
      wins: completed.filter(trade => trade.netPnl > 0).length, openPosition: analysis.backtest.openPosition });
  }
  const count = folds.reduce((total, fold) => total + fold.completedTrades, 0), wins = folds.reduce((total, fold) => total + fold.wins, 0);
  const warnings = [
    'Cada bloque empieza sin posición; una posición abierta al final se valora al cierre, sin simular una venta. Los bloques no son una trayectoria operativa continua.',
    'El intervalo Wilson resume frecuencia histórica y asume resultados independientes. Las operaciones financieras pueden estar correlacionadas.',
    'No se ajustó ni calibró un modelo de probabilidad futura. Los resultados no validan opciones ni estrategias F5 completas.',
  ];
  if (count < minimumTrades) warnings.unshift(`Muestra insuficiente: ${count} operaciones cerradas frente al mínimo descriptivo de ${minimumTrades}.`);
  if (!folds.length) warnings.unshift('Faltan velas para separar contexto y una ventana de prueba.');
  return {
    method: 'expanding-window-fixed-rule', folds, completedTrades: count, wins, historicalWinRate: count ? wins / count : null,
    winRateInterval95: wilsonInterval(wins, count), minimumTrades, sufficientSample: count >= minimumTrades,
    positiveFolds: folds.filter(fold => fold.returnPct > 0).length,
    compoundedReturnPct: folds.length ? (folds.reduce((value, fold) => value * (1 + fold.returnPct / 100), 1) - 1) * 100 : null,
    compoundedBuyHoldReturnPct: folds.length ? (folds.reduce((value, fold) => value * (1 + fold.buyHoldReturnPct / 100), 1) - 1) * 100 : null,
    feeBps: options.feeBps ?? 10, slippageBps: options.slippageBps ?? 5, warnings,
  };
}
