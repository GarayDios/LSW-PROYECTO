"use client";

import type { ChartNewsArticle, ChartNewsGroup } from '../chart-news';
import type { ChartNewsState } from '../hooks/use-chart-news';
import { headlineSentiment } from '../../../cores/03-noticias-financieras/sentiment';

const stamp = (value: string) => new Date(value).toLocaleString('es-MX', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
function safeUrl(url: string | null): string | null {
  try { const parsed = new URL(url ?? ''); return parsed.protocol === 'https:' ? parsed.href : null; } catch { return null; }
}
function Article({ article }: { article: ChartNewsArticle }) {
  const url = safeUrl(article.url);
  const sentiment = headlineSentiment(article.headline);
  return <li><strong>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{article.headline}<span aria-hidden="true"> ↗</span></a> : article.headline}</strong>
    <span>{article.source} · {stamp(article.publishedAt)} ET</span>
    <small style={{color: sentiment.score > 0 ? '#41c9a6' : sentiment.score < 0 ? '#ef787b' : '#a4afbb'}}>Sentimiento {sentiment.label}{sentiment.earnings ? ' · resultados / earnings' : ''} · reglas de titulares{sentiment.matches.length ? `: ${sentiment.matches.join(', ')}` : ': sin términos reconocidos'}</small>
    {article.availableAt !== article.publishedAt && <small>Versión disponible: {stamp(article.availableAt)} ET</small>}
  </li>;
}

export function ChartNewsRail({ groups, left, right, y, selectedId, detailsId, onSelect, demo }: {
  groups: ChartNewsGroup[]; left: number; right: number; y: number; selectedId: string | null; detailsId: string; onSelect: (id: string) => void; demo: boolean;
}) {
  return <g className="chart-news-rail" data-news-rail="true" aria-label="Línea temporal de noticias">
    <text x={left} y={y - 18} fill="#d6b66c" fontSize="11">{demo ? 'NOTICIAS · DEMO SINTÉTICA' : 'NOTICIAS · ALPACA'}</text>
    <line x1={left} x2={right} y1={y} y2={y} stroke="#d6b66c" strokeWidth="1" opacity=".5"/>
    {groups.map(group => {
      const active = group.id === selectedId;
      const score = group.articles.reduce((sum, article) => sum + headlineSentiment(article.headline).score, 0) / group.articles.length;
      const color = score > 0 ? '#41c9a6' : score < 0 ? '#ef787b' : '#d6b66c';
      const description = `${group.articles.length} ${group.articles.length === 1 ? 'noticia' : 'noticias'} · ${stamp(group.articles[0].publishedAt)} ET${group.outsideSession ? ' · incluye publicaciones fuera de sesión' : ''}`;
      return <g key={group.id} role="button" tabIndex={0} aria-label={description} aria-pressed={active} aria-controls={detailsId}
        data-news-marker={group.id} data-news-count={group.articles.length} transform={`translate(${group.x},${y})`}
        onClick={event => { event.stopPropagation(); onSelect(group.id); }}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(group.id); } }}>
        <title>{`${description}\n${group.articles.slice(0, 3).map(article => article.headline).join('\n')}${group.articles.length > 3 ? '\nPulsa para consultar todos los titulares del grupo.' : ''}`}</title>
        <rect x="-14" y="-15" width="28" height="30" fill="transparent"/>
        <rect className="news-marker-box" data-sentiment={score > 0 ? 'positivo' : score < 0 ? 'negativo' : 'neutral'} x="-11" y="-10" width="22" height="20" rx="4" fill={active ? color : '#20251e'} stroke={color} strokeWidth={active ? 2 : 1}/>
        <text y="4" textAnchor="middle" fill={active ? '#10161b' : '#eed799'} fontSize="11" fontWeight="700" pointerEvents="none">{group.articles.length === 1 ? 'N' : group.articles.length > 99 ? '99+' : group.articles.length}</text>
      </g>;
    })}
  </g>;
}

export function ChartNewsDetails({ state, groups, selectedId, id, demo }: {
  state?: ChartNewsState; groups: ChartNewsGroup[]; selectedId: string | null; id: string; demo: boolean;
}) {
  const group = groups.find(item => item.id === selectedId), snapshot = state?.snapshot;
  const visible = groups.flatMap(item => item.articles).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return <section className="chart-news-details" id={id} aria-label="Noticias de la gráfica">
    <div className="chart-news-heading"><strong><i aria-hidden="true"/>Noticias de la gráfica</strong>
      {!demo && state && <button type="button" className="secondary-button" disabled={state.loading || state.loadingMore} onClick={state.reload}>Actualizar noticias</button>}
    </div>
    {demo && !snapshot ? <p>Selecciona Alpaca para consultar noticias reales. Esta gráfica utiliza velas de demostración.</p> : <>
      {demo && <p>Los titulares identificados como DEMO son ejemplos sintéticos para probar el sentimiento. No son publicaciones reales.</p>}
      {state?.loading && <p role="status">Consultando noticias del rango seleccionado…</p>}
      {state?.error && <p role="alert">{state.error} {state.error.includes('Inicia sesión') && <a href="/signin-with-chatgpt?return_to=%2F" target="_self">Iniciar sesión para consultar noticias</a>}</p>}
      {snapshot && <>
        <p className="chart-news-coverage">{demo ? 'DEMO sintética' : 'Alpaca'} · {visible.length} titulares en esta vista de {snapshot.news.articles.length} cargados · consulta {snapshot.start} → {snapshot.end} · corte {stamp(snapshot.asOf)} ET.</p>
        {!snapshot.news.complete && <p className="chart-news-partial" role="status">Cobertura parcial: quedan noticias por consultar o la fuente interrumpió la respuesta. {snapshot.news.warnings.join(' ')}</p>}
        {!visible.length && <p>{snapshot.news.complete ? 'No se recibieron noticias para las fechas de esta vista.' : 'No hay titulares cargados en esta vista; carga noticias anteriores o reduce el periodo.'}</p>}
        {!!visible.length && <p>Las marcas N contienen una noticia; los números agrupan publicaciones cercanas. Pasa el cursor para ver titulares o pulsa una marca para abrir sus detalles.</p>}
        {group && <div className="chart-news-selection" aria-live="polite"><h3>{group.articles.length} {group.articles.length === 1 ? 'noticia seleccionada' : 'noticias seleccionadas'}</h3>
          {group.outsideSession && <p>Este grupo incluye publicaciones en fechas u horas sin velas. Se sitúan entre sesiones o en el extremo del rango; consulta la hora exacta.</p>}
          <ul>{[...group.articles].reverse().map(article => <Article key={article.id} article={article}/>)}</ul>
        </div>}
        {!!visible.length && <details><summary>Consultar todos los titulares de la vista · {visible.length}</summary><ul>{visible.map(article => <Article key={article.id} article={article}/>)}</ul></details>}
        {snapshot.nextPageToken && <button type="button" className="secondary-button" disabled={state?.loadingMore} onClick={state?.loadMore}>{state?.loadingMore ? 'Cargando noticias…' : 'Cargar noticias anteriores'}</button>}
      </>}
      {!snapshot && !state?.loading && !state?.error && <p>Noticias todavía no disponibles para este rango.</p>}
      <p>Verde: sentimiento positivo; rojo: negativo; amarillo: neutral. El core «Noticias y earnings» incorpora el sentimiento reciente a la confluencia y al escenario cuando está activo. Las marcas no atribuyen movimientos históricos a una noticia.</p>
    </>}
  </section>;
}
