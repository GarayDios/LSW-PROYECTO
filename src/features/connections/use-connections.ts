"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionRecord } from '../../api/connections/handler';
import type {WebullPortfolio} from '../../cores/compartido/webull-model';
import type {WebullAccountSummary} from '../../api/brokers/webull/client';

type Account = { status: string; equity: string; buyingPower: string; cash?: string; accountNumber?: string };
export type ConnectionsSnapshot = {
  identity: { displayName: string; authenticated: boolean } | null; connections: ConnectionRecord[];
  alpaca: { connected: boolean; account: Account | null; message: string };
  webull: { configured?: boolean; connected: boolean; enabled: boolean; message: string; account?: WebullAccountSummary|null;portfolio?:WebullPortfolio|null };
};
async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
  const data = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw Error(data.error?.message ?? 'No fue posible comprobar la conexión.');
  return data;
}
export function useConnections() {
  const [data, setData] = useState<ConnectionsSnapshot | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const current = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    current.current?.abort(); const controller = new AbortController(); current.current = controller;
    setLoading(true); setError('');
    try {
      const summary = await get<Pick<ConnectionsSnapshot, 'identity' | 'connections'>>('/api/connections', controller.signal);
      if (!Array.isArray(summary.connections)) throw Error('La respuesta de conexiones no es válida. Vuelve a consultar.');
      const results = await Promise.allSettled([
        summary.identity ? get<{ account: Account }>('/api/broker/account', controller.signal) : Promise.reject(Error('Inicia sesión para verificar tu cuenta Paper.')),
        summary.identity ? (async()=>{const status=await get<ConnectionsSnapshot['webull']>('/api/webull',controller.signal);if(!status.connected)return status;try{const detail=await get<ConnectionsSnapshot['webull']>('/api/webull?action=account',controller.signal);return {...status,...detail,message:'Cuenta Webull Sandbox verificada. Cada sección muestra su disponibilidad.'};}catch{return {...status,portfolio:null,message:'Cuenta verificada; no se pudieron actualizar sus saldos y posiciones.'};}})() : Promise.reject(Error('Inicia sesión para verificar Webull.')),
      ]);
      if (controller.signal.aborted) return;
      setData({ ...summary,
        alpaca: results[0].status === 'fulfilled' ? { connected: true, account: results[0].value.account, message: 'Cuenta Paper verificada.' } : { connected: false, account: null, message: results[0].reason instanceof Error ? results[0].reason.message : 'Cuenta no disponible.' },
        webull: results[1].status === 'fulfilled' ? results[1].value : { connected: false, enabled: false, message: results[1].reason instanceof Error ? results[1].reason.message : 'Webull no disponible.' },
      });
    } catch (cause) { if (!controller.signal.aborted) { setData(null); setError(cause instanceof Error ? cause.message : 'Conexiones no disponibles.'); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void refresh(); }); return () => { active = false;current.current?.abort(); }; }, [refresh]);
  return { data, error, loading, refresh };
}
