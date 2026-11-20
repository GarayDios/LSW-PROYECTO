import { normalizeFinancialNews } from '../../cores/03-noticias-financieras/normalize-news.ts';
import { beforeCutoff, missingVariable, type ObservedOptionContract, type ResearchNews, type ResearchOptions, type ResearchVariable } from '../../cores/compartido/research-model.ts';
import { nextToken, numeric, providerFailure, record, researchJson, timestamp, validateResearchRequest, type ResearchFetch } from './http.ts';
import { easternTime } from '../../features/research/contract-terms.ts';

export type AlpacaResearchConfig = { apiKey: string; secretKey: string; optionsFeed?: 'indicative' | 'opra'; stockFeed?:'iex'|'sip';maxPages?: number };
const DATA = 'https://data.alpaca.markets';
const PAPER = 'https://paper-api.alpaca.markets';
const DAY = 86_400_000;

function headers(config: AlpacaResearchConfig): Record<string, string> {
  return { 'APCA-API-KEY-ID': config.apiKey, 'APCA-API-SECRET-KEY': config.secretKey };
}
function pageLimit(value: number | undefined): number { return Math.max(1, Math.min(10, Number.isInteger(value) ? value! : 5)); }

export function missingOptions(message = 'Configura las claves Alpaca Paper en el servidor.'): ResearchOptions {
  return { contracts: [], feed: null, complete: false, status: { source: 'Alpaca opciones', status: 'missing_config', message }, warnings: [] };
}

/** Latest snapshots are never represented as a historical chain. No feed fallback. */
export async function fetchAlpacaOptions(config: AlpacaResearchConfig | undefined, symbol: string, asOf: string, fetcher: ResearchFetch = fetch, now = new Date()): Promise<ResearchOptions> {
  validateResearchRequest(symbol, asOf);
  if (!config?.apiKey || !config.secretKey) return missingOptions();
  if (Date.parse(asOf) < now.getTime()) return {
    ...missingOptions(), status: { source: 'Alpaca opciones', status: 'unavailable', message: 'La cadena es una consulta actual; no se utiliza para un corte histórico anterior a la consulta.' },
  };
  const feed = config.optionsFeed ?? 'indicative';
  const acquiredAt = now.toISOString();
  const expirationStart = acquiredAt.slice(0, 10);
  const expirationEnd = new Date(now.getTime() + 730 * DAY).toISOString().slice(0, 10);
  const maxPages = pageLimit(config.maxPages);
  const warnings = feed === 'indicative' ? ['Feed indicative: operaciones retrasadas y cotizaciones modificadas; no representa precios OPRA ejecutables.'] : [];
  try {
    const loadPages = async (base: string, path: string, key: string, params: Record<string, string>) => {
      const data: Record<string, unknown>[] = [];
      const snapshots: Record<string, unknown> = {};
      const seen = new Set<string>();
      let token: string | null = null;
      let complete = false;
      for (let page = 0; page < maxPages; page++) {
        const url = new URL(path, base);
        for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
        if (token) url.searchParams.set('page_token', token);
        const body = record(await researchJson(url, headers(config), fetcher));
        if (key === 'snapshots') {
          if (!body.snapshots || typeof body.snapshots !== 'object' || Array.isArray(body.snapshots)) throw new Error('invalid snapshots');
          Object.assign(snapshots, record(body.snapshots));
        } else {
          if (!Array.isArray(body[key])) throw new Error('invalid contracts');
          data.push(...body[key].map(record));
        }
        token = nextToken(body.next_page_token);
        if (!token) { complete = true; break; }
        if (seen.has(token)) throw new Error('repeated pagination token');
        seen.add(token);
      }
      return { data, snapshots, complete };
    };
    const [chain, metadata] = await Promise.all([
      loadPages(DATA, `/v1beta1/options/snapshots/${encodeURIComponent(symbol)}`, 'snapshots', { feed, limit: '1000', expiration_date_gte: expirationStart, expiration_date_lte: expirationEnd }),
      loadPages(PAPER, '/v2/options/contracts', 'option_contracts', { underlying_symbols: symbol, status: 'active', expiration_date_gte: expirationStart, expiration_date_lte: expirationEnd, limit: '1000', show_deliverables: 'true' }),
    ]);
    // These sources enrich the horizon but never turn a trading close into an
    // asserted exercise deadline. Failures preserve the chain with an explicit fallback.
    let calendar: {date:string;close:string}[] = [];
    let lateClose: boolean | null = null;
    if (metadata.data.length) {
      const calendarUrl=new URL('/v2/calendar',PAPER);
      calendarUrl.searchParams.set('start',new Date(now.getTime()-7*DAY).toISOString().slice(0,10));
      calendarUrl.searchParams.set('end',expirationEnd);
      const extra=await Promise.allSettled([
        researchJson(calendarUrl,headers(config),fetcher),
        researchJson(new URL(`/v2/assets/${encodeURIComponent(symbol)}`,PAPER),headers(config),fetcher),
      ]);
      if(extra[0].status==='fulfilled' && Array.isArray(extra[0].value))calendar=extra[0].value.map(record).flatMap(row=>
        typeof row.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && typeof row.close==='string' && easternTime(row.date,row.close)
          ? [{date:row.date,close:row.close}] : []).sort((a,b)=>a.date.localeCompare(b.date));
      if(extra[1].status==='fulfilled') {
        const asset=record(extra[1].value);
        if(asset.symbol===symbol && Array.isArray(asset.attributes))lateClose=asset.attributes.includes('options_late_close');
      }
      if(!calendar.length || lateClose===null)warnings.push('Calendario o atributo de cierre tardío no verificado; el horizonte usará 16:00 ET como supuesto identificado.');
    }
    const complete = chain.complete && metadata.complete;
    if (!complete) warnings.push(`Cadena parcial: se alcanzó el límite explícito de ${maxPages} páginas por recurso.`);
    const contracts: ObservedOptionContract[] = [];
    for (const item of metadata.data) {
      if (typeof item.symbol !== 'string' || item.underlying_symbol !== symbol || !['call', 'put'].includes(String(item.type))) continue;
      if (typeof item.expiration_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.expiration_date)) continue;
      const snap = record(chain.snapshots[item.symbol]);
      if (!Object.keys(snap).length) continue;
      const quote = record(snap.latestQuote);
      const quoteAt = timestamp(quote.t);
      const greeks = record(snap.greeks);
      const bidNumber = numeric(quote.bp);
      const askNumber = numeric(quote.ap);
      const quoteProblem = quoteAt === null
        ? 'Falta la cotización o su fecha verificable.'
        : Date.parse(quoteAt) > now.getTime()
          ? 'La fecha de la cotización es posterior a la consulta; no se utiliza.'
          : bidNumber === null || askNumber === null
            ? 'Falta el precio de compra (bid) o de venta (ask).'
            : bidNumber < 0 || askNumber <= 0 || bidNumber > askNumber
              ? 'Los precios bid/ask no forman una cotización válida.'
              : now.getTime() - Date.parse(quoteAt) > 60 * 60_000
                ? `La última cotización es de ${quoteAt} (UTC) y supera el límite de una hora. Actualiza durante la sesión de mercado; puede seguir sin haber cotización reciente para este contrato.`
                : null;
      const validQuote = quoteProblem === null;
      const raw = (value: unknown, label: string, observedAt: string | null, kind: 'observed' | 'estimated' = 'observed'): ResearchVariable => {
        const parsed = numeric(value);
        return parsed === null || !observedAt ? missingVariable(`Alpaca ${feed} · ${label}`, 'Dato no publicado o sin fecha verificable.')
          : beforeCutoff({ value: parsed, source: `Alpaca ${feed} · ${label}`, observedAt, availableAt: acquiredAt, kind }, asOf);
      };
      const staleValidQuote = quoteAt !== null && Date.parse(quoteAt) <= now.getTime()
        && now.getTime() - Date.parse(quoteAt) > 60 * 60_000
        && bidNumber !== null && askNumber !== null && bidNumber >= 0 && askNumber > 0 && bidNumber <= askNumber;
      const quoteVar = (value: unknown, label: string, kind: 'observed' | 'estimated' = 'observed'): ResearchVariable => {
        if (validQuote) return raw(value, label, quoteAt, feed === 'indicative' ? 'estimated' : kind);
        const missing = missingVariable(`Alpaca ${feed} · ${label}`, quoteProblem!);
        const parsed = numeric(value);
        if (staleValidQuote && parsed !== null) missing.lastReceived = { value: parsed, observedAt: quoteAt!, receivedAt: acquiredAt };
        return missing;
      };
      const iv = numeric(snap.impliedVolatility);
      const deliverables=Array.isArray(item.deliverables)?item.deliverables.map(record):[];
      const delivered=deliverables[0];
      const shares=numeric(item.size),amount=numeric(delivered?.amount);
      const singleEquity=deliverables.length===1 && delivered.type==='equity' && delivered.delayed_settlement!==true
        && (delivered.symbol===symbol || typeof item.underlying_asset_id==='string' && delivered.asset_id===item.underlying_asset_id)
        && shares!==null && shares>0 && amount===shares;
      const session=calendar.filter(row=>row.date<=String(item.expiration_date)
        && Date.parse(String(item.expiration_date))-Date.parse(row.date)<7*DAY).at(-1);
      const close=session && lateClose!==null ? easternTime(session.date,session.close):null;
      const valuationAt=close ? new Date(Date.parse(close)+(lateClose?15*60000:0)).toISOString():null;
      contracts.push({
        symbol: item.symbol, underlyingSymbol: symbol, type: item.type as 'call' | 'put', expiration: item.expiration_date,
        multiplier: raw(item.multiplier,'multiplicador de prima y ejercicio',acquiredAt),
        deliverableShares: raw(singleEquity?shares:null,'acciones entregables verificadas',acquiredAt),
        deliverableType: singleEquity?'single_equity':deliverables.length?'unsupported':'unknown',
        ...(valuationAt?{valuationExpiry:{at:valuationAt,availableAt:acquiredAt,
          source:`Alpaca calendario y atributo options_late_close: ${session!.date} ${session!.close} ET${lateClose?' +15 minutos':''}; horizonte de valoración estimado, no plazo legal de ejercicio`}}:{}),
        style: item.style === 'american' || item.style === 'european' ? item.style : 'unknown',
        strike: raw(item.strike_price, 'strike contractual', acquiredAt),
        impliedVolatility: iv !== null && iv > 0 ? quoteVar(iv, 'IV implícita publicada por proveedor') : missingVariable(`Alpaca ${feed} · IV`, 'No hay IV positiva publicada para este contrato.'),
        bid: quoteVar(bidNumber, 'bid'), ask: quoteVar(askNumber, 'ask'),
        premium: quoteVar(validQuote || staleValidQuote ? (bidNumber! + askNumber!) / 2 : null, 'prima media bid/ask (estimada, por acción)', 'estimated'),
        openInterest: raw(item.open_interest, 'open interest contractual', timestamp(item.open_interest_date)),
        delta: quoteVar(greeks.delta, 'delta publicada'), gamma: quoteVar(greeks.gamma, 'gamma publicada'),
        theta: quoteVar(greeks.theta, 'theta publicada'), vega: quoteVar(greeks.vega, 'vega publicada'),
      });
    }
    return { contracts, feed, complete, warnings, status: {
      source: 'Alpaca opciones', status: complete && contracts.length ? 'ready' : 'partial',
      message: contracts.length ? `${contracts.length} contratos encontrados; ${contracts.filter(contract => contract.premium.value !== null).length} con cotización válida de hasta una hora. Feed ${feed}; esto no garantiza todas las entradas del modelo.` : 'No hay contratos coincidentes con snapshot y metadatos observados.',
    } };
  } catch (error) { return { contracts: [], feed, complete: false, status: providerFailure('Alpaca opciones', error), warnings }; }
}

export function missingNews(): ResearchNews {
  return { articles: [], complete: false, status: { source: 'Alpaca noticias', status: 'missing_config', message: 'Configura las claves Alpaca Paper en el servidor.' }, warnings: [] };
}

export async function fetchAlpacaNews(config: AlpacaResearchConfig | undefined, symbol: string, asOf: string, fetcher: ResearchFetch = fetch): Promise<ResearchNews> {
  validateResearchRequest(symbol, asOf);
  if (!config?.apiKey || !config.secretKey) return missingNews();
  try {
    const articles: ResearchNews['articles'] = [];
    const seen = new Set<string>();
    let token: string | null = null;
    let complete = false;
    const maxPages = pageLimit(config.maxPages);
    for (let page = 0; page < maxPages; page++) {
      const url = new URL('/v1beta1/news', DATA);
      Object.entries({ symbols: symbol, start: new Date(Date.parse(asOf) - 7 * DAY).toISOString(), end: asOf, sort: 'desc', limit: '50', include_content: 'false' }).forEach(([name, value]) => url.searchParams.set(name, value));
      if (token) url.searchParams.set('page_token', token);
      const body = record(await researchJson(url, headers(config), fetcher));
      if (!Array.isArray(body.news)) throw new Error('invalid news');
      articles.push(...normalizeFinancialNews(body.news, asOf));
      token = nextToken(body.next_page_token);
      if (!token) { complete = true; break; }
      if (seen.has(token)) throw new Error('repeated token');
      seen.add(token);
    }
    return { articles: [...new Map(articles.map(item => [item.id, item])).values()], complete,
      status: { source: 'Alpaca noticias', status: complete ? 'ready' : 'partial', message: 'Titulares de los siete días anteriores al corte; sin puntuación automática de sentimiento.' },
      warnings: complete ? [] : [`Noticias parciales: límite de ${maxPages} páginas.`] };
  } catch (error) { return { articles: [], complete: false, status: providerFailure('Alpaca noticias', error), warnings: [] }; }
}
