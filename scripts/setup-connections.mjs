import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Dry-run by default; migrations are scoped to an existing configured project. */
export async function setupConnections({ environment, apply = false, fetcher = fetch, root = process.cwd(), setupMongo } = {}) {
  const env = environment ?? process.env;
  const migration = path.resolve(root, 'supabase/migrations/202611130001_terminal_persistence.sql');
  const sql = await readFile(migration, 'utf8'), sha256 = createHash('sha256').update(sql).digest('hex');
  const result = { apply, supabase: { status: 'missing_config', migration: path.basename(migration), sha256 }, mongodb: { status: env.MONGODB_URI ? 'configured' : 'missing_config' }, fred: { status: env.FRED_API_KEY ? 'configured' : 'missing_config' }, sec: { status: env.SEC_USER_AGENT ? 'configured' : 'missing_config' } };
  let projectRef = env.SUPABASE_PROJECT_REF?.trim();
  if (!projectRef && env.SUPABASE_URL) {
    try { projectRef = new URL(env.SUPABASE_URL).hostname.split('.')[0]; } catch { throw Error('supabase_url_invalid'); }
  }
  if (projectRef && env.SUPABASE_ACCESS_TOKEN) {
    if (!/^[a-z0-9]{10,40}$/.test(projectRef) || /[\r\n]/.test(env.SUPABASE_ACCESS_TOKEN)) throw Error('supabase_management_configuration_invalid');
    result.supabase.status = 'ready_to_apply';
    if (apply) {
      // A migration ledger prevents replaying schema creation against an existing project.
      const ledger = `create schema if not exists tepic_migrations; create table if not exists tepic_migrations.applied(version text primary key,sha256 text not null,applied_at timestamptz default now());`;
      const escaped = sql.replaceAll('$tepic_migration$', '$tepic_migration_collision$');
      const query = `begin; select pg_advisory_xact_lock(hashtext('tepic_terminal_migration')); ${ledger} do $tepic_migration$ begin if exists(select 1 from tepic_migrations.applied where version='202611130001' and sha256 <> '${sha256}') then raise exception 'Migration checksum mismatch'; end if; if not exists(select 1 from tepic_migrations.applied where version='202611130001') then ${escaped} insert into tepic_migrations.applied(version,sha256) values('202611130001','${sha256}'); end if; end $tepic_migration$; commit;`;
      const response = await fetcher(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }), redirect: 'manual', signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw Error('supabase_migration_rejected');
      result.supabase.status = 'applied_or_previously_applied';
    }
  } else if (env.SUPABASE_URL) result.supabase.status = 'management_access_required';
  if (apply && env.MONGODB_URI) {
    if (setupMongo) await setupMongo(env);
    else {
      const { MongoClient } = await import('mongodb');
      const { setupSnapshotCollection } = await import('../services/mongo-api/indexes.ts');
      const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
      try { await client.connect(); await setupSnapshotCollection(client.db(env.MONGODB_DATABASE || 'tepic_terminal')); }
      finally { await client.close(); }
    }
    result.mongodb.status = 'collection_and_indexes_ready';
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    for (const filename of ['.env.local', '.env.mongo.local']) if (existsSync(filename)) process.loadEnvFile(filename);
    const result = await setupConnections({ apply: process.argv.includes('--apply') });
    console.log(JSON.stringify(result, null, 2));
    if (process.argv.includes('--report')) {
      const target = path.resolve('.sites-runtime/connections-readiness.json');
      const { mkdir } = await import('node:fs/promises'); await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    }
  } catch { console.error('No se completaron las conexiones. Revisa los permisos, la migracion y las variables privadas; no se publican diagnosticos sensibles.'); process.exitCode = 1; }
}
