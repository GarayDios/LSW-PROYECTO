import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readDatabaseConfig } from '../src/db/config.ts';
import { SupabaseRepository } from '../src/db/supabase/client.ts';

const env = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(env)) process.loadEnvFile(env);
// Reads only: do not save state, initialize collections or acknowledge outbox entries.
const result = { readOnly: true, supabase: 'missing_config', mongoBridge: 'missing_config' };
try {
  const config = readDatabaseConfig(process.env);
  if (config) {
    const ownerId = process.env.PERSISTENCE_CHECK_OWNER_ID?.trim() || process.env.BROKER_OWNER_USER_ID?.trim();
    if (!ownerId) throw Error('missing_owner');
    try { await new SupabaseRepository(config).load(ownerId); result.supabase = 'ready'; }
    catch { result.supabase = 'unavailable_or_migration_missing'; process.exitCode = 1; }
    if (config.mongoBridge) {
      try {
        const url = new URL('/snapshots', config.mongoBridge.url);
        url.searchParams.set('ownerId', ownerId); url.searchParams.set('limit', '1');
        const response = await fetch(url, { headers: { Authorization: `Bearer ${config.mongoBridge.token}` }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
        if (!response.ok || !Array.isArray((await response.json()).snapshots)) throw Error('invalid_response');
        result.mongoBridge = 'ready';
      } catch { result.mongoBridge = 'unavailable'; process.exitCode = 1; }
    }
  }
} catch { result.supabase = 'invalid_configuration'; process.exitCode = 1; }
console.log(JSON.stringify(result, null, 2));
