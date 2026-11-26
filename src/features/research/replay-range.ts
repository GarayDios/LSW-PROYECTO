import type { Candle } from '../market/chart-history.ts';

const date = (time: number) => new Date(time).toISOString().slice(0, 10);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && date(Date.parse(value)) === value;

/** Resolve an inclusive user range without silently moving either date outside it. */
export function resolveReplayRange(bars: readonly Candle[], from: string, to: string, minimum: string) {
  if (!validDate(from) || !validDate(to) || from > to) throw new RangeError('Elige un inicio y un fin válidos, en ese orden.');
  if (from < minimum || !bars.length || to > date(bars.at(-1)!.time)) throw new RangeError('El rango debe quedar dentro del histórico disponible.');
  const sessions = bars.filter(bar => date(bar.time) >= from && date(bar.time) <= to);
  if (!sessions.length) throw new RangeError('No hay sesiones disponibles entre esas fechas.');
  return { from, to, decision: date(sessions[0].time), firstTime: sessions[0].time, lastTime: sessions.at(-1)!.time, sessions: sessions.length };
}
