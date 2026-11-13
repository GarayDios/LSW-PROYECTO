"use client";

import { useEffect, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import type { TerminalState } from '../../db/state.ts';
import { TerminalSyncController } from './sync-controller.ts';

export function useTerminalPersistence() {
  const [controller] = useState(() => new TerminalSyncController({
    storage: {
      getItem: key => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: key => window.localStorage.removeItem(key),
    },
    fetcher: (input, init) => fetch(input, init),
  }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  useEffect(() => { void controller.start(); return () => controller.stop(); }, [controller]);

  const setLists: Dispatch<SetStateAction<TerminalState['lists']>> = value => controller.updateField('lists', value);
  const setOrders: Dispatch<SetStateAction<TerminalState['orders']>> = value => controller.updateField('orders', value);
  const setCycles: Dispatch<SetStateAction<TerminalState['cycles']>> = value => controller.updateField('cycles', value);
  const setRate: Dispatch<SetStateAction<TerminalState['rate']>> = value => controller.updateField('rate', value);

  return { ...snapshot, ...snapshot.state, setLists, setOrders, setCycles, setRate, controller };
}
