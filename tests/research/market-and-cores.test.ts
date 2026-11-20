import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveObservedMarket } from '../../src/cores/01-analisis-tecnico/market-analysis.ts';
import { knownBy, missingVariable, type CompanyResearch, type ResearchVariable, type ObservedOptionContract } from '../../src/cores/compartido/research-model.ts';
import { missingFundamentals } from '../../src/api/research/sec.ts';
import { missingMacro } from '../../src/api/research/fred.ts';
import { missingNews, missingOptions } from '../../src/api/research/alpaca.ts';
import { observedOptionInputs, rankObservedCompanies, selectObservedOption } from '../../src/cores/evaluacion/observed-ranking.ts';

const cutoff = '2026-11-13T16:00:00.000Z';
const bars = Array.from({ length: 100 }, (_, i) => {
  const price = 100 * Math.exp(.001 * i + .012 * Math.sin(i));
  return { time: Date.parse('2026-08-01T04:00:00Z') + i * 86_400_000, open: price, high: price + 1, low: price - 1, close: price, volume: 1_000_000 + i * 100 };
});
function variable(value: number, source = 'fixture observed', kind: ResearchVariable['kind'] = 'observed'): ResearchVariable {
  return { value, source, observedAt: '2026-11-13T15:59:00.000Z', availableAt: cutoff, kind };
}
function snapshot(): CompanyResearch {
  return { symbol: 'AAPL', asOf: cutoff, generatedAt: cutoff, market: deriveObservedMarket('AAPL', bars, cutoff),
    options: missingOptions(), fundamentals: missingFundamentals(), macro: missingMacro(), news: missingNews(),
    quality: { historicalOnly: false, missing: [], stale: [], sources: [] }, warnings: [] };
}
function contract(): ObservedOptionContract {
  return { symbol: 'AAPL261218P00100000', underlyingSymbol: 'AAPL', multiplier: variable(100), deliverableShares: variable(100), deliverableType: 'single_equity', type: 'put', expiration: '2026-12-18', style: 'american',
    strike: variable(100), impliedVolatility: variable(.3), bid: variable(1.9), ask: variable(2.1), premium: variable(2, 'observed midpoint', 'estimated'),
    openInterest: variable(5000), delta: variable(-.25), gamma: variable(.02), theta: variable(-.04), vega: variable(.1) };
}

test('daily derived values retain input source and availability; realized HV is sample daily volatility', () => {
  const market = deriveObservedMarket('AAPL', bars, cutoff, 'Alpaca iex · split');
  const returns = bars.slice(1).map((b, i) => Math.log(b.close / bars[i].close));
  const mean = returns.reduce((a, b) => a + b) / returns.length;
  const expected = Math.sqrt(returns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(252);
  assert.ok(Math.abs(market.historicalVolatility.value! - expected) < 1e-12);
  assert.equal(market.historicalVolatility.kind, 'estimated');
  assert.match(market.historicalVolatility.source, /Alpaca iex/);
  assert.ok(knownBy(market.historicalVolatility, cutoff));
  assert.equal(market.spot.kind, 'observed');
});

test('a future close and an unfinished same-day daily candle cannot affect a historical decision', () => {
  const asOf = '2026-11-01T16:00:00Z';
  const base = deriveObservedMarket('AAPL', bars, asOf);
  const changed = deriveObservedMarket('AAPL', [...bars.filter(bar => bar.time < Date.parse('2026-11-01')), {
    time: Date.parse('2026-11-01T04:00:00Z'), open: 10000, high: 11000, low: 9000, close: 10500, volume: 8e8,
  }], asOf);
  assert.equal(base.spot.value, changed.spot.value);
  assert.equal(base.historicalVolatility.value, changed.historicalVolatility.value);
  assert.ok(base.bars.every(bar => bar.time < Date.parse('2026-11-01')));
});

test('too little daily history yields missing estimates and intraday data is rejected', () => {
  const market = deriveObservedMarket('AAPL', bars.slice(-10), cutoff);
  assert.equal(market.historicalVolatility.value, null);
  assert.equal(market.historicalVolatility.kind, 'missing');
  assert.equal(market.momentum20.value, null);
  assert.throws(() => deriveObservedMarket('AAPL', [bars[0], { ...bars[0], time: bars[0].time + 60_000 }], cutoff), /diaria/);
});

test('a full daily bar waits until the entire New York date has ended', () => {
  const bar = { time: Date.parse('2026-11-13T05:00:00Z'), open: 100, high: 102, low: 99, close: 101, volume: 100 };
  assert.equal(deriveObservedMarket('AAPL', [bar], '2026-11-14T04:00:00Z').spot.value, null);
  assert.equal(deriveObservedMarket('AAPL', [bar], '2026-11-14T06:00:00Z').spot.value, 101);
});

test('market cores work with actual candles while option cores stay unavailable without real contract/IV', () => {
  const research = snapshot();
  const selected = rankObservedCompanies([research], ['volatility', 'trend', 'liquidity', 'risk'], 'wheel', 35)[0];
  assert.ok(selected.score !== null);
  assert.equal(selected.availableCoreCount, 4);
  assert.match(selected.reason, /no una probabilidad/);
  assert.equal(selected.probabilityOfProfit.value, null);
  const option = rankObservedCompanies([research], ['bsm', 'volatility'], 'wheel', 35)[0];
  assert.equal(option.score, null);
  assert.equal(option.availableCoreCount, 1);
  assert.match(option.coreResults.find(result => result.core === 'bsm')!.reason, /No se usa HV como IV/);
});

test('a published IV is distinct from historical volatility and q cannot silently default to zero', () => {
  const research = snapshot();
  research.options.contracts = [contract()];
  research.macro.riskFreeRate = variable(.04, 'FRED vintage');
  research.market.stale = false;
  assert.notEqual(research.market.historicalVolatility.value, contract().impliedVolatility.value);
  const selected = selectObservedOption(research, 'wheel', 35);
  assert.equal(selected?.symbol, contract().symbol);
  const inputs = observedOptionInputs(research, selected);
  assert.equal(inputs.input, null);
  assert.ok(inputs.missing.includes('dividendYield'));
  assert.equal(rankObservedCompanies([research], ['probability'], 'wheel', 35)[0].probabilityOfProfit.value, null);
});

test('explicit q assumption permits transparent single-leg theoretical modeling, never strategy success', () => {
  const research = snapshot();
  research.options.contracts = [contract()];
  research.macro.riskFreeRate = variable(.04, 'FRED vintage');
  research.market.stale = false;
  // Last spot is recent enough for the fixture contract.
  research.market.spot = variable(105, 'Alpaca prior daily close');
  const assumption = variable(0, 'Usuario · supuesto q=0 explícito', 'assumed');
  const inputs = observedOptionInputs(research, contract(), { dividendYield: assumption });
  assert.equal(inputs.input?.dividendYield, 0);
  assert.equal(inputs.input?.volatility, .3);
  assert.equal(inputs.premium, 2);
  assert.ok(inputs.warnings.some(text => /ejercicio anticipado/.test(text)));
  const ranked = rankObservedCompanies([research], ['bsm', 'greeks', 'probability'], 'wheel', 35, { dividendYield: assumption })[0];
  assert.equal(ranked.availableCoreCount, 3);
  assert.ok(ranked.probabilityOfProfit.value! >= 0 && ranked.probabilityOfProfit.value! <= 1);
  assert.match(ranked.probabilityLabel, /una pierna/);
  assert.match(ranked.coreResults[2].reason, /excluye comisiones/);
  assert.equal(ranked.coreResults[0].evidence.find(item => item.input === 'dividendYield')!.variable.kind, 'assumed');
});

test('future-published or absent inputs invalidate modeling even when a numeric value is present', () => {
  const research = snapshot();
  research.market.spot = variable(105);
  research.market.stale = false;
  research.options.contracts = [contract()];
  research.fundamentals.dividendYield = variable(.01);
  research.macro.riskFreeRate = { ...variable(.04), availableAt: '2026-11-14T00:00:00Z' };
  assert.ok(observedOptionInputs(research, contract()).missing.includes('riskFreeRate'));
  assert.equal(knownBy({ ...variable(1), observedAt: null }, cutoff), false);
  research.macro.riskFreeRate = missingVariable('FRED', 'missing');
  assert.equal(rankObservedCompanies([research], ['bsm'], 'wheel', 35)[0].score, null);
});

import { educationalOptionScenario } from '../../src/features/research/educational-scenario.ts';
import { blackScholes } from '../../src/cores/nucleo-cuantitativo/bsm.ts';
test('educational Greeks use explicit dividends and dated prior IV without changing observed inputs', () => {
  const research = snapshot();
  research.market.stale = false;
  research.market.spot = variable(105);
  research.macro.riskFreeRate = variable(.04);
  const option = contract();
  option.impliedVolatility = { ...missingVariable('Alpaca', 'stale'), lastReceived: { value: .3, observedAt: '2026-11-12T20:00:00Z', receivedAt: cutoff } };
  research.options.contracts = [option];
  const scenario = educationalOptionScenario(research, 'wheel', 35, 1)!;
  assert.equal(scenario.dividendYield, .01);
  assert.equal(scenario.volatility, .3);
  assert.match(scenario.volatilityLabel, /IV anterior/);
  const result = blackScholes(scenario);
  assert.ok([result.delta, result.gamma, result.theta, result.vega].every(Number.isFinite));
  assert.equal(observedOptionInputs(research, option).input, null);
  option.impliedVolatility.lastReceived!.observedAt = '2026-10-01T00:00:00Z';
  assert.match(educationalOptionScenario(research, 'wheel', 35, 0)!.volatilityLabel, /no es IV/);
  research.macro.riskFreeRate.availableAt = '2026-12-01T00:00:00Z';
  assert.equal(educationalOptionScenario(research, 'wheel', 35, 0), null);
  assert.equal(educationalOptionScenario(research, 'wheel', 35, NaN), null);
});
