"use client";

import { useEffect, useRef, useState } from 'react';
import type { ComparisonResult } from '../../../cores/05-indicadores-y-senales/comparison';
import './comparison-panel.css';

const pct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
function exportResult(result: ComparisonResult) {
  const rows: (string | number)[][] = [['Empresa', 'Años', 'Regla', 'Primera sesión', 'Última sesión', 'Retorno validación %', 'Comprar y mantener %', 'Caída máxima %', 'Operaciones cerradas', 'Ventanas positivas', 'Ventanas totales', 'Aciertos históricos %', 'Comisión pb', 'Deslizamiento pb', 'Fuente', 'Corte']];
  for (const row of result.rows) rows.push([row.symbol, row.years, row.label, row.firstBar, row.lastBar, row.returnPct, row.buyHoldReturnPct, row.maxDrawdownPct, row.completedTrades, row.stability.positiveFolds, row.stability.folds.length, row.stability.historicalWinRate === null ? '' : row.stability.historicalWinRate * 100, result.feeBps, result.slippageBps, result.source, result.cutoff]);
  for (const item of result.excluded) rows.push([item.symbol, item.years, `Excluida: ${item.reason}`]);
  const csv = '\uFEFF' + rows.map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `comparacion-${result.cutoff}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ComparisonPanel({ symbol, end, enabled,provider='alpaca' }: { symbol: string; end: string; enabled: boolean;provider?:'alpaca'|'webull' }) {
  const [symbols, setSymbols] = useState(`${symbol}, AAPL, MSFT`);
  const [years, setYears] = useState<number[]>([1, 3, 5]);
  const [fee, setFee] = useState('10'), [slippage, setSlippage] = useState('5');
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => { active.current?.abort(); setResult(null); setBusy(false); setError(''); return () => active.current?.abort(); }, [end, enabled,provider]);
  async function compare(event: React.FormEvent) {
    event.preventDefault();
    const universe = [...new Set(symbols.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
    if (!universe.length || universe.length > 6 || !universe.every(value => /^[A-Z][A-Z0-9.\-]{0,14}$/.test(value)) || !years.length || !fee.trim() || !slippage.trim() || ![Number(fee), Number(slippage)].every(value => Number.isFinite(value) && value >= 0 && value <= 1000)) { setError('Define de una a seis empresas, al menos un periodo y costes entre 0 y 1000 pb.'); return; }
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/research/comparison', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: universe, years, end, provider,feeBps: Number(fee), slippageBps: Number(slippage) }), signal: controller.signal });
      const value = await response.json() as ComparisonResult & { error?: { message?: string } };
      if (!response.ok) throw Error(value.error?.message ?? 'No se pudo completar la comparación.');
      if (!controller.signal.aborted) setResult(value);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'La comparación no está disponible.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="panel comparison-panel" aria-label="Comparación de reglas y empresas">
    <div className="comparison-heading"><div><span className="eyebrow">EMPRESAS · PERIODOS · ESTABILIDAD</span><h2>Comparar reglas con datos reales</h2></div>{result && <button className="secondary-button" onClick={() => exportResult(result)}>Exportar comparación CSV</button>}</div>
    <p>Dos reglas fijas: cruce SMA20/50, con y sin filtro RSI14. Comparación de acciones con validación temporal y costes iguales para todas las empresas.</p>
    <form onSubmit={event => void compare(event)}>
      <label className="comparison-symbols">Empresas separadas por coma<input aria-label="Empresas para comparar" value={symbols} onChange={event => setSymbols(event.target.value)} maxLength={100} required placeholder="AAPL, MSFT, NVDA"/></label>
      <fieldset><legend>Periodos hasta {end}</legend>{[1, 3, 5].map(period => <label key={period}><input type="checkbox" checked={years.includes(period)} onChange={event => setYears(current => event.target.checked ? [...current, period].sort() : current.filter(value => value !== period))}/>{period} {period === 1 ? 'año' : 'años'}</label>)}</fieldset>
      <label>Comisión por ejecución (pb)<input aria-label="Comisión comparación" type="number" min="0" max="1000" step="0.1" value={fee} onChange={event => setFee(event.target.value)} required/></label>
      <label>Deslizamiento (pb)<input aria-label="Deslizamiento comparación" type="number" min="0" max="1000" step="0.1" value={slippage} onChange={event => setSlippage(event.target.value)} required/></label>
      <button className="secondary-button" disabled={!enabled || busy}>{busy ? 'Comparando históricos…' : 'Comparar empresas y periodos'}</button>
    </form>
    {!enabled && <p>Selecciona Alpaca o Webull para consultar históricos del proveedor.</p>}
    {enabled&&provider==='webull'&&<p>Comparación con Webull Sandbox: resultados de pruebas; se conserva la procedencia y cobertura del histórico.</p>}
    {busy && <p role="status">Consultando cada empresa una sola vez para todos los periodos…</p>}
    {error && <p className="negative" role="alert">{error}</p>}
    {result && <><p>{result.source} · Corte: {result.cutoff} · Comisión {result.feeBps} pb + deslizamiento {result.slippageBps} pb por ejecución.</p>
      {result.rows.length > 0 && <div className="validation-table"><table><thead><tr><th>Empresa / periodo</th><th>Regla</th><th>Retorno 70/30</th><th>Comprar y mantener</th><th>Caída máx.</th><th>Cerradas</th><th>Ventanas positivas</th></tr></thead><tbody>{result.rows.map(row => <tr key={`${row.symbol}-${row.years}-${row.rule}`}><td>{row.symbol} · {row.years}A<small>{row.firstBar} → {row.lastBar}</small></td><td>{row.label}</td><td className={row.returnPct < 0 ? 'negative' : 'positive'}>{pct(row.returnPct)}</td><td>{pct(row.buyHoldReturnPct)}</td><td>{row.maxDrawdownPct.toFixed(2)}%</td><td>{row.completedTrades}{row.openPosition ? ' + abierta' : ''}</td><td>{row.stability.positiveFolds}/{row.stability.folds.length}{!row.stability.sufficientSample && <small>Muestra insuficiente: {row.stability.completedTrades} cerradas en ventanas</small>}</td></tr>)}</tbody></table></div>}
      {result.rows.map(row => <details key={`${row.symbol}-${row.years}-${row.rule}`}><summary>{row.symbol} · {row.years}A · {row.label}: ventanas e incertidumbre</summary><div className="validation-table"><table><thead><tr><th>Prueba</th><th>Retorno</th><th>Comprar y mantener</th><th>Caída</th><th>Cerradas</th></tr></thead><tbody>{row.stability.folds.map(fold => <tr key={fold.startTime}><td>{new Date(fold.startTime).toISOString().slice(0, 10)} → {new Date(fold.endTime).toISOString().slice(0, 10)}</td><td className={fold.returnPct < 0 ? 'negative' : 'positive'}>{pct(fold.returnPct)}</td><td>{pct(fold.buyHoldReturnPct)}</td><td>{fold.maxDrawdownPct.toFixed(2)}%</td><td>{fold.completedTrades}{fold.openPosition ? ' + abierta' : ''}</td></tr>)}</tbody></table></div><p>Aciertos históricos: {row.stability.historicalWinRate === null ? 'sin operaciones cerradas' : `${(row.stability.historicalWinRate * 100).toFixed(1)}%`}{row.stability.winRateInterval95 ? ` · intervalo Wilson 95%: ${(row.stability.winRateInterval95.low * 100).toFixed(1)}–${(row.stability.winRateInterval95.high * 100).toFixed(1)}%` : ''}.</p>{row.stability.warnings.map(warning => <p key={warning}>{warning}</p>)}</details>)}
      {result.excluded.map(item => <p className="comparison-warning" key={`${item.symbol}-${item.years}`}>{item.symbol} · {item.years}A: {item.reason}</p>)}
      {result.warnings.map(warning => <p key={warning}>{warning}</p>)}
    </>}
  </section>;
}
