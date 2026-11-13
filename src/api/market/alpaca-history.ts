import { z } from 'zod';
import type { BrokerConfig } from '../brokers/config.ts';
import { historyIssue, type Candle } from '../../features/market/chart-history.ts';

export type HistoryInterval = '5m' | '15m' | '1h' | '1d';
export type HistoryQuery = { symbol: string; start: string; end: string; interval: HistoryInterval };
export type MarketHistory = HistoryQuery & {
  source: 'alpaca'; feed: 'iex' | 'sip'; adjustment: 'split'; asOf: string;
  bars: Candle[]; warnings: string[];
  coverage: { firstBar: string | null; lastBar: string | null; requestedStart: string; requestedEnd: string };
};
export class MarketDataError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 503) { super(message); this.code = code; this.status = status; }
}
const DATA_URL = 'https://data.alpaca.markets';
const PAPER_URL = 'https://paper-api.alpaca.markets';
const DAY = 86400000;
export const symbolSchema = z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/);
export const historyQuerySchema = z.object({ symbol: symbolSchema, start: z.string(), end: z.string(), interval: z.enum(['5m', '15m', '1h', '1d']) }).strict();
const barSchema = z.object({
  t: z.string().refine(value => Number.isFinite(Date.parse(value))), o: z.number().finite().positive(), h: z.number().finite().positive(),
  l: z.number().finite().positive(), c: z.number().finite().positive(), v: z.number().finite().nonnegative(),
}).refine(value => value.h >= Math.max(value.o, value.c, value.l) && value.l <= Math.min(value.o, value.c, value.h));
const pageSchema = z.object({ bars: z.array(barSchema).nullable(), next_page_token: z.string().nullable().optional(), symbol: z.string().optional() });
const calendarSchema = z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) }));
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function newYorkDate(time: number): string {
  const parts = dateFormat.formatToParts(new Date(time));
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}-${parts.find(part => part.type === 'day')!.value}`;
}

async function providerJson(url: string, config: BrokerConfig, fetcher: typeof fetch): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      headers: { 'APCA-API-KEY-ID': config.apiKey, 'APCA-API-SECRET-KEY': config.secretKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000), cache: 'no-store', redirect: 'manual',
    });
    if (!response.ok) {
      if (response.status === 429) throw new MarketDataError('market_rate_limited', 'El proveedor alcanzó su límite de consultas. Espera antes de reintentar.', 429);
      if (response.status === 401 || response.status === 403) throw new MarketDataError('market_access_denied', 'Alpaca rechazó el acceso. Revisa las claves de práctica y los permisos del feed en el servidor.', 503);
      throw new MarketDataError('market_unavailable', 'No se pudo consultar el histórico de Alpaca.');
    }
    return await response.json();
  } catch (error) {
    if (error instanceof MarketDataError) throw error;
    throw new MarketDataError('market_unavailable', 'El proveedor de histórico no respondió correctamente.');
  }
}

/** Real split-adjusted bars. All pages are read; missing or partial data never becomes synthetic data. */
export async function fetchAlpacaHistory(config: BrokerConfig, query: HistoryQuery, fetcher: typeof fetch = fetch, now = Date.now()): Promise<MarketHistory> {
  const parsedQuery = historyQuerySchema.safeParse(query);
  if (!parsedQuery.success) throw new MarketDataError('invalid_history', 'Revisa símbolo, fechas y temporalidad.', 400);
  const issue = historyIssue(query.start, query.end);
  if (issue) throw new MarketDataError('invalid_history', issue, 400);
  const span = (Date.parse(query.end) - Date.parse(query.start)) / DAY;
  const maximum = { '5m': 31, '15m': 93, '1h': 366, '1d': 3660 }[query.interval];
  if (span > maximum) throw new MarketDataError('interval_range_exceeded', `Para ese rango utiliza velas diarias. ${query.interval} admite hasta ${maximum} días por consulta.`, 400);
  const today = newYorkDate(now);
  if (query.start > today) throw new MarketDataError('future_history', 'El histórico solo puede consultar fechas observadas.', 400);
  // A wide UTC envelope includes the entire selected New York date through DST.
  // Exact dates and regular sessions are enforced after parsing provider bars.
  const requestedEnd = Date.parse(query.end + 'T23:59:59.999-05:00');
  const cutoff = now - 16 * 60000;
  const end = new Date(Math.min(requestedEnd, cutoff)).toISOString();
  const start = query.start + 'T00:00:00.000Z';
  const timeframe = { '5m': '5Min', '15m': '15Min', '1h': '30Min', '1d': '1Day' }[query.interval];
  const warnings: string[] = [];
  if (config.dataFeed === 'iex') warnings.push('IEX cubre una sola bolsa; su volumen no representa todo el mercado estadounidense.');
  if (query.end >= today) warnings.push('Se excluyen datos recientes y la vela diaria del día en curso; las señales usan únicamente velas cerradas.');
  const sessions = new Map<string, { open: string; close: string }>();
  if (query.interval !== '1d') {
    const url = new URL(PAPER_URL + '/v2/calendar');
    url.searchParams.set('start', query.start); url.searchParams.set('end', query.end > today ? today : query.end);
    const calendar = calendarSchema.safeParse(await providerJson(url.href, config, fetcher));
    if (!calendar.success) throw new MarketDataError('invalid_market_response', 'El calendario del proveedor no tiene un formato válido.');
    for (const session of calendar.data) sessions.set(session.date, session);
  }
  const rows = new Map<number, Candle>();
  const tokens = new Set<string>();
  let token: string | null = null;
  let pages = 0;
  do {
    if (++pages > 8) throw new MarketDataError('history_too_large', 'El histórico requiere demasiadas páginas. Reduce el rango o utiliza velas diarias.', 400);
    const url = new URL(`${DATA_URL}/v2/stocks/${encodeURIComponent(query.symbol)}/bars`);
    for (const [key, value] of Object.entries({ timeframe, start, end, limit: '10000', feed: config.dataFeed, adjustment: 'split', sort: 'asc' })) url.searchParams.set(key, value);
    if (token) url.searchParams.set('page_token', token);
    const page = pageSchema.safeParse(await providerJson(url.href, config, fetcher));
    if (!page.success || (page.data.symbol && page.data.symbol !== query.symbol)) throw new MarketDataError('invalid_market_response', 'Las velas del proveedor no tienen un formato válido.');
    for (const bar of page.data.bars ?? []) {
      const time = Date.parse(bar.t);
      const date = newYorkDate(time);
      if (date < query.start || date > query.end || time > cutoff) continue;
      if (query.interval === '1d') { if (date >= today) continue; }
      else {
        const session = sessions.get(date), clock = timeFormat.format(new Date(time));
        const duration = (query.interval === '1h' ? 30 : query.interval === '15m' ? 15 : 5) * 60000;
        if (!session || clock < session.open || clock >= session.close || time + duration > cutoff) continue;
      }
      rows.set(time, { time, open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v });
    }
    if (rows.size > 20000) throw new MarketDataError('history_too_large', 'El histórico es demasiado grande. Reduce el rango o utiliza velas diarias.', 400);
    token = page.data.next_page_token ?? null;
    if (token) {
      if (tokens.has(token)) throw new MarketDataError('invalid_market_response', 'El proveedor repitió una página; el histórico no se mostrará incompleto.');
      tokens.add(token);
    }
  } while (token);
  let bars = [...rows.values()].sort((a, b) => a.time - b.time);
  if (query.interval === '1h') {
    const grouped = new Map<string, Candle>();
    // Bucket by session clock, so a missing half-hour never shifts later hours.
    for (const bar of bars) {
      const date = newYorkDate(bar.time), session = sessions.get(date)!;
      const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
      const elapsed = minutes(timeFormat.format(new Date(bar.time))) - minutes(session.open);
      const bucket = Math.floor(elapsed / 60), key = `${date}:${bucket}`;
      const existing = grouped.get(key);
      if (existing) { existing.high = Math.max(existing.high, bar.high); existing.low = Math.min(existing.low, bar.low); existing.close = bar.close; existing.volume += bar.volume; }
      else grouped.set(key, { ...bar, time: bar.time - (elapsed % 60) * 60000 });
    }
    bars = [...grouped.values()];
  }
  if (!bars.length) warnings.push('No hay velas para este símbolo y rango. Comprueba la fecha de cotización, las sesiones y los permisos de datos.');
  else if (newYorkDate(bars[0].time) > query.start && Date.parse(newYorkDate(bars[0].time)) - Date.parse(query.start) > 7 * DAY) warnings.push('La cobertura del proveedor comienza después del inicio solicitado; no se completan huecos con datos inventados.');
  return { ...query, source: 'alpaca', feed: config.dataFeed, adjustment: 'split', asOf: new Date(now).toISOString(), bars, warnings, coverage: { firstBar: bars[0] ? new Date(bars[0].time).toISOString() : null, lastBar: bars.at(-1) ? new Date(bars.at(-1)!.time).toISOString() : null, requestedStart: query.start, requestedEnd: query.end } };
}
