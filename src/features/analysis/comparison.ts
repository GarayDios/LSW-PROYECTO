import { analyzeHistory, type StockRule } from './signals.ts';
import { walkForwardValidation, type TemporalValidation } from './validation.ts';
import type { Candle } from '../market/chart-history.ts';

export const STOCK_RULES: { id: StockRule; label: string }[] = [
  { id: 'sma-rsi', label: 'SMA20/50 + RSI14' },
  { id: 'sma-cross', label: 'SMA20/50 sin filtro RSI' },
];
export type ComparisonRow = {
  symbol: string; years: number; rule: StockRule; label: string; observations: number;
  firstBar: string; lastBar: string; validationStartTime: number | null;
  returnPct: number; buyHoldReturnPct: number; maxDrawdownPct: number; completedTrades: number;
  openPosition: boolean; stability: TemporalValidation;
};
export type ComparisonResult = {
  rows: ComparisonRow[]; excluded: { symbol: string; years: number; reason: string }[];
  cutoff: string; generatedAt: string; source: string; feeBps: number; slippageBps: number; warnings: string[];
};

export function periodStart(end: string, years: number): string {
  const date = new Date(end + 'T12:00:00Z');
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

/** Same bars, costs, chronological splits and fixed rules for every comparison. */
export function compareStockRules(symbol: string, bars: readonly Candle[], years: number, options: { asOf: number; feeBps: number; slippageBps: number }): ComparisonRow[] {
  const closed = bars.filter(bar => bar.time <= options.asOf);
  if (closed.length < 100) throw new RangeError('Se necesitan al menos 100 sesiones cerradas.');
  return STOCK_RULES.map(({ id: rule, label }) => {
    const result = analyzeHistory(closed, { ...options, rule });
    return { symbol, years, rule, label, observations: closed.length,
      firstBar: new Date(closed[0].time).toISOString().slice(0, 10), lastBar: new Date(closed.at(-1)!.time).toISOString().slice(0, 10),
      validationStartTime: result.validationStartTime, returnPct: result.backtest.returnPct,
      buyHoldReturnPct: result.backtest.buyHoldReturnPct, maxDrawdownPct: result.backtest.maxDrawdownPct,
      completedTrades: result.backtest.completedTrades, openPosition: result.backtest.openPosition,
      stability: walkForwardValidation(closed, { ...options, rule }),
    };
  });
}
