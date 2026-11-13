"use client";

import type { PersistenceSnapshot, TerminalSyncController } from './sync-controller.ts';
import './storage-status.css';

export default function StorageStatus({ storage, controller }: { storage: PersistenceSnapshot; controller: TerminalSyncController }) {
  const label = {
    loading: 'Cargando datos guardados…', local: 'Guardado en este navegador', 'needs-import': 'Prepara tus datos para esta cuenta',
    saving: 'Guardando cambios…', synced: 'Datos sincronizados', error: 'Cambios pendientes de sincronizar',
    conflict: 'Hay cambios en otra sesión', 'auth-required': 'Inicia sesión para sincronizar',
  }[storage.phase];
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([controller.draftForDownload()], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'tepic-borrador.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className={`persistence-status persistence-${storage.phase}`} aria-label="Estado del guardado">
    <div role="status" aria-live="polite"><strong>{label}</strong>{storage.owner && <span> · {storage.owner.displayName}</span>}
      {storage.message && <p>{storage.message}</p>}
      {!storage.storageAvailable && <p>No pudimos conservar una copia en este navegador. Exporta los datos que quieras mantener.</p>}
      {storage.phase === 'needs-import' && <p>Importa las listas y simulaciones de este navegador o comienza con una cuenta nueva. Los datos del navegador se conservarán.</p>}
      {storage.phase === 'synced' && storage.hasDraft && <p>{storage.canRestoreDraft ? 'Hay un borrador de esta cuenta que todavía puedes recuperar.' : 'Hay un borrador anterior de esta cuenta que todavía puedes descargar.'}</p>}
      {storage.archiveEnabled && storage.pendingArchives > 0 && <p>Datos guardados. {storage.pendingArchives} {storage.pendingArchives === 1 ? 'copia de análisis pendiente' : 'copias de análisis pendientes'}.</p>}
    </div>
    <div className="persistence-actions">
      {storage.phase === 'needs-import' && <><button className="secondary-button" disabled={!storage.hasLocalImport} onClick={() => controller.chooseInitialState(true)}>Importar datos de este navegador</button><button className="primary-button small" onClick={() => controller.chooseInitialState(false)}>Empezar sin importar</button></>}
      {storage.phase === 'error' && <button className="secondary-button" onClick={controller.retry}>Reintentar</button>}
      {storage.phase === 'conflict' && <button className="secondary-button" onClick={controller.reloadRemote}>Cargar datos de la cuenta</button>}
      {storage.hasDraft && <button className="secondary-button" onClick={downloadDraft}>Descargar borrador</button>}
      {storage.canRestoreDraft && <button className="secondary-button" onClick={controller.restoreDraft}>Recuperar borrador</button>}
      {storage.phase === 'auth-required' && <a className="secondary-button" href="/signin-with-chatgpt?return_to=%2F" target="_top">Iniciar sesión</a>}
    </div>
  </section>;
}
