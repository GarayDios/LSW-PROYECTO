export type Candle = { open: number; high: number; low: number; close: number; volume: number; time: number };
export const HISTORY_INTERVALS = ['5m', '15m', '1h', '1d'] as const;
const DAY = 86400000;
function hash(text: string) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}
export function historyIssue(start: string, end: string): string {
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (!valid(start) || !valid(end)) return 'Selecciona fechas válidas para el histórico.';
  if (start > end) return 'El histórico debe comenzar antes o el mismo día que la fecha final.';
  if ((Date.parse(end) - Date.parse(start)) / DAY > 3660) return 'El histórico admite un máximo de diez años por consulta.';
  return '';
}
/** Synthetic US weekday sessions, 09:30–16:00 New York, inclusive dates.
 * DST is observed; holidays and shortened sessions are not modeled.
 * Every interval aggregates the same deterministic five-minute base series.
 */
export function generateHistory(symbol: string, price: number, start: string, end: string, interval: string): Candle[] {
  if (historyIssue(start, end) || !HISTORY_INTERVALS.includes(interval as typeof HISTORY_INTERVALS[number]) || !Number.isFinite(price) || price <= 0) return [];
  const result: Candle[] = [];
  const hours = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' });
  const groupSize = interval === '1d' ? 78 : interval === '1h' ? 12 : interval === '15m' ? 3 : 1;
  const symbolSeed = hash(symbol);
  for (let day = Date.parse(start); day <= Date.parse(end); day += DAY) {
    const weekday = new Date(day).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const offset = 12 - Number(hours.format(new Date(day + 12 * 3600000)));
    const openTime = day + (9.5 + offset) * 3600000;
    const phase = day / DAY + symbolSeed % 1000;
    let close = price * (1 + .035 * Math.sin(phase / 13) + .012 * Math.cos(phase / 4));
    let group: Candle | null = null;
    for (let i = 0; i < 78; i++) {
      const time = openTime + i * 300000;
      const random = hash(`${symbol}:${time}`) / 4294967296;
      const open = close;
      close = Math.max(price * .1, open + (random - .5) * price * .003);
      const wick = price * (.0002 + random * .0007);
      const candle = { time, open, close, high: Math.max(open, close) + wick, low: Math.min(open, close) - wick, volume: Math.round(1000 + random * 19000) };
      if (!group) group = { ...candle };
      else { group.high = Math.max(group.high, candle.high); group.low = Math.min(group.low, candle.low); group.close = close; group.volume += candle.volume; }
      if ((i + 1) % groupSize === 0 || i === 77) { result.push(group); group = null; }
    }
  }
  return result;
}
/** Preserve OHLC extremes and summed volume when fitting large histories to SVG. */
export function aggregateCandles(candles: readonly Candle[], max = 180): Candle[] {
  if (candles.length <= max) return [...candles];
  const size = Math.ceil(candles.length / max);
  const result: Candle[] = [];
  for (let i = 0; i < candles.length; i += size) {
    const group = candles.slice(i, i + size);
    result.push({ time: group[0].time, open: group[0].open, close: group[group.length - 1].close, high: Math.max(...group.map(c => c.high)), low: Math.min(...group.map(c => c.low)), volume: group.reduce((sum, c) => sum + c.volume, 0) });
  }
  return result;
}
