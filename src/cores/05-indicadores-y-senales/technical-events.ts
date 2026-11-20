import type { Candle } from '../../features/market/chart-history.ts';
import type { TechnicalIndicator } from '../01-analisis-tecnico/indicators.ts';
import type { StructurePoint } from '../01-analisis-tecnico/support-resistance.ts';

export type TechnicalEvent = { time: number; price: number; direction: 'up' | 'down'; kind: 'macd' | 'rsi' | 'structure'; label: string; reason: string };

/** Events describe a closed bar. They are not broker instructions or option picks. */
export function detectTechnicalEvents(bars: readonly Candle[], indicators: readonly TechnicalIndicator[], structure: readonly StructurePoint[]): TechnicalEvent[] {
  if (bars.length !== indicators.length || bars.length !== structure.length) throw new RangeError('Los eventos requieren velas, indicadores y niveles alineados.');
  const result: TechnicalEvent[] = [];
  for (let index = 1; index < bars.length; index++) {
    const current = indicators[index], previous = indicators[index - 1], bar = bars[index], oldBar = bars[index - 1];
    if (!current || !previous || current.time !== bar.time || previous.time !== oldBar.time) continue;
    const add = (kind: TechnicalEvent['kind'], direction: TechnicalEvent['direction'], label: string, reason: string) => result.push({ time: bar.time, price: bar.close, kind, direction, label, reason });
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
