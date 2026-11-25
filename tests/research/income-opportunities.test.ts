import test from 'node:test';
import assert from 'node:assert/strict';
import { incomeOpportunities } from '../../src/cores/evaluacion/income-opportunities.ts';
import { researchFixture } from './research-fixture.ts';

const settings={capital:10000,ownedShares:0,costBasis:100,feePerContract:.65,maxSpreadPercent:30};
test('CSP screens actual bid less fees and secured nominal, not midpoint or theoretical premium',()=>{
  const snapshot=researchFixture(), rows=incomeOpportunities(snapshot,settings);
  assert.ok(rows.length>0);
  assert.ok(rows.every(r=>r.strategy==='csp'&&r.collateral<=10000));
  const contract=snapshot.options.contracts.find(c=>c.symbol===rows[0].contract)!;
  assert.equal(rows[0].netPremium,contract.bid.value!*contract.multiplier!.value!-.65);
  assert.equal(rows[0].annualizedRoc, rows[0].netPremium/rows[0].collateral*365/rows[0].days);
  assert.equal(incomeOpportunities(snapshot,{...settings,capital:1}).length,0);
});
test('CC requires declared deliverable shares and current quotes; stale or crossed quotes are excluded',()=>{
  const snapshot=researchFixture();
  const rows=incomeOpportunities(snapshot,{...settings,ownedShares:100});
  assert.ok(rows.some(r=>r.strategy==='cc'));
  snapshot.options.contracts=snapshot.options.contracts.filter(c=>c.type==='call');
  assert.equal(incomeOpportunities(snapshot,settings).length,0);
  for(const c of snapshot.options.contracts)c.bid.observedAt='2020-01-01T00:00:00Z';
  assert.equal(incomeOpportunities(snapshot,{...settings,ownedShares:100}).length,0);
});
