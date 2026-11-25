"use client";

import { useMemo, useState } from 'react';
import type { StrategyId } from '../../cores/compartido/types';
import type { AnalysisSettings } from '../research/analysis-settings';
import type { CompanyResearch } from '../../cores/compartido/research-model';
import { strategies } from '../strategies/catalog';
import { forecastMarket } from '../../cores/02-inteligencia-artificial/forecast';
import { investorPreferencesSchema, type InvestorPreferences } from '../../cores/02-inteligencia-artificial/preferences';
import { recommendForPreferences } from '../../cores/02-inteligencia-artificial/recommendations';
import './intelligence-panel.css';

const money = (value: number | null) => value === null ? 'Sin determinar' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'USD' }).format(value);
const percent = (value: number | null) => value === null ? 'Sin determinar' : `${(value * 100).toFixed(2)}%`;

export default function IntelligencePanel({ symbol, research, loading, error, demo, preferences, onPreferences, settings, onChoose }: {
  symbol: string; research: CompanyResearch | null; loading: boolean; error: string; demo: boolean;
  preferences: InvestorPreferences; onPreferences: (value: InvestorPreferences) => void;
  settings: AnalysisSettings; onChoose: (strategy: StrategyId) => void;
}) {
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const current = research?.symbol === symbol && !demo ? research : null;
  const forecast = useMemo(() => current ? forecastMarket({ symbol: current.symbol, bars: current.market.bars,
    asOf: current.asOf, source: current.market.historicalVolatility.source, horizonSessions: preferences.horizonSessions }) : null,
  [current, preferences.horizonSessions]);
  const recommendation = useMemo(() => forecast ? recommendForPreferences({ research: current, forecast, preferences, settings }) : null,
    [current, forecast, preferences, settings]);

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const parsed = investorPreferencesSchema.safeParse({
      objective: values.get('objective'), riskTolerance: values.get('riskTolerance'),
      capital: Number(values.get('capital')), maxAllocationPercent: Number(values.get('maxAllocationPercent')),
      maxLossPercent: Number(values.get('maxLossPercent')), horizonSessions: Number(values.get('horizonSessions')),
      experience: values.get('experience'), monitoring: values.get('monitoring'), allowedStrategies: values.getAll('strategy'),
    });
    if (!parsed.success) { setFormError('Revisa los importes, los porcentajes y las estrategias de tu perfil.'); return; }
    onPreferences(parsed.data); setFormError(''); setNotice('Preferencias aplicadas a esta sesión.');
  }

  return <section className="panel intelligence-panel" aria-label="Core de Inteligencia Artificial">
    <div className="intelligence-heading"><div><span className="intelligence-kicker">CORE DE INTELIGENCIA ARTIFICIAL</span>
      <h2>Tu perfil y la evidencia de {symbol}</h2></div><span className="neutral-badge">Modelo experimental</span></div>
    <p>Define qué buscas y cuánto puedes arriesgar. La IA estima el movimiento del subyacente con cierres históricos y compara las estrategias que respetan tu perfil.</p>
    <details className="intelligence-preferences">
      <summary>Tus preferencias</summary>
      <form onSubmit={apply}>
        <div className="intelligence-fields">
          <label>Objetivo<select name="objective" defaultValue={preferences.objective}><option value="preservation">Preservar capital</option><option value="income">Generar ingresos</option><option value="growth">Buscar crecimiento</option></select></label>
          <label>Tolerancia al riesgo<select name="riskTolerance" defaultValue={preferences.riskTolerance}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option></select></label>
          <label>Capital disponible para esta decisión (USD)<input name="capital" type="number" min="1" max="10000000" step="0.01" required defaultValue={preferences.capital}/></label>
          <label>Asignación máxima (% del capital)<input name="maxAllocationPercent" type="number" min="0" max="100" step="0.1" required defaultValue={preferences.maxAllocationPercent}/></label>
          <label>Pérdida máxima aceptada (% del capital)<input name="maxLossPercent" type="number" min="0" max="100" step="0.1" required defaultValue={preferences.maxLossPercent}/></label>
          <label>Horizonte del pronóstico<select name="horizonSessions" defaultValue={preferences.horizonSessions}><option value="5">5 sesiones</option><option value="20">20 sesiones</option><option value="60">60 sesiones</option></select></label>
          <label>Experiencia con opciones<select name="experience" defaultValue={preferences.experience}><option value="learning">Estoy aprendiendo</option><option value="intermediate">Conozco asignación y spreads</option><option value="advanced">Manejo estructuras complejas</option></select></label>
          <label>Seguimiento disponible<select name="monitoring" defaultValue={preferences.monitoring}><option value="occasional">Ocasional</option><option value="daily">Diario</option></select></label>
        </div>
        <fieldset><legend>Estrategias que quieres evaluar</legend><div className="intelligence-strategies">{strategies.map(strategy =>
          <label key={strategy.id}><input name="strategy" type="checkbox" value={strategy.id} defaultChecked={preferences.allowedStrategies.includes(strategy.id)}/>{strategy.title}</label>)}</div></fieldset>
        <button className="primary-button" type="submit">Aplicar preferencias</button>
        {formError && <p role="alert">{formError}</p>}{notice && <p role="status">{notice} Cambiar los campos requiere volver a aplicar.</p>}
      </form>
    </details>
    {demo ? <p role="status">Selecciona Alpaca para estudiar datos observados. La demostración no genera predicciones de IA.</p>
      : loading ? <p role="status">Actualizando datos para el pronóstico…</p>
      : error ? <p role="status">Pronóstico pendiente: {error}</p>
      : !forecast ? <p role="status">Esperando cierres diarios de la empresa.</p> : <>
        <div className="intelligence-evidence"><span>Corte: <strong>{new Date(forecast.asOf).toLocaleDateString('es-MX', { timeZone: 'America/New_York' })}</strong></span>
          <span>Horizonte desde el cierre: <strong>{forecast.horizonSessions} sesiones</strong></span><span>Último cierre usado: <strong>{money(forecast.lastClose)}</strong></span></div>
        {forecast.status === 'available' && <div className="intelligence-metrics">
          <div><span>Retorno estimado del subyacente</span><strong>{percent(forecast.expectedReturn)}</strong></div>
          <div><span>Rango descriptivo de comparables · P10–P90</span><strong>{percent(forecast.lowerReturn)} a {percent(forecast.upperReturn)}</strong></div>
          <div><span>Comparables al alza · frecuencia ponderada</span><strong>{percent(forecast.risingComparableFraction)}</strong></div>
        </div>}
        <p role="status">{forecast.reason}</p>
        {forecast.diagnostics&&<div className="intelligence-diagnostics"><div className="intelligence-diagnostics-heading"><h3>¿Qué respalda esta estimación?</h3><span className="neutral-badge">{forecast.diagnostics.ready?'Evidencia suficiente para revisar':'Requiere cautela'}</span></div><div className="intelligence-metrics">
          <div><span>Mejora del error frente a retorno cero</span><strong>{percent(forecast.diagnostics.overall.improvementVsNoChange)}</strong></div>
          <div><span>Mejora frente a media histórica</span><strong>{percent(forecast.diagnostics.overall.improvementVsHistoricalMean)}</strong></div>
          <div><span>Últimos ocho periodos</span><strong>{forecast.diagnostics.recentPassed?'Superan ambas referencias':'Sin mejora suficiente'}</strong></div>
          <div><span>Cobertura observada del rango P10–P90</span><strong>{percent(forecast.diagnostics.overall.comparableRangeCoverage)}</strong></div>
        </div><p>La cobertura indica cuántos resultados de prueba cayeron dentro del rango que se calculó entonces. No garantiza la cobertura futura.</p>
          <details><summary>Variables y situaciones históricas comparadas</summary><p>{forecast.neighbors} comparables; {forecast.diagnostics.effectiveNeighbors.toFixed(1)} efectivos por sus pesos. La distancia estandarizada mide similitud, no importancia causal.</p><div className="intelligence-table-scroll"><table><thead><tr><th>Variable</th><th>Valor actual</th><th>Media de comparables</th><th>Cobertura</th></tr></thead><tbody>{forecast.diagnostics.features.map(feature=><tr key={feature.label}><td>{feature.label}</td><td>{percent(feature.value)}</td><td>{percent(feature.comparableMean)}</td><td>{feature.outsideTrainingRange?'Fuera del rango entrenado':'Dentro del rango'}</td></tr>)}</tbody></table></div><p>Momentum y distancia se expresan como retornos logarítmicos; volatilidad diaria, sin anualizar.</p><div className="intelligence-table-scroll"><table><thead><tr><th>Decisión histórica</th><th>Resultado conocido</th><th>Retorno</th><th>Peso</th></tr></thead><tbody>{forecast.comparables?.map(row=><tr key={row.outcomeAt}><td>{row.originAt?.slice(0,10)??'Sin dato'}</td><td>{row.outcomeAt.slice(0,10)}</td><td>{percent(row.return)}</td><td>{percent(row.weight)}</td></tr>)}</tbody></table></div></details>
        </div>}
        {recommendation && <div className="intelligence-result" aria-live="polite"><h3>{recommendation.title}</h3><p>{recommendation.reason}</p>
          <p>Capital máximo para una estructura: {money(recommendation.capitalLimit)}. Pérdida máxima aceptada: {money(recommendation.lossLimit)}.</p>
          {recommendation.best && <button className="secondary-button" onClick={() => onChoose(recommendation.best!.strategy)}>Ver estrategia sugerida en el explorador</button>}
          <p>La sugerencia no envía órdenes. Cada operación conserva su revisión y confirmación manual.</p>
        </div>}
        {!!recommendation?.alternatives.length && <details><summary>Comparación y motivos de descarte</summary><div className="intelligence-alternatives">{recommendation.alternatives.map(alternative =>
          <article key={alternative.strategy}><h3>{alternative.title} · {alternative.eligible ? `${alternative.score}/100 de ajuste` : 'Descartada'}</h3>
            <p>Capital: {money(alternative.capitalRequired)} · Pérdida máxima del modelo: {money(alternative.maxLoss)}</p>
            <ul>{alternative.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></article>)}</div></details>}
        <details><summary>Cómo se calculó y qué se comprobó</summary>
          <p>Regresión kNN con momentum de 5, 20 y 60 sesiones, volatilidad y distancia a la media de 20 cierres. Usa {forecast.neighbors} comparables con ventanas de resultado sin solaparse; solo aprende resultados conocidos antes de cada decisión.</p>
          <p>Fuente: {forecast.source}. El rango es descriptivo y la frecuencia al alza no es una probabilidad calibrada. El pronóstico del subyacente no equivale a rentabilidad ni probabilidad de beneficio de una estrategia de opciones.</p>
          <p>Validación cronológica: {forecast.validation.periods.length} periodos sin solaparse. Error absoluto medio: modelo {percent(forecast.validation.modelMae)}, precio sin cambio {percent(forecast.validation.noChangeMae)}, media histórica {percent(forecast.validation.historicalMeanMae)}.</p>
          <p>El ajuste compara una estructura por estrategia: primero exige datos observados OPRA, experiencia, plazo, capital y pérdida máxima; después pondera objetivo, capital restante y margen frente al límite de pérdida. La tolerancia baja, media o alta asigna al margen de riesgo un peso de 60%, 40% o 20%. El resto pondera objetivo (80%) y capital restante (20%). No se ha validado que estos pesos maximicen ganancias.</p>
          <p>PMCC necesita una cota de pérdida verificable y Gamma un modelo de coberturas antes de recibir una sugerencia. Las noticias y fundamentales siguen en sus paneles; este modelo todavía no los usa como variables predictoras. El análisis no sustituye la revisión de las posiciones ya existentes.</p>
        </details>
      </>}
  </section>;
}
