import type { Candle } from '../../features/market/chart-history.ts';
import { missingVariable, type ObservedMarket, type ResearchVariable } from '../compartido/research-model.ts';

const DAY = 86_400_000;

/** Daily candles only. Wait until after the whole New York calendar day has closed. */
export function deriveObservedMarket(symbol: string, input: readonly Candle[], asOf: string, source = 'Alpaca · histórico diario'): ObservedMarket {
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) throw new RangeError('La fecha de decisión no es válida.');
  const daily = new Map<string, Candle>();
  for (const bar of input) {
    if (![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
      || bar.close <= 0 || bar.open <= 0 || bar.low <= 0 || bar.volume < 0
      || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) continue;
    if (!Number.isFinite(new Date(bar.time).getTime())) continue;
    const date = new Date(bar.time).toISOString().slice(0, 10);
    const available = Date.parse(date) + DAY + 6 * 3_600_000;
    if (bar.time > cutoff || available > cutoff) continue;
    // More than one bar in a day means intraday data, which cannot estimate daily HV.
    if (daily.has(date)) throw new RangeError('Los cálculos requieren una vela diaria por sesión.');
    daily.set(date, { ...bar });
  }
  const bars = [...daily.values()].sort((a, b) => a.time - b.time);
  const last = bars.at(-1);
  const observedAt = last ? new Date(last.time).toISOString() : null;
  const availableAt = last ? new Date(Date.parse(new Date(last.time).toISOString().slice(0, 10)) + DAY + 6 * 3_600_000).toISOString() : null;
  const stale = !!last && cutoff - Date.parse(availableAt!) > 7 * DAY;
  const variable = (value: number | null, label: string, min: number, kind: 'observed' | 'estimated' = 'estimated'): ResearchVariable =>
    bars.length >= min && value !== null && Number.isFinite(value)
      ? { value, source: `${source} · ${label}`, observedAt, availableAt, kind }
      : missingVariable(`${source} · ${label}`, `Se requieren al menos ${min} velas diarias cerradas.`);
  const closes = bars.map(bar => bar.close);
  const returns = closes.slice(1).map((value, i) => Math.log(value / closes[i]));
  const window = returns.slice(-252);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const hv = Math.sqrt(window.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (window.length - 1)) * Math.sqrt(252);
  const downside = Math.sqrt(window.reduce((sum, x) => sum + Math.min(0, x) ** 2, 0) / window.length) * Math.sqrt(252);
  const recent = bars.slice(-20);
  const averageVolume = recent.reduce((sum, bar) => sum + bar.volume, 0) / recent.length;
  const dollarVolume = recent.reduce((sum, bar) => sum + bar.volume * bar.close, 0) / recent.length;
  let peak = 0;
  let maxDrawdown = 0;
  for (const close of closes.slice(-252)) { peak = Math.max(peak, close); maxDrawdown = Math.max(maxDrawdown, 1 - close / peak); }
  const warnings: string[] = [];
  if (stale) warnings.push('El último cierre disponible tiene más de siete días de antigüedad respecto al corte.');
  if (bars.length < 61) warnings.push('Histórico insuficiente para todas las métricas; no se rellenan con datos de demostración.');
  if (bars.length && bars.length < input.length) warnings.push('Se excluyeron velas posteriores al corte, incompletas o inválidas.');
  return {
    symbol, bars, observations: bars.length, stale, warnings,
    spot: variable(last?.close ?? null, 'último cierre', 1, 'observed'),
    historicalVolatility: variable(hv, 'HV: desviación muestral de retornos log diarios, anualizada √252 (máximo 252 sesiones)', 31),
    momentum20: variable(last && bars.length > 20 ? last.close / closes[closes.length - 21] - 1 : null, 'retorno de 20 sesiones', 21),
    momentum60: variable(last && bars.length > 60 ? last.close / closes[closes.length - 61] - 1 : null, 'retorno de 60 sesiones', 61),
    averageVolume20: variable(averageVolume, 'volumen medio de 20 sesiones (acciones)', 20),
    averageDollarVolume20: variable(dollarVolume, 'volumen monetario medio de 20 sesiones (USD aproximados)', 20),
    maxDrawdown: variable(maxDrawdown, 'máximo drawdown de hasta 252 sesiones', 31),
    downsideVolatility: variable(downside, 'desviación bajista anualizada √252, umbral diario cero', 31),
  };
}
