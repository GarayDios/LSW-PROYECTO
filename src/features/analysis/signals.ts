import type { Candle } from '../market/chart-history.ts';

export type AnalysisSignal = {
  time: number;
  action: 'buy' | 'sell' | 'hold';
  price: number;
  reason: string;
  smaFast: number;
  smaSlow: number;
  rsi: number;
};
export type BacktestTrade = {
  entryTime: number; entryPrice: number; exitTime: number | null; exitPrice: number | null;
  quantity: number; netPnl: number; returnPct: number;
};
export type AnalysisResult = {
  signals: AnalysisSignal[];
  latest: AnalysisSignal | null;
  indicators: { time: number; smaFast: number | null; smaSlow: number | null; rsi: number | null }[];
  warmupBars: number;
  validationStartTime: number | null;
  warning: string;
  backtest: {
    initialCapital: number; finalEquity: number; returnPct: number; maxDrawdownPct: number;
    buyHoldReturnPct: number; trades: BacktestTrade[]; completedTrades: number;
    winRatePct: number | null; feeBps: number; slippageBps: number;
    startTime: number | null; endTime: number | null; openPosition: boolean;
  };
};
export type StockRule = 'sma-rsi' | 'sma-cross';
export type AnalysisOptions = { initialCapital?: number; feeBps?: number; slippageBps?: number; asOf?: number; validationStartIndex?: number; rule?: StockRule };
const FAST = 20, SLOW = 50, RSI_PERIOD = 14;
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** Fixed educational rule. Every value at t depends only on candles at or before t. */
export function analyzeHistory(input: readonly Candle[], options: AnalysisOptions = {}): AnalysisResult {
  const initialCapital = options.initialCapital ?? 10000;
  const feeBps = options.feeBps ?? 10;
  const slippageBps = options.slippageBps ?? 5;
  const rule = options.rule ?? 'sma-rsi';
  if (!['sma-rsi', 'sma-cross'].includes(rule)) throw new RangeError('Regla de análisis inválida.');
  if (![initialCapital, feeBps, slippageBps].every(Number.isFinite) || initialCapital <= 0 || feeBps < 0 || feeBps > 1000 || slippageBps < 0 || slippageBps > 1000 || options.asOf !== undefined && !Number.isFinite(options.asOf)) throw new RangeError('Parámetros de análisis inválidos.');
  if (options.validationStartIndex !== undefined && (!Number.isInteger(options.validationStartIndex) || options.validationStartIndex < SLOW)) throw new RangeError('La validación requiere al menos 50 velas previas.');
  const candles = input.filter(candle => options.asOf === undefined || candle.time <= options.asOf);
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (![candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) || candle.open <= 0 || candle.close <= 0 || candle.low <= 0 || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.volume < 0 || i > 0 && candle.time <= candles[i - 1].time) throw new RangeError('El histórico debe contener velas válidas, ordenadas y sin duplicados.');
  }
  const indicators: AnalysisResult['indicators'] = [];
  const signals: AnalysisSignal[] = [];
  let sumFast = 0, sumSlow = 0, averageGain = 0, averageLoss = 0;
  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
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
    const previous = indicators.at(-1);
    indicators.push({ time: candles[i].time, smaFast, smaSlow, rsi });
    if (smaFast === null || smaSlow === null || rsi === null) continue;
    const crossedUp = previous?.smaFast !== null && previous?.smaFast !== undefined && previous.smaSlow !== null && previous.smaFast <= previous.smaSlow && smaFast > smaSlow;
    const crossedDown = previous?.smaFast !== null && previous?.smaFast !== undefined && previous.smaSlow !== null && previous.smaFast >= previous.smaSlow && smaFast < smaSlow;
    const action = crossedUp && (rule === 'sma-cross' || rsi <= 70) ? 'buy' : crossedDown ? 'sell' : 'hold';
    const reason = action === 'buy' ? rule === 'sma-cross' ? 'La media de 20 cierres cruza por encima de la de 50 (sin filtro RSI).' : 'La media de 20 cierres cruza por encima de la de 50 y RSI14 no supera 70.'
      : action === 'sell' ? 'La media de 20 cierres cruza por debajo de la de 50.'
      : crossedUp ? 'Cruce alcista descartado: RSI14 supera 70.' : 'Esperar: no hay un nuevo cruce válido al cierre.';
    signals.push({ time: candles[i].time, action, price: close, reason, smaFast, smaSlow, rsi });
  }
  const validationIndex = options.validationStartIndex ?? Math.max(SLOW, Math.floor(candles.length * .7));
  const validationStartTime = candles[validationIndex]?.time ?? null;
  const fee = feeBps / 10000, slippage = slippageBps / 10000;
  const byTime = new Map(signals.map(signal => [signal.time, signal]));
  let cash = initialCapital, quantity = 0, peak = initialCapital, maxDrawdownPct = 0;
  let active: { entryTime: number; entryPrice: number; quantity: number; cost: number } | null = null;
  const trades: BacktestTrade[] = [];
  for (let i = validationIndex; i < candles.length; i++) {
    const candle = candles[i];
    // A signal becomes tradable only at the NEXT bar's open, never at its own close.
    const signal = i > validationIndex ? byTime.get(candles[i - 1].time) : undefined;
    if (signal?.action === 'buy' && quantity === 0) {
      const executionPrice = candle.open * (1 + slippage);
      quantity = cash / (executionPrice * (1 + fee));
      active = { entryTime: candle.time, entryPrice: executionPrice, quantity, cost: cash };
      cash = 0;
    } else if (signal?.action === 'sell' && active) {
      const executionPrice = candle.open * (1 - slippage);
      cash = quantity * executionPrice * (1 - fee);
      trades.push({ entryTime: active.entryTime, entryPrice: round(active.entryPrice), exitTime: candle.time, exitPrice: round(executionPrice), quantity: round(quantity), netPnl: round(cash - active.cost), returnPct: round((cash / active.cost - 1) * 100) });
      quantity = 0;
      active = null;
    }
    const equity = cash + quantity * candle.close;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, (1 - equity / peak) * 100);
  }
  const finalClose = candles.at(-1)?.close ?? 0;
  const finalEquity = cash + quantity * finalClose;
  if (active) trades.push({ entryTime: active.entryTime, entryPrice: round(active.entryPrice), exitTime: null, exitPrice: null, quantity: round(active.quantity), netPnl: round(quantity * finalClose - active.cost), returnPct: round((quantity * finalClose / active.cost - 1) * 100) });
  const completed = trades.filter(trade => trade.exitTime !== null);
  const buyHoldReturnPct = validationStartTime === null ? 0 : (finalClose / (candles[validationIndex].open * (1 + slippage) * (1 + fee)) - 1) * 100;
  return {
    signals, latest: signals.at(-1) ?? null, indicators, warmupBars: SLOW, validationStartTime,
    warning: candles.length < 100 ? 'Histórico insuficiente para una validación temporal útil; se recomiendan al menos 100 velas cerradas.' : 'Regla educativa fija. Los resultados históricos no garantizan rentabilidad futura.',
    backtest: {
      initialCapital, finalEquity: round(finalEquity), returnPct: round((finalEquity / initialCapital - 1) * 100), maxDrawdownPct: round(maxDrawdownPct), buyHoldReturnPct: round(buyHoldReturnPct),
      trades, completedTrades: completed.length, winRatePct: completed.length ? round(completed.filter(trade => trade.netPnl > 0).length / completed.length * 100) : null,
      feeBps, slippageBps, startTime: validationStartTime, endTime: candles.at(-1)?.time ?? null, openPosition: quantity > 0,
    },
  };
}
