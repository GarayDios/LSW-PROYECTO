import { z } from 'zod';
import { ALPACA_DATA_URL, ALPACA_PAPER_URL, BrokerConfigError, type BrokerConfig } from '../config.ts';

const decimal = z.string().refine(value => /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)));
const symbolSchema = z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/);
const clientIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const orderIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const accountSchema = z.object({
  id: z.string().min(1), status: z.string(), buying_power: decimal, cash: decimal, equity: decimal,
  trading_blocked: z.boolean(), account_blocked: z.boolean(), trade_suspended_by_user: z.boolean().optional(),
}).passthrough();
const assetSchema = z.object({
  id: z.string().min(1), symbol: symbolSchema, name: z.string(), class: z.string(), status: z.string(),
  tradable: z.boolean(), exchange: z.string().optional(), fractionable: z.boolean().optional(), shortable: z.boolean().optional(),
}).passthrough();
const clockSchema = z.object({ timestamp: z.string().datetime({ offset: true }), is_open: z.boolean(), next_open: z.string().datetime({ offset: true }), next_close: z.string().datetime({ offset: true }) }).passthrough();
const orderBaseSchema = z.object({
  id: z.string().min(1), client_order_id: z.string().min(1), symbol: symbolSchema, status: z.string(),
  side: z.enum(['buy', 'sell']), type: z.string(), time_in_force: z.string(), qty: decimal,
  filled_qty: decimal, limit_price: decimal.nullable().optional(), stop_price: decimal.nullable().optional(), filled_avg_price: decimal.nullable().optional(),
  order_class: z.string().optional(),
  created_at: z.string().optional(), submitted_at: z.string().nullable().optional(),
}).passthrough();
const orderSchema = orderBaseSchema.extend({ legs: z.array(orderBaseSchema).nullable().optional() });
const positionSchema = z.object({
  symbol: symbolSchema, qty: decimal, asset_class: z.string().optional(), market_value: decimal.optional(),
  current_price: decimal.optional(), avg_entry_price: decimal.optional(), unrealized_pl: decimal.optional(),
}).passthrough();
const priceSchema = decimal.refine(value => Number(value) > 0 && Number(value) <= 1_000_000 && (Number(value) >= 1 ? /^\d+(?:\.\d{1,2})?$/.test(value) : /^\d+(?:\.\d{1,4})?$/.test(value)));
const inputBaseSchema = z.object({
  symbol: symbolSchema, qty: z.string().regex(/^[1-9]\d*$/).refine(value => Number(value) <= 1_000_000),
  side: z.enum(['buy', 'sell']), type: z.literal('limit'), time_in_force: z.literal('day'),
  limit_price: priceSchema,
  client_order_id: clientIdSchema,
}).strict();
const bracketInputSchema = inputBaseSchema.extend({
  side: z.literal('buy'), time_in_force: z.literal('gtc'), order_class: z.literal('bracket'),
  take_profit: z.object({ limit_price: priceSchema }).strict(), stop_loss: z.object({ stop_price: priceSchema }).strict(),
}).refine(order => Number(order.stop_loss.stop_price) < Number(order.limit_price) && Number(order.take_profit.limit_price) > Number(order.limit_price), 'Los precios bracket deben rodear la entrada.');
const inputSchema = z.union([inputBaseSchema, bracketInputSchema]);

export type BrokerAccount = z.infer<typeof accountSchema>;
export type BrokerAsset = z.infer<typeof assetSchema>;
export type BrokerClock = z.infer<typeof clockSchema>;
export type BrokerOrder = z.infer<typeof orderSchema>;
export type BrokerPosition = z.infer<typeof positionSchema>;
export type PaperOrderInput = z.infer<typeof inputSchema>;
export type BrokerQuote = { bidPrice: number; askPrice: number; time: number };

export class BrokerError extends Error {
  readonly code: string;
  readonly status: number;
  readonly safeToRetry: boolean;
  constructor(code: string, status: number, message: string, safeToRetry = true) {
    super(message); this.code = code; this.status = status; this.safeToRetry = safeToRetry;
  }
}

const invalidResponse = () => new BrokerError('broker_response_invalid', 502, 'Alpaca no devolvió una respuesta válida.');
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  return parsed.data;
}
function checkedSymbol(value: string): string {
  const parsed = symbolSchema.safeParse(value);
  if (!parsed.success) throw new BrokerError('broker_symbol_invalid', 400, 'Usa un símbolo de acción válido.');
  return parsed.data;
}
function checkedClientId(value: string): string {
  if (!clientIdSchema.safeParse(value).success) throw new BrokerError('broker_order_invalid', 400, 'El identificador de la orden no es válido.');
  return value;
}

/** Server-only Trading API client. This class cannot submit live orders or options. */
export class AlpacaPaperClient {
  private readonly config: BrokerConfig;
  private readonly fetcher: typeof fetch;
  constructor(config: BrokerConfig, fetcher: typeof fetch = fetch) {
    const parsed = z.object({ apiKey: z.string().min(1), secretKey: z.string().min(1), ownerUserId: z.string().min(1).max(255), dataFeed: z.enum(['iex', 'sip']) }).strict().safeParse(config);
    if (!parsed.success || /[\r\n]/.test(parsed.data.apiKey + parsed.data.secretKey)) throw new BrokerConfigError();
    this.config = parsed.data;
    this.fetcher = (input, init) => fetcher(input, init);
  }

  private async request(path: string, init: RequestInit = {}, allowMissing = false, data = false): Promise<unknown> {
    try {
      const response = await this.fetcher((data ? ALPACA_DATA_URL : ALPACA_PAPER_URL) + path, {
        ...init, headers: { 'APCA-API-KEY-ID': this.config.apiKey, 'APCA-API-SECRET-KEY': this.config.secretKey, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        signal: AbortSignal.timeout(8000), redirect: 'manual', cache: 'no-store',
      });
      if (response.status === 404 && allowMissing) return null;
      if (!response.ok) {
        if (response.status === 401) throw new BrokerError('broker_credentials_invalid', 401, 'Las claves de Alpaca Paper no son válidas.');
        if (response.status === 403) throw new BrokerError('broker_access_denied', 403, 'La cuenta no tiene permiso para esta operación.');
        if (response.status === 429) throw new BrokerError('broker_rate_limited', 429, 'Alpaca ha limitado las consultas. Intenta de nuevo más tarde.');
        if (response.status === 422 || response.status === 400) throw new BrokerError('broker_order_rejected', 422, 'Alpaca rechazó los parámetros de la operación.');
        if (response.status === 404) throw new BrokerError('broker_resource_missing', 404, 'No se encontró el recurso solicitado en Alpaca.');
        throw new BrokerError('broker_unavailable', 503, 'Alpaca Paper no está disponible en este momento.');
      }
      if (response.status === 204 && init.method === 'DELETE') return null;
      try { return await response.json(); } catch { throw invalidResponse(); }
    } catch (error) {
      if (error instanceof BrokerError) throw error;
      throw new BrokerError('broker_unavailable', 503, 'No se pudo conectar con Alpaca Paper.');
    }
  }

  async getAccount(): Promise<BrokerAccount> { return parse(accountSchema, await this.request('/v2/account')); }
  async getAsset(symbol: string): Promise<BrokerAsset> { return parse(assetSchema, await this.request('/v2/assets/' + encodeURIComponent(checkedSymbol(symbol)))); }
  async getClock(): Promise<BrokerClock> { return parse(clockSchema, await this.request('/v2/clock')); }
  async getCalendar(start: string, end: string): Promise<{ date: string; open: string; close: string }[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw new BrokerError('broker_calendar_invalid', 400, 'El rango del calendario no es válido.');
    return parse(z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), open: z.string(), close: z.string() })), await this.request('/v2/calendar?' + new URLSearchParams({ start, end })));
  }
  async getLatestQuote(symbol: string): Promise<BrokerQuote> {
    const result = parse(z.object({ quote: z.object({ bp: z.number().finite().positive(), ap: z.number().finite().positive(), t: z.string().datetime({ offset: true }) }) }),
      await this.request('/v2/stocks/' + encodeURIComponent(checkedSymbol(symbol)) + '/quotes/latest?feed=' + this.config.dataFeed, {}, false, true));
    const time = Date.parse(result.quote.t);
    if (!Number.isFinite(time) || result.quote.ap < result.quote.bp) throw invalidResponse();
    return { bidPrice: result.quote.bp, askPrice: result.quote.ap, time };
  }
  async getOrderByClientId(clientOrderId: string): Promise<BrokerOrder | null> {
    const result = await this.request('/v2/orders:by_client_order_id?client_order_id=' + encodeURIComponent(checkedClientId(clientOrderId)), {}, true);
    return result === null ? null : parse(orderSchema, result);
  }
  async getOrder(orderId: string): Promise<BrokerOrder> {
    if (!orderIdSchema.safeParse(orderId).success) throw new BrokerError('broker_order_invalid', 400, 'El identificador de la orden no es válido.');
    const order = parse(orderSchema, await this.request('/v2/orders/' + encodeURIComponent(orderId) + '?nested=true'));
    if (order.id !== orderId) throw invalidResponse();
    return order;
  }
  /** The runner must also verify this ID belongs to its persisted execution ledger. */
  async cancelOwnedOrder(orderId: string, clientOrderId: string): Promise<void> {
    checkedClientId(clientOrderId);
    if (!clientOrderId.startsWith('tepic-')) throw new BrokerError('broker_order_conflict', 409, 'Solo se pueden cancelar órdenes identificadas del runner.', false);
    const existing = await this.getOrder(orderId);
    if (existing.client_order_id !== clientOrderId) throw new BrokerError('broker_order_conflict', 409, 'La orden no corresponde al identificador propio solicitado.', false);
    await this.request('/v2/orders/' + encodeURIComponent(orderId), { method: 'DELETE' });
  }
  async getPosition(symbol: string): Promise<BrokerPosition | null> {
    const result = await this.request('/v2/positions/' + encodeURIComponent(checkedSymbol(symbol)), {}, true);
    return result === null ? null : parse(positionSchema, result);
  }
  async listPositions(): Promise<BrokerPosition[]> { return parse(z.array(positionSchema), await this.request('/v2/positions')); }
  async listOpenOrders(symbol?: string): Promise<BrokerOrder[]> {
    const params = new URLSearchParams({ status: 'open', limit: '500', direction: 'desc' });
    if (symbol) params.set('symbols', checkedSymbol(symbol));
    const orders = parse(z.array(orderSchema), await this.request('/v2/orders?' + params));
    if (orders.length >= 500) throw new BrokerError('broker_exposure_uncertain', 409, 'Hay demasiadas órdenes abiertas para comprobar la exposición con seguridad.', false);
    return orders;
  }

  private matchingOrder(existing: BrokerOrder, requested: PaperOrderInput): BrokerOrder {
    if (existing.client_order_id !== requested.client_order_id || existing.symbol !== requested.symbol || existing.side !== requested.side || Number(existing.qty) !== Number(requested.qty) || existing.type !== requested.type || existing.time_in_force !== requested.time_in_force || Number(existing.limit_price) !== Number(requested.limit_price)) {
      throw new BrokerError('broker_order_conflict', 409, 'Ese identificador ya corresponde a una orden diferente.', false);
    }
    if ('order_class' in requested) {
      if (existing.order_class !== 'bracket') throw new BrokerError('broker_order_conflict', 409, 'La orden no corresponde al bracket solicitado.', false);
      // Legs may arrive on the next nested GET. If present, validate their identity now.
      if (existing.legs?.length && (existing.legs.length !== 2 || !existing.legs.some(leg => leg.side === 'sell' && leg.symbol === requested.symbol && leg.type === 'limit' && Number(leg.limit_price) === Number(requested.take_profit.limit_price)) || !existing.legs.some(leg => leg.side === 'sell' && leg.symbol === requested.symbol && leg.type === 'stop' && Number(leg.stop_price) === Number(requested.stop_loss.stop_price)))) throw new BrokerError('broker_order_conflict', 409, 'Las salidas no corresponden al bracket solicitado.', false);
    } else if (existing.order_class && existing.order_class !== 'simple') throw new BrokerError('broker_order_conflict', 409, 'La clase de la orden no corresponde a la solicitud.', false);
    return existing;
  }

  async submitPaperOrder(input: PaperOrderInput): Promise<BrokerOrder> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new BrokerError('broker_order_invalid', 400, 'Usa acciones completas con orden límite diaria o entrada bracket GTC válida.');
    const order = parsed.data;
    const existing = await this.getOrderByClientId(order.client_order_id);
    if (existing) return this.matchingOrder(existing, order);
    const [account, asset, clock] = await Promise.all([this.getAccount(), this.getAsset(order.symbol), this.getClock()]);
    if (account.status !== 'ACTIVE' || account.trading_blocked || account.account_blocked || account.trade_suspended_by_user) throw new BrokerError('broker_account_blocked', 409, 'La cuenta de práctica no está habilitada para operar.', false);
    if (asset.symbol !== order.symbol || asset.class !== 'us_equity' || asset.status !== 'active' || !asset.tradable) throw new BrokerError('broker_asset_not_tradable', 409, 'El activo no es una acción negociable en esta cuenta.', false);
    if (!clock.is_open) throw new BrokerError('broker_market_closed', 409, 'El mercado está cerrado. La orden automática no se envió.');
    if (order.side === 'buy') {
      const available = Math.min(Number(account.cash), Number(account.buying_power));
      if (Number(order.qty) * Number(order.limit_price) > available) throw new BrokerError('broker_insufficient_funds', 409, 'No hay efectivo disponible suficiente para esta orden de práctica.', false);
    } else {
      const [position, open] = await Promise.all([this.getPosition(order.symbol), this.listOpenOrders(order.symbol)]);
      const reserved = open.filter(item => item.symbol === order.symbol && item.side === 'sell').reduce((sum, item) => sum + Math.max(0, Number(item.qty) - Number(item.filled_qty)), 0);
      if (!position || position.symbol !== order.symbol || Number(position.qty) - reserved < Number(order.qty) || position.asset_class && position.asset_class !== 'us_equity') throw new BrokerError('broker_insufficient_position', 409, 'Solo puedes vender acciones disponibles de una posición larga; las ventas en corto están deshabilitadas.', false);
    }
    try {
      return this.matchingOrder(parse(orderSchema, await this.request('/v2/orders', { method: 'POST', body: JSON.stringify(order) })), order);
    } catch (error) {
      if (error instanceof BrokerError && error.status < 500) throw error;
      // An ambiguous response can follow a successful broker-side insert. Never
      // issue a second POST here: first reconcile using the stable client ID.
      try {
        const recovered = await this.getOrderByClientId(order.client_order_id);
        if (recovered) return this.matchingOrder(recovered, order);
      } catch (lookupError) {
        if (lookupError instanceof BrokerError && lookupError.code === 'broker_order_conflict') throw lookupError;
      }
      throw new BrokerError('broker_order_ambiguous', 503, 'No se pudo confirmar la orden. Consulta su identificador antes de intentar otra operación.', false);
    }
  }
}
