import type { OptionInputs } from './types.ts';
import { validateOptionInputs } from './validation.ts';

/** CRR backward induction, continuous yield; American exercise at every node. */
export function binomialPrice(input: OptionInputs, style: 'american'|'european' = 'american', steps = 400): number {
  validateOptionInputs(input);
  if (!['american','european'].includes(style) || !Number.isInteger(steps) || steps < 2 || steps > 2000) throw new RangeError('Árbol: usa entre 2 y 2000 pasos.');
  const {spot:S,strike:K,rate:r,volatility:sigma,type}=input, q=input.dividendYield??0,T=input.days/365;
  const payoff=(s:number)=>Math.max(0,type==='call'?s-K:K-s);
  if(T===0)return payoff(S);
  const dt=T/steps,discount=Math.exp(-r*dt);
  if(sigma===0){
    let value=Math.exp(-r*T)*payoff(S*Math.exp((r-q)*T));
    if(style==='american')for(let j=0;j<steps;j++)value=Math.max(value,Math.exp(-r*j*dt)*payoff(S*Math.exp((r-q)*j*dt)));
    return value;
  }
  const up=Math.exp(sigma*Math.sqrt(dt)),down=1/up,p=(Math.exp((r-q)*dt)-down)/(up-down);
  if(!Number.isFinite(p)||p<0||p>1)throw new RangeError('Árbol no válido con esos parámetros: aumenta los pasos o revisa volatilidad y tasas.');
  const values=Array.from({length:steps+1},(_,j)=>payoff(S*Math.exp((2*j-steps)*Math.log(up))));
  for(let i=steps-1;i>=0;i--)for(let j=0;j<=i;j++){
    const continuation=discount*(p*values[j+1]+(1-p)*values[j]);
    values[j]=style==='american'?Math.max(continuation,payoff(S*Math.exp((2*j-i)*Math.log(up)))):continuation;
  }
  if(!Number.isFinite(values[0]))throw new RangeError('El árbol excede el rango numérico admitido.');
  return values[0];
}
