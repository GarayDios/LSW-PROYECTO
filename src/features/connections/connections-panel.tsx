"use client";
import { useRef, useState } from 'react';
import { ArrowUpRight, Check, Database, Plug, RefreshCw, ShieldCheck } from 'lucide-react';
import type { useTerminalPersistence, StorageProvider } from '../persistence/use-terminal-persistence';
import type { useConnections } from './use-connections';
import type { ConnectionRecord } from '../../api/connections/handler';
import './connections.css';
type Props = { state: ReturnType<typeof useConnections>; storage: ReturnType<typeof useTerminalPersistence>; broker: 'alpaca' | 'webull'; onBroker: (broker: 'alpaca' | 'webull') => void; onTrade: () => void };
const labels = { configured: 'Configurado · por verificar', missing_config: 'Sin configurar', invalid_config: 'Revisar configuración', auth_required: 'Requiere sesión', ready: 'Lectura verificada', error: 'No disponible', manual: 'Carga manual disponible' };
const storageLabels = { loading: 'consultando', local: 'guardado local', synced: 'sincronizado', saving: 'guardando', 'auth-required': 'inicia sesión', 'needs-import': 'elige cómo empezar', conflict: 'conflicto pendiente', error: 'cambios pendientes' };
export default function ConnectionsPanel({ state, storage, broker, onBroker, onTrade }: Props) {
  const [probes, setProbes] = useState<Record<string, ConnectionRecord>>({}), [busy, setBusy] = useState('');
  const [probeError, setProbeError] = useState(''); const sequence = useRef(0);
  const records = state.data?.connections ?? [], blocked = storage.phase === 'saving' || storage.phase === 'loading' || storage.hasDraft;
  const probe = async (id: string) => {
    const version = ++sequence.current; setBusy(id); setProbeError('');
    try {
      const response = await fetch(`/api/connections?probe=${id}`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json() as { connections?: ConnectionRecord[]; error?: { message?: string } };
      if (!response.ok) throw Error(data.error?.message ?? 'No se pudo comprobar la base.');
      const record = data.connections?.find(c => c.id === id);
      if (record && version === sequence.current) setProbes(previous => ({ ...previous, [id]: record }));
    } catch (e) { if (version === sequence.current) setProbeError(e instanceof Error ? e.message : 'Comprobación no disponible.'); }
    finally { if (version === sequence.current) setBusy(''); }
  };
  return <div className="connections-page">
    <section className="panel connections-intro"><div><span className="eyebrow">TU ESPACIO CONECTADO</span><h2>Conexiones</h2><p>Consulta tus proveedores, elige la base de esta sesión y selecciona el bróker principal.</p></div><button className="secondary-button" disabled={state.loading} onClick={() => { sequence.current++;setProbes({});setBusy('');void state.refresh(); }}><RefreshCw size={14} className={state.loading ? 'spin' : ''}/>Actualizar conexiones</button></section>
    {state.error && <p role="alert" className="form-error">{state.error}</p>}
    {!state.data?.identity && <div className="panel connection-session"><ShieldCheck size={20}/><div><strong>Inicia sesión para verificar tus conexiones</strong><p>El análisis demo está disponible. Las cuentas y bases remotas requieren tu sesión.</p></div><a className="primary-button small" href="/signin-with-chatgpt?return_to=%2F" target="_top">Iniciar sesión<ArrowUpRight size={13}/></a></div>}
    <section aria-label="Bases de datos"><div className="connections-section-heading"><Database size={17}/><h2>Almacenamiento de la sesión</h2><span className="neutral-badge">{storage.provider === 'local' ? 'Navegador' : storage.provider === 'supabase' ? 'PostgreSQL / Supabase' : 'MongoDB'}</span></div><div className="connection-grid">
      {(['local', 'supabase', 'mongodb'] as const).map(id => {
        const record = probes[id] ?? records.find(c => c.id === id), active = storage.provider === id;
        return <article className={`panel connection-card ${active ? 'connection-selected' : ''}`} key={id}>
          <div className="connection-card-title"><span className="connection-logo"><Database size={22}/></span><div><h3>{id === 'local' ? 'Este navegador' : record?.title ?? (id === 'supabase' ? 'PostgreSQL / Supabase' : 'MongoDB')}</h3><span className="neutral-badge">{active ? 'Sesión activa' : id === 'local' ? 'Disponible' : record ? labels[record.status] : 'Consultando…'}</span></div></div>
          <p>{id === 'local' ? 'Listas y simulaciones guardadas en este dispositivo.' : record?.message ?? 'Consultando configuración…'}</p>
          <small>{active ? `Estado del guardado: ${storageLabels[storage.phase]}` : 'Cada base conserva sus propios datos.'}</small>
          <div className="connection-actions">{id !== 'local' && <button className="secondary-button" disabled={!!busy || !state.data?.identity || !record || ['missing_config','invalid_config'].includes(record.status)} onClick={() => void probe(id)}>{busy === id ? 'Comprobando…' : 'Comprobar lectura'}</button>}<button className={active ? 'secondary-button' : 'primary-button small'} disabled={active || blocked || id !== 'local' && (!record || !['configured','ready'].includes(record.status))} onClick={() => storage.changeProvider(id as StorageProvider)}>{active ? <><Check size={13}/>Base activa</> : 'Usar esta base'}</button></div>
          {record && <details><summary>Configuración y capacidades</summary><p>{record.capabilities.join(' · ')}</p><p>Configura en el servidor: {record.setup.join(', ')}. Las credenciales no se muestran en el navegador.</p></details>}
        </article>;
      })}</div><p className="connection-note">Cambiar de base recarga el terminal y abre sus datos. No copia ni borra los registros de otra base.{blocked ? ' Resuelve el guardado pendiente antes de cambiar.' : ''}</p>{(probeError || storage.providerError) && <p role="alert" className="form-error">{probeError || storage.providerError}</p>}</section>
    <section aria-label="Cuentas de corretaje"><div className="connections-section-heading"><ShieldCheck size={17}/><h2>Tus brókers de práctica</h2></div><div className="connection-grid broker-connection-grid">{(['alpaca','webull'] as const).map(id => {
      const record = records.find(c => c.id === id), current = state.data?.[id], active = broker === id;
      const statusLabel = state.loading ? 'Verificando…' : current?.connected ? 'Cuenta verificada' : id === 'webull' && state.data?.webull.configured === false ? 'Sin configurar' : record ? labels[record.status] : 'Sin verificar';
      return <article key={id} className={`panel connection-card ${active ? 'connection-selected' : ''}`}><div className="connection-card-title"><span className="connection-logo">{id === 'alpaca' ? 'ALP' : 'WB'}</span><div><h3>{id === 'alpaca' ? 'Alpaca Paper' : 'Webull Sandbox'}</h3><span className="neutral-badge">{statusLabel}</span></div></div><p>{current?.message ?? record?.message ?? 'Consultando el estado…'}</p><p>{record?.capabilities.join(' · ')}</p><div className="connection-actions"><button className={active ? 'secondary-button' : 'primary-button small'} aria-pressed={active} onClick={() => onBroker(id)}>{active ? <><Check size={13}/>Bróker principal</> : 'Seleccionar como principal'}</button><button className="secondary-button" onClick={() => { onBroker(id);onTrade(); }}>Abrir mesa de órdenes<ArrowUpRight size={13}/></button></div><small>La selección no habilita ni envía órdenes.</small>{record && <details><summary>Configurar conexión</summary><p>{record.setup.join(' · ')}</p></details>}</article>;
    })}</div></section>
    <section className="panel provider-catalog" aria-label="Proveedores de datos"><div className="connections-section-heading"><Plug size={17}/><h2>Proveedores de datos del análisis</h2></div><p>La disponibilidad se verifica por empresa y fecha. Si una fuente falla, se muestra el motivo.</p><div className="table-scroll"><table className="companies-table"><thead><tr><th>Proveedor</th><th>Datos</th><th>Estado</th><th>Configuración</th></tr></thead><tbody>{records.filter(c => c.category === 'data' || c.id === 'alpaca').map(record => <tr key={record.id}><td><strong>{record.title}</strong></td><td>{record.capabilities.join(' · ')}</td><td>{labels[record.status]}</td><td><details><summary>Ver requisitos</summary><p>{record.message}</p><p>{record.setup.join(' · ')}</p></details></td></tr>)}</tbody></table></div></section>
  </div>;
}
