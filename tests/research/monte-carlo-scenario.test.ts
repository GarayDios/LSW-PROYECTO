import test from 'node:test';
import assert from 'node:assert/strict';
import { strategyMonteCarloScenario } from '../../src/cores/evaluacion/monte-carlo-scenario.ts';
import { analyzeStrategy } from '../../src/cores/evaluacion/strategy-analysis.ts';
import { missingVariable } from '../../src/cores/compartido/research-model.ts';
import { fixtureVariable as v, researchFixture } from './research-fixture.ts';

test('Monte Carlo strategy adapter preserves bid/ask cashflows, ratios, fees and original snapshots', () => {
  for (const strategy of ['wheel', 'backspread', 'gamma', 'pmcc'] as const) {
    const snapshot = researchFixture(), before = structuredClone(snapshot), policy = { feePerContract: .65 };
    const actual = strategyMonteCarloScenario(snapshot, strategy, 30, policy), analysis = analyzeStrategy(snapshot, strategy, 30, policy);
    assert.ok(actual.scenario, actual.error);
    const { basis } = actual.scenario;
    const debit = basis.legs.reduce((sum, leg) => sum + leg.quantity * leg.units * leg.premium + Math.abs(leg.quantity) * basis.feePerContract, 0);
    assert.ok(Math.abs(debit - analysis.entryDebit!) < 1e-10);
    assert.deepEqual(basis.legs.map(l => l.quantity), analysis.legs.map(l => l.quantity));
    assert.deepEqual(snapshot, before);
    assert.match(actual.scenario.label, strategy === 'wheel' ? /put inicial/ : strategy === 'pmcc' ? /PMCC/ : strategy === 'gamma' ? /Gamma/ : /Backspread/);
  }
});

test('adjusted deliverables preserve exercise and premium units instead of assuming 100 shares', () => {
  const snapshot = researchFixture();
  snapshot.options.contracts = snapshot.options.contracts.filter(c => c.type === 'put' && c.strike.value === 95);
  for (const c of snapshot.options.contracts) { c.multiplier = v(100); c.deliverableShares = v(150); }
  const result = strategyMonteCarloScenario(snapshot, 'wheel', 30);
  assert.ok(result.scenario, result.error);
  const leg = result.scenario.basis.legs[0];
  assert.equal(leg.units, 150); assert.equal(leg.strike * 150, 9500); assert.equal(leg.premium * 150, 200);
});

test('PMCC keeps two maturities while missing inputs and discrete dividends remain explicit', () => {
  const snapshot = researchFixture();
  const diagonal = strategyMonteCarloScenario(snapshot, 'pmcc', 30).scenario!;
  assert.ok(diagonal);
  assert.ok(diagonal.basis.legs.some(leg => leg.daysToExpiry! > diagonal.basis.days));
  assert.ok(diagonal.basis.legs.some(leg => leg.daysToExpiry === diagonal.basis.days));
  assert.match(diagonal.warnings.join(' '), /LEAPS conserva su vencimiento/);
  assert.equal(strategyMonteCarloScenario(snapshot, 'wheel', 30, { dividendModel: 'declared-cash' }).scenario, null);
  snapshot.macro.riskFreeRate = missingVariable('FRED', 'missing');
  assert.equal(strategyMonteCarloScenario(snapshot, 'wheel', 30).scenario, null);
  assert.ok(strategyMonteCarloScenario(snapshot, 'wheel', 30, { riskFreeRate: v(.04) }).scenario);
  snapshot.options.contracts = [];
  assert.equal(strategyMonteCarloScenario(snapshot, 'wheel', 30, { riskFreeRate: v(.04) }).scenario, null);
});

test('estimated entries and common volatility are disclosed in the simulation provenance', () => {
  const snapshot = researchFixture();
  for (const c of snapshot.options.contracts) {
    c.bid = missingVariable('Alpaca', 'missing'); c.ask = missingVariable('Alpaca', 'missing');
    c.premium = missingVariable('Alpaca', 'missing'); c.impliedVolatility = missingVariable('Alpaca', 'missing');
  }
  const result = strategyMonteCarloScenario(snapshot, 'backspread', 30, { modelMode: 'estimated' });
  assert.ok(result.scenario, result.error);
  assert.match(result.scenario.label, /estimadas/);
  assert.ok(result.scenario.warnings.some(w => w.includes('Una sola volatilidad')));
  assert.ok(result.scenario.sources.some(s => s.includes('Escenario estimado')));
});
