"use client";

import { useEffect, useMemo, useState } from 'react';
import { generateHistory, historyIssue, type Candle } from '../chart-history';

export type MarketSource = 'demo' | 'alpaca'|'webull';
export type MarketHistory = {
  source: 'alpaca'|'webull'; feed: 'iex' | 'sip'|'sandbox'; symbol: string; interval: string; start: string; end: string;
  bars: Candle[]; adjustment: 'split'|'unverified'|'forward'|'unadjusted'; asOf: string;
  coverage: { firstBar: string | null; lastBar: string | null; requestedStart: string; requestedEnd: string };
  warnings: string[];
};
type CompanyIdentity = { source: 'alpaca'; symbol: string; name: string; exchange: string; tradable: boolean; assetClass: string };
type RemoteState = { key: string; bars: Candle[]; meta: MarketHistory | null; company: CompanyIdentity | null; loading: boolean; error: string };

function validCandle(value: unknown): value is Candle {
  if (!value || typeof value !== 'object') return false;
  const candle = value as Candle;
  return [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
    && candle.open > 0 && candle.close > 0 && candle.low > 0 && candle.volume >= 0
    && candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close);
}

/** Remote failures stay visible; a failed real-data query never becomes a demo series. */
export function useMarketHistory(options: { source: MarketSource; symbol: string; price: number; start: string; end: string; interval: string }) {
  const { source, symbol, price, start, end, interval } = options;
  const [revision, setRevision] = useState(0);
  const key = `${source}:${symbol}:${start}:${end}:${interval}:${revision}`;
  const [remote, setRemote] = useState<RemoteState>({ key: '', bars: [], meta: null, company: null, loading: false, error: '' });
  const demo = useMemo(() => source === 'demo' ? generateHistory(symbol, price, start, end, interval) : [], [source, symbol, price, start, end, interval]);
  useEffect(() => {
    if (source === 'demo') return;
    const controller = new AbortController();
    const issue = historyIssue(start, end);
    if (issue) {
      queueMicrotask(() => { if (!controller.signal.aborted) setRemote({ key, bars: [], meta: null, company: null, loading: false, error: issue }); });
      return () => controller.abort();
    }
    queueMicrotask(()=>{if(!controller.signal.aborted)setRemote({ key, bars: [], meta: null, company: null, loading: true, error: '' });});
    const query = new URLSearchParams(source==='webull'?{action:'market-history',symbol,start,end,interval}:{source:'alpaca',symbol,start,end,interval});
    void (async () => {
      try {
        const response = await fetch(`${source==='webull'?'/api/webull':'/api/market/history'}?${query}`, { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
        const value = await response.json() as MarketHistory & { error?: { message?: string } };
        if (!response.ok) throw new Error(value.error?.message || 'No se pudo consultar el histórico real. Revisa la conexión de Alpaca en el servidor.');
        if (value.source !== source || value.symbol !== symbol || value.interval !== interval || !(source==='webull'?['sandbox']:['iex','sip']).includes(value.feed) || !Array.isArray(value.warnings) || !value.warnings.every(warning => typeof warning === 'string') || !Array.isArray(value.bars) || !value.bars.every(validCandle)) throw new Error('El proveedor devolvió un histórico no válido.');
        if (controller.signal.aborted) return;
        setRemote({ key, bars: value.bars, meta: value, company: null, loading: false, error: '' });
        if(source==='webull')return;
        try {
          const identityResponse = await fetch(`/api/market/company?symbol=${encodeURIComponent(symbol)}`, { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
          if (!identityResponse.ok) return;
          const identity = await identityResponse.json() as CompanyIdentity;
          if (!controller.signal.aborted && identity.symbol === symbol && typeof identity.name === 'string') setRemote(previous => previous.key === key ? { ...previous, company: identity } : previous);
        } catch { /* Company identity is optional; it does not replace or invalidate the bars. */ }
      } catch (error) {
        if (!controller.signal.aborted) setRemote({ key, bars: [], meta: null, company: null, loading: false, error: error instanceof Error ? error.message : 'No se pudo consultar el histórico real.' });
      }
    })();
    return () => controller.abort();
  }, [source, symbol, start, end, interval, key]);
  const current = remote.key === key ? remote : { bars: [], meta: null, company: null, loading: source !== 'demo', error: '' };
  return {
    bars: source === 'demo' ? demo : current.bars,
    loading: source !== 'demo' && current.loading,
    error: source === 'demo' ? historyIssue(start, end) : current.error,
    meta: source !== 'demo' ? current.meta : null,
    company: source !== 'demo' ? current.company : null,
    reload: () => setRevision(value => value + 1),
  };
}
