"use client";

import { AUTO_CORE_IDS, USER_SELECTABLE_CORE_IDS, effectiveCores, type CoreId } from '../../../cores/compartido/types';
import { cores } from '../../../cores/evaluacion/catalog';
import { coreWeight, evaluationTuning, type EvaluationTuningInput } from '../../../cores/evaluacion/evaluation-policy';
import './ranking-criteria.css';

/**
 * Only the quantitative-nucleus cores (BSM, Greeks, Probability) are user-selectable.
 * Volatility, Trend, Liquidity and Risk always participate in the ranking automatically
 * based on the company's data and the chosen strategy — the user cannot toggle them.
 */
export default function RankingCriteria({ selected, onChange, tuning, demo }: {
  selected: CoreId[]; onChange: (ids: CoreId[]) => void; tuning?: EvaluationTuningInput; demo: boolean;
}) {
  const weights = evaluationTuning(tuning);
  const effective = effectiveCores(selected);
  const participating = effective.filter(id => demo || coreWeight(weights, id) > 0).length;
  return <section className="scanner-section core-section">
    <div className="step-heading"><span>03</span><h3>Evaluación del ranking</h3><span className="section-code">{participating}/7</span></div>
    <p className="core-hint">El análisis técnico (volatilidad, tendencia y liquidez) y la gestión de riesgos se calculan automáticamente a partir de los datos de la empresa y la estrategia. No requieren activación manual.</p>
    <p className="ranking-criteria-status" role="status">{participating} de 7 criterios activos · {demo ? 'pesos iguales en demostración' : 'según los pesos configurados'}. La disponibilidad de datos se comprueba al evaluar.</p>
    <details className="ranking-criteria">
      <summary>Ajustar núcleo cuantitativo</summary>
      <p>Selecciona qué métodos cuantitativos incluir en la evaluación. Los criterios de análisis técnico y riesgo siempre participan.</p>
      <div className="core-bulk-actions"><button type="button" onClick={() => onChange([...USER_SELECTABLE_CORE_IDS])}>Activar todos</button><button type="button" onClick={() => onChange([])}>Limpiar</button></div>
      <fieldset>
        <legend>Núcleo cuantitativo</legend><p>Valoración, sensibilidades y equilibrio de opciones.</p>
        {USER_SELECTABLE_CORE_IDS.map(id => {
          const criterion = cores.find(item => item.id === id)!;
          return <label className="ranking-criterion" key={id}>
            <input type="checkbox" aria-label={criterion.title} checked={selected.includes(id)} onChange={() => onChange(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id])}/>
            <span>{criterion.title}<small>{criterion.subtitle}</small></span>
            <small className="ranking-weight">Peso {demo ? 1 : coreWeight(weights, id)}</small>
          </label>;
        })}
      </fieldset>
      <p>Los factores de análisis técnico, financiero y gestión de riesgos se calculan automáticamente según los datos de la empresa y la estrategia para el ranking, sin requerir selección del usuario.</p>
      <p>Los pesos del modo Alpaca se ajustan en «Compara estrategias» → «Ajustar capital y criterios».</p>
      <p>El análisis financiero y las noticias se consultan en los datos de la empresa; la IA conserva su propio perfil.</p>
    </details>
  </section>;
}
