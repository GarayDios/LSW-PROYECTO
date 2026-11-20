import type { ResearchFundamentals } from '../../cores/compartido/research-model.ts';
import { deriveSecFundamentals, missingFundamentals } from '../../cores/04-analisis-fundamental/sec-fundamentals.ts';
export { deriveSecFundamentals, missingFundamentals } from '../../cores/04-analisis-fundamental/sec-fundamentals.ts';
import { numeric, providerFailure, record, researchJson, ResearchProviderError, validateResearchRequest, type ResearchFetch } from './http.ts';

export type SecResearchConfig = { userAgent: string };
const SOURCE = 'SEC EDGAR Company Facts';
const tickerCache = new WeakMap<ResearchFetch, { expiresAt: number; promise: Promise<unknown> }>();
let secGate = Promise.resolve();
let lastSecStartAt = 0;
let pendingSecRequests = 0;

/** Shared per-process gate; queued requests expire rather than waiting indefinitely. */
async function secJson(url: URL, headers: Record<string, string>, fetcher: ResearchFetch): Promise<unknown> {
  const queuedAt = Date.now();
  const busy = () => new ResearchProviderError(null, 'La cola SEC está ocupada; vuelve a intentar en unos segundos.');
  if (pendingSecRequests >= 24) throw busy();
  pendingSecRequests++;
  const turn = secGate.then(async () => {
    const wait = Math.max(0, lastSecStartAt + 210 - Date.now());
    if (Date.now() - queuedAt + wait > 5_000) throw busy();
    if (wait) await new Promise<void>(resolve => setTimeout(resolve, wait));
    if (Date.now() - queuedAt > 5_000) throw busy();
    lastSecStartAt = Date.now();
  });
  secGate = turn.catch(() => {});
  try { await turn; } finally { pendingSecRequests--; }
  return researchJson(url, headers, fetcher);
}

function cachedTickers(headers: Record<string, string>, fetcher: ResearchFetch): Promise<unknown> {
  const cached = tickerCache.get(fetcher);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const entry = { expiresAt: Date.now() + 3_600_000, promise: secJson(new URL('https://www.sec.gov/files/company_tickers.json'), headers, fetcher) };
  tickerCache.set(fetcher, entry);
  void entry.promise.catch(() => { if (tickerCache.get(fetcher) === entry) tickerCache.delete(fetcher); });
  return entry.promise;
}

export async function fetchSecFundamentals(config: SecResearchConfig | undefined, symbol: string, asOf: string, fetcher: ResearchFetch = fetch): Promise<ResearchFundamentals> {
  validateResearchRequest(symbol, asOf);
  if (!config?.userAgent || !/\S+@\S+/.test(config.userAgent) || /[\r\n]/.test(config.userAgent)) return missingFundamentals();
  try {
    const headers = { 'User-Agent': config.userAgent };
    const tickers = record(await cachedTickers(headers, fetcher));
    const company = Object.values(tickers).map(record).find(item => item.ticker === symbol || item.ticker === symbol.replace('.', '-'));
    const cikNumber = numeric(company?.cik_str);
    if (cikNumber === null || cikNumber <= 0 || !Number.isInteger(cikNumber)) return {
      ...missingFundamentals(), status: { source: SOURCE, status: 'unavailable', message: 'El símbolo no tiene una correspondencia CIK en el directorio SEC actual.' },
    };
    const cik = String(cikNumber).padStart(10, '0');
    const [facts, submissions] = await Promise.all([
      secJson(new URL(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`), headers, fetcher),
      secJson(new URL(`https://data.sec.gov/submissions/CIK${cik}.json`), headers, fetcher),
    ]);
    if (!Object.keys(record(record(facts).facts)).length) throw new Error('invalid SEC facts');
    return deriveSecFundamentals(facts, submissions, asOf, cik);
  } catch (error) { return { ...missingFundamentals(), status: providerFailure(SOURCE, error) }; }
}
