import type { Candle } from '../../features/market/chart-history.ts';
import type { TechnicalIndicator } from '../01-analisis-tecnico/indicators.ts';
import type { StructurePoint } from '../01-analisis-tecnico/support-resistance.ts';

export type TechnicalEvent = {
  time: number; price: number; direction: 'up' | 'down';
  kind: 'macd' | 'rsi' | 'structure' | 'average' | 'gap'; label: string; reason: string;
  gapPercent?: number; previousClose?: number;
};

/** Events describe a closed bar. They are not broker instructions or option picks. */
export function detectTechnicalEvents(bars: readonly Candle[], indicators: readonly TechnicalIndicator[], structure: readonly StructurePoint[]): TechnicalEvent[] {
  if (bars.length !== indicators.length || bars.length !== structure.length) throw new RangeError('Los eventos requieren velas, indicadores y niveles alineados.');
  const result: TechnicalEvent[] = [];
  for (let index = 1; index < bars.length; index++) {
    const current = indicators[index], previous = indicators[index - 1], bar = bars[index], oldBar = bars[index - 1];
    if (!current || !previous || current.time !== bar.time || previous.time !== oldBar.time) continue;
    const add = (kind: TechnicalEvent['kind'], direction: TechnicalEvent['direction'], label: string, reason: string) => result.push({ time: bar.time, price: bar.close, kind, direction, label, reason });
    if (current.smaFast !== null && current.smaSlow !== null && previous.smaFast !== null && previous.smaSlow !== null) {
      if (previous.smaFast <= previous.smaSlow && current.smaFast > current.smaSlow) add('average', 'up', 'Cruce 20/50 ↑', 'La SMA20 cruza por encima de la SMA50 al cierre.');
      if (previous.smaFast >= previous.smaSlow && current.smaFast < current.smaSlow) add('average', 'down', 'Cruce 20/50 ↓', 'La SMA20 cruza por debajo de la SMA50 al cierre.');
    }
    if (current.macdHistogram !== null && previous.macdHistogram !== null) {
      if (previous.macdHistogram <= 0 && current.macdHistogram > 0) add('macd', 'up', 'MACD ↑', 'MACD12/26 cruza por encima de su señal EMA9 al cierre.');
      if (previous.macdHistogram >= 0 && current.macdHistogram < 0) add('macd', 'down', 'MACD ↓', 'MACD12/26 cruza por debajo de su señal EMA9 al cierre.');
    }
    if (current.rsi !== null && previous.rsi !== null) {
      if (previous.rsi >= 30 && current.rsi < 30) add('rsi', 'up', 'RSI < 30', 'RSI14 entra en sobreventa; por sí solo no es una compra.');
      if (previous.rsi <= 70 && current.rsi > 70) add('rsi', 'down', 'RSI > 70', 'RSI14 entra en sobrecompra; por sí solo no es una venta.');
    }
    const previousStructure = structure[index - 1]?.time === oldBar.time ? structure[index - 1] : undefined;
    if (previousStructure?.support && oldBar.close >= previousStructure.support.price && bar.close < previousStructure.support.price) {
      add('structure', 'down', 'Ruptura soporte', `El cierre rompe el soporte confirmado de ${previousStructure.support.price.toFixed(2)}.`);
    }
    if (previousStructure?.resistance && oldBar.close <= previousStructure.resistance.price && bar.close > previousStructure.resistance.price) {
      add('structure', 'up', 'Ruptura resistencia', `El cierre supera la resistencia confirmada de ${previousStructure.resistance.price.toFixed(2)}.`);
    }
  }
  return result;
}

const sessionDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const sessionClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DAY = 86400000;

function dayStamp(time: number): number {
  const parts = sessionDate.formatToParts(new Date(time));
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return Date.parse(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
}

/** Without an exchange calendar, skip missing weekdays rather than infer holidays. */
function nextWeekday(previous: number, current: number): boolean {
  if ([0, 6].includes(new Date(previous).getUTCDay())) return false;
  let expected = previous + DAY;
  while ([0, 6].includes(new Date(expected).getUTCDay())) expected += DAY;
  return current === expected;
}

/** Opening gap = (session open - previous session close) / previous close.
 * This is an opening-price discontinuity, not a full-range or unfilled gap.
 * Intraday bars in this app are anchored at 09:30 New York, including hourly bars.
 * A known final regular-session bar is required; shortened or incomplete sessions
 * and missing weekdays are omitted because this input has no exchange calendar.
 * Separate from technical events so gaps never become trading-rule triggers.
 */
export function detectOpeningGaps(bars: readonly Candle[], interval: string, minimumPercent = 0.5): TechnicalEvent[] {
  if (!['1d', '1h', '15m', '5m'].includes(interval) || !Number.isFinite(minimumPercent) || minimumPercent <= 0) {
    throw new RangeError('Intervalo o porcentaje mínimo de gaps inválido.');
  }
  const closingBar = interval === '1h' ? '15:30' : interval === '15m' ? '15:45' : '15:55';
  const result: TechnicalEvent[] = [];
  let previousDay: number | undefined;
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index], previous = bars[index - 1];
    if (![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
      || bar.open <= 0 || bar.close <= 0 || bar.low <= 0 || bar.high < Math.max(bar.open, bar.close)
      || bar.low > Math.min(bar.open, bar.close) || bar.volume < 0 || previous && bar.time <= previous.time) {
      throw new RangeError('Los gaps requieren velas válidas, únicas y ordenadas.');
    }
    const currentDay = dayStamp(bar.time);
    const adjacentSessions = previousDay !== undefined && nextWeekday(previousDay, currentDay);
    previousDay = currentDay;
    if (!previous || !adjacentSessions) continue;
    if (interval !== '1d' && (sessionClock.format(new Date(bar.time)) !== '09:30'
      || sessionClock.format(new Date(previous.time)) !== closingBar)) continue;
    const gapPercent = (bar.open - previous.close) / previous.close * 100;
    if (Math.abs(gapPercent) < minimumPercent) continue;
    const percentage = `${gapPercent > 0 ? '+' : ''}${gapPercent.toFixed(2)}%`;
    result.push({ time: bar.time, price: bar.open, kind: 'gap', direction: gapPercent > 0 ? 'up' : 'down',
      label: `GAP ${percentage}`, gapPercent, previousClose: previous.close,
      reason: `Apertura ${bar.open.toFixed(2)} frente al cierre de la sesión anterior ${previous.close.toFixed(2)}: ${percentage}. Umbral ${minimumPercent}%. No indica si el gap sigue abierto.` });
  }
  return result;
}
