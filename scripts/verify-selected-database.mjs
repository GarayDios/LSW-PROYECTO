import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSelectedDatabaseConfig } from '../src/db/config.ts';
import { MongoPrimaryRepository } from '../src/db/mongodb/primary.ts';
import { SupabaseRepository } from '../src/db/supabase/client.ts';
const local = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(local)) process.loadEnvFile(local);
const provider = process.argv[2];
try {
  if (!['supabase', 'mongodb'].includes(provider)) throw Error('provider');
  const config = readSelectedDatabaseConfig(process.env, provider);
  const owner = process.env.PERSISTENCE_CHECK_OWNER_ID?.trim() || process.env.BROKER_OWNER_USER_ID?.trim();
  if (!config || !owner) throw Error('configuration');
  const repository = 'provider' in config ? new MongoPrimaryRepository(config.connection) : new SupabaseRepository(config);
  await repository.load(owner);
  console.log(`${provider}: conexión y consulta verificadas. Solo lectura; no se modificaron datos.`);
} catch {
  console.error(`${provider}: no se pudo verificar. Revisa configuración, servicio y esquema. No se muestran credenciales.`);
  process.exitCode = 1;
}
