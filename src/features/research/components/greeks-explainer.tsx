"use client";
import { useState } from 'react';
import type { OptionInputs, OptionValue } from '../../../cores/types';
import { density, normalCdf } from '../../../cores/math';

const labels = { delta: 'Delta Δ', gamma: 'Gamma Γ', theta: 'Theta Θ / día', vega: 'Vega ν / 1%' };
type Greek = keyof typeof labels;
const meanings = {
  delta: 'Cambio aproximado del precio de la opción si la acción sube $1.',
  gamma: 'Cambio aproximado de delta si la acción sube $1. No es el cambio directo del precio de la opción.',
  theta: 'Cambio aproximado del precio de la opción al pasar un día, manteniendo lo demás constante.',
  vega: 'Cambio aproximado del precio de la opción si la volatilidad aumenta un punto porcentual, por ejemplo de 30% a 31%.',
};
const n = (value: number) => value.toFixed(6);
export default function GreeksExplainer({ input, model, volatilityLabel, context }: {
  input: OptionInputs | null; model: OptionValue | null; volatilityLabel: string; context: string;
}) {
  const [active, setActive] = useState<Greek | null>(null);
  const S=input?.spot??0, K=input?.strike??0, sigma=input?.volatility??0, r=input?.rate??0, q=input?.dividendYield??0;
  const T=(input?.days??0)/365, root=Math.sqrt(T);
  const regular = !!input && T>0 && sigma>0;
  const d1=regular?(Math.log(S/K)+(r-q+sigma*sigma/2)*T)/(sigma*root):0, d2=d1-sigma*root;
  const dq=Math.exp(-q*T), dr=Math.exp(-r*T), phi=density(d1), call=input?.type==='call';
  const formulas = {
    delta: call?'Δ = e^(−qT) × N(d₁)':'Δ = e^(−qT) × [N(d₁) − 1]',
    gamma: 'Γ = e^(−qT) × φ(d₁) / (S × σ × √T)',
    theta: call?'Θ = [−S × e^(−qT) × φ(d₁) × σ / (2√T) − rK × e^(−rT) × N(d₂) + qS × e^(−qT) × N(d₁)] / 365':'Θ = [−S × e^(−qT) × φ(d₁) × σ / (2√T) + rK × e^(−rT) × N(−d₂) − qS × e^(−qT) × N(−d₁)] / 365',
    vega: 'ν = S × e^(−qT) × φ(d₁) × √T / 100',
  };
  const diffusion = regular?-S*dq*phi*sigma/(2*root):0;
  const substitution = {
    delta: `${n(dq)} × ${call?n(normalCdf(d1)):`(${n(normalCdf(d1))} − 1)`}`,
    gamma: `${n(dq)} × ${n(phi)} / (${n(S)} × ${n(sigma)} × ${n(root)})`,
    theta: call?`[${n(diffusion)} − ${n(r*K*dr*normalCdf(d2))} + ${n(q*S*dq*normalCdf(d1))}] / 365`:`[${n(diffusion)} + ${n(r*K*dr*normalCdf(-d2))} − ${n(q*S*dq*normalCdf(-d1))}] / 365`,
    vega: `${n(S)} × ${n(dq)} × ${n(phi)} × ${n(root)} / 100`,
  };
  return <div className="greeks-explainer" onKeyDown={event=>{if(event.key==='Escape')setActive(null);}}>
    <div className="greeks-strip">{(Object.keys(labels) as Greek[]).map(key=><div key={key}><button type="button" className="greek-trigger" aria-expanded={active===key} aria-controls="greek-calculation" onMouseEnter={()=>setActive(key)} onFocus={()=>setActive(key)} onClick={()=>setActive(key)}>{labels[key]} ⓘ<strong>{model?model[key].toFixed(key==='gamma'?4:3):'—'}</strong></button></div>)}<div><span>{volatilityLabel}</span><strong>{input?(input.volatility*100).toFixed(1):'—'}<small>%</small></strong></div></div>
    {active&&<section id="greek-calculation" className="greek-calculation" aria-label={`Cálculo de ${labels[active]}`}><button type="button" className="secondary-button" onClick={()=>setActive(null)} aria-label="Cerrar explicación">Cerrar ×</button><h3>{labels[active]}: cómo se calcula</h3><p>{meanings[active]} Es una aproximación local, manteniendo los otros factores constantes.</p><p><strong>{context}</strong></p>{input&&model&&regular?<>
      <p>Modelo Black–Scholes–Merton (BSM), opción {input.type==='call'?'call':'put'} comprada. Valores por acción, no por contrato. Para una posición vendida, las sensibilidades cambian de signo. En opciones americanas es una aproximación que no contempla ejercicio anticipado.</p>
      <dl><dt>S · Precio base de la acción</dt><dd>${n(S)}</dd><dt>K · Precio de ejercicio</dt><dd>${n(K)}</dd><dt>T · Tiempo en años</dt><dd>{n(input.days)} días / 365 = {n(T)}</dd><dt>σ · Volatilidad anual</dt><dd>{n(sigma)} ({(sigma*100).toFixed(2)}%)</dd><dt>r · Tasa anual continua</dt><dd>{n(r)}</dd><dt>q · Dividendo anual continuo usado</dt><dd>{n(q)}</dd></dl>
      <p>N(x) es la distribución normal acumulada; φ(x) = e^(−x²/2) / √(2π) es su densidad. Son funciones matemáticas auxiliares, no predicciones de éxito.</p>
      <code>d₁ = [ln(S/K) + (r − q + σ²/2)T] / (σ√T) = {n(d1)}<br/>d₂ = d₁ − σ√T = {n(d2)}</code>
      <h4>Fórmula</h4><code>{formulas[active]}</code><h4>Con los valores de esta pantalla</h4><code>{substitution[active]} = {n(model[active])}</code><p>Los números del panel están redondeados; el cálculo conserva su precisión completa. Theta se divide entre 365 para expresarla por día; vega entre 100 para expresarla por un punto porcentual.</p>
    </>:<p>{!input?'Todavía faltan entradas para realizar este cálculo.': 'Con tiempo o volatilidad cero se utiliza el caso límite de BSM, no estas fórmulas que dividen entre σ√T.'}</p>}</section>}
  </div>;
}
