import { AsyncLocalStorage } from 'node:async_hooks';

const environments = new AsyncLocalStorage<Record<string, unknown>>();

/** Hosted request bindings stay within the request. Local Node uses its environment. */
export function runWithDatabaseEnvironment<T>(values: Record<string, unknown>, callback: () => T): T {
  return environments.run(values, callback);
}

export function databaseEnvironment(): Record<string, string | undefined> {
  const request = environments.getStore();
  const keys = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'MONGO_BRIDGE_URL', 'MONGO_BRIDGE_TOKEN',
    'ALPACA_API_KEY', 'ALPACA_SECRET_KEY', 'BROKER_OWNER_USER_ID', 'ALPACA_DATA_FEED',
    'ALPACA_API_BASE_URL', 'APCA_API_BASE_URL', 'ALPACA_TRADING_BASE_URL',
    'TRADING_RUNNER_URL', 'TRADING_RUNNER_TOKEN', 'ALPACA_AUTOMATION_ENABLED',
    'ALPACA_OPTIONS_FEED', 'ALPACA_F5_ENABLED', 'ALPACA_F5_AUTOMATION_ENABLED', 'WEBULL_MANUAL_ENABLED', 'SEC_USER_AGENT', 'FRED_API_KEY', 'FINNHUB_API_KEY'];
  return Object.fromEntries(keys.map(key => [key, typeof request?.[key] === 'string' ? request[key] : process.env[key]]));
}
