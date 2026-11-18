import { blackScholes } from './bsm.ts';
import type { OptionInputs } from './types.ts';
import { validateOptionInputs } from './validation.ts';

/** European BSM IV: safeguarded Newton step (vega per unit), bisection fallback. */
export function impliedVolatility(input: Omit<OptionInputs,'volatility'>, price:number) {
  validateOptionInputs({...input,volatility:.2});
  if(!Number.isFinite(price)||price<0||input.days<=0)throw new RangeError('La IV requiere una prima válida y tiempo hasta el vencimiento.');
  const T=input.days/365,S=input.spot*Math.exp(-(input.dividendYield??0)*T),K=input.strike*Math.exp(-input.rate*T);
  const lower=Math.max(0,input.type==='call'?S-K:K-S),upper=input.type==='call'?S:K;
  if(price<lower-1e-8||price>=upper)throw new RangeError('La prima queda fuera de los límites del modelo europeo.');
  if(Math.abs(price-lower)<1e-8)return {volatility:0,iterations:0,error:Math.abs(price-lower),method:'límite de volatilidad cero'};
  let lo=0,hi=5,sigma=.3;
  if(blackScholes({...input,volatility:hi}).price<price)throw new RangeError('La prima exige una IV fuera del intervalo admitido (0–500%).');
  for(let iterations=1;iterations<=100;iterations++){
    const value=blackScholes({...input,volatility:sigma}),error=value.price-price;
    if(Math.abs(error)<=1e-8)return {volatility:sigma,iterations,error:Math.abs(error),method:'Newton–Raphson protegido con bisección'};
    if(error>0)hi=sigma;else lo=sigma;
    const candidate=sigma-error/(value.vega*100);
    sigma=Number.isFinite(candidate)&&candidate>lo&&candidate<hi?candidate:(lo+hi)/2;
  }
  throw new RangeError('La IV no convergió; no se publica un resultado aproximado sin validar.');
}
