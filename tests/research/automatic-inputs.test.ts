import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMarketContext } from '../../src/api/research/market-context.ts';
import { fetchCompanyResearch } from '../../src/api/research/company.ts';
import { completeOptionInputs } from '../../src/api/research/complete-option-inputs.ts';
import { researchFixture, fixtureTime, fixtureContract, fixtureVariable } from './research-fixture.ts';
import { missingVariable } from '../../src/cores/compartido/research-model.ts';
import { blackScholes } from '../../src/cores/nucleo-cuantitativo/bsm.ts';
import { binomialPrice } from '../../src/cores/nucleo-cuantitativo/binomial.ts';
import { equityTerms, valuationExpiry } from '../../src/features/research/contract-terms.ts';
import { rankObservedCompanies } from '../../src/cores/evaluacion/observed-ranking.ts';
const config={apiKey:'fixture',secretKey:'fixture'};
const payment={id:'one',symbol:'XYZ',rate:1,ex_date:'2026-08-01',foreign:false,special:false};

test('automatic dividend yield uses fetched historical payments, excludes future payments and retains its estimated origin',async()=>{
  const fetcher:typeof fetch=async input=>{
    const url=new URL(String(input));
    if(url.pathname.includes('corporate-actions')){
      assert.ok(url.searchParams.get('start')!<'2026-01-01');
      return Response.json({corporate_actions:{cash_dividends:[payment,payment,{...payment,id:'next',ex_date:'2026-12-01',rate:9}]},next_page_token:null});
    }
    if(url.pathname.includes('/quotes/latest'))return Response.json({quote:{bp:99,ap:101,t:fixtureTime}});
    if(url.pathname.includes('/contracts'))return Response.json({option_contracts:[]});
    if(url.pathname.includes('/snapshots'))return Response.json({snapshots:{}});
    return Response.json({news:[]});
  };
  const result=await fetchCompanyResearch({symbol:'XYZ',asOf:fixtureTime,bars:[],alpaca:config},fetcher,new Date(fixtureTime));
  assert.equal(result.fundamentals.dividendYield.value,.01);
  assert.equal(result.fundamentals.dividendYield.kind,'estimated');
  assert.equal(result.cashDividends?.events.length,1);
  assert.match(result.fundamentals.dividendYield.reason!,/no dividendo futuro garantizado/);
});

test('empty history permits an automatic zero estimate; denied, partial, invalid or split-affected payments do not',async()=>{
  const load=(body:unknown,status=200)=>fetchMarketContext(config,'XYZ',fixtureTime,async()=>Response.json(body,{status}),new Date(fixtureTime));
  assert.equal((await load({corporate_actions:{},next_page_token:null})).annualDividend.value,0);
  assert.equal((await load({},403)).annualDividend.value,null);
  assert.equal((await load({corporate_actions:{},next_page_token:'more'})).annualDividend.value,null);
  assert.equal((await load({corporate_actions:{cash_dividends:[payment],forward_splits:[{symbol:'XYZ'}]}})).annualDividend.value,null);
  assert.equal((await load({corporate_actions:{cash_dividends:[],forward_splits:[{symbol:'XYZ'}]}})).annualDividend.value,0,'A split cannot alter an empty historical sum');
  assert.equal((await load({corporate_actions:{cash_dividends:[{...payment,rate:null}]}})).annualDividend.value,null);
  assert.equal((await load({corporate_actions:{cash_dividends:[{...payment,ex_date:'2026-99-99'}]}})).annualDividend.value,null);
  assert.equal((await load({corporate_actions:{cash_dividends:[payment,{...payment,rate:2}]}})).annualDividend.value,null);
});

test('missing European or American IV is automatically solved from real quote midpoint, without using historical volatility',()=>{
  for(const style of ['european','american'] as const){
    const s=researchFixture();s.options.contracts=[fixtureContract('put',95)];
    const c=s.options.contracts[0];c.style=style;
    const terms=equityTerms(c,s.asOf)!;
    const input={spot:100,strike:terms.effectiveStrike,days:(valuationExpiry(c,s.asOf).time-Date.parse(s.asOf))/86400000,rate:.04,dividendYield:0,volatility:.35,type:'put' as const};
    const price=style==='american'?binomialPrice(input,'american',100):blackScholes(input).price;
    c.premium=fixtureVariable(price);c.bid=fixtureVariable(price-.01);c.ask=fixtureVariable(price+.01);
    c.impliedVolatility=missingVariable('provider','not published');s.market.historicalVolatility=missingVariable('history','absent');
    completeOptionInputs(s);
    assert.ok(Math.abs(c.impliedVolatility.value!-.35)<1e-4);
    assert.equal(c.impliedVolatility.kind,'estimated');
    assert.match(c.impliedVolatility.source,/IV calculada de bid\/ask/);
    const row=rankObservedCompanies([s],['bsm'],'wheel',30)[0];
    assert.equal(row.score,50,'Self-calibrated IV cannot manufacture a valuation opportunity');
    assert.equal(c.bid.value,price-.01,'No synthetic quote is created');
  }
});

test('automatic IV keeps missing, stale or infeasible quotes unavailable',()=>{
  const s=researchFixture();s.options.contracts=[fixtureContract('put',95)];
  const c=s.options.contracts[0];c.impliedVolatility=missingVariable('provider','absent');
  c.premium.observedAt='2026-11-16T16:00:00Z';
  completeOptionInputs(s);assert.equal(c.impliedVolatility.value,null);
  c.premium=fixtureVariable(10000);c.bid=fixtureVariable(9999);c.ask=fixtureVariable(10001);
  completeOptionInputs(s);assert.equal(c.impliedVolatility.value,null);
});

test('a valid locked quote can supply automatic IV without adding a spread',()=>{
  const s=researchFixture();s.options.contracts=[fixtureContract('put',95)];
  const c=s.options.contracts[0];c.style='european';
  const price=blackScholes({spot:100,strike:95,days:(valuationExpiry(c,s.asOf).time-Date.parse(s.asOf))/86400000,rate:.04,dividendYield:0,volatility:.35,type:'put'}).price;
  c.bid=fixtureVariable(price);c.ask=fixtureVariable(price);c.premium=fixtureVariable(price);
  c.impliedVolatility=missingVariable('provider','not published');
  completeOptionInputs(s);
  assert.ok(Math.abs(c.impliedVolatility.value!-.35)<1e-4);
  assert.equal(c.bid.value,c.ask.value);
});
