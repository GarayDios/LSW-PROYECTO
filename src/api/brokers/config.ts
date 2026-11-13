export const ALPACA_PAPER_URL = 'https://paper-api.alpaca.markets';
export const ALPACA_DATA_URL = 'https://data.alpaca.markets';

export type BrokerConfig = {
  apiKey: string;
  secretKey: string;
  ownerUserId: string;
  dataFeed: 'iex' | 'sip';
};

export class BrokerConfigError extends Error {
  readonly code = 'broker_configuration_invalid';
  readonly status = 503;
  constructor() { super('Configura las claves de Alpaca Paper y el propietario autorizado en el servidor.'); }
}

export function readBrokerConfig(values: Record<string, string | undefined>): BrokerConfig | null {
  const apiKey = values.ALPACA_API_KEY?.trim();
  const secretKey = values.ALPACA_SECRET_KEY?.trim();
  const ownerUserId = values.BROKER_OWNER_USER_ID?.trim();
  if (!apiKey && !secretKey && !ownerUserId) return null;
  if (!apiKey || !secretKey || !ownerUserId || ownerUserId.length > 255 || /[\r\n]/.test(apiKey + secretKey + ownerUserId)) throw new BrokerConfigError();
  const dataFeed = values.ALPACA_DATA_FEED?.trim() || 'iex';
  if (dataFeed !== 'iex' && dataFeed !== 'sip') throw new BrokerConfigError();
  // Recognize common SDK variables only to reject an accidental live setup.
  // This integration always uses its fixed Paper URL; no caller controls it.
  for (const name of ['ALPACA_API_BASE_URL', 'APCA_API_BASE_URL', 'ALPACA_TRADING_BASE_URL']) {
    const supplied = values[name]?.trim().replace(/\/$/, '');
    if (supplied && supplied !== ALPACA_PAPER_URL) throw new BrokerConfigError();
  }
  return { apiKey, secretKey, ownerUserId, dataFeed };
}
