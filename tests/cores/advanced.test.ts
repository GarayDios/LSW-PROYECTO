import test from 'node:test';
import assert from 'node:assert/strict';
import {blackScholes} from '../../src/cores/nucleo-cuantitativo/bsm.ts';
import {binomialPrice} from '../../src/cores/nucleo-cuantitativo/binomial.ts';
import {impliedVolatility} from '../../src/cores/nucleo-cuantitativo/implied-volatility.ts';
const base={spot:100,strike:100,days:365,volatility:.2,rate:.05,dividendYield:0,type:'call' as const};
test('CRR converges to BSM and American non-dividend call has no exercise premium',()=>{
 const bsm=blackScholes(base).price;
 assert.ok(Math.abs(binomialPrice(base,'european',1000)-bsm)<.003);
 assert.ok(Math.abs(binomialPrice(base,'american',1000)-binomialPrice(base,'european',1000))<1e-8);
});
test('American put retains exercise value, expiry and deterministic cases are finite',()=>{
 const put={...base,spot:50,type:'put' as const};
 assert.ok(binomialPrice(put)>=50);
 assert.ok(binomialPrice(put)>=binomialPrice(put,'european'));
 assert.equal(binomialPrice({...put,days:0}),50);
 assert.equal(binomialPrice({...put,volatility:0}),50);
 assert.throws(()=>binomialPrice(base,'american',0));
});
test('IV recovers call and put volatilities and rejects infeasible prices',()=>{
 for(const type of ['call','put'] as const)for(const volatility of [.1,.3,.8]){
 const input={...base,type,volatility,dividendYield:.02};
 const result=impliedVolatility(input,blackScholes(input).price);
 assert.ok(Math.abs(result.volatility-volatility)<1e-6);
 }
 assert.throws(()=>impliedVolatility(base,101));
 assert.throws(()=>impliedVolatility({...base,days:0},5));
});
