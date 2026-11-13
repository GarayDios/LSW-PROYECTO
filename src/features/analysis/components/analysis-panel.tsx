"use client";

import { useMemo } from 'react';
import type { AnalysisResult } from '../signals';
import { walkForwardValidation } from '../validation';
import type { Candle } from '../../market/chart-history';
import type { MarketSource } from '../../market/hooks/use-market-history';
import './analysis-panel.css';

const percentage = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const date = (value: number | null) => value === null ? '—' : new Intl.DateTimeFormat('es-MX', { timeZone: 'America/New_York', day: '2-digit', month: 'short', year: 'numeric' }).format(value);

export default function AnalysisPanel({ analysis, source, interval, loading, onDaily, candles }: { analysis: AnalysisResult | null; source: MarketSource; interval: string; loading: boolean; onDaily: () => void; candles?: readonly Candle[] }) {
  const signal = analysis?.latest;
  const validation = useMemo(() => interval === '1d' && candles && candles.length >= 100 ? walkForwardValidation(candles) : null, [interval, candles]);
  const action = signal?.action === 'buy' ? 'Señal de entrada' : signal?.action === 'sell' ? 'Señal de salida' : 'Esperar una señal';
  return <section className="panel analysis-panel" aria-label="Análisis de entrada y validación histórica">
    <div className="analysis-panel-heading"><div><span className="analysis-kicker">FECHAS → HISTÓRICO → REGLAS → VALIDACIÓN</span><h2>Cuándo evaluar una entrada</h2></div><span className={`analysis-source ${source === 'demo' ? 'is-demo' : ''}`}>{source === 'demo' ? 'Demostración' : 'Histórico real'}</span></div>
    {loading ? <p className="analysis-message" role="status">Esperando las velas del rango seleccionado…</p> : interval !== '1d' ? <div className="analysis-message"><p>La estrategia usa cierres diarios. Cambia a 1 día para evaluar el rango y marcar las señales en la gráfica.</p><button className="secondary-button" onClick={onDaily}>Usar velas diarias</button></div> : !analysis ? <p className="analysis-message">Selecciona un rango con al menos 60 sesiones diarias. Los botones 3A y 5A permiten revisar varios años.</p> : <>
      <div className={`analysis-current signal-${signal?.action ?? 'hold'}`}><div><strong>{action}</strong><span>{date(signal?.time ?? null)} · cierre observado</span></div><p>{signal?.reason || 'Aún no hay información suficiente para evaluar las reglas.'}</p></div>
      <p className="analysis-rule">Cruce de medias de 20 y 50 sesiones con filtro RSI de 14 sesiones. Cada señal usa únicamente las velas conocidas hasta ese cierre. En la prueba histórica se ejecuta en la apertura de la siguiente sesión.</p>
      <div className="analysis-metrics"><div><span>Retorno de validación</span><strong className={analysis.backtest.returnPct >= 0 ? 'positive' : 'negative'}>{percentage(analysis.backtest.returnPct)}</strong></div><div><span>Caída máxima</span><strong>{analysis.backtest.maxDrawdownPct.toFixed(2)}%</strong></div><div><span>Compras y ventas cerradas</span><strong>{analysis.backtest.completedTrades}</strong></div><div><span>Comprar y mantener</span><strong>{percentage(analysis.backtest.buyHoldReturnPct)}</strong></div></div>
      <div className="analysis-validation"><span>Contexto inicial: 70% del rango</span><span>Validación temporal: {date(analysis.validationStartTime)} → {date(analysis.backtest.endTime)}</span><span>Costes: {analysis.backtest.feeBps} pb de comisión + {analysis.backtest.slippageBps} pb de deslizamiento por ejecución</span></div>
      {analysis.warning && <p className="analysis-warning">{analysis.warning}</p>}
      {validation && <details className="temporal-validation"><summary>Validación por ventanas: {validation.folds.length} bloques · {validation.completedTrades} operaciones cerradas</summary>
        <p>Contexto creciente, regla fija y ventanas de 63 sesiones. Cada bloque se evalúa después de su contexto, con ejecución en la siguiente apertura.</p>
        <div className="validation-table"><table><thead><tr><th>Prueba</th><th>Retorno</th><th>Comprar y mantener</th><th>Caída máx.</th><th>Cerradas</th></tr></thead><tbody>{validation.folds.map(fold => <tr key={fold.startTime}><td>{date(fold.startTime)} → {date(fold.endTime)}</td><td>{percentage(fold.returnPct)}</td><td>{percentage(fold.buyHoldReturnPct)}</td><td>{fold.maxDrawdownPct.toFixed(2)}%</td><td>{fold.completedTrades}{fold.openPosition ? ' + abierta' : ''}</td></tr>)}</tbody></table></div>
        <p>Aciertos históricos: {validation.historicalWinRate === null ? 'sin operaciones cerradas' : `${(validation.historicalWinRate * 100).toFixed(1)}%`}{validation.winRateInterval95 ? ` · intervalo descriptivo del 95%: ${(validation.winRateInterval95.low * 100).toFixed(1)}–${(validation.winRateInterval95.high * 100).toFixed(1)}%` : ''}. No es una probabilidad de la próxima inversión.</p>
        {validation.warnings.map(warning => <p className="analysis-warning" key={warning}>{warning}</p>)}
      </details>}
      <p className="analysis-disclaimer">{source === 'demo' ? 'Esta prueba usa datos sintéticos y solo explica el funcionamiento. ' : ''}Las marcas muestran reglas históricas; no predicen una fecha futura ni garantizan rentabilidad. El modo Alpaca identifica las fuentes y deja sin calcular los cores que no tengan datos suficientes.</p>
    </>}
  </section>;
}
