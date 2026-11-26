import type { Candle } from '../../features/market/chart-history.ts';

export type TrendLine = {
  id: string; direction: 'up' | 'down';
  startTime: number; startPrice: number; pivotTime: number; pivotPrice: number;
  confirmedAt: number; endTime: number; endPrice: number; broken: boolean;
};

/** Two confirmed swing lows/highs define a line. Only project after confirmation;
 * terminate at a closing break or when the next line of that direction replaces it. */
export function detectTrendLines(bars: readonly Candle[], width = 2): TrendLine[] {
  if (!Number.isInteger(width) || width < 1 || width > 10) throw new RangeError('Ventana de tendencia inválida.');
  const previous: Partial<Record<'up' | 'down', { index: number; price: number }>> = {};
  const active: Partial<Record<'up' | 'down', TrendLine>> = {};
  const lines: TrendLine[] = [];
  const project = (line: TrendLine, time: number) => line.startPrice + (line.pivotPrice - line.startPrice) * (time - line.startTime) / (line.pivotTime - line.startTime);
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    if (![bar.time, bar.low, bar.high, bar.close].every(Number.isFinite) || bar.low <= 0 || bar.close < bar.low || bar.close > bar.high || index > 0 && bar.time <= bars[index - 1].time) throw new RangeError('Velas de tendencia inválidas o desordenadas.');
    const pivot = index - width;
    if (pivot >= width) {
      const center = bars[pivot], window = bars.slice(pivot - width, index + 1);
      for (const direction of ['up', 'down'] as const) {
        if (!window.every((row, offset) => offset === width || (direction === 'up' ? row.low > center.low : row.high < center.high))) continue;
        const price = direction === 'up' ? center.low : center.high, prior = previous[direction];
        if (active[direction]) delete active[direction];
        if (prior && (direction === 'up' ? price > prior.price : price < prior.price)) {
          const line: TrendLine = { id: `${direction}-${center.time}`, direction, startTime: bars[prior.index].time, startPrice: prior.price,
            pivotTime: center.time, pivotPrice: price, confirmedAt: bar.time, endTime: bar.time, endPrice: price, broken: false };
          lines.push(line); active[direction] = line;
        }
        previous[direction] = { index: pivot, price };
      }
    }
    for (const direction of ['up', 'down'] as const) {
      const line = active[direction];
      if (!line) continue;
      line.endTime = bar.time; line.endPrice = project(line, bar.time);
      if (direction === 'up' ? bar.close < line.endPrice : bar.close > line.endPrice) { line.broken = true; delete active[direction]; }
    }
  }
  return lines;
}
