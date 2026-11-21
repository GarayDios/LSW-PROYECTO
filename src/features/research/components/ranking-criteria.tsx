"use client";

import { CORE_IDS, type CoreId } from '../../../cores/compartido/types';
import { cores } from '../../../cores/evaluacion/catalog';
import { coreWeight, evaluationTuning, type EvaluationTuningInput } from '../../../cores/evaluacion/evaluation-policy';
import './ranking-criteria.css';

const groups: { title: string; description: string; ids: CoreId[] }[] = [
  { title: 'Núcleo cuantitativo', description: 'Valoración, sensibilidades y equilibrio de opciones.', ids: ['bsm', 'greeks', 'probability'] },
  { title: 'Análisis técnico', description: 'Comportamiento del precio, volatilidad y liquidez.', ids: ['volatility', 'trend', 'liquidity'] },
  { title: 'Gestión de riesgos', description: 'Componente de riesgo de la evaluación. Los límites operativos se aplican por separado.', ids: ['risk'] },
];

export default function RankingCriteria({ selected, onChange, tuning, demo }: {
  selected: CoreId[]; onChange: (ids: CoreId[]) => void; tuning?: EvaluationTuningInput; demo: boolean;
}) {
  const weights = evaluationTuning(tuning);
  const participating = selected.filter(id => demo || coreWeight(weights, id) > 0).length;
  return <section className="scanner-section core-section">
    <div className="step-heading"><span>03</span><h3>Evaluación del ranking</h3><span className="section-code">{participating}/7</span></div>
    <p className="core-hint">El núcleo cuantitativo, el análisis técnico y la gestión de riesgos aportan los criterios del ranking. Mostrar u ocultar capas en la gráfica no cambia esta evaluación.</p>
    <p className="ranking-criteria-status" role="status">{participating} de 7 criterios habilitados · {demo ? 'pesos iguales en demostración' : 'según los pesos configurados'}. La disponibilidad de datos se comprueba al evaluar.</p>
    <details className="ranking-criteria">
      <summary>Ajustar criterios del ranking</summary>
      <p>Estos ajustes cambian la comparación de estrategias y las próximas listas generadas. Las listas guardadas conservan su configuración.</p>
      <div className="core-bulk-actions"><button type="button" onClick={() => onChange([...CORE_IDS])}>Activar todos</button><button type="button" onClick={() => onChange([])}>Limpiar</button></div>
      {groups.map(group => <fieldset key={group.title}>
        <legend>{group.title}</legend><p>{group.description}</p>
        {group.ids.map(id => {
          const criterion = cores.find(item => item.id === id)!;
          return <label className="ranking-criterion" key={id}>
            <input type="checkbox" aria-label={criterion.title} checked={selected.includes(id)} onChange={() => onChange(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id])}/>
            <span>{criterion.title}<small>{criterion.subtitle}</small></span>
            <small className="ranking-weight">Peso {demo ? 1 : coreWeight(weights, id)}</small>
          </label>;
        })}
      </fieldset>)}
      <p>Los pesos del modo Alpaca se ajustan en «Compara estrategias» → «Ajustar capital y criterios». Un peso cero excluye ese criterio.</p>
      <p>El análisis financiero y las noticias se consultan en los datos de la empresa; la IA conserva su propio perfil. Esta selección no activa ni desactiva esos módulos.</p>
    </details>
  </section>;
}
