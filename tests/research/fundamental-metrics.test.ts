import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSecFundamentals } from '../../src/cores/04-analisis-fundamental/sec-fundamentals.ts';
import { enrichFundamentalValuation } from '../../src/cores/04-analisis-fundamental/fundamental-metrics.ts';
import type { ResearchVariable } from '../../src/cores/compartido/research-model.ts';

const asOf = '2026-06-15T16:00:00.000Z';
const annual = (value: number, year = 2025) => ({ val: value, start: `${year}-01-01`, end: `${year}-12-31`, filed: `${year + 1}-03-01`, form: '10-K', accn: `${year}-annual` });
const balance = (value: number, year = 2025) => ({ val: value, end: `${year}-12-31`, filed: `${year + 1}-03-01`, form: '10-K', accn: `${year}-annual` });
function facts() {
  const usd = (...values: object[]) => ({ units: { USD: values } });
  return { facts: { 'us-gaap': {
    Revenues: usd(annual(500), annual(400, 2024)), NetIncomeLoss: usd(annual(60), annual(50, 2024)),
    Assets: usd(balance(500), balance(400, 2024)), Liabilities: usd(balance(200)),
    StockholdersEquity: usd(balance(300), balance(240, 2024)), CashAndCashEquivalentsAtCarryingValue: usd(balance(80)),
    AssetsCurrent: usd(balance(250)), LiabilitiesCurrent: usd(balance(100)), InventoryNet: usd(balance(50)),
    GrossProfit: usd(annual(200)), OperatingIncomeLoss: usd(annual(100)),
    NetCashProvidedByUsedInOperatingActivities: usd(annual(80)), PaymentsToAcquirePropertyPlantAndEquipment: usd(annual(20)),
    EarningsPerShareDiluted: { units: { 'USD/shares': [annual(3)] } },
  }, dei: { EntityCommonStockSharesOutstanding: { units: { shares: [balance(20)] } } } } };
}
const spot: ResearchVariable = { value: 30, kind: 'observed', source: 'Market fixture', observedAt: asOf, availableAt: asOf };

test('financial core derives matched cash flow, liquidity, annual growth and returns on average balances', () => {
  const result = deriveSecFundamentals(facts(), {}, asOf, '1');
  const metrics = result.analysis!.metrics;
  assert.equal(metrics.freeCashFlow.value, 60); assert.equal(metrics.currentRatio.value, 2.5);
  assert.equal(metrics.quickRatio.value, 2); assert.equal(metrics.grossMargin.value, .4);
  assert.equal(metrics.operatingMargin.value, .2); assert.equal(metrics.revenueGrowth.value, .25);
  assert.ok(Math.abs(metrics.incomeGrowth.value! - .2) < 1e-12);
  assert.ok(Math.abs(metrics.returnOnAssets.value! - 60 / 450) < 1e-12);
  assert.ok(Math.abs(metrics.returnOnEquity.value! - 60 / 270) < 1e-12);
  assert.ok(Math.abs(metrics.cashConversion.value! - 80 / 60) < 1e-12);
  for (const value of Object.values(metrics)) if (value.value !== null) assert.ok(Date.parse(value.availableAt!) <= Date.parse(asOf));
  const valued = enrichFundamentalValuation(result, spot, asOf);
  assert.equal(valued.metrics.marketCap.value, 600); assert.equal(valued.metrics.priceEarningsAnnual.value, 10);
  assert.equal(valued.metrics.priceSalesAnnual.value, 1.2); assert.equal(valued.metrics.priceBook.value, 2);
  assert.equal(valued.metrics.freeCashFlowYield.value, .1);
  assert.equal(valued.coverage.available, 25); assert.equal(result.analysis!.metrics.marketCap.value, null, 'Valuation does not mutate SEC facts');
});

test('incompatible periods, unavailable future revisions and absent opening balances cannot create financial ratios', () => {
  const input = facts();
  input.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment.units.USD = [annual(20, 2024)];
  input.facts['us-gaap'].AssetsCurrent.units.USD = [{ ...balance(250), end: '2025-09-30' }];
  input.facts['us-gaap'].StockholdersEquity.units.USD = [balance(300)];
  input.facts['us-gaap'].NetIncomeLoss.units.USD.push({ ...annual(6000), filed: '2027-01-01' });
  const result = deriveSecFundamentals(input, {}, asOf, '1');
  assert.equal(result.annualNetIncome.value, 60);
  assert.equal(result.analysis!.metrics.freeCashFlow.value, null);
  assert.equal(result.analysis!.metrics.currentRatio.value, null);
  assert.equal(result.analysis!.metrics.quickRatio.value, null);
  assert.equal(result.analysis!.metrics.returnOnEquity.value, null);
  const futureSpot = { ...spot, availableAt: '2027-01-01T00:00:00.000Z' };
  assert.equal(enrichFundamentalValuation(result, futureSpot, asOf).metrics.marketCap.value, null);
  assert.equal(enrichFundamentalValuation(result, { ...spot, value: -1 }, asOf).metrics.priceEarningsAnnual.value, null);
});

test('negative earnings/equity and a missing cash flow stay explicit rather than becoming favorable multiples or zero', () => {
  const input = facts();
  input.facts['us-gaap'].EarningsPerShareDiluted.units['USD/shares'] = [annual(-3)];
  input.facts['us-gaap'].StockholdersEquity.units.USD = [balance(-10), balance(-20, 2024)];
  input.facts['us-gaap'].NetCashProvidedByUsedInOperatingActivities.units.USD = [];
  const result = deriveSecFundamentals(input, {}, asOf, '1');
  const valued = enrichFundamentalValuation(result, spot, asOf);
  assert.equal(valued.metrics.priceEarningsAnnual.value, null); assert.equal(valued.metrics.priceBook.value, null);
  assert.equal(valued.metrics.returnOnEquity.value, null); assert.equal(valued.metrics.freeCashFlow.value, null);
  assert.equal(valued.metrics.freeCashFlowYield.value, null);
});
