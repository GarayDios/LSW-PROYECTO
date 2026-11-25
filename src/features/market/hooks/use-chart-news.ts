"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NewsTimelinePage } from '../../../cores/compartido/research-model';

export type ChartNewsState = {
  snapshot: NewsTimelinePage | null; loading: boolean; loadingMore: boolean; error: string;
  reload: () => void; loadMore: () => void;
};
type State = { key: object | null; snapshot: NewsTimelinePage | null; loading: boolean; loadingMore: boolean; error: string };

/** Loading an older page cannot replace a different company's selected range. */
export function useChartNews({ enabled, symbol, start, end,provider='alpaca' }: { enabled: boolean; symbol: string; start: string; end: string;provider?:'alpaca'|'webull' }): ChartNewsState {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({ key: null, snapshot: null, loading: false, loadingMore: false, error: '' });
  const paging = useRef<AbortController | null>(null);
  const key = useMemo(() => ({ enabled, symbol, start, end, revision,provider }), [enabled, symbol, start, end, revision,provider]);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const read = useCallback(async (controller: AbortController, token?: string, cutoff?: string): Promise<NewsTimelinePage> => {
    const query = new URLSearchParams({ symbol, start, end, provider,...(token ? { pageToken: token } : {}), ...(cutoff ? { cutoff } : {}) });
    const response = await fetch(`/api/research/news?${query}`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' });
    const body = await response.json() as NewsTimelinePage & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? 'No se pudieron consultar las noticias.');
    if (body.symbol !== symbol || body.start !== start || body.end !== end || !Number.isFinite(Date.parse(body.asOf))
      || !Array.isArray(body.news?.articles) || cutoff && body.asOf !== cutoff) throw new Error('La fuente devolvió noticias de otro rango o una respuesta incompleta.');
    return body;
  }, [symbol, start, end,provider]);
  useEffect(() => {
    paging.current?.abort(); paging.current = null;
    if (!enabled) return;
    const controller = new AbortController();
    void read(controller).then(snapshot => {
      if (!controller.signal.aborted) setState({ key, snapshot, loading: false, loadingMore: false, error: '' });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, snapshot: null, loading: false, loadingMore: false, error: error instanceof Error ? error.message : 'Consulta de noticias no disponible.' });
    });
    return () => { controller.abort(); paging.current?.abort(); paging.current = null; };
  }, [enabled, key, read]);
  const loadMore = useCallback(() => {
    const previous = state.key === key ? state.snapshot : null;
    if (!enabled || !previous?.nextPageToken || paging.current) return;
    const controller = new AbortController(); paging.current = controller;
    setState(value => value.key === key ? { ...value, loadingMore: true, error: '' } : value);
    void read(controller, previous.nextPageToken, previous.asOf).then(page => {
      if (controller.signal.aborted) return;
      if (page.nextPageToken === previous.nextPageToken) throw new Error('La fuente repitió la continuación de noticias. Actualiza la consulta para reintentar.');
      const articles = [...new Map([...previous.news.articles, ...page.news.articles].map(article => [article.id, article])).values()]
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id));
      setState(value => value.key === key ? { key, snapshot: { ...page, news: { ...page.news, articles } }, loading: false, loadingMore: false, error: '' } : value);
    }).catch(error => {
      if (!controller.signal.aborted) setState(value => value.key === key ? { ...value, loadingMore: false, error: error instanceof Error ? error.message : 'No se pudieron cargar más noticias.' } : value);
    }).finally(() => { if (paging.current === controller) paging.current = null; });
  }, [enabled, key, state.key, state.snapshot, read]);
  const current = enabled && state.key === key;
  return { snapshot: current ? state.snapshot : null, loading: enabled && (!current || state.loading), loadingMore: current && state.loadingMore, error: current ? state.error : '', reload, loadMore };
}
