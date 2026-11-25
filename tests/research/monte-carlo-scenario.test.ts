import test from 'node:test';
import assert from 'node:assert/strict';
import { strategyMonteCarloScenario } from '../../src/cores/evaluacion/monte-carlo-scenario.ts';
import { analyzeStrategy } from '../../src/cores/evaluacion/strategy-analysis.ts';
import { missingVariable } from '../../src/cores/compartido/research-model.ts';
import { fixtureVariable as v, researchFixture } from './research-fixture.ts';
import {defaultScannerSettings} from '../../src/cores/evaluacion/scanner-settings.ts';
import {evaluateScanner} from '../../src/cores/evaluacion/scanner.ts';

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

function staleChain(){
  const s=researchFixture();s.options.feed='indicative';
  for(const c of s.options.contracts)for(const key of ['bid','ask','premium','impliedVolatility'] as const)c[key]={...missingVariable('Alpaca indicative','La cotización de la última sesión supera una hora.'),lastReceived:{value:c[key].value!,observedAt:'2026-11-16T20:59:59.315Z',receivedAt:s.asOf}};
  return s;
}
test('automatic Monte Carlo reconstructs stale indicative inputs for all strategies without changing observed research or enabling a trade',()=>{
  for(const strategy of ['wheel','pmcc','backspread','gamma'] as const){
    const s=staleChain(),original=structuredClone(s),scenario=strategyMonteCarloScenario(s,strategy,30);
    assert.ok(scenario.scenario,scenario.error);assert.equal(scenario.scenario.dataMode,'estimated');assert.equal(scenario.scenario.automaticEstimation,true);assert.match(scenario.scenario.label,/estimación automática/);assert.ok(scenario.scenario.sources.some(source=>source.includes('Escenario estimado')));assert.equal(scenario.scenario.basis.volatility,s.market.historicalVolatility.value);assert.ok(scenario.scenario.warnings.some(w=>w.includes('No son cotizaciones ejecutables')));
    assert.deepEqual(s,original);assert.equal(analyzeStrategy(s,strategy,30).status,'unavailable','A simulated reconstruction cannot make the observed strategy tradable');
  }
});
test('automatic Monte Carlo prefers valid provider inputs and strict mode never substitutes stale inputs',()=>{
  const observed=strategyMonteCarloScenario(researchFixture(),'wheel',30).scenario!;assert.equal(observed.dataMode,'observed');assert.notEqual(observed.automaticEstimation,true);
  const s=staleChain(),scanner={...defaultScannerSettings,monteCarlo:{...defaultScannerSettings.monteCarlo,dataMode:'observed' as const}};
  assert.equal(strategyMonteCarloScenario(s,'wheel',30,{scanner}).scenario,null);assert.equal(strategyMonteCarloScenario(s,'wheel',30,{scanner,modelMode:'estimated'}).scenario,null);
  const explicit=strategyMonteCarloScenario(s,'wheel',30,{scanner:{...scanner,monteCarlo:{...scanner.monteCarlo,dataMode:'estimated'}}}).scenario!;assert.equal(explicit.dataMode,'estimated');assert.notEqual(explicit.automaticEstimation,true);
});

test('automatic reconstruction repairs invalid IV and can use verified IV when historical volatility is missing',()=>{
  const invalid=staleChain();for(const c of invalid.options.contracts)c.impliedVolatility=v(-.1);
  const repaired=strategyMonteCarloScenario(invalid,'wheel',30);assert.ok(repaired.scenario,repaired.error);assert.equal(repaired.scenario.basis.volatility,invalid.market.historicalVolatility.value);
  const noHistory=staleChain();noHistory.market.historicalVolatility=missingVariable('Market','No history');for(const c of noHistory.options.contracts)c.impliedVolatility=v(.3);
  const quotedIv=strategyMonteCarloScenario(noHistory,'gamma',30);assert.ok(quotedIv.scenario,quotedIv.error);assert.equal(quotedIv.scenario.basis.volatility,.3);assert.equal(quotedIv.scenario.automaticEstimation,true);
});

test('automatic reconstruction preserves capital constraints and reports the actual blocker',()=>{
  const s=staleChain(),result=strategyMonteCarloScenario(s,'wheel',30,{capital:100});
  assert.equal(result.scenario,null);assert.match(result.error!,/Capital insuficiente/);assert.doesNotMatch(result.error!,/IV ausente|última sesión supera/);
});
test('automatic reconstruction never supplies missing rate, dividend, history, stale spot or nonexistent contracts',()=>{
  for(const missing of ['rate','dividend','history','spot','contracts','deliverable','future-metadata'] as const){
    const s=staleChain();if(missing==='rate')s.macro.riskFreeRate=missingVariable('FRED','No rate');if(missing==='dividend')s.fundamentals.dividendYield=missingVariable('SEC','No yield');if(missing==='history')s.market.historicalVolatility=missingVariable('Market','Insufficient history');if(missing==='spot')s.market.stale=true;if(missing==='contracts')s.options.contracts=[];
    if(missing==='deliverable')for(const c of s.options.contracts)c.deliverableShares=missingVariable('Provider','Unknown deliverable');
    if(missing==='future-metadata')for(const c of s.options.contracts)c.strike.availableAt='2027-01-01T00:00:00Z';
    assert.equal(strategyMonteCarloScenario(s,'wheel',30).scenario,null,missing);
  }
});
test('4122 unusable quotes still yield a bounded, reproducible automatic core while strict mode remains unavailable',()=>{
  const s=staleChain(),base=s.options.contracts;s.options.contracts=Array.from({length:4122},(_,i)=>({...base[i%base.length],symbol:base[i%base.length].symbol+'-QA'+i}));
  const settings={...defaultScannerSettings,monteCarlo:{seed:31,paths:500},cores:Object.fromEntries(Object.entries(defaultScannerSettings.cores).map(([id,c])=>[id,{...c,enabled:id==='monteCarlo'}])) as typeof defaultScannerSettings.cores};
  const first=evaluateScanner(s,'pmcc',30,settings,{estimatedCandidateLimit:20}),second=evaluateScanner(s,'pmcc',30,settings,{estimatedCandidateLimit:20});
  assert.ok(first.monteCarloPop!==null);assert.equal(first.monteCarloPop,second.monteCarloPop);assert.equal(first.results[0].automaticEstimation,true);assert.equal(first.available,1);assert.match(first.results[0].reason,/Estimación automática/);
  const scenario=strategyMonteCarloScenario(s,'pmcc',30,{estimatedCandidateLimit:20});assert.match(scenario.scenario!.warnings.join(' '),/20 candidatos de 4122/);
  const strict=evaluateScanner(s,'pmcc',30,{...settings,monteCarlo:{...settings.monteCarlo,dataMode:'observed'}});assert.equal(strict.monteCarloPop,null);assert.equal(strict.available,0);
});
