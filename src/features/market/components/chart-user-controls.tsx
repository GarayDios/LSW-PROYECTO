"use client";
import { useState } from 'react';
import type { StockRule } from '../../../cores/05-indicadores-y-senales/signals';
import type { ChartStudies } from './chart-study-toolbar';
export type ChartLevel={id:string;symbol:string;label:string;value:number;color:string};
export type ChartSettings={signals:boolean;optionLevels:boolean;strategy:boolean;rule:StockRule;studies:ChartStudies};
export default function ChartUserControls({symbol,settings,onSettings,levels,onLevels}:{symbol:string;settings:ChartSettings;onSettings:(value:ChartSettings)=>void;levels:ChartLevel[];onLevels:(value:ChartLevel[])=>void}){
  const [label,setLabel]=useState('Entrada'),[price,setPrice]=useState('');
  return <details className="chart-user-controls"><summary>Habilitar indicadores y dibujar niveles</summary>
    <p>Estas opciones muestran u ocultan capas. Los cores siguen calculando señales y evaluando el ranking.</p>
    {([['signals','Señales históricas de entrada y salida'],['optionLevels','Strike y equilibrio del contrato'],['strategy','Strikes y equilibrios de la estrategia seleccionada']] as const).map(([key,title])=><label className="manual-toggle" key={key}><input type="checkbox" checked={settings[key]} onChange={e=>onSettings({...settings,[key]:e.target.checked})}/>{title}</label>)}
    <label className="manual-toggle">Regla de señales<select aria-label="Regla de señales en gráfica" value={settings.rule} onChange={e=>onSettings({...settings,rule:e.target.value as ChartSettings['rule']})}><option value="sma-rsi">Cruce SMA20/50 con filtro RSI14</option><option value="sma-cross">Cruce SMA20/50 sin filtro RSI</option><option value="technical-confluence">Confluencia: medias, MACD, RSI y rupturas</option></select></label>
    <p>Cambiar la regla sí recalcula las señales y su validación histórica; los botones de las capas solo cambian su visibilidad.</p>
    <form onSubmit={e=>{e.preventDefault();const value=Number(price);if(!label.trim()||!Number.isFinite(value)||value<=0||value>1000000||levels.filter(l=>l.symbol===symbol).length>=8)return;onLevels([...levels,{id:crypto.randomUUID(),symbol,label:label.trim().slice(0,32),value,color:'#9bd17c'}]);setPrice('');}}><div className="manual-fields"><label>Nombre del nivel<input aria-label="Nombre del nivel" value={label} maxLength={32} onChange={e=>setLabel(e.target.value)} required/></label><label>Precio · USD<input aria-label="Precio del nivel" type="number" min="0.01" max="1000000" step="0.01" value={price} onChange={e=>setPrice(e.target.value)} required/></label></div><button className="secondary-button" disabled={levels.filter(l=>l.symbol===symbol).length>=8}>Añadir nivel a {symbol}</button></form>
    <ul className="manual-level-list">{levels.filter(l=>l.symbol===symbol).map(l=><li key={l.id}>{l.label}: USD {l.value.toFixed(2)}<button className="secondary-button" aria-label={`Quitar nivel ${l.label}`} onClick={()=>onLevels(levels.filter(item=>item.id!==l.id))}>Quitar</button></li>)}</ul><p>Los niveles son anotaciones de esta sesión. Mostrar una señal o una estrategia no envía órdenes.</p>
  </details>;
}
