import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSupportResistance } from '../../src/cores/01-analisis-tecnico/support-resistance.ts';
import { detectTrendLines } from '../../src/cores/01-analisis-tecnico/trend-lines.ts';
import { analyzeHistory } from '../../src/cores/05-indicadores-y-senales/signals.ts';
import { coreChartStudies, defaultChartStudies, studyCore } from '../../src/features/market/chart-core-layers.ts';
import type { Candle } from '../../src/features/market/chart-history.ts';

const barsOf = (values: number[]): Candle[] => values.map((close, index) => ({ time: Date.parse('2023-01-01') + index * 86400000, open: close, close, low: close - .5, high: close + .5, volume: 1000 }));

test('chart archive retains every confirmed level, including expired and crossed levels', () => {
  const bars = barsOf(Array.from({ length: 5 }, (_, i) => [104, 100, 104, 106, 104, 100, 104, 106].map(v => v + i * 20)).flat());
  const result = analyzeSupportResistance(bars, { pivotBars: 1, lookback: 9 });
  const supports = result.allLevels.filter(level => level.kind === 'support');
  assert.equal(supports.length, 5);
  assert.ok(result.allLevels.length > result.levels.length);
  assert.equal(supports[0].price, 99.5);
  assert.equal(supports[0].confirmedAt, bars[6].time);
  assert.ok(supports.every(level => level.touches >= 2 && level.pivotAt < level.confirmedAt));
  assert.equal(new Set(result.allLevels.map(level => level.id)).size, result.allLevels.length);
  assert.deepEqual(analyzeSupportResistance(bars.slice(0, 6), { pivotBars: 1, lookback: 9 }).allLevels, []);
});

test('trend lines require higher lows or lower highs and begin only after pivot confirmation', () => {
  const up = barsOf([103, 100, 104, 102, 106, 104, 108, 106, 110]);
  const down = barsOf([107, 110, 106, 108, 104, 106, 102, 104, 100]);
  for (const [bars, direction] of [[up, 'up'], [down, 'down']] as const) {
    const lines = detectTrendLines(bars, 1).filter(line => line.direction === direction);
    assert.ok(lines.length >= 2);
    assert.equal(lines[0].startTime, bars[1].time);
    assert.equal(lines[0].pivotTime, bars[3].time);
    assert.equal(lines[0].confirmedAt, bars[4].time);
    assert.equal(detectTrendLines(bars.slice(0, 4), 1).length, 0);
  }
  assert.deepEqual(detectTrendLines(barsOf(Array(20).fill(100))), []);
  assert.throws(() => detectTrendLines(up, 0));
  assert.throws(() => detectTrendLines([up[1], up[0]]));
});

test('trend projection stops at a closing break and future bars cannot change its confirmed anchors', () => {
  const bars = barsOf([103, 100, 104, 102, 106, 104, 108, 95, 98]);
  const line = detectTrendLines(bars, 1).filter(line => line.direction === 'up').at(-1)!;
  assert.equal(line.broken, true);
  assert.equal(line.endTime, bars[7].time);
  const prefix = detectTrendLines(bars.slice(0, 7), 1);
  const anchors = (lines: ReturnType<typeof detectTrendLines>) => lines.map(({ id, direction, startTime, startPrice, pivotTime, pivotPrice, confirmedAt }) => ({ id, direction, startTime, startPrice, pivotTime, pivotPrice, confirmedAt }));
  assert.deepEqual(anchors(detectTrendLines(bars, 1).filter(row => row.confirmedAt <= bars[6].time)), anchors(prefix));
});

test('each chart layer belongs to its selected core and zero active cores leaves only price', () => {
  const all = { ...defaultChartStudies, volatilityBands: true, riskScenario: true };
  for (const core of ['own', 'fundamental', 'monteCarlo', 'structure', 'institutional', 'technical', 'news'] as const) {
    const visible = coreChartStudies(all, [core]);
    for (const [key, owner] of Object.entries(studyCore)) assert.equal(visible[key as keyof typeof studyCore], core === owner, `${key} / ${core}`);
  }
  assert.ok(Object.entries(coreChartStudies(all, [])).every(([key, enabled]) => key === 'labels' || !enabled));
  assert.equal(coreChartStudies({ ...all, trends: false }, ['technical']).trends, false);
  assert.equal(all.trends, true, 'visibility filtering must preserve user settings');
});

test('backtest equity curve reconciles trades, reference, drawdown and causal prefixes', () => {
  const bars = barsOf(Array.from({ length: 400 }, (_, i) => 100 + 10 * Math.sin(i / 10)));
  const options = { initialCapital: 25000, validationStartIndex: 80, feeBps: 20, slippageBps: 15, rule: 'sma-cross' as const };
  const result = analyzeHistory(bars, options).backtest;
  assert.ok(result.completedTrades > 0);
  assert.equal(result.equityCurve.length, 320);
  assert.equal(result.equityCurve.at(-1)!.equity, result.finalEquity);
  assert.ok(Math.abs(result.finalEquity - (result.initialCapital + result.trades.reduce((sum, trade) => sum + trade.netPnl, 0))) < 1e-4);
  assert.equal(Math.max(...result.equityCurve.map(point => point.drawdownPct)), result.maxDrawdownPct);
  assert.ok(Math.abs((result.equityCurve.at(-1)!.benchmark / result.initialCapital - 1) * 100 - result.buyHoldReturnPct) < 1e-6);
  assert.deepEqual(result.equityCurve.slice(0, 170), analyzeHistory(bars.slice(0, 250), options).backtest.equityCurve);
  const free = analyzeHistory(bars, { ...options, feeBps: 0, slippageBps: 0 }).backtest;
  assert.ok(free.finalEquity > result.finalEquity, 'execution costs reduce equity for the same trades');
});

test('no-trade backtest keeps cash and an unavailable test period has no equity points', () => {
  const bars = barsOf(Array(100).fill(100));
  const result = analyzeHistory(bars, { initialCapital: 12345, validationStartIndex: 50 }).backtest;
  assert.equal(result.completedTrades, 0);
  assert.equal(result.winRatePct, null);
  assert.ok(result.equityCurve.every(point => point.equity === 12345 && point.drawdownPct === 0));
  assert.deepEqual(analyzeHistory(bars, { validationStartIndex: 100 }).backtest.equityCurve, []);
});
