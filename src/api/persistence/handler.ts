import { MongoPrimaryRepository } from '../../db/mongodb/primary.ts';
import { z } from 'zod';
import { DatabaseConfigError, type SelectedDatabaseConfig } from '../../db/config.ts';
import { MAX_STATE_BYTES, terminalStateSchema } from '../../db/state.ts';
import { flushAnalysisArchive } from '../../db/mongodb/archive.ts';
import { PersistenceError, SupabaseRepository, type PersistenceOwner } from '../../db/supabase/client.ts';

type Repository = Pick<SupabaseRepository, 'load' | 'save' | 'pending' | 'acknowledge'>;
type Dependencies = {
  config(request?: Request): SelectedDatabaseConfig | null;
  owner(): Promise<PersistenceOwner | null>;
  repository?(config: SelectedDatabaseConfig): Repository;
  fetcher?: typeof fetch;
};
const saveSchema = z.object({ expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), state: terminalStateSchema }).strict();
const MAX_REQUEST_BYTES = MAX_STATE_BYTES + 4096;
const responseHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: responseHeaders });
class HttpFailure extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

function requireSameOrigin(request: Request): void {
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new HttpFailure(403, 'origin_rejected', 'La solicitud debe proceder del propio terminal.');
  }
}

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpFailure(415, 'invalid_content_type', 'Envía los datos en formato JSON.');
  if (Number(request.headers.get('Content-Length')) > MAX_REQUEST_BYTES) throw new HttpFailure(413, 'state_too_large', 'Los datos superan el tamaño permitido.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpFailure(400, 'invalid_state', 'Faltan los datos que deseas guardar.');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) { await reader.cancel(); throw new HttpFailure(413, 'state_too_large', 'Los datos superan el tamaño permitido.'); }
      chunks.push(value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch (error) {
    if (error instanceof HttpFailure) throw error;
    throw new HttpFailure(400, 'invalid_state', 'El archivo JSON no es válido.');
  } finally { reader.releaseLock(); }
}

function failure(error: unknown): Response {
  if (error instanceof HttpFailure) return json({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof PersistenceError) return json({ error: { code: error.code, message: error.message } }, error.code === 'revision_conflict' ? 409 : 503);
  if (error instanceof DatabaseConfigError) return json({ error: { code: 'persistence_unavailable', message: 'El guardado en la nube no está disponible. Puedes conservar tus cambios en este navegador.' } }, 503);
  return json({ error: { code: 'persistence_unavailable', message: 'No se pudieron guardar o recuperar los datos. Tus cambios locales se conservan.' } }, 503);
}

/** Identity always comes from the authenticated server request, never the JSON body. */
export function createPersistenceHandlers(dependencies: Dependencies) {
  async function context(request?: Request) {
    const config = dependencies.config(request);
    if (!config) return null;
    const owner = await dependencies.owner();
    if (!owner) throw new HttpFailure(401, 'auth_required', 'Inicia sesión para guardar tus datos en la nube.');
    return { config, owner, repository: dependencies.repository?.(config) ?? ('provider' in config ? new MongoPrimaryRepository(config.connection, dependencies.fetcher) : new SupabaseRepository(config, dependencies.fetcher)) };
  }
  return {
    async GET(request?: Request): Promise<Response> {
      try {
        const current = await context(request);
        if (!current) return json({ mode: 'local' });
        const { owner, repository, config } = current;
        await flushAnalysisArchive(repository, owner.id, config.mongoBridge, dependencies.fetcher);
        const saved = await repository.load(owner.id);
        return json({ mode: 'remote', owner: { id: owner.id, displayName: owner.displayName }, revision: saved.revision, state: saved.state, archive: { enabled: Boolean(config.mongoBridge), pending: saved.pendingArchives } });
      } catch (error) { return failure(error); }
    },
    async PUT(request: Request): Promise<Response> {
      try {
        requireSameOrigin(request);
        const current = await context(request);
        if (!current) throw new HttpFailure(503, 'persistence_unavailable', 'El terminal está usando almacenamiento local.');
        const parsed = saveSchema.safeParse(await readBody(request));
        if (!parsed.success) throw new HttpFailure(400, 'invalid_state', 'Revisa el formato de las listas, órdenes y ciclos.');
        if (new TextEncoder().encode(JSON.stringify(parsed.data.state)).byteLength > MAX_STATE_BYTES) throw new HttpFailure(413, 'state_too_large', 'Los datos superan el tamaño permitido.');
        const { repository, owner, config } = current;
        const revision = await repository.save(owner, parsed.data.expectedRevision, parsed.data.state);
        await flushAnalysisArchive(repository, owner.id, config.mongoBridge, dependencies.fetcher);
        // A failed status read after a committed write must still report the successful revision.
        let pending: number | null = null;
        try { pending = (await repository.load(owner.id)).pendingArchives; } catch { /* status can be refreshed later */ }
        return json({ revision, archive: { enabled: Boolean(config.mongoBridge), pending } });
      } catch (error) { return failure(error); }
    },
  };
}
