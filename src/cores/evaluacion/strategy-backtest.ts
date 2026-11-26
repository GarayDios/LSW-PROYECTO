import { blackScholes } from '../nucleo-cuantitativo/bsm.ts';
import type { StrategyId } from '../compartido/types.ts';
import type { Candle } from '../../features/market/chart-history.ts';

const DAY = 86400000;
const date = (time: number) => new Date(time).toISOString().slice(0, 10);
const day = (time: number) => Date.parse(date(time));
const round = (value: number) => Math.round(value * 1e6) / 1e6;

export function strategyBacktestTerms(strategy: StrategyId) {
  return { shortPercent: strategy === 'wheel' ? 95 : strategy === 'pmcc' ? 105 : 100,
    longPercent: strategy === 'pmcc' ? 70 : 110, callPercent: 105 };
}

export type StrategyBacktestInput = {
  strategy: StrategyId; bars: readonly Candle[]; from: string; to: string;
  capital: number; contracts: number; days: number; longDays: number;
  shortPercent: number; longPercent: number; callPercent: number;
  feePerContract: number; feePerShare: number; slippageBps: number;
  rate: number; dividendYield: number;
};
export type HistoricalLeg = { type: 'call' | 'put'; quantity: number; strike: number; expiry: number; volatility: number };
export type StrategyBacktestOperation = {
  time: number; cycle: number; kind: 'option-open' | 'option-close' | 'settlement' | 'assignment' | 'hedge' | 'stock-close';
  detail: string; quantity: number; price: number; fee: number; cashFlow: number;
};
export type StrategyBacktestTrade = {
  id: number; entryTime: number; exitTime: number; entrySpot: number; exitSpot: number;
  contracts: number; required: number; volatility: number; netPnl: number; returnPct: number;
  fees: number; reason: string; legs: HistoricalLeg[];
};
export type StrategyBacktestResult = {
  strategy: StrategyId; initialCapital: number; finalEquity: number; returnPct: number;
  maxDrawdownPct: number; buyHoldReturnPct: number; completedTrades: number; winRatePct: number | null;
  startTime: number; endTime: number; totalFees: number; skipped: { time: number; reason: string }[];
  trades: StrategyBacktestTrade[]; operations: StrategyBacktestOperation[];
  equityCurve: { time: number; equity: number; benchmark: number; drawdownPct: number }[];
  snapshots: StrategyBacktestSnapshot[];
};
export type StrategyBacktestSnapshot = {
  time: number; equity: number; cash: number; shares: number; optionsValue: number; fees: number;
  delta: number; gamma: number; theta: number; vega: number;
  legs: (HistoricalLeg & { mark: number; remainingDays: number })[];
};

/** Daily option-strategy simulation. Historical underlying prices are observed;
 * contracts, premiums, volatility, cash settlement and execution costs are modeled.
 * Entry volatility uses prior closes only. Close-based delta orders fill next open. */
export function backtestStrategy(input: StrategyBacktestInput): StrategyBacktestResult {
  const { strategy, capital, contracts, days, longDays, feePerContract, feePerShare, rate, dividendYield } = input;
  if (!['wheel', 'pmcc', 'backspread', 'gamma'].includes(strategy)) throw new RangeError('Estrategia de backtesting inválida.');
  if (![capital, contracts, days, longDays, feePerContract, feePerShare, rate, dividendYield, input.slippageBps, input.shortPercent, input.longPercent, input.callPercent].every(Number.isFinite)
    || capital <= 0 || capital > 1e7 || !Number.isInteger(contracts) || contracts < 1 || contracts > 100
    || !Number.isInteger(days) || days < 1 || days > 730 || !Number.isInteger(longDays) || longDays < 1 || longDays > 3650
    || feePerContract < 0 || feePerContract > 100 || feePerShare < 0 || feePerShare > 10
    || input.slippageBps < 0 || input.slippageBps > 1000 || rate < -.2 || rate > 1 || dividendYield < 0 || dividendYield > 1
    || [input.shortPercent, input.longPercent, input.callPercent].some(value => value <= 0 || value > 300)) throw new RangeError('Revisa capital, contratos, plazos, strikes, costes y supuestos del backtest.');
  for (const value of [input.from, input.to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || date(Date.parse(value)) !== value) throw new RangeError('Fechas del backtest inválidas.');
  if (input.from > input.to) throw new RangeError('El inicio debe ser anterior al fin de la prueba.');
  if (strategy === 'pmcc' && (longDays <= days || input.longPercent >= input.shortPercent)) throw new RangeError('PMCC requiere strike largo inferior al corto y plazo largo mayor.');
  if (strategy === 'backspread' && input.longPercent <= input.shortPercent) throw new RangeError('Backspread requiere un strike comprado superior al vendido.');
  const bars = input.bars.filter(bar => date(bar.time) <= input.to);
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    if (![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) || bar.open <= 0 || bar.close <= 0 || bar.low <= 0 || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.volume < 0
      || index > 0 && date(bar.time) <= date(bars[index - 1].time)) throw new RangeError('Se requiere una vela diaria válida, única y ordenada por sesión.');
  }
  const first = bars.findIndex(bar => date(bar.time) >= input.from);
  if (first < 31) throw new RangeError('Se requieren al menos 31 cierres anteriores al inicio para estimar la volatilidad sin datos futuros.');
  if (bars.length - first < 2) throw new RangeError('Se requieren al menos dos sesiones en el período de prueba.');
  const slippage = input.slippageBps / 10000;
  const operations: StrategyBacktestOperation[] = [], trades: StrategyBacktestTrade[] = [], skipped: StrategyBacktestResult['skipped'] = [], equityCurve: StrategyBacktestResult['equityCurve'] = [];
  const snapshots: StrategyBacktestSnapshot[] = [];
  let cash = capital, shares = 0, legs: HistoricalLeg[] = [], fees = 0, peak = capital, maxDrawdown = 0, nextCycle = 0;
  let pendingHedge: number | null = null;
  let active: { id: number; entryTime: number; entrySpot: number; equity: number; fees: number; required: number; volatility: number; legs: HistoricalLeg[] } | null = null;
  const model = (leg: HistoricalLeg, spot: number, time: number) => blackScholes({ spot, strike: leg.strike, days: Math.max(0, (leg.expiry - day(time)) / DAY), volatility: leg.volatility, rate, dividendYield, type: leg.type });
  const equity = (spot: number, time: number) => cash + shares * spot + legs.reduce((sum, leg) => sum + leg.quantity * 100 * model(leg, spot, time).price, 0);
  const operation = (time: number, kind: StrategyBacktestOperation['kind'], detail: string, quantity: number, price: number, fee: number, cashFlow: number) => {
    cash += cashFlow; fees += fee;
    operations.push({ time, cycle: active!.id, kind, detail, quantity, price: round(price), fee: round(fee), cashFlow: round(cashFlow) });
  };
  const tradeShares = (quantity: number, spot: number, time: number, kind: 'hedge' | 'stock-close') => {
    if (!quantity) return;
    const price = spot * (1 + Math.sign(quantity) * slippage), fee = Math.abs(quantity) * feePerShare;
    operation(time, kind, `${quantity > 0 ? 'Compra' : 'Venta'} de ${Math.abs(quantity)} acciones`, quantity, price, fee, -quantity * price - fee);
    shares += quantity;
  };
  const openLeg = (leg: HistoricalLeg, spot: number, time: number) => {
    const price = model(leg, spot, time).price * (1 + Math.sign(leg.quantity) * slippage), fee = Math.abs(leg.quantity) * feePerContract;
    operation(time, 'option-open', `${leg.quantity > 0 ? 'Compra' : 'Venta'} ${Math.abs(leg.quantity)} ${leg.type.toUpperCase()} ${leg.strike} · ${date(leg.expiry)}`, leg.quantity, price, fee, -leg.quantity * 100 * price - fee);
    legs.push(leg); active!.legs.push({ ...leg });
  };
  const closeLeg = (leg: HistoricalLeg, spot: number, time: number, settlement: boolean) => {
    const price = settlement ? Math.max(0, leg.type === 'call' ? spot - leg.strike : leg.strike - spot) : model(leg, spot, time).price * (1 - Math.sign(leg.quantity) * slippage);
    const fee = settlement ? 0 : Math.abs(leg.quantity) * feePerContract;
    operation(time, settlement ? 'settlement' : 'option-close', `${settlement ? 'Vencimiento' : 'Cierre'} ${leg.type.toUpperCase()} ${leg.strike}`, -leg.quantity, price, fee, leg.quantity * 100 * price - fee);
    legs = legs.filter(item => item !== leg);
  };
  const finish = (spot: number, time: number, reason: string) => {
    if (!active) return;
    for (const leg of [...legs]) closeLeg(leg, spot, time, false);
    tradeShares(-shares, spot, time, 'stock-close');
    const pnl = cash - active.equity;
    trades.push({ id: active.id, entryTime: active.entryTime, exitTime: time, entrySpot: active.entrySpot, exitSpot: spot, contracts, required: round(active.required), volatility: active.volatility,
      netPnl: round(pnl), returnPct: round(pnl / active.equity * 100), fees: round(fees - active.fees), reason, legs: active.legs });
    active = null; pendingHedge = null;
  };
  const volatilityAt = (index: number) => {
    const closes = bars.slice(Math.max(0, index - 253), index).map(bar => bar.close);
    const returns = closes.slice(1).map((close, i) => Math.log(close / closes[i]));
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    return Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1) * 252);
  };
  const makeLeg = (type: 'call' | 'put', quantity: number, strike: number, time: number, duration: number, volatility: number): HistoricalLeg => ({ type, quantity: quantity * contracts, strike: Math.max(.01, Math.round(strike * 100) / 100), expiry: day(time) + duration * DAY, volatility });
  const benchmarkShares = capital / (bars[first].open * (1 + slippage) + feePerShare);

  for (let index = first; index < bars.length; index++) {
    const bar = bars[index], volatility = volatilityAt(index);
    if (!active && cash > 0) {
      if (!(volatility > 0 && volatility <= 3)) skipped.push({ time: bar.time, reason: 'Sin volatilidad histórica positiva y válida en los cierres previos.' });
      else {
        const strike = bar.open * input.shortPercent / 100, longStrike = bar.open * input.longPercent / 100;
        const proposed = strategy === 'wheel' ? [makeLeg('put', -1, strike, bar.time, days, volatility)]
          : strategy === 'pmcc' ? [makeLeg('call', 1, longStrike, bar.time, longDays, volatility), makeLeg('call', -1, strike, bar.time, days, volatility)]
          : strategy === 'backspread' ? [makeLeg('call', -1, strike, bar.time, days, volatility), makeLeg('call', 2, longStrike, bar.time, days, volatility)]
          : [makeLeg('call', 1, strike, bar.time, days, volatility), makeLeg('put', 1, strike, bar.time, days, volatility)];
        const debit = proposed.reduce((sum, leg) => sum + leg.quantity * 100 * model(leg, bar.open, bar.time).price * (1 + Math.sign(leg.quantity) * slippage) + Math.abs(leg.quantity) * feePerContract, 0);
        const required = strategy === 'wheel' ? proposed[0].strike * 100 * contracts + feePerContract * contracts
          : strategy === 'pmcc' ? Math.max(0, debit) + proposed[1].strike * 100 * contracts
          : strategy === 'backspread' ? Math.max(0, (proposed[1].strike - proposed[0].strike) * 100 * contracts + debit)
          : Math.max(0, debit) + bar.open * 100 * contracts;
        if (proposed.some(leg => model(leg, bar.open, bar.time).price < .001)) skipped.push({ time: bar.time, reason: 'Prima teórica inferior al mínimo de 0.001 USD por acción; ajusta strikes o plazo.' });
        else if (required > cash) skipped.push({ time: bar.time, reason: `Reserva del modelo USD ${required.toFixed(2)}; efectivo disponible USD ${cash.toFixed(2)}.` });
        else {
          active = { id: ++nextCycle, entryTime: bar.time, entrySpot: bar.open, equity: cash, fees, required, volatility, legs: [] };
          for (const leg of proposed) openLeg(leg, bar.open, bar.time);
          if (strategy === 'gamma') tradeShares(Math.round(-legs.reduce((sum, leg) => sum + leg.quantity * 100 * model(leg, bar.open, bar.time).delta, 0)), bar.open, bar.time, 'hedge');
        }
      }
    } else if (active) {
      if (strategy === 'gamma' && pendingHedge !== null) { tradeShares(pendingHedge - shares, bar.open, bar.time, 'hedge'); pendingHedge = null; }
      if (strategy === 'wheel' && !legs.length && shares > 0) {
        openLeg(makeLeg('call', -1, bar.open * input.callPercent / 100, bar.time, days, volatility > 0 && volatility <= 3 ? volatility : active.volatility), bar.open, bar.time);
      }
      if (strategy === 'pmcc' && legs.length === 1 && legs[0].quantity > 0) {
        const remaining = Math.round((legs[0].expiry - day(bar.time)) / DAY);
        if (remaining > days) openLeg(makeLeg('call', -1, Math.max(legs[0].strike + .01, bar.open * input.shortPercent / 100), bar.time, days, volatility > 0 && volatility <= 3 ? volatility : active.volatility), bar.open, bar.time);
        else finish(bar.open, bar.time, 'Cierre de PMCC: plazo insuficiente para otra call corta');
      }
    }
    if (active) {
      for (const leg of [...legs].filter(leg => leg.expiry <= day(bar.time))) {
        if (strategy === 'wheel') {
          const itm = (leg.type === 'put' ? leg.strike - bar.close : bar.close - leg.strike) >= .01 - 1e-8;
          if (itm) {
            const quantity = -leg.quantity * 100 * (leg.type === 'put' ? 1 : -1);
            operation(bar.time, 'assignment', `${leg.type === 'put' ? 'PUT asignada: recibir acciones' : 'CALL asignada: entregar acciones'} a ${leg.strike}`, quantity, leg.strike, 0, -quantity * leg.strike);
            shares += quantity;
          } else operation(bar.time, 'settlement', `${leg.type.toUpperCase()} ${leg.strike} vence sin valor`, -leg.quantity, 0, 0, 0);
          legs = legs.filter(item => item !== leg);
        } else closeLeg(leg, bar.close, bar.time, true);
      }
      if (!legs.length && (strategy !== 'wheel' || shares === 0)) finish(bar.close, bar.time, 'Vencimiento de la estrategia');
      else if (equity(bar.close, bar.time) <= 0) finish(bar.close, bar.time, 'Cierre por agotamiento del capital');
      else if (strategy === 'gamma') pendingHedge = Math.round(-legs.reduce((sum, leg) => sum + leg.quantity * 100 * model(leg, bar.close, bar.time).delta, 0));
    }
    if (index === bars.length - 1 && active) finish(bar.close, bar.time, 'Cierre al final del período');
    const value = equity(bar.close, bar.time);
    peak = Math.max(peak, value); const drawdown = (1 - value / peak) * 100; maxDrawdown = Math.max(maxDrawdown, drawdown);
    equityCurve.push({ time: bar.time, equity: round(value), benchmark: round(benchmarkShares * bar.close), drawdownPct: round(drawdown) });
    const marks = legs.map(leg => ({ leg, model: model(leg, bar.close, bar.time) }));
    snapshots.push({ time: bar.time, equity: round(value), cash: round(cash), shares, fees: round(fees),
      optionsValue: round(marks.reduce((sum, row) => sum + row.leg.quantity * 100 * row.model.price, 0)),
      delta: round(shares + marks.reduce((sum, row) => sum + row.leg.quantity * 100 * row.model.delta, 0)),
      gamma: round(marks.reduce((sum, row) => sum + row.leg.quantity * 100 * row.model.gamma, 0)),
      theta: round(marks.reduce((sum, row) => sum + row.leg.quantity * 100 * row.model.theta, 0)),
      vega: round(marks.reduce((sum, row) => sum + row.leg.quantity * 100 * row.model.vega, 0)),
      legs: marks.map(row => ({ ...row.leg, mark: row.model.price, remainingDays: Math.max(0, (row.leg.expiry - day(bar.time)) / DAY) })) });
  }
  return { strategy, initialCapital: capital, finalEquity: round(cash), returnPct: round((cash / capital - 1) * 100), maxDrawdownPct: round(maxDrawdown),
    buyHoldReturnPct: round((equityCurve.at(-1)!.benchmark / capital - 1) * 100), completedTrades: trades.length, winRatePct: trades.length ? round(trades.filter(trade => trade.netPnl > 0).length / trades.length * 100) : null,
    startTime: bars[first].time, endTime: bars.at(-1)!.time, totalFees: round(fees), trades, operations, skipped, equityCurve, snapshots };
}
