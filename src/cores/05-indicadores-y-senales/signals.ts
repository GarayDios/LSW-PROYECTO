import { calculateTechnicalIndicators, type TechnicalIndicator } from '../01-analisis-tecnico/indicators.ts';
import { analyzeSupportResistance, type SupportResistance } from '../01-analisis-tecnico/support-resistance.ts';
import { detectTechnicalEvents, type TechnicalEvent } from './technical-events.ts';
import type { Candle } from '../../features/market/chart-history.ts';

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
  indicators: TechnicalIndicator[];
  structure: SupportResistance;
  technicalEvents: TechnicalEvent[];
  rule: StockRule;
  warmupBars: number;
  validationStartTime: number | null;
  warning: string;
  backtest: {
    equityCurve: { time: number; equity: number; benchmark: number; drawdownPct: number }[];
    initialCapital: number; finalEquity: number; returnPct: number; maxDrawdownPct: number;
    buyHoldReturnPct: number; trades: BacktestTrade[]; completedTrades: number;
    winRatePct: number | null; feeBps: number; slippageBps: number;
    startTime: number | null; endTime: number | null; openPosition: boolean;
  };
};
export type StockRule = 'sma-rsi' | 'sma-cross' | 'technical-confluence';
export type AnalysisOptions = { initialCapital?: number; feeBps?: number; slippageBps?: number; asOf?: number; validationStartIndex?: number; rule?: StockRule };
const SLOW = 50;
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** Fixed educational rule. Every value at t depends only on candles at or before t. */
export function analyzeHistory(input: readonly Candle[], options: AnalysisOptions = {}): AnalysisResult {
  const initialCapital = options.initialCapital ?? 10000;
  const feeBps = options.feeBps ?? 10;
  const slippageBps = options.slippageBps ?? 5;
  const rule = options.rule ?? 'sma-rsi';
  if (!['sma-rsi', 'sma-cross', 'technical-confluence'].includes(rule)) throw new RangeError('Regla de análisis inválida.');
  if (![initialCapital, feeBps, slippageBps].every(Number.isFinite) || initialCapital <= 0 || feeBps < 0 || feeBps > 1000 || slippageBps < 0 || slippageBps > 1000 || options.asOf !== undefined && !Number.isFinite(options.asOf)) throw new RangeError('Parámetros de análisis inválidos.');
  if (options.validationStartIndex !== undefined && (!Number.isInteger(options.validationStartIndex) || options.validationStartIndex < SLOW)) throw new RangeError('La validación requiere al menos 50 velas previas.');
  const candles = input.filter(candle => options.asOf === undefined || candle.time <= options.asOf);
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (![candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) || candle.open <= 0 || candle.close <= 0 || candle.low <= 0 || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.volume < 0 || i > 0 && candle.time <= candles[i - 1].time) throw new RangeError('El histórico debe contener velas válidas, ordenadas y sin duplicados.');
  }
  const indicators = calculateTechnicalIndicators(candles);
  const structure = analyzeSupportResistance(candles);
  const technicalEvents = detectTechnicalEvents(candles, indicators, structure.points);
  const eventsByTime = new Map<number, TechnicalEvent[]>();
  for (const event of technicalEvents) eventsByTime.set(event.time, [...(eventsByTime.get(event.time) ?? []), event]);
  const signals: AnalysisSignal[] = [];
  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    const { smaFast, smaSlow, rsi } = indicators[i];
    const previous = indicators[i - 1];
    if (smaFast === null || smaSlow === null || rsi === null) continue;
    const crossedUp = previous?.smaFast !== null && previous?.smaFast !== undefined && previous.smaSlow !== null && previous.smaFast <= previous.smaSlow && smaFast > smaSlow;
    const crossedDown = previous?.smaFast !== null && previous?.smaFast !== undefined && previous.smaSlow !== null && previous.smaFast >= previous.smaSlow && smaFast < smaSlow;
    let action: AnalysisSignal['action'] = crossedUp && (rule === 'sma-cross' || rsi <= 70) ? 'buy' : crossedDown ? 'sell' : 'hold';
    let reason = action === 'buy' ? rule === 'sma-cross' ? 'La media de 20 cierres cruza por encima de la de 50 (sin filtro RSI).' : 'La media de 20 cierres cruza por encima de la de 50 y RSI14 no supera 70.'
      : action === 'sell' ? 'La media de 20 cierres cruza por debajo de la de 50.'
      : crossedUp ? 'Cruce alcista descartado: RSI14 supera 70.' : 'Esperar: no hay un nuevo cruce válido al cierre.';
    if (rule === 'technical-confluence') {
      const point = indicators[i], events = eventsByTime.get(candles[i].time) ?? [];
      const bullish = events.some(event => event.direction === 'up' && event.kind !== 'rsi');
      const bearish = events.some(event => event.direction === 'down' && event.kind !== 'rsi');
      const macdUp = point.macdHistogram !== null && point.macdHistogram > 0;
      const macdDown = point.macdHistogram !== null && point.macdHistogram < 0;
      action = (bullish || crossedUp) && smaFast > smaSlow && macdUp && rsi >= 35 && rsi <= 70 ? 'buy'
        : (bearish || crossedDown) && (macdDown || smaFast < smaSlow) ? 'sell' : 'hold';
      reason = action === 'hold' ? 'Esperar: no coinciden un nuevo cruce/ruptura, tendencia SMA20/50, MACD y rango RSI de la regla de confluencia.'
        : `Confluencia ${action === 'buy' ? 'alcista' : 'bajista'}: SMA20 ${smaFast.toFixed(2)}, SMA50 ${smaSlow.toFixed(2)}, RSI14 ${rsi.toFixed(1)}, histograma MACD ${point.macdHistogram?.toFixed(3)}. ${events.map(event => event.reason).join(' ')}`;
    }
    signals.push({ time: candles[i].time, action, price: close, reason, smaFast, smaSlow, rsi });
  }
  const validationIndex = options.validationStartIndex ?? Math.max(SLOW, Math.floor(candles.length * .7));
  const validationStartTime = candles[validationIndex]?.time ?? null;
  const fee = feeBps / 10000, slippage = slippageBps / 10000;
  const byTime = new Map(signals.map(signal => [signal.time, signal]));
  let cash = initialCapital, quantity = 0, peak = initialCapital, maxDrawdownPct = 0;
  let active: { entryTime: number; entryPrice: number; quantity: number; cost: number } | null = null;
  const trades: BacktestTrade[] = [];
  const equityCurve: AnalysisResult['backtest']['equityCurve'] = [];
  const benchmarkQuantity = candles[validationIndex] ? initialCapital / (candles[validationIndex].open * (1 + slippage) * (1 + fee)) : 0;
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
    equityCurve.push({ time: candle.time, equity: round(equity), benchmark: round(benchmarkQuantity * candle.close), drawdownPct: round((1 - equity / peak) * 100) });
  }
  const finalClose = candles.at(-1)?.close ?? 0;
  const finalEquity = cash + quantity * finalClose;
  if (active) trades.push({ entryTime: active.entryTime, entryPrice: round(active.entryPrice), exitTime: null, exitPrice: null, quantity: round(active.quantity), netPnl: round(quantity * finalClose - active.cost), returnPct: round((quantity * finalClose / active.cost - 1) * 100) });
  const completed = trades.filter(trade => trade.exitTime !== null);
  const buyHoldReturnPct = validationStartTime === null ? 0 : (finalClose / (candles[validationIndex].open * (1 + slippage) * (1 + fee)) - 1) * 100;
  return {
    signals, latest: signals.at(-1) ?? null, indicators, structure, technicalEvents, rule, warmupBars: SLOW, validationStartTime,
    warning: candles.length < 100 ? 'Histórico insuficiente para una validación temporal útil; se recomiendan al menos 100 velas cerradas.' : 'Regla educativa fija. Los resultados históricos no garantizan rentabilidad futura.',
    backtest: {
      equityCurve,
      initialCapital, finalEquity: round(finalEquity), returnPct: round((finalEquity / initialCapital - 1) * 100), maxDrawdownPct: round(maxDrawdownPct), buyHoldReturnPct: round(buyHoldReturnPct),
      trades, completedTrades: completed.length, winRatePct: completed.length ? round(completed.filter(trade => trade.netPnl > 0).length / completed.length * 100) : null,
      feeBps, slippageBps, startTime: validationStartTime, endTime: candles.at(-1)?.time ?? null, openPosition: quantity > 0,
    },
  };
}
