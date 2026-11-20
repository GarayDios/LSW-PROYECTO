"use client";

import { useCallback, useEffect, useState } from 'react';
import type { ResearchSnapshot } from '../../../cores/compartido/research-model';

/** An aborted or older query must never replace the selected company's data. */
export function useCompanyResearch({ enabled, symbol, start, end, cutoff }: {
  enabled: boolean; symbol: string; start: string; end: string; cutoff?: string;
}) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; research: ResearchSnapshot | null; loading: boolean; error: string }>({ key: '', research: null, loading: false, error: '' });
  const key = `${symbol}|${start}|${end}|${cutoff}`;
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!enabled) { setState({ key, research: null, loading: false, error: '' }); return; }
    const controller = new AbortController();
    setState({ key, research: null, loading: true, error: '' });
    const query = new URLSearchParams({ symbol, start, end, ...(cutoff ? { cutoff } : {}) });
    void (async () => {
      try {
        const response = await fetch(`/api/research/company?${query}`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' });
        const value = await response.json() as ResearchSnapshot & { research?: ResearchSnapshot; error?: { message?: string } };
        if (!response.ok) throw new Error(value.error?.message || 'No se pudieron consultar las variables de la empresa.');
        const research = value.research ?? value;
        if (research.symbol !== symbol || !research.market || !research.quality) throw new Error('La fuente devolvió una respuesta de investigación incompleta.');
        if (!controller.signal.aborted) setState({ key, research, loading: false, error: '' });
      } catch (cause) {
        if (!controller.signal.aborted) setState({ key, research: null, loading: false, error: cause instanceof Error ? cause.message : 'La consulta de variables no está disponible.' });
      }
    })();
    return () => controller.abort();
  }, [enabled, key, symbol, start, end, cutoff, revision]);
  return { research: enabled && state.key === key ? state.research : null, loading: enabled && (state.key !== key || state.loading), error: enabled && state.key === key ? state.error : '', reload };
}
