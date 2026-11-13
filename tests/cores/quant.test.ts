import test from 'node:test';
import assert from 'node:assert/strict';
import { blackScholes, CORE_IDS, normalCdf, profitMetrics, rankCompanies } from '../../src/cores/index.ts';
import { companies } from '../../src/features/market/data.ts';

const base = { spot: 100, strike: 100, days: 365, volatility: .2, rate: .05, type: 'call' as const };
const close = (actual: number, expected: number, tolerance = .00002) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

test('standard one-year BSM benchmark and Greek units', () => {
  const call = blackScholes(base);
  close(call.price, 10.450584);
  close(call.delta, .636831);
  close(call.gamma, .018762);
  close(call.vega, .375240);
  close(call.rho, .532325);
  close(call.theta, -.017573);
  close(blackScholes({ ...base, type: 'put' }).price, 5.573526);
});

test('put-call parity includes dividends and negative rates', () => {
  for (const rate of [-.01, .05]) {
    const input = { ...base, spot: 140, strike: 130, days: 175, dividendYield: .025, rate };
    const call = blackScholes(input);
    const put = blackScholes({ ...input, type: 'put' });
    const t = input.days / 365;
    close(call.price - put.price, input.spot * Math.exp(-input.dividendYield * t) - input.strike * Math.exp(-rate * t));
    close(call.delta - put.delta, Math.exp(-input.dividendYield * t));
    close(call.gamma, put.gamma);
  }
});

test('Greek sensitivities agree with finite differences', () => {
  for (const type of ['call', 'put'] as const) {
    const input = { ...base, type, dividendYield: .02 };
    const result = blackScholes(input);
    const h = .01;
    const up = blackScholes({ ...input, spot: input.spot + h }).price;
    const dn = blackScholes({ ...input, spot: input.spot - h }).price;
    close((up - dn) / (2 * h), result.delta, .00003);
    close((up - 2 * result.price + dn) / (h * h), result.gamma, .00003);
    close((blackScholes({ ...input, volatility: .20001 }).price - blackScholes({ ...input, volatility: .19999 }).price) / .00002 / 100, result.vega, .00003);
    close((blackScholes({ ...input, days: input.days - .01 }).price - blackScholes({ ...input, days: input.days + .01 }).price) / .02, result.theta, .00003);
  }
});

test('expiry and zero volatility produce finite deterministic values', () => {
  assert.equal(blackScholes({ ...base, spot: 120, days: 0 }).price, 20);
  assert.equal(blackScholes({ ...base, spot: 90, days: 0, type: 'put' }).price, 10);
  const value = blackScholes({ ...base, volatility: 0 });
  close(value.price, 100 - 100 * Math.exp(-.05));
  assert.ok(Object.values(value).every(Number.isFinite));
  assert.equal(value.vega, 0);
});

test('probability uses premium breakeven, not delta or strike ITM probability', () => {
  const call = profitMetrics({ ...base, premium: 10, side: 'buy' });
  assert.equal(call.breakeven, 110);
  const d = (Math.log(100 / 110) + (.05 - .2 * .2 / 2)) / .2;
  close(call.probabilityOfProfit, normalCdf(d));
  assert.ok(call.probabilityOfProfit < blackScholes(base).delta);
  const short = profitMetrics({ ...base, premium: 10, side: 'sell' });
  close(call.probabilityOfProfit + short.probabilityOfProfit, 1);
  const put = profitMetrics({ ...base, type: 'put', premium: 5, side: 'buy' });
  assert.equal(put.breakeven, 95);
  close(put.probabilityOfProfit + profitMetrics({ ...base, type: 'put', premium: 5, side: 'sell' }).probabilityOfProfit, 1);
});

test('impossible profit, zero premium, and exact breakeven are handled correctly', () => {
  assert.equal(profitMetrics({ ...base, type: 'put', premium: 101, side: 'buy' }).probabilityOfProfit, 0);
  assert.equal(profitMetrics({ ...base, type: 'put', premium: 101, side: 'sell' }).probabilityOfProfit, 1);
  assert.equal(profitMetrics({ ...base, premium: 0, side: 'sell' }).probabilityOfProfit, 0);
  assert.equal(profitMetrics({ ...base, spot: 110, days: 0, premium: 10, side: 'buy' }).probabilityOfProfit, 0);
  assert.equal(profitMetrics({ ...base, spot: 110, days: 0, premium: 10, side: 'sell' }).probabilityOfProfit, 0);
  for (const side of ['buy', 'sell'] as const) {
    assert.equal(profitMetrics({ ...base, spot: 100.10, days: 0, premium: .10, side }).probabilityOfProfit, 0);
    assert.equal(profitMetrics({ ...base, spot: 99.90, days: 0, type: 'put', premium: .10, side }).probabilityOfProfit, 0);
  }
});

test('invalid numeric inputs fail explicitly', () => {
  for (const patch of [{ spot: 0 }, { strike: -1 }, { days: -1 }, { volatility: -.01 }, { rate: NaN }, { dividendYield: Infinity }]) assert.throws(() => blackScholes({ ...base, ...patch }), RangeError);
  assert.throws(() => profitMetrics({ ...base, premium: -1, side: 'buy' }), RangeError);
  assert.throws(() => rankCompanies(companies, [], 'wheel', 30), RangeError);
});

test('ranking is deterministic, sorted and sensitive to strategy, core and tenor', () => {
  const selected = ['bsm', 'greeks', 'probability'] as const;
  const wheel = rankCompanies(companies, selected, 'wheel', 30);
  assert.deepEqual(wheel, rankCompanies(companies, selected, 'wheel', 30));
  assert.equal(wheel.length, companies.length);
  assert.ok(wheel.every((row, index) => row.score >= 0 && row.score <= 100 && (index === 0 || wheel[index - 1].score >= row.score)));
  assert.notDeepEqual(wheel.map(row => [row.symbol, row.score]), rankCompanies(companies, selected, 'gamma', 30).map(row => [row.symbol, row.score]));
  assert.notDeepEqual(wheel.map(row => row.score), rankCompanies(companies, ['bsm'], 'wheel', 30).map(row => row.score));
  assert.notDeepEqual(wheel.map(row => row.score), rankCompanies(companies, selected, 'wheel', 90).map(row => row.score));
  const single = rankCompanies(companies, ['greeks'], 'wheel', 30);
  assert.ok(single.every(row => !row.reason.includes('BSM') && !row.reason.includes('Prob.')));
});

test('only unique selected cores count, with equal weight in the denominator', () => {
  const company = [companies[0]];
  const singleScores = (['bsm', 'greeks', 'probability'] as const).map(core => rankCompanies(company, [core], 'wheel', 30)[0].score);
  const full = rankCompanies(company, ['bsm', 'greeks', 'probability'], 'wheel', 30)[0].score;
  // Individual component rounding may move the rounded average by one point.
  assert.ok(Math.abs(full - singleScores.reduce((sum, value) => sum + value, 0) / 3) <= 1);
  assert.deepEqual(rankCompanies(companies, ['greeks', 'greeks'], 'wheel', 30), rankCompanies(companies, ['greeks'], 'wheel', 30));
  assert.deepEqual(rankCompanies(companies, ['probability', 'bsm'], 'wheel', 30).map(c => [c.symbol, c.score]), rankCompanies(companies, ['bsm', 'probability'], 'wheel', 30).map(c => [c.symbol, c.score]));
});

test('every strategy and every individual core responds to duration', () => {
  for (const strategy of ['wheel', 'pmcc', 'backspread', 'gamma'] as const) {
    for (const core of ['bsm', 'greeks', 'probability'] as const) {
      const short = rankCompanies(companies, [core], strategy, 14).map(c => [c.symbol, c.score]);
      const long = rankCompanies(companies, [core], strategy, 90).map(c => [c.symbol, c.score]);
      assert.notDeepEqual(short, long, `${strategy}/${core} must account for duration`);
    }
  }
});

test('configured risk-free rate reaches screening, including negative rates', () => {
  const initial = rankCompanies(companies, ['bsm', 'probability'], 'wheel', 90, -.01);
  const higher = rankCompanies(companies, ['bsm', 'probability'], 'wheel', 90, .10);
  assert.notDeepEqual(initial.map(c => [c.symbol, c.score]), higher.map(c => [c.symbol, c.score]));
  assert.throws(() => rankCompanies(companies, ['bsm'], 'wheel', 30, NaN), RangeError);
});

test('all seven cores independently contribute, stay finite and have auditable evidence', () => {
  assert.equal(CORE_IDS.length, 7);
  for (const strategy of ['wheel', 'pmcc', 'backspread', 'gamma'] as const) {
    for (const core of CORE_IDS) {
      const ranked = rankCompanies(companies, [core], strategy, 30);
      assert.ok(ranked.every(c => Number.isFinite(c.score) && c.score >= 0 && c.score <= 100 && c.reason.length > 0));
      assert.notDeepEqual(rankCompanies(companies,[core],strategy,14).map(c=>[c.symbol,c.score]),rankCompanies(companies,[core],strategy,90).map(c=>[c.symbol,c.score]));
    }
    const individual = CORE_IDS.map(id=>rankCompanies([companies[0]],[id],strategy,30)[0].score);
    const full = rankCompanies([companies[0]],CORE_IDS,strategy,30)[0];
    assert.ok(Math.abs(full.score - individual.reduce((s,n)=>s+n,0)/7)<=1);
    assert.ok(full.reason.includes('Tendencia proxy') && full.reason.includes('Riesgo:') && full.reason.includes('Liquidez demo'));
  }
});
