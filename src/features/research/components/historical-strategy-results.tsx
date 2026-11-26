"use client";
import type { StrategyBacktestResult } from '../../../cores/evaluacion/strategy-backtest';
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const date = (time: number) => new Date(time).toISOString().slice(0, 10);
const percent = (value: number) => `${value.toFixed(2)}%`;

export default function HistoricalStrategyResults({ result, cursorTime, title, symbol, complete }: {
  result: StrategyBacktestResult; cursorTime: number; title: string; symbol: string; complete: boolean;
}) {
  const point = result.snapshots.find(point => point.time === cursorTime);
  const movements = result.operations.filter(op => op.time === cursorTime);
  function download() {
    const rows = [['Empresa', 'Estrategia', 'Capital inicial USD', 'Fecha UTC', 'Ciclo', 'Tipo', 'Operacion', 'Cantidad firmada', 'Precio USD', 'Comision USD', 'Flujo USD'],
      ...result.operations.map(op => [symbol, result.strategy, result.initialCapital, new Date(op.time).toISOString(), op.cycle, op.kind, op.detail, op.quantity, op.price, op.fee, op.cashFlow])];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${symbol}-${result.strategy}-backtest-${date(result.startTime)}-${date(result.endTime)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="replay-backtest-results" data-backtest-result data-backtest-strategy={result.strategy}>
    <section aria-label="Posición de la estrategia en el punto" className="historical-point-pnl" data-pnl={point ? point.equity - result.initialCapital : undefined}>
      <h3>{title} · posición al {date(cursorTime)}</h3>
      {point ? <><div className="replay-data-grid">{[
        ['P/L neto acumulado', money(point.equity - result.initialCapital)], ['Capital a mercado', money(point.equity)], ['Efectivo', money(point.cash)], ['Acciones', String(point.shares)],
        ['Valor de opciones', money(point.optionsValue)], ['Comisiones acumuladas', money(point.fees)], ['Delta con cobertura', point.delta.toFixed(2)], ['Gamma', point.gamma.toFixed(4)], ['Theta · USD/día', money(point.theta)], ['Vega · USD/punto IV', money(point.vega)],
      ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <p>El P/L incluye primas, asignaciones y coberturas ya ejecutadas. Las posiciones abiertas se valoran a mercado; los costes de un cierre futuro aún no se descuentan.</p>
        <div className="table-scroll"><table><caption>Opciones abiertas en este cierre</caption><thead><tr><th>Tipo</th><th>Contratos</th><th>Strike</th><th>Vencimiento</th><th>Prima teórica</th><th>HV de apertura</th></tr></thead><tbody>{point.legs.map((leg, i) => <tr key={i}><td>{leg.type.toUpperCase()}</td><td>{leg.quantity}</td><td>{money(leg.strike)}</td><td>{date(leg.expiry)}</td><td>{money(leg.mark)}</td><td>{percent(leg.volatility * 100)}</td></tr>)}</tbody></table></div>{!point.legs.length && <p>Sin opciones abiertas en este cierre.</p>}
        <details><summary>Movimientos de esta sesión · {movements.length}</summary>{movements.length ? <ul>{movements.map((op, i) => <li key={i}>{op.detail} · flujo {money(op.cashFlow)} · comisión {money(op.fee)}</li>)}</ul> : <p>Sin operaciones en esta sesión.</p>}</details>
      </> : <p>Este cierre es anterior a la ejecución. La estrategia comienza en la apertura del {date(result.startTime)}.</p>}
    </section>
    <section aria-label="Resultado del backtesting de la estrategia">
      <h3>Resultado del período · {title}</h3><p>{date(result.startTime)} a {date(result.endTime)} · {complete ? 'Período completo.' : 'Período parcial: faltan sesiones hasta el horizonte elegido.'} Se liquidan las posiciones al último cierre disponible.</p>
      <div className="replay-data-grid">{[
        ['Capital inicial', money(result.initialCapital)], ['Capital final', money(result.finalEquity)], ['Resultado neto', money(result.finalEquity - result.initialCapital)], ['Retorno', percent(result.returnPct)],
        ['Caída máxima', percent(result.maxDrawdownPct)], ['Ciclos cerrados', String(result.completedTrades)], ['Ciclos con beneficio', result.winRatePct === null ? 'Sin ciclos' : percent(result.winRatePct)], ['Comisiones totales', money(result.totalFees)],
      ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <details><summary>Ver ciclos y operaciones · {result.operations.length} movimientos</summary><div className="table-scroll"><table><thead><tr><th>Entrada</th><th>Salida</th><th>Contratos base</th><th>Reserva inicial</th><th>P/L neto</th><th>Motivo</th></tr></thead><tbody>{result.trades.map(trade => <tr key={trade.id}><td>{date(trade.entryTime)}</td><td>{date(trade.exitTime)}</td><td>{trade.contracts}</td><td>{money(trade.required)}</td><td>{money(trade.netPnl)}</td><td>{trade.reason}</td></tr>)}</tbody></table></div><ul>{result.operations.map((op, i) => <li key={i} data-backtest-operation={op.kind}>{date(op.time)} · ciclo {op.cycle} · {op.detail} · flujo {money(op.cashFlow)}</li>)}</ul></details>
      {!!result.skipped.length && <details><summary>Sesiones sin entrada · {result.skipped.length}</summary><ul>{result.skipped.map(item => <li key={item.time}>{date(item.time)} · {item.reason}</li>)}</ul></details>}
      {!result.trades.length && <p>No se abrieron posiciones. Consulta el capital requerido y los motivos de las sesiones omitidas.</p>}
      <button className="secondary-button" onClick={download}>Exportar operaciones CSV</button>
    </section>
  </div>;
}
