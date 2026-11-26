"use client";

import { useState } from 'react';
import type { F5RiskSettings, F5RiskState } from './types';
import type { DailyRiskResetReference } from './risk-reset';

const cash = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function F5DailyRisk({ risk, settings, equity, busy, onReset }: {
  risk: F5RiskState; settings: F5RiskSettings; equity: number; busy: boolean;
  onReset(reference: DailyRiskResetReference): Promise<boolean>;
}) {
  const [review, setReview] = useState<DailyRiskResetReference | null>(null);
  const changed = review && (review.date !== risk.date || review.baselineEquity !== risk.baselineEquity || review.maxDailyLossUsd !== settings.maxDailyLossUsd || review.resetId !== (risk.resetId ?? null));

  return <section className="panel f5-daily-risk" aria-label="Control de pérdida diaria Alpaca Paper">
    <h2>Se alcanzó el límite de pérdida diaria</h2>
    <p>Las nuevas aperturas quedan bloqueadas hasta el siguiente día de Nueva York, aunque el patrimonio se recupere.</p>
    <dl className="f5-risk-summary">
      <div><dt>Referencia del período</dt><dd>{cash(risk.baselineEquity)}</dd></div>
      <div><dt>Variación del patrimonio</dt><dd>{cash(risk.dailyPnlUsd)}</dd></div>
      <div><dt>Límite de pérdida</dt><dd>{cash(settings.maxDailyLossUsd)}</dd></div>
    </dl>
    {review ? <div className="f5-risk-confirmation" role="group" aria-label="Confirmación de reinicio del control diario">
      <p>Al confirmar, el patrimonio que consulte el servidor será la nueva referencia. El valor actual es <strong>{cash(equity)}</strong>; la variación del nuevo período comenzará en cero y el límite seguirá en <strong>{cash(settings.maxDailyLossUsd)}</strong>.</p>
      <p>El reinicio queda registrado y conserva el historial de operaciones. Esta acción solo cambia el control de pruebas de Alpaca Paper.</p>
      {changed && <p role="alert">La referencia o el límite cambió. Cancela esta confirmación y revisa nuevamente el reinicio.</p>}
      <div className="f5-risk-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setReview(null)}>Cancelar reinicio</button><button type="button" className="primary-button" disabled={busy || Boolean(changed)} onClick={() => void onReset(review)}>{busy ? 'Reiniciando…' : 'Confirmar reinicio del control diario'}</button></div>
    </div> : <button type="button" className="secondary-button" disabled={busy} onClick={() => setReview({ date: risk.date, baselineEquity: risk.baselineEquity, maxDailyLossUsd: settings.maxDailyLossUsd, resetId: risk.resetId ?? null })}>Reiniciar control diario</button>}
  </section>;
}
