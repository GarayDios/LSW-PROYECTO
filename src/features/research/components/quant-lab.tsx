"use client";
import { useMemo, useState } from 'react';
import type { OptionInputs } from '../../../cores/compartido/types';
import { blackScholes } from '../../../cores/nucleo-cuantitativo/bsm';
import { binomialPrice } from '../../../cores/nucleo-cuantitativo/binomial';
import { impliedVolatility } from '../../../cores/nucleo-cuantitativo/implied-volatility';
export default function QuantLab({input}:{input:OptionInputs|null}) {
  const [premium,setPremium]=useState('');
  const result=useMemo(()=>{
    if(!input)return null;
    try {
      const bsm=blackScholes(input);
      const target=premium.trim()===''?bsm.price:Number(premium);
      let iv:string;
      try {const solved=impliedVolatility(input,target);iv=`${(solved.volatility*100).toFixed(3)}% · ${solved.iterations} iteraciones · error de precio ${solved.error.toExponential(2)}`;}
      catch(error){iv=error instanceof Error?error.message:'No se pudo resolver la IV.';}
      let tree:string;
      try {tree=`Europea: $${binomialPrice(input,'european').toFixed(4)} · Americana: $${binomialPrice(input,'american').toFixed(4)}`;}
      catch(error){tree=error instanceof Error?error.message:'No se pudo construir el árbol.';}
      return {bsm,target,iv,tree};
    }catch{return null;}
  },[input,premium]);
  return <details className="panel quant-lab"><summary>Laboratorio de fórmulas F0 · BSM, binomial e IV</summary><p>Comparación educativa independiente: no cambia tus órdenes, ranking ni ciclos guardados.</p>{input&&result?<>
    <p>Usa las entradas del modelo mostrado arriba: {input.type.toUpperCase()}, precio ${input.spot.toFixed(2)}, strike ${input.strike.toFixed(2)}, {input.days.toFixed(2)} días, volatilidad {(input.volatility*100).toFixed(2)}%, tasa {(input.rate*100).toFixed(2)}% y dividendo {((input.dividendYield??0)*100).toFixed(2)}%. Conserva las mismas limitaciones de datos y supuestos.</p>
    <h3>1. Comparar modelos</h3><p>BSM europeo: <strong>${result.bsm.price.toFixed(4)} por acción</strong>. Rho: <strong>{result.bsm.rho.toFixed(4)}</strong> dólares por acción ante un aumento de un punto porcentual de la tasa, manteniendo lo demás constante.</p><p>Árbol Cox–Ross–Rubinstein, 400 pasos: <strong>{result.tree}</strong>.</p>
    <p>El árbol divide el plazo en pasos: en cada nodo el precio puede subir o bajar. Retrocede desde el vencimiento descontando el valor esperado. Para la opción americana compara continuar con ejercer en ese nodo.</p><code>Δt = T / 400; u = exp(σ√Δt); d = 1/u; p = [exp((r−q)Δt)−d] / (u−d)<br/>Continuar = exp(−rΔt) × [p × valor arriba + (1−p) × valor abajo]<br/>Americana = máximo(valor de continuar, valor de ejercer)</code>
    <h3>2. Resolver la volatilidad implícita</h3><label>Prima objetivo por acción · USD <input type="number" min="0" step="0.01" value={premium} placeholder={result.bsm.price.toFixed(4)} onChange={event=>setPremium(event.target.value)}/></label><p>{premium.trim()===''?'Sin prima manual se usa el precio BSM para demostrar que recuperamos la volatilidad de entrada. Esto no obtiene una IV del mercado.':'Prima manual del ejercicio; no es una cotización verificada.'} Objetivo: ${Number.isFinite(result.target)?result.target.toFixed(4):'inválido'}.</p><p><strong>{result.iv}</strong></p><code>σ siguiente = σ actual − (precio BSM − prima objetivo) / vega por unidad de volatilidad</code><p>Newton–Raphson ajusta la volatilidad hasta reproducir la prima. Si un paso sale del intervalo, se usa bisección. La IV calculada aquí pertenece al modelo europeo; no es una solución de IV americana.</p>
  </>:<p>Selecciona una empresa y carga las entradas del escenario para ver el cálculo.</p>}</details>;
}
