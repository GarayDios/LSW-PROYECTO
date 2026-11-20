import type { Candle } from '../../features/market/chart-history.ts';

export type PriceLevel = {
  id: string; kind: 'support' | 'resistance'; price: number; touches: number;
  pivotAt: number; confirmedAt: number;
};
export type StructurePoint = { time: number; support: PriceLevel | null; resistance: PriceLevel | null };
export type SupportResistance = { points: StructurePoint[]; levels: PriceLevel[]; confirmationBars: number };

/** Two bars on each side confirm a pivot. A second distinct pivot confirms a level.
 * Price is anchored to the first pivot and never moved by subsequent touches.
 * Levels are visible from their SECOND confirmation, never from the old pivot date.
 */
export function analyzeSupportResistance(bars: readonly Candle[], options: {
  pivotBars?: number; lookback?: number; tolerancePercent?: number;
} = {}): SupportResistance {
  const width = options.pivotBars ?? 2, lookback = options.lookback ?? 150, tolerance = (options.tolerancePercent ?? .75) / 100;
  if (!Number.isInteger(width) || width < 1 || width > 10 || !Number.isInteger(lookback) || lookback < width * 2 + 1
    || !Number.isFinite(tolerance) || tolerance <= 0 || tolerance > .1) throw new RangeError('Parámetros de soportes y resistencias inválidos.');
  type Candidate = PriceLevel & { lastIndex: number };
  let candidates: Candidate[] = [];
  const points: StructurePoint[] = [];
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    if (![bar.time, bar.low, bar.high, bar.close].every(Number.isFinite) || bar.low <= 0 || bar.high < bar.low || bar.close < bar.low || bar.close > bar.high
      || (index > 0 && bar.time <= bars[index - 1].time)) throw new RangeError('Las velas de estructura deben ser válidas, únicas y ordenadas.');
    candidates = candidates.filter(candidate => index - candidate.lastIndex <= lookback);
    const pivot = index - width;
    if (pivot >= width) {
      const window = bars.slice(pivot - width, index + 1);
      const center = bars[pivot];
      const kinds: PriceLevel['kind'][] = [];
      if (window.every((value, offset) => offset === width || value.low > center.low)) kinds.push('support');
      if (window.every((value, offset) => offset === width || value.high < center.high)) kinds.push('resistance');
      for (const kind of kinds) {
        const price = kind === 'support' ? center.low : center.high;
        const existing = candidates.filter(candidate => candidate.kind === kind && Math.abs(candidate.price / price - 1) <= tolerance)
          .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))[0];
        if (existing) {
          existing.touches++; existing.lastIndex = index;
          if (existing.touches === 2) existing.confirmedAt = bar.time;
        } else candidates.push({ id: `${kind}-${center.time}`, kind, price, touches: 1,
          pivotAt: center.time, confirmedAt: bar.time, lastIndex: index });
      }
    }
    const active = candidates.filter(candidate => candidate.touches >= 2);
    const snapshot = (candidate: Candidate | undefined): PriceLevel | null => candidate ? {
      id: candidate.id, kind: candidate.kind, price: candidate.price, touches: candidate.touches,
      pivotAt: candidate.pivotAt, confirmedAt: candidate.confirmedAt,
    } : null;
    points.push({ time: bar.time,
      support: snapshot(active.filter(candidate => candidate.kind === 'support' && candidate.price <= bar.close).sort((a, b) => b.price - a.price)[0]),
      resistance: snapshot(active.filter(candidate => candidate.kind === 'resistance' && candidate.price >= bar.close).sort((a, b) => a.price - b.price)[0]),
    });
  }
  const close = bars.at(-1)?.close ?? 0;
  const selected = [
    ...candidates.filter(candidate => candidate.touches >= 2 && candidate.kind === 'support' && candidate.price <= close).sort((a, b) => b.price - a.price).slice(0, 2),
    ...candidates.filter(candidate => candidate.touches >= 2 && candidate.kind === 'resistance' && candidate.price >= close).sort((a, b) => a.price - b.price).slice(0, 2),
  ];
  return { points, levels: selected.map(({ id, kind, price, touches, pivotAt, confirmedAt }) => ({ id, kind, price, touches, pivotAt, confirmedAt })), confirmationBars: width };
}
