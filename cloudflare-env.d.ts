declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SUPABASE_URL?: string;
    SUPABASE_SECRET_KEY?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    MONGO_BRIDGE_URL?: string;
    MONGO_BRIDGE_TOKEN?: string;
    ALPACA_API_KEY?: string;
    ALPACA_SECRET_KEY?: string;
    BROKER_OWNER_USER_ID?: string;
    ALPACA_DATA_FEED?: string;
    ALPACA_OPTIONS_FEED?: string;
    SEC_USER_AGENT?: string;
    FRED_API_KEY?: string;
    TRADING_RUNNER_URL?: string;
    TRADING_RUNNER_TOKEN?: string;
    ALPACA_AUTOMATION_ENABLED?: string;
  }
}
