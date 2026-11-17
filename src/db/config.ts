export class DatabaseConfigError extends Error {
  constructor() { super('La persistencia remota está configurada de forma incompleta.'); }
}
export type DatabaseConfig = {
  supabaseUrl: string;
  supabaseKey: string;
  mongoBridge: { url: string; token: string } | null;
};

function serverUrl(value: string): string {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return url.origin;
  } catch { throw new DatabaseConfigError(); }
}

export function readDatabaseConfig(values: Record<string, string | undefined>): DatabaseConfig | null {
  const url = values.SUPABASE_URL?.trim();
  const key = (values.SUPABASE_SECRET_KEY || values.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  const bridgeUrl = values.MONGO_BRIDGE_URL?.trim();
  const bridgeToken = values.MONGO_BRIDGE_TOKEN?.trim();
  if (!url && !key && !bridgeUrl && !bridgeToken) return null;
  if (!url || !key || key.length < 20 || Boolean(bridgeUrl) !== Boolean(bridgeToken)) throw new DatabaseConfigError();
  if (bridgeToken && bridgeToken.length < 32) throw new DatabaseConfigError();
  if (!key.startsWith('sb_secret_')) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role !== 'service_role') throw new Error();
    } catch { throw new DatabaseConfigError(); }
  }
  return { supabaseUrl: serverUrl(url), supabaseKey: key, mongoBridge: bridgeUrl && bridgeToken ? { url: serverUrl(bridgeUrl), token: bridgeToken } : null };
}

export type SelectedDatabaseConfig = DatabaseConfig | { provider: 'mongodb'; connection: { url: string; token: string }; mongoBridge: null };
/** Explicit remote selections never silently downgrade to browser storage. */
export function readSelectedDatabaseConfig(values: Record<string, string | undefined>, provider: string | null): SelectedDatabaseConfig | null {
  if (provider === 'local') return null;
  if (provider === 'mongodb') {
    const url = values.MONGO_BRIDGE_URL?.trim(), token = values.MONGO_BRIDGE_TOKEN?.trim();
    if (!url || !token || token.length < 32 || token.length > 512 || /[\r\n]/.test(token)) throw new DatabaseConfigError();
    return { provider: 'mongodb', connection: { url: serverUrl(url), token }, mongoBridge: null };
  }
  if (provider === 'supabase') {
    const config = readDatabaseConfig({ ...values, MONGO_BRIDGE_URL: '', MONGO_BRIDGE_TOKEN: '' });
    if (!config) throw new DatabaseConfigError();
    return config;
  }
  if (provider !== null) throw new DatabaseConfigError();
  return readDatabaseConfig(values);
}
