import type { Candle } from '../../features/market/chart-history.ts';

export type TechnicalIndicator = {
  time: number; smaFast: number | null; smaSlow: number | null; rsi: number | null;
  macd: number | null; macdSignal: number | null; macdHistogram: number | null;
  atr: number | null; averageVolume: number | null; relativeVolume: number | null;
};
const FAST = 20, SLOW = 50, RSI_PERIOD = 14;

/** Causal SMA20/SMA50 and Wilder RSI14, without buy/sell decisions. */
export function calculateTechnicalIndicators(candles: readonly Candle[]): TechnicalIndicator[] {
  const indicators: TechnicalIndicator[] = [];
  let sumFast = 0, sumSlow = 0, averageGain = 0, averageLoss = 0;
  let ema12: number | null = null, ema26: number | null = null, ema9: number | null = null;
  let sum12 = 0, sum26 = 0, sumMacd = 0, macdCount = 0, atr: number | null = null, trueRangeSum = 0;
  let volumeSum = 0;
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    if (![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
      || bar.low <= 0 || bar.open <= 0 || bar.close <= 0 || bar.volume < 0
      || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)
      || (i > 0 && bar.time <= candles[i - 1].time)) throw new RangeError('Los indicadores requieren velas válidas, únicas y ordenadas.');
    const close = candles[i].close;
    sum12 += close; sum26 += close;
    if (i === 11) ema12 = sum12 / 12;
    else if (i > 11) ema12 = close * (2 / 13) + ema12! * (1 - 2 / 13);
    if (i === 25) ema26 = sum26 / 26;
    else if (i > 25) ema26 = close * (2 / 27) + ema26! * (1 - 2 / 27);
    const macd = ema12 === null || ema26 === null ? null : ema12 - ema26;
    if (macd !== null) {
      macdCount++; sumMacd += macd;
      if (macdCount === 9) ema9 = sumMacd / 9;
      else if (macdCount > 9) ema9 = macd * .2 + ema9! * .8;
    }
    const trueRange = i === 0 ? candles[i].high - candles[i].low : Math.max(candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    trueRangeSum += trueRange;
    if (i === 13) atr = trueRangeSum / 14;
    else if (i > 13) atr = (atr! * 13 + trueRange) / 14;
    // The comparison volume is known BEFORE the current bar, not diluted by its spike.
    const averageVolume = i >= 20 ? volumeSum / 20 : null;
    const relativeVolume = averageVolume !== null && averageVolume > 0 ? candles[i].volume / averageVolume : null;
    volumeSum += candles[i].volume;
    if (i >= 20) volumeSum -= candles[i - 20].volume;
    sumFast += close;
    sumSlow += close;
    if (i >= FAST) sumFast -= candles[i - FAST].close;
    if (i >= SLOW) sumSlow -= candles[i - SLOW].close;
    if (i > 0) {
      const difference = close - candles[i - 1].close;
      if (i <= RSI_PERIOD) {
        averageGain += Math.max(0, difference) / RSI_PERIOD;
        averageLoss += Math.max(0, -difference) / RSI_PERIOD;
      } else {
        averageGain = (averageGain * (RSI_PERIOD - 1) + Math.max(0, difference)) / RSI_PERIOD;
        averageLoss = (averageLoss * (RSI_PERIOD - 1) + Math.max(0, -difference)) / RSI_PERIOD;
      }
    }
    const rsi = i < RSI_PERIOD ? null : averageGain === 0 && averageLoss === 0 ? 50 : averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
    const smaFast = i + 1 >= FAST ? sumFast / FAST : null;
    const smaSlow = i + 1 >= SLOW ? sumSlow / SLOW : null;
    indicators.push({ time: candles[i].time, smaFast, smaSlow, rsi, macd,
      macdSignal: ema9, macdHistogram: macd === null || ema9 === null ? null : macd - ema9,
      atr, averageVolume, relativeVolume });
  }
  return indicators;
}
