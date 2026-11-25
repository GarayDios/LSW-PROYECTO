"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, BarChart3, RefreshCw } from 'lucide-react';
import { strategies } from '../strategies/catalog';
import { f5ReportCsv, type F5Coverage, type F5Report, type F5ReportEvent, type F5ReportMetrics } from './report-types';
import './f5-report-panel.css';

const cash = (value: number | null) => value === null || !Number.isFinite(value) ? 'No determinado' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const moneyClass = (value: number | null) => value === null ? 'f5-report-unknown' : value < 0 ? 'negative' : value > 0 ? 'positive' : '';
const title = (strategy: string) => strategies.find(item => item.id === strategy)?.title ?? strategy;
const time = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('es-MX', { timeZone: 'America/Mazatlan' }) : value ?? 'Sin fecha confirmada';
const coverageLabels: Record<F5Coverage, string> = { complete: 'Verificada', partial: 'Parcial', unknown: 'No determinada' };
const eventLabels: Record<F5ReportEvent['type'], string> = { fill: 'Ejecución', order_fill: 'Ejecución de orden', assignment: 'Asignación', exercise: 'Ejercicio', expiration: 'Vencimiento', settlement: 'Liquidación', fee: 'Comisión', unattributed: 'Sin atribución' };
const stateLabels = { open: 'Abierto', closed: 'Cerrado', uncertain: 'Pendiente de conciliar' };
function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function eventsCsv(report: F5Report) {
  const cell = (value: string | number | null) => value === null ? '' : typeof value === 'number' ? String(value) : `"${(/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  const eventRow = (scope: string, cycle: string, strategy: string, event: F5ReportEvent) => [scope, cycle, strategy, event.id, event.operationId, event.activityId, event.type, event.symbol, event.date, event.quantity, event.price, event.cashFlowUsd, event.feeUsd, event.source, event.known ? 'known' : 'unknown', event.reason ?? ''].map(cell).join(',');
  return '\uFEFF' + ['scope,cycle,strategy,id,operation_id,activity_id,type,symbol,date,quantity,price,cash_flow_usd,fee_usd,source,coverage,reason', ...report.cycles.flatMap(cycle => cycle.events.map(event => eventRow('cycle', cycle.id, cycle.strategy, event))), ...report.unattributed.map(event => eventRow('unattributed', '', '', event))].join('\r\n') + '\r\n';
}
function Coverage({ metrics }: { metrics: F5ReportMetrics }) {
  return <div className="f5-report-coverage">{([['fills', 'Ejecuciones'], ['fees', 'Comisiones'], ['settlements', 'Liquidaciones'], ['positions', 'Posiciones']] as const).map(([key, label]) => <span className={`coverage-${metrics.coverage[key]}`} key={key}>{label}: {coverageLabels[metrics.coverage[key]]}</span>)}</div>;
}
function EventsTable({ events }: { events: F5ReportEvent[] }) {
  return events.length ? <div className="f5-table-scroll f5-report-event-table"><table><thead><tr><th>Evento / fecha</th><th>Activo</th><th>Cantidad</th><th>Precio</th><th>Flujo de efectivo</th><th>Comisión</th><th>Procedencia</th></tr></thead><tbody>{events.map(event => <tr key={event.id}><td><strong>{eventLabels[event.type]}</strong><small>{time(event.date)}</small></td><td>{event.symbol ?? 'Sin símbolo'}</td><td>{event.quantity ?? '—'}</td><td>{cash(event.price)}</td><td className={moneyClass(event.cashFlowUsd)}>{cash(event.cashFlowUsd)}</td><td>{cash(event.feeUsd)}</td><td className="f5-report-source"><span>{event.source}</span>{!event.known && <small>Importe o atribución sin confirmar</small>}{event.reason && <small>{event.reason}</small>}{event.operationId && <small>Operación: {event.operationId}</small>}{event.activityId && <small>Actividad: {event.activityId}</small>}</td></tr>)}</tbody></table></div> : <p className="f5-empty">No hay movimientos confirmados para mostrar en este grupo.</p>;
}

export default function F5ReportPanel({ available,broker='alpaca' }: { available: boolean;broker?:'alpaca'|'webull' }) {
  const endpoint=broker==='webull'?'/api/webull-f5':'/api/f5',label=broker==='webull'?'Webull Sandbox':'Alpaca Paper';
  const [report, setReport] = useState<F5Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [strategyFilter, setStrategyFilter] = useState('all');
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(()=>{availableRef.current=available;},[available]);
  const availableRef=useRef(available);
  const load = useCallback(async () => {
    if (!availableRef.current) return;
    const requestId = ++sequence.current;
    setLoading(true); setError('');
    try {
      const response = await fetch(endpoint+'?resource=report', { credentials: 'same-origin', cache: 'no-store' });
      const value = await response.json().catch(() => null) as (Partial<F5Report> & { report?: F5Report; error?: string | { message?: string } }) | null;
      const received=value?.report??(value?.totals&&Array.isArray(value.cycles)?value as F5Report:null);
      if (!response.ok || !received) throw new Error(typeof value?.error === 'string' ? value.error : value?.error?.message || 'No se pudo generar el reporte con los movimientos del bróker.');
      if (mounted.current && requestId === sequence.current) setReport(received);
    } catch (failure) { if (mounted.current && requestId === sequence.current) { setReport(null); setError(failure instanceof Error ? failure.message : 'No se pudo consultar el reporte.'); } }
    finally { if (mounted.current && requestId === sequence.current) setLoading(false); }
  }, [endpoint]);
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(()=>{if(!mounted.current)return;if (available) void load(); else { setReport(null); sequence.current++; }});
    return () => { mounted.current = false; sequence.current++; };
  }, [available, load]);
  const cycles = report?.cycles.filter(cycle => strategyFilter === 'all' || cycle.strategy === strategyFilter) ?? [];
  const metrics = report?.totals;
  return <div className="f5-report-panel" aria-label="Reporte F5 de resultados y movimientos">
    <section className="panel f5-report-summary"><div className="f5-heading"><div><span className="f5-kicker"><BarChart3 size={14}/>RESULTADOS CON EVIDENCIA DEL BRÓKER</span><h2>Reporte de ciclos y estrategias F5</h2><p>Consolida ejecuciones, posiciones, liquidaciones y comisiones identificadas. Los importes que no se pueden determinar permanecen pendientes.</p></div><button className="secondary-button" disabled={!available || loading} onClick={() => void load()}><RefreshCw size={14} className={loading ? 'spin' : ''}/>{loading ? 'Consultando movimientos…' : 'Actualizar reporte F5'}</button></div>
      {!available && <p className="f5-empty">Conecta {label} para consultar el historial del servicio y los movimientos de la cuenta.</p>}
      {error && <p className="f5-error" role="alert">{error}</p>}
      {report && metrics && <><p className="f5-report-cutoff">Generado: {time(report.generatedAt)} · moneda: {report.currency} · {report.source}</p><div className="f5-report-summary-grid"><div><span>Flujo de efectivo del ciclo</span><strong className={moneyClass(metrics.cashFlowUsd)}>{cash(metrics.cashFlowUsd)}</strong><small>Entradas y salidas monetarias; no equivale por sí solo a ganancia.</small></div><div><span>Resultado realizado</span><strong className={moneyClass(metrics.realizedPnlUsd)}>{cash(metrics.realizedPnlUsd)}</strong><small>Sobre cantidades cerradas y atribuidas.</small></div><div><span>Resultado no realizado</span><strong className={moneyClass(metrics.unrealizedPnlUsd)}>{cash(metrics.unrealizedPnlUsd)}</strong><small>Posiciones abiertas valoradas por el bróker.</small></div><div><span>Resultado antes de comisiones</span><strong className={moneyClass(metrics.grossPnlUsd)}>{cash(metrics.grossPnlUsd)}</strong><small>Solo cuando flujos y valoración están conciliados.</small></div><div><span>Comisiones identificadas</span><strong>{cash(metrics.feesUsd)}</strong><small>La ausencia de comisiones publicadas no se interpreta como coste cero.</small></div><div><span>Resultado neto</span><strong className={moneyClass(metrics.netPnlUsd)}>{cash(metrics.netPnlUsd)}</strong><small>Después de los costes que se pueden verificar.</small></div></div><Coverage metrics={metrics}/>{(metrics.cashFlowUsd === null || metrics.feesUsd === null) && <p className="f5-report-observed">Subtotal identificado: flujos {cash(metrics.observedCashFlowUsd)} · comisiones {cash(metrics.observedFeesUsd)}. Estos subtotales no completan los movimientos que falten por atribuir.</p>}<div className="f5-report-export"><button className="secondary-button" disabled={loading} onClick={() => download(f5ReportCsv(report), `TEPIC-F5-resumen-${report.generatedAt.slice(0, 10)}.csv`)}><ArrowDownToLine size={14}/>Exportar resumen F5 CSV</button><button className="secondary-button" disabled={loading} onClick={() => download(eventsCsv(report), `TEPIC-F5-movimientos-${report.generatedAt.slice(0, 10)}.csv`)}><ArrowDownToLine size={14}/>Exportar movimientos F5 CSV</button></div>{(report.warnings.length > 0 || metrics.warnings.length > 0) && <details className="f5-report-warnings" open><summary>Alcance y datos pendientes del reporte</summary><ul>{[...new Set([...report.warnings, ...metrics.warnings])].map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}</>}
    </section>

    {report && <><section className="panel f5-report-strategies"><div className="f5-heading"><div><span className="f5-kicker">COMPARACIÓN CONTABLE</span><h2>Resultados por estrategia</h2><p>Consolidado de todos los ciclos incluidos en el reporte actual.</p></div></div>{report.strategies.length ? <div className="f5-table-scroll"><table><thead><tr><th>Estrategia</th><th>Ciclos</th><th>Flujos</th><th>Realizado</th><th>No realizado</th><th>Comisiones</th><th>Resultado neto</th></tr></thead><tbody>{report.strategies.map(item => <tr key={item.strategy}><td><strong>{title(item.strategy)}</strong><small>{coverageLabels[item.metrics.coverage.fills]} · ejecuciones</small></td><td>{item.cycleCount}</td><td className={moneyClass(item.metrics.cashFlowUsd)}>{cash(item.metrics.cashFlowUsd)}</td><td className={moneyClass(item.metrics.realizedPnlUsd)}>{cash(item.metrics.realizedPnlUsd)}</td><td className={moneyClass(item.metrics.unrealizedPnlUsd)}>{cash(item.metrics.unrealizedPnlUsd)}</td><td>{cash(item.metrics.feesUsd)}</td><td className={moneyClass(item.metrics.netPnlUsd)}>{cash(item.metrics.netPnlUsd)}</td></tr>)}</tbody></table></div> : <p className="f5-empty">Todavía no hay ciclos F5 con actividad que atribuir a una estrategia.</p>}</section>

    <section className="panel f5-report-cycles"><div className="f5-heading"><div><span className="f5-kicker">RECORRIDO DE CADA INVERSIÓN</span><h2>Detalle por ciclo</h2><p>Abre un ciclo para revisar sus importes, eventos y fuentes.</p></div><label className="f5-field">Filtrar ciclos por estrategia<select aria-label="Filtrar ciclos F5 por estrategia" value={strategyFilter} onChange={event => setStrategyFilter(event.target.value)}><option value="all">Todas las estrategias</option>{strategies.map(strategy => <option value={strategy.id} key={strategy.id}>{strategy.title}</option>)}</select></label></div>{cycles.length ? <div className="f5-report-cycle-list">{cycles.map(cycle => <details className="f5-report-cycle" key={cycle.id}><summary><span><strong>{cycle.underlying} · {title(cycle.strategy)}</strong><small>{time(cycle.openedAt)} · {stateLabels[cycle.state]}</small></span><span className={moneyClass(cycle.metrics.netPnlUsd)}>{cash(cycle.metrics.netPnlUsd)}<small>Resultado neto</small></span></summary><div className="f5-report-cycle-content"><p className="f5-report-id">Ciclo: {cycle.id} · operaciones asociadas: {cycle.operationIds.length}</p><div className="f5-report-cycle-metrics"><div><span>Flujo monetario</span><strong>{cash(cycle.metrics.cashFlowUsd)}</strong></div><div><span>Realizado</span><strong>{cash(cycle.metrics.realizedPnlUsd)}</strong></div><div><span>No realizado</span><strong>{cash(cycle.metrics.unrealizedPnlUsd)}</strong></div><div><span>Antes de comisiones</span><strong>{cash(cycle.metrics.grossPnlUsd)}</strong></div><div><span>Comisiones</span><strong>{cash(cycle.metrics.feesUsd)}</strong></div></div><Coverage metrics={cycle.metrics}/>{cycle.metrics.warnings.length > 0 && <ul className="f5-warnings">{cycle.metrics.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}<EventsTable events={cycle.events}/></div></details>)}</div> : <p className="f5-empty">No hay ciclos de la estrategia seleccionada en este reporte.</p>}</section>

    <section className="panel f5-report-daily"><div className="f5-heading"><div><span className="f5-kicker">FLUJOS POR FECHA</span><h2>Actividad diaria</h2><p>La distribución monetaria por día conserva los importes pendientes y su cobertura de datos.</p></div></div>{report.daily.length ? <div className="f5-table-scroll"><table><thead><tr><th>Fecha</th><th>Flujos</th><th>Realizado</th><th>Comisiones</th><th>Resultado neto</th><th>Cobertura de liquidaciones</th></tr></thead><tbody>{report.daily.map(day => <tr key={day.date}><td>{day.date}</td><td className={moneyClass(day.metrics.cashFlowUsd)}>{cash(day.metrics.cashFlowUsd)}</td><td className={moneyClass(day.metrics.realizedPnlUsd)}>{cash(day.metrics.realizedPnlUsd)}</td><td>{cash(day.metrics.feesUsd)}</td><td className={moneyClass(day.metrics.netPnlUsd)}>{cash(day.metrics.netPnlUsd)}</td><td>{coverageLabels[day.metrics.coverage.settlements]}</td></tr>)}</tbody></table></div> : <p className="f5-empty">Todavía no hay movimientos diarios identificados.</p>}</section>

    {report.unattributed.length > 0 && <section className="panel f5-report-unattributed"><div className="f5-heading"><div><span className="f5-kicker">MOVIMIENTOS PENDIENTES DE ATRIBUCIÓN</span><h2>Actividad sin ciclo confirmado</h2><p>Estos movimientos se muestran para revisión. No se asignan automáticamente a una estrategia ni se cuentan como beneficios confirmados.</p></div></div><EventsTable events={report.unattributed}/></section>}</>}
  </div>;
}
