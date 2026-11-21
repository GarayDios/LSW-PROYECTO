import type { OptionValue, ProfitInputs } from '../../../cores/compartido/types';
import { profitMetrics } from '../../../cores/nucleo-cuantitativo/probability';

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function OptionValuationSummary({ model, input, context }: {
  model: OptionValue | null; input: ProfitInputs | null; context: string;
}) {
  const metrics = input ? profitMetrics(input) : null;
  const values = [
    { label: 'Valor teórico BSM', value: model ? money(model.price) : 'No disponible', detail: 'USD por acción; no es una cotización.' },
    { label: 'Prima utilizada', value: input ? money(input.premium) : 'No disponible', detail: 'USD por acción, según la fuente o el supuesto indicado.' },
    { label: 'Equilibrio al vencimiento', value: metrics ? money(metrics.breakeven) : 'No disponible', detail: 'Precio de la acción para una opción individual, antes de comisiones.' },
    { label: 'Probabilidad teórica de beneficio', value: metrics ? `${(metrics.probabilityOfProfit * 100).toFixed(1)}%` : 'No disponible', detail: 'Medida neutral al riesgo bajo los supuestos del modelo.' },
  ];
  return <section className="option-valuation-summary" aria-label="Valoración del contrato">
    <div className="model-caption"><strong>Valoración del contrato</strong><p>{context}</p>
      {input && <p>{input.type.toUpperCase()} {input.side === 'buy' ? 'comprada' : 'vendida'} · Strike {money(input.strike)} · {input.days.toFixed(1)} días al vencimiento.</p>}
    </div>
    <div className="research-grid">{values.map(item => <div className={`research-variable${item.value === 'No disponible' ? ' research-missing' : ''}`} key={item.label}>
      <div><span>{item.label}</span><strong>{item.value}</strong></div><small>{item.detail}</small>
    </div>)}</div>
    <div className="model-caption">
      {!input && <p>Faltan entradas completas, incluida una prima explícita, para calcular equilibrio y probabilidad. El valor teórico BSM no sustituye automáticamente una prima faltante.</p>}
      <p>BSM supone ejercicio europeo y entradas constantes; para opciones americanas es una aproximación sin ejercicio anticipado. La probabilidad corresponde a esta opción individual antes de comisiones, no al resultado de una estrategia completa ni a una predicción de éxito real.</p>
    </div>
  </section>;
}
