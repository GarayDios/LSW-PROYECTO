import { z } from 'zod';
import { ALPACA_DATA_URL, ALPACA_PAPER_URL, BrokerConfigError, type BrokerConfig } from '../config.ts';
import { BrokerError } from './client.ts';
import { f5EquitySymbol, f5OptionSymbol } from '../../../features/f5/validation.ts';
import type { F5Account, F5Activity, F5BrokerOrder, F5Contract, F5OrderInput, F5Position } from '../../../features/f5/types.ts';
import type { F5AccountingActivity, F5AccountingBatch } from '../../../features/f5/report-types.ts';

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/).refine(value => Number.isFinite(Number(value)));
const positiveInteger = z.string().regex(/^[1-9]\d*$/).refine(value => Number.isSafeInteger(Number(value)) && Number(value) <= 1_000_000);
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const optionSymbol = z.string().regex(f5OptionSymbol);
const equitySymbol = z.string().regex(f5EquitySymbol);
const securitySymbol = z.union([optionSymbol, equitySymbol]);
const intent = z.enum(['buy_to_open', 'buy_to_close', 'sell_to_open', 'sell_to_close']);
const side = z.enum(['buy', 'sell']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value);
const timestamp = z.string().datetime({ offset: true });
const price = z.string().regex(/^-?\d+(?:\.\d{1,2})?$/).refine(value => Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1_000_000);
const legInput = z.object({ symbol: optionSymbol, side, ratio_qty: positiveInteger, position_intent: intent }).strict();
const baseInput = { client_order_id: identifier, qty: positiveInteger, type: z.literal('limit'), time_in_force: z.literal('day'), limit_price: price };
const orderInput = z.union([
  z.object({ ...baseInput, symbol: securitySymbol, side, position_intent: intent.optional() }).strict(),
  z.object({ ...baseInput, order_class: z.literal('mleg'), legs: z.array(legInput).min(2).max(4) }).strict(),
]);
const orderBase = z.object({ id: identifier, client_order_id: z.string().min(1).max(128), status: z.string().min(1), qty: decimal, filled_qty: decimal,
  filled_avg_price: decimal.nullable().optional(), symbol: securitySymbol.optional(), side: side.optional(), limit_price: decimal.nullable().optional(),
  order_class: z.string().optional(), type: z.string().optional(), time_in_force: z.string().optional(), position_intent: intent.nullable().optional(), ratio_qty: decimal.optional(),
}).strip();
const orderSchema = orderBase.extend({ legs: z.array(orderBase).max(4).nullable().optional() }).refine(order => [order, ...(order.legs ?? [])].every(item => Number(item.qty) > 0 && Number(item.filled_qty) >= 0 && Number(item.filled_qty) <= Number(item.qty)));
type Order = z.infer<typeof orderSchema>;
const metadata = z.object({ symbol: optionSymbol, underlying_symbol: equitySymbol, type: z.enum(['call', 'put']), expiration_date: date, strike_price: decimal,
  size: decimal, multiplier: decimal, status: z.string(), tradable: z.boolean(), style: z.string(), root_symbol: z.string().optional(), deliverables: z.array(z.unknown()).optional(),
}).passthrough();
type Metadata = z.infer<typeof metadata>;
const metadataPage = z.object({ option_contracts: z.array(metadata), next_page_token: z.string().max(2048).nullable().optional() });
const quote = z.object({ bp: z.number().finite().nonnegative(), ap: z.number().finite().nonnegative(), t: timestamp });
const snapshot = z.object({ latestQuote: quote.nullable().optional(), greeks: z.object({ delta: z.number().finite().min(-1).max(1).nullable().optional() }).nullable().optional() }).passthrough();
type Snapshot = z.infer<typeof snapshot>;
const snapshotsPage = z.object({ snapshots: z.record(snapshot), next_page_token: z.string().max(2048).nullable().optional() });
const invalid = () => new BrokerError('broker_response_invalid', 502, 'Alpaca no devolvió datos F5 verificables.', false);
const conflict = () => new BrokerError('broker_order_conflict', 409, 'Ese identificador corresponde a otra orden o a piernas diferentes.', false);
const ambiguous = () => new BrokerError('broker_order_ambiguous', 503, 'La orden F5 requiere conciliación por su identificador; no se repitió el envío.', false);
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw invalid(); return result.data; }
function checked<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new BrokerError('broker_order_invalid', 400, 'Revisa el símbolo o los parámetros de la operación F5.', false); return result.data; }
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
const todayAt = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));

/** Fixed-host, server-only client. Capital allocation and operation ownership remain service responsibilities. */
export class AlpacaOptionsClient {
  private readonly config: BrokerConfig;
  private readonly fetcher: typeof fetch;
  private readonly feed: 'indicative' | 'opra';
  private readonly now: () => number;
  private readonly attempted = new Map<string, F5OrderInput>();
  private readonly inFlight = new Map<string, { input: string; promise: Promise<F5BrokerOrder> }>();
  constructor(config: BrokerConfig, opts: { fetcher?: typeof fetch; feed?: 'indicative' | 'opra'; now?: () => number } = {}) {
    const parsed = z.object({ apiKey: z.string().min(1), secretKey: z.string().min(1), ownerUserId: z.string().min(1).max(255), dataFeed: z.enum(['iex', 'sip']) }).strict().safeParse(config);
    if (!parsed.success || /[\r\n]/.test(parsed.data.apiKey + parsed.data.secretKey + parsed.data.ownerUserId) || opts.feed !== undefined && !['indicative', 'opra'].includes(opts.feed)) throw new BrokerConfigError();
    this.config = parsed.data; this.fetcher = opts.fetcher ?? fetch; this.feed = opts.feed ?? 'indicative'; this.now = opts.now ?? Date.now;
  }
  private async request(path: string, init: RequestInit = {}, missing = false, data = false): Promise<unknown> {
    try {
      const response = await this.fetcher((data ? ALPACA_DATA_URL : ALPACA_PAPER_URL) + path, { ...init,
        headers: { 'APCA-API-KEY-ID': this.config.apiKey, 'APCA-API-SECRET-KEY': this.config.secretKey, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8000),
      });
      if (response.status === 404 && missing) return null;
      if (!response.ok) {
        const errors: Record<number, [string, string]> = { 401: ['broker_credentials_invalid', 'Las claves de Alpaca Paper no son válidas.'], 403: ['broker_access_denied', 'La cuenta no tiene permiso para esta operación F5.'], 404: ['broker_resource_missing', 'No se encontró el recurso solicitado en Alpaca.'], 409: ['broker_order_rejected', 'Alpaca rechazó la operación F5.'], 422: ['broker_order_rejected', 'Alpaca rechazó los contratos, el precio o la cobertura de la operación F5.'], 400: ['broker_order_rejected', 'Alpaca rechazó los parámetros de la operación F5.'], 429: ['broker_rate_limited', 'Alpaca ha limitado las consultas. Intenta de nuevo más tarde.'] };
        const known = errors[response.status];
        throw new BrokerError(known?.[0] ?? 'broker_unavailable', known ? response.status : 503, known?.[1] ?? 'Alpaca Paper no está disponible.', false);
      }
      if (init.method === 'DELETE') return null;
      try { return await response.json(); } catch { throw invalid(); }
    } catch (error) { if (error instanceof BrokerError) throw error; throw new BrokerError('broker_unavailable', 503, 'No se pudo consultar Alpaca Paper.', false); }
  }
  async account(): Promise<F5Account> {
    const result = parse(z.object({ status: z.string(), cash: decimal, buying_power: decimal, options_buying_power: decimal, equity: decimal,
      options_trading_level: z.number().int().min(0).max(3), trading_blocked: z.boolean(), account_blocked: z.boolean(), trade_suspended_by_user: z.boolean().optional(),
    }), await this.request('/v2/account'));
    return { status: result.status, cash: Number(result.cash), buyingPower: Number(result.buying_power), optionsBuyingPower: Number(result.options_buying_power), equity: Number(result.equity), optionsLevel: result.options_trading_level, blocked: result.trading_blocked || result.account_blocked || !!result.trade_suspended_by_user };
  }
  async clock(): Promise<boolean> { return parse(z.object({ is_open: z.boolean() }), await this.request('/v2/clock')).is_open; }
  async stockQuote(underlying: string): Promise<{ bid: number; ask: number; time: string }> {
    checked(equitySymbol, underlying);
    const result = parse(z.object({ quote: quote }), await this.request('/v2/stocks/' + encodeURIComponent(underlying) + '/quotes/latest?' + new URLSearchParams({ feed: this.config.dataFeed }), {}, false, true));
    if (result.quote.bp <= 0 || result.quote.ap < result.quote.bp || Date.parse(result.quote.t) > this.now() + 5000 || this.now() - Date.parse(result.quote.t) > 60000) throw new BrokerError('f5_quote_unavailable', 409, 'No hay cotización reciente y verificable de la acción para revisar la cobertura.', false);
    return { bid: result.quote.bp, ask: result.quote.ap, time: result.quote.t };
  }
  private async equity(symbol: string): Promise<void> {
    const asset = parse(z.object({ symbol: equitySymbol, class: z.string(), status: z.string(), tradable: z.boolean() }), await this.request('/v2/assets/' + encodeURIComponent(checked(equitySymbol, symbol))));
    if (asset.symbol !== symbol || asset.class !== 'us_equity' || asset.status !== 'active' || !asset.tradable) throw new BrokerError('broker_asset_not_tradable', 409, 'F5 requiere una acción negociable verificada; los índices no están habilitados.', false);
  }
  private standard(contract: Metadata, underlying: string): boolean {
    if (contract.underlying_symbol !== underlying) throw invalid();
    const occ = contract.symbol.match(/(\d{6})([CP])(\d{8})$/)!;
    if (`20${occ[1].slice(0, 2)}-${occ[1].slice(2, 4)}-${occ[1].slice(4, 6)}` !== contract.expiration_date || (occ[2] === 'C' ? 'call' : 'put') !== contract.type || Number(occ[3]) / 1000 !== Number(contract.strike_price)) throw invalid();
    // Request deliverables explicitly on lists and verify them on details too.
    // The execution service supports only verified standard 100/100 contracts.
    const ordinaryDelivery = z.object({ type: z.literal('equity'), symbol: equitySymbol, amount: decimal, allocation_percentage: decimal, delayed_settlement: z.boolean().optional() });
    const delivery = contract.deliverables?.length === 1 ? ordinaryDelivery.safeParse(contract.deliverables[0]) : null;
    const standardDelivery = !!(delivery?.success && delivery.data.symbol === underlying && Number(delivery.data.amount) === 100 && Number(delivery.data.allocation_percentage) === 100 && delivery.data.delayed_settlement !== true);
    return contract.status === 'active' && contract.tradable && contract.style === 'american' && Number(contract.size) === 100 && Number(contract.multiplier) === 100 && Number(contract.strike_price) > 0
      && contract.symbol.slice(0, -15) === underlying && (!contract.root_symbol || contract.root_symbol === underlying) && standardDelivery;
  }
  private normalized(contract: Metadata, observed?: Snapshot): F5Contract {
    const q = observed?.latestQuote;
    if (q && (q.ap < q.bp || Date.parse(q.t) > this.now() + 60_000)) throw invalid();
    return { symbol: contract.symbol, underlying: contract.underlying_symbol, type: contract.type, expiry: contract.expiration_date, strike: Number(contract.strike_price), size: Number(contract.size), tradable: contract.tradable, style: contract.style,
      bid: q?.bp ?? null, ask: q?.ap ?? null, quoteTime: q?.t ?? null, delta: observed?.greeks?.delta ?? null };
  }
  async contracts(underlying: string, expiry?: string): Promise<{ contracts: F5Contract[]; complete: boolean; feed: 'indicative' | 'opra' }> {
    checked(equitySymbol, underlying); if (expiry !== undefined) checked(date, expiry); await this.equity(underlying);
    const today = todayAt(this.now()), end = new Date(today + 'T12:00:00Z'); end.setUTCFullYear(end.getUTCFullYear() + 3);
    const filters: Record<string, string> = expiry ? { expiration_date: expiry } : { expiration_date_gte: today, expiration_date_lte: end.toISOString().slice(0, 10) };
    const metadataParams = new URLSearchParams({ underlying_symbols: underlying, status: 'active', limit: '1000',show_deliverables:'true', ...filters });
    const found: Metadata[] = [], seen = new Set<string>(); let token: string | null | undefined, complete = true;
    for (let page = 0; page < 20; page++) {
      if (token) metadataParams.set('page_token', token);
      const result = parse(metadataPage, await this.request('/v2/options/contracts?' + metadataParams));
      for (const contract of result.option_contracts) {
        if (seen.has(contract.symbol)) throw invalid(); seen.add(contract.symbol);
        if (this.standard(contract, underlying) && contract.expiration_date >= today && (!expiry || contract.expiration_date === expiry)) found.push(contract);
      }
      const next = result.next_page_token;
      if (!next) break;
      if (next === token) throw invalid(); token = next;
      if (page === 19) complete = false;
    }
    const snapshotParams = new URLSearchParams({ feed: this.feed, limit: '1000', ...filters });
    const observed = new Map<string, Snapshot>(); token = undefined;
    for (let page = 0; page < 20; page++) {
      if (token) snapshotParams.set('page_token', token);
      const result = parse(snapshotsPage, await this.request('/v1beta1/options/snapshots/' + encodeURIComponent(underlying) + '?' + snapshotParams, {}, false, true));
      for (const [symbol, value] of Object.entries(result.snapshots)) { checked(optionSymbol, symbol); if (observed.has(symbol)) throw invalid(); observed.set(symbol, value); }
      const next = result.next_page_token;
      if (!next) break;
      if (next === token) throw invalid(); token = next;
      if (page === 19) complete = false;
    }
    return { contracts: found.map(contract => this.normalized(contract, observed.get(contract.symbol))), complete, feed: this.feed };
  }
  async contract(symbol: string): Promise<F5Contract> {
    checked(optionSymbol, symbol);
    const contract = parse(metadata, await this.request('/v2/options/contracts/' + encodeURIComponent(symbol)));
    if (contract.symbol !== symbol || !this.standard(contract, contract.underlying_symbol) || contract.expiration_date < todayAt(this.now())) throw new BrokerError('broker_contract_invalid', 409, 'El contrato no es una opción americana estándar vigente y negociable.', false);
    await this.equity(contract.underlying_symbol);
    const result = parse(snapshotsPage, await this.request('/v1beta1/options/snapshots?' + new URLSearchParams({ symbols: symbol, feed: this.feed }), {}, false, true));
    if (result.next_page_token || Object.keys(result.snapshots).some(key => key !== symbol)) throw invalid();
    return this.normalized(contract, result.snapshots[symbol]);
  }
  async positions(): Promise<F5Position[]> {
    const result = parse(z.array(z.object({ symbol: securitySymbol, qty: decimal, asset_class: z.string(), market_value: decimal.nullable().optional(), avg_entry_price: decimal.nullable().optional(), unrealized_pl: decimal.nullable().optional() })), await this.request('/v2/positions'));
    if (new Set(result.map(position => position.symbol)).size !== result.length) throw invalid();
    return result.map(position => ({ symbol: position.symbol, quantity: Number(position.qty), assetClass: position.asset_class, marketValue: position.market_value == null ? null : Number(position.market_value), averagePrice: position.avg_entry_price == null ? null : Number(position.avg_entry_price), unrealizedPnl: position.unrealized_pl == null ? null : Number(position.unrealized_pl) }));
  }
  async orders(): Promise<F5BrokerOrder[]> {
    const all: Order[] = [], seen = new Set<string>(); const params = new URLSearchParams({ status: 'open', nested: 'true', limit: '500', direction: 'desc' });
    for (let page = 0; page < 20; page++) {
      const result = parse(z.array(orderSchema).max(500), await this.request('/v2/orders?' + params));
      for (const order of result) { if (seen.has(order.id)) throw invalid(); seen.add(order.id); all.push(order); }
      if (result.length < 500) return all;
      // ID cursor avoids losing orders that share the same timestamp.
      params.set('before_order_id', result.at(-1)!.id);
    }
    throw new BrokerError('broker_exposure_uncertain', 409, 'No se pudo comprobar la lista completa de órdenes abiertas.', false);
  }
  async activities(): Promise<F5Activity[]> {
    const schema = z.array(z.object({ id: z.string().min(1), activity_type: z.enum(['OPASN', 'OPTRD', 'OPEXC', 'OPEXP']), symbol: securitySymbol, date: z.string().min(10), qty: decimal, description: z.string().optional(), group_id: z.string().nullable().optional() })).max(100);
    const params = new URLSearchParams({ activity_types: 'OPASN,OPTRD,OPEXC,OPEXP', page_size: '100', direction: 'desc' }); const all: F5Activity[] = [], seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const result = parse(schema, await this.request('/v2/account/activities?' + params));
      for (const activity of result) { if (seen.has(activity.id)) throw invalid(); seen.add(activity.id); all.push({ id: activity.id, type: activity.activity_type, symbol: activity.symbol, date: activity.date, quantity: activity.qty, description: activity.description ?? '', ...(activity.group_id ? { groupId: activity.group_id } : {}) }); }
      if (result.length < 100) return all;
      params.set('page_token', result.at(-1)!.id);
    }
    throw new BrokerError('broker_activities_incomplete', 409, 'No se pudo comprobar el historial completo de asignaciones y vencimientos.', false);
  }
  /** A bounded read advertises incomplete pagination instead of presenting a subset as the full ledger. */
  private async accountingActivities(types: string, options: { after?: string; maxPages?: number } = {}): Promise<F5AccountingBatch> {
    if (options.after !== undefined) checked(z.union([date, timestamp]), options.after);
    const maxPages = options.maxPages ?? 20;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new BrokerError('broker_order_invalid', 400, 'El límite de páginas del reporte no es válido.', false);
    const amount = z.union([decimal, z.number().finite()]).nullable().optional();
    const text = z.string().max(4096).nullable().optional();
    const schema = z.array(z.object({ id: z.string().min(1).max(512), activity_type: z.string().min(1).max(64), symbol: text, order_id: text,
      transaction_time: timestamp.nullable().optional(), date: z.string().min(10).nullable().optional(), qty: amount, price: amount, net_amount: amount,
      side: text, group_id: text, option_symbol: text, related_activity_id: text, status: text, description: text, activity_sub_type: text, currency: text,
    })).max(100);
    const params = new URLSearchParams({ activity_types: types, page_size: '100', direction: 'asc', ...(options.after ? { after: options.after } : {}) });
    const items: F5AccountingActivity[] = [], ids = new Map<string, string>(), warnings: string[] = []; let complete = false;
    for (let page = 0; page < maxPages; page++) {
      const raw = parse(schema, await this.request('/v2/account/activities?' + params));
      for (const value of raw) {
        if (!types.split(',').includes(value.activity_type)) throw invalid();
        const numeric = (value: string | number | null | undefined): number | null => value == null ? null : Number(value);
        const activity: F5AccountingActivity = { id: value.id, type: value.activity_type, symbol: value.symbol ?? null, orderId: value.order_id ?? null,
          date: value.date?.slice(0, 10) ?? value.transaction_time?.slice(0, 10) ?? null, transactionTime: value.transaction_time ?? null, quantity: numeric(value.qty), price: numeric(value.price),
          side: value.side === 'buy' || value.side === 'sell' || value.side === 'sell_short' ? value.side : null, netAmount: numeric(value.net_amount), groupId: value.group_id ?? null,
          optionSymbol: value.option_symbol ?? null, relatedActivityId: value.related_activity_id ?? null, status: value.status ?? null, description: value.description ?? '', subtype: value.activity_sub_type ?? null, currency: value.currency ?? null };
        const signature = JSON.stringify(activity), previous = ids.get(activity.id);
        if (previous && previous !== signature) { warnings.push('Un identificador de actividad cambió durante la consulta; el reporte requiere conciliación.'); return { items, complete: false, asOf: new Date(this.now()).toISOString(), source: 'Alpaca Paper /v2/account/activities', warnings }; }
        if (!previous) { ids.set(activity.id, signature); items.push(activity); }
      }
      if (raw.length < 100) { complete = true; break; }
      const last = raw.at(-1)!.id;
      if (last === params.get('page_token')) { warnings.push('La paginación de actividades no avanzó.'); break; }
      params.set('page_token', last);
    }
    if (!complete) warnings.push('La consulta de actividades es parcial; los importes completos y los costes no se dan por conocidos.');
    return { items, complete, asOf: new Date(this.now()).toISOString(), source: 'Alpaca Paper /v2/account/activities', warnings };
  }
  async fillActivities(options?: { after?: string; maxPages?: number }): Promise<F5AccountingBatch> { return this.accountingActivities('FILL', options); }
  async feeActivities(options?: { after?: string; maxPages?: number }): Promise<F5AccountingBatch> { return this.accountingActivities('FEE,CFEE', options); }
  async optionActivities(options?: { after?: string; maxPages?: number }): Promise<F5AccountingBatch> { return this.accountingActivities('OPASN,OPTRD,OPEXC,OPEXP,OPCSH', options); }
  async orderByClientId(id: string): Promise<F5BrokerOrder | null> {
    checked(identifier, id);
    const result = await this.request('/v2/orders:by_client_order_id?' + new URLSearchParams({ client_order_id: id, nested: 'true' }), {}, true);
    if (result === null) return null;
    const order = parse(orderSchema, result);
    if (order.client_order_id !== id) throw invalid();
    return order;
  }
  private matching(order: F5BrokerOrder, requested: F5OrderInput): F5BrokerOrder {
    if (order.client_order_id !== requested.client_order_id || Number(order.qty) !== Number(requested.qty) || order.type !== requested.type || order.time_in_force !== requested.time_in_force || order.limit_price == null || Number(order.limit_price) !== Number(requested.limit_price)) throw conflict();
    if (requested.order_class === 'mleg') {
      if (order.order_class !== 'mleg' || !order.legs || order.legs.length !== requested.legs!.length) throw conflict();
      const seen = new Set<string>();
      for (const actual of order.legs) {
        const expected = requested.legs!.find(leg => leg.symbol === actual.symbol);
        const ratio = (actual as Order).ratio_qty;
        if (!expected || seen.has(expected.symbol) || actual.side !== expected.side || actual.position_intent !== expected.position_intent || ratio === undefined || Number(ratio) !== Number(expected.ratio_qty) || Number(actual.qty) !== Number(requested.qty) * Number(expected.ratio_qty)) throw conflict();
        seen.add(expected.symbol);
      }
    } else {
      // Alpaca can infer position_intent for equity even when it was omitted.
      // Options always require the exact reviewed intent; a hedge must stay long-only.
      const intentMatches = requested.position_intent !== undefined
        ? order.position_intent === requested.position_intent
        : order.position_intent == null || order.position_intent === (requested.side === 'buy' ? 'buy_to_open' : 'sell_to_close');
      if (order.order_class && order.order_class !== 'simple' || order.legs?.length || order.symbol !== requested.symbol || order.side !== requested.side || !intentMatches) throw conflict();
    }
    return order;
  }
  async submit(input: F5OrderInput, notAfter?: number, allowSubmit?: () => boolean): Promise<F5BrokerOrder> {
    if (notAfter !== undefined && !Number.isFinite(notAfter)) throw new BrokerError('broker_order_invalid', 400, 'La fecha límite de la revisión no es válida.', false);
    const requested = checked(orderInput, input) as F5OrderInput;
    const legs = requested.legs;
    if (legs) {
      if (new Set(legs.map(leg => leg.symbol)).size !== legs.length || legs.reduce((result, leg) => gcd(result, Number(leg.ratio_qty)), 0) !== 1 || legs.some(leg => leg.position_intent.startsWith(leg.side) === false || Number(requested.qty) * Number(leg.ratio_qty) > 1_000_000)) throw new BrokerError('broker_order_invalid', 400, 'Las piernas requieren identidades distintas, lados coherentes y proporciones enteras simplificadas.', false);
    } else if (!requested.symbol || Number(requested.limit_price) <= 0 || (f5OptionSymbol.test(requested.symbol) ? !requested.position_intent || !requested.position_intent.startsWith(requested.side!) : requested.position_intent !== undefined)) throw new BrokerError('broker_order_invalid', 400, 'Revisa el precio y la intención de la orden simple.', false);
    const signature = JSON.stringify(requested), flight = this.inFlight.get(requested.client_order_id);
    if (flight) { if (flight.input !== signature) throw conflict(); return flight.promise; }
    const previous = this.attempted.get(requested.client_order_id);
    if (previous && JSON.stringify(previous) !== signature) throw conflict();
    const promise = this.submitOnce(requested, notAfter, allowSubmit);
    this.inFlight.set(requested.client_order_id, { input: signature, promise });
    try { return await promise; } finally { this.inFlight.delete(requested.client_order_id); }
  }
  private async submitOnce(requested: F5OrderInput, notAfter?: number, allowSubmit?: () => boolean): Promise<F5BrokerOrder> {
    const existing = await this.orderByClientId(requested.client_order_id);
    if (existing) return this.matching(existing, requested);
    if (this.attempted.has(requested.client_order_id)) throw ambiguous();
    const [account, open] = await Promise.all([this.account(), this.clock()]);
    if (account.blocked || account.status !== 'ACTIVE') throw new BrokerError('broker_account_blocked', 409, 'La cuenta Paper no está habilitada para operar.', false);
    if (!open) throw new BrokerError('broker_market_closed', 409, 'El mercado está cerrado; no se envió la orden F5.', false);
    const symbols = requested.legs?.map(leg => leg.symbol) ?? [requested.symbol!];
    if (requested.legs || f5OptionSymbol.test(symbols[0])) {
      const opening = requested.legs?.some(leg => leg.position_intent.endsWith('_open')) ?? requested.position_intent?.endsWith('_open');
      const level = requested.legs ? 3 : requested.position_intent === 'buy_to_open' ? 2 : 1;
      if (opening && (account.optionsLevel===null||account.optionsLevel < level)) throw new BrokerError('broker_options_level_required', 409, 'La cuenta no tiene el nivel efectivo de opciones requerido.', false);
      const contracts = await Promise.all(symbols.map(symbol => this.contract(symbol)));
      if (new Set(contracts.map(contract => contract.underlying)).size !== 1) throw new BrokerError('broker_order_invalid', 400, 'Todas las piernas deben pertenecer al mismo subyacente.', false);
      if (opening && Number(requested.limit_price) > 0 && Number(requested.limit_price) * Number(requested.qty) * 100 > account.optionsBuyingPower) throw new BrokerError('broker_insufficient_funds', 409, 'No hay poder de compra de opciones suficiente.', false);
    } else {
      await this.equity(symbols[0]);
      if (requested.side === 'buy' && Number(requested.qty) * Number(requested.limit_price) > Math.min(account.cash, account.buyingPower)) throw new BrokerError('broker_insufficient_funds', 409, 'No hay efectivo suficiente para la cobertura.', false);
      if (requested.side === 'sell') {
        const positions = await this.positions();
        if (!positions.some(position => position.symbol === requested.symbol && position.assetClass === 'us_equity' && position.quantity >= Number(requested.qty))) throw new BrokerError('broker_insufficient_position', 409, 'La cobertura solo permite vender acciones de una posición larga disponible.', false);
      }
    }
    // The review can expire while the preceding provider reads are in flight.
    // An expired review may reconcile an existing order, but can never POST.
    if (notAfter !== undefined && this.now() >= notAfter) throw new BrokerError('f5_preview_expired', 409, 'La revisión venció durante las comprobaciones; no se envió la orden F5.', false);
    if (allowSubmit && !allowSubmit()) throw new BrokerError('f5_paused', 409, 'La política F5 cambió durante las consultas; no se envió la orden.', false);
    this.attempted.set(requested.client_order_id, requested);
    try { return this.matching(parse(orderSchema, await this.request('/v2/orders', { method: 'POST', body: JSON.stringify(requested) })), requested); }
    catch (error) {
      try { const recovered = await this.orderByClientId(requested.client_order_id); if (recovered) return this.matching(recovered, requested); }
      catch (lookupError) { if (lookupError instanceof BrokerError && lookupError.code === 'broker_order_conflict') throw lookupError; }
      if (error instanceof BrokerError && error.status < 500) throw error;
      throw ambiguous();
    }
  }
  async cancel(id: string): Promise<void> { checked(identifier, id); await this.request('/v2/orders/' + encodeURIComponent(id), { method: 'DELETE' }); }
}
