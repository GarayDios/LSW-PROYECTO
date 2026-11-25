import test from 'node:test';
import assert from 'node:assert/strict';
import { scanUniverse,filterScanResults } from '../../src/cores/evaluacion/scan-universe.ts';
import { defaultScannerSettings,scannerSettingsSchema } from '../../src/cores/evaluacion/scanner-settings.ts';
import { companies } from '../../src/features/market/data.ts';
import { evaluateScanner } from '../../src/cores/evaluacion/scanner.ts';
import { strategyMonteCarloScenario } from '../../src/cores/evaluacion/monte-carlo-scenario.ts';
import { simulateMonteCarlo } from '../../src/cores/nucleo-cuantitativo/monte-carlo.ts';
import { researchFixture } from './research-fixture.ts';

test('scan universes use actual catalog membership and do not invent ETF or arbitrary tickers',()=>{
  assert.equal(scanUniverse(companies,[],'catalog').length,14);
  assert.deepEqual(scanUniverse(companies,['NVDA','UNKNOWN','AAPL','NVDA'],'current-list'),['AAPL','NVDA']);
  const tech=scanUniverse(companies,[],'technology');assert.ok(tech.includes('NVDA'));assert.ok(!tech.includes('JPM'));
});
test('confluence thresholds, result limits and Monte Carlo sorting treat missing values explicitly',()=>{
  const rows=Array.from({length:12},(_,i)=>({symbol:`QA${i}`,score:90-i,probabilityOfProfit:i===0?null:i/20}));
  const settings={...defaultScannerSettings.scan,limit:5 as const,minConfluence:85};
  assert.deepEqual(filterScanResults(rows,settings).map(r=>r.symbol),['QA0','QA1','QA2','QA3','QA4']);
  assert.deepEqual(filterScanResults(rows,{...settings,order:'pop'}).map(r=>r.symbol),['QA5','QA4','QA3','QA2','QA1']);
  assert.equal(filterScanResults([{symbol:'none',score:null},{symbol:'nan',score:NaN}],settings).length,0);
  assert.equal(rows[0].symbol,'QA0');
});
test('legacy settings get defaults and saved seed/path controls drive the actual core simulation',()=>{
  const legacy={cores:defaultScannerSettings.cores,rule:defaultScannerSettings.rule};
  assert.deepEqual(scannerSettingsSchema.parse(legacy).monteCarlo,defaultScannerSettings.monteCarlo);
  const settings=structuredClone(defaultScannerSettings);
  for(const [core,value] of Object.entries(settings.cores))value.enabled=core==='monteCarlo';
  settings.monteCarlo={seed:31,paths:500};
  const s=researchFixture(),scenario=strategyMonteCarloScenario(s,'wheel',30);
  assert.ok(scenario.scenario);
  const expected=simulateMonteCarlo({...scenario.scenario.basis,paths:500,seed:31,steps:16,mode:'terminal',hedgeFeePerShare:0,hedgeSpreadBps:0,stockBorrowRate:0});
  const actual=evaluateScanner(s,'wheel',30,settings);
  assert.equal(actual.monteCarloPop,expected.pnl.probabilityOfProfit);
  assert.deepEqual(evaluateScanner(s,'wheel',30,settings),actual);
  assert.match(actual.results[0].reason,/semilla 31/);
  assert.throws(()=>scannerSettingsSchema.parse({...settings,monteCarlo:{paths:50001,seed:31}}));
  for(const dataMode of ['auto','observed','estimated'] as const){
    const saved=JSON.parse(JSON.stringify({...settings,monteCarlo:{...settings.monteCarlo,dataMode}}));
    assert.equal(scannerSettingsSchema.parse(saved).monteCarlo.dataMode,dataMode);
  }
  assert.throws(()=>scannerSettingsSchema.parse({...settings,monteCarlo:{...settings.monteCarlo,dataMode:'fabricated'}}));
});
