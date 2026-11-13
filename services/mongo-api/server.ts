import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { MAX_BODY_BYTES, ownerIdSchema, snapshotIdSchema, snapshotInputSchema, SnapshotConflictError, type SnapshotRepository } from './model.ts';

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function respond(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

function authorized(request: IncomingMessage, expected: Buffer): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const received = Buffer.from(header.slice(7));
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'json_required');
  const length = request.headers['content-length'];
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new HttpError(413, 'payload_too_large');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let rejected = false;
    request.on('data', (chunk: Buffer) => {
      if (rejected) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        rejected = true;
        chunks.length = 0;
        reject(new HttpError(413, 'payload_too_large'));
      } else chunks.push(Buffer.from(chunk));
    });
    request.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { reject(new HttpError(400, 'invalid_json')); }
    });
    request.on('error', () => reject(new HttpError(400, 'invalid_body')));
    request.on('aborted', () => reject(new HttpError(400, 'invalid_body')));
  });
}

export function createSnapshotServer(options: { token: string; repository: SnapshotRepository }) {
  const token = Buffer.from(options.token);
  if (token.length < 32 || token.length > 512 || /[\r\n]/.test(options.token)) throw new Error('MONGO_BRIDGE_TOKEN must contain between 32 and 512 bytes without line breaks.');
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://bridge.local');
      if (url.pathname === '/healthz' && request.method === 'GET') return respond(response, 200, { status: 'ok' });
      if (!authorized(request, token)) return respond(response, 401, { error: 'unauthorized' });
      if (url.pathname === '/snapshots' && request.method === 'PUT') {
        const parsed = snapshotInputSchema.safeParse(await readJson(request));
        if (!parsed.success) throw new HttpError(400, 'invalid_snapshot');
        const result = await options.repository.put(parsed.data);
        return respond(response, result === 'created' ? 201 : 200, { id: parsed.data.id, status: result });
      }
      if (request.method === 'GET' && (url.pathname === '/snapshots' || url.pathname.startsWith('/snapshots/'))) {
        const owner = ownerIdSchema.safeParse(url.searchParams.get('ownerId'));
        if (!owner.success) throw new HttpError(400, 'invalid_owner');
        if (url.pathname === '/snapshots') {
          const rawLimit = url.searchParams.get('limit') ?? '20';
          if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) throw new HttpError(400, 'invalid_limit');
          return respond(response, 200, { snapshots: await options.repository.list(owner.data, Number(rawLimit)) });
        }
        const id = snapshotIdSchema.safeParse(url.pathname.slice('/snapshots/'.length));
        if (!id.success) throw new HttpError(400, 'invalid_snapshot_id');
        const snapshot = await options.repository.get(owner.data, id.data);
        return snapshot ? respond(response, 200, { snapshot }) : respond(response, 404, { error: 'not_found' });
      }
      return respond(response, 404, { error: 'not_found' });
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      if (error instanceof HttpError) return respond(response, error.status, { error: error.code });
      if (error instanceof SnapshotConflictError) return respond(response, 409, { error: 'snapshot_conflict' });
      // No driver errors, connection strings, tokens or internal stack traces
      // are returned to the caller (or printed to a public application log).
      return respond(response, 503, { error: 'archive_unavailable' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

async function main(): Promise<void> {
  const { createMongoRepository, mongoClientFromEnvironment } = await import('./repository.ts');
  const { client, databaseName } = mongoClientFromEnvironment();
  const port = Number(process.env.MONGO_BRIDGE_PORT ?? '8788');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Configure MONGO_BRIDGE_PORT.');
  const server = createSnapshotServer({ token: process.env.MONGO_BRIDGE_TOKEN ?? '', repository: createMongoRepository(client.db(databaseName)) });
  try {
    await client.connect();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, process.env.MONGO_BRIDGE_HOST ?? '127.0.0.1', resolve);
    });
    console.log(`Mongo snapshot bridge listening on port ${port}.`);
  } catch {
    await client.close();
    throw new Error('Mongo snapshot bridge could not start. Check configuration and database connectivity.');
  }
  const shutdown = () => {
    server.close(() => { void client.close().finally(() => process.exit(0)); });
    server.closeIdleConnections();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Mongo snapshot bridge could not start. Check environment configuration, collection setup and connectivity.');
    process.exitCode = 1;
  });
}
