"use client";

import { useEffect, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { LOCAL_STORAGE_KEY, type TerminalState } from '../../db/state.ts';
import { TerminalSyncController } from './sync-controller.ts';

export type StorageProvider = 'local' | 'supabase' | 'mongodb';
const PROVIDER_KEY = 'tepic:storage-provider';
function selectedProvider(): StorageProvider {
  try { const value = window.localStorage.getItem(PROVIDER_KEY); return value === 'supabase' || value === 'mongodb' ? value : 'local'; }
  catch { return 'local'; }
}
function scopedKey(key: string) {
  return key.startsWith(`${LOCAL_STORAGE_KEY}:user:`) ? `${key}:provider:${selectedProvider()}` : key;
}
export function useTerminalPersistence() {
  const [provider, setProvider] = useState<StorageProvider>('local');
  const [providerError, setProviderError] = useState('');
  useEffect(() => setProvider(selectedProvider()), []);
  const [controller] = useState(() => new TerminalSyncController({
    storage: {
      getItem: key => window.localStorage.getItem(scopedKey(key)),
      setItem: (key, value) => window.localStorage.setItem(scopedKey(key), value),
      removeItem: key => window.localStorage.removeItem(scopedKey(key)),
    },
    fetcher: (input, init) => fetch(`${input}?provider=${selectedProvider()}`, init),
  }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  useEffect(() => { void controller.start(); return () => controller.stop(); }, [controller]);

  const setLists: Dispatch<SetStateAction<TerminalState['lists']>> = value => controller.updateField('lists', value);
  const setOrders: Dispatch<SetStateAction<TerminalState['orders']>> = value => controller.updateField('orders', value);
  const setCycles: Dispatch<SetStateAction<TerminalState['cycles']>> = value => controller.updateField('cycles', value);
  const setRate: Dispatch<SetStateAction<TerminalState['rate']>> = value => controller.updateField('rate', value);

  const changeProvider = (next: StorageProvider) => {
    if (!['local', 'supabase', 'mongodb'].includes(next) || next === provider) return;
    if (snapshot.phase === 'saving' || snapshot.phase === 'loading' || snapshot.hasDraft) {
      setProviderError('Guarda o resuelve los cambios pendientes antes de cambiar de base.'); return;
    }
    try { window.localStorage.setItem(PROVIDER_KEY, next); window.location.reload(); }
    catch { setProviderError('No se pudo conservar la selección en este navegador.'); }
  };
  return { provider, providerError, changeProvider, ...snapshot, ...snapshot.state, setLists, setOrders, setCycles, setRate, controller };
}
