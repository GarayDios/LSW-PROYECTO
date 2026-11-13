import { missingVariable, type ResearchFundamentals, type ResearchVariable } from '../../features/research/model.ts';
import { numeric, providerFailure, record, researchJson, ResearchProviderError, timestamp, validateResearchRequest, type ResearchFetch } from './http.ts';

export type SecResearchConfig = { userAgent: string };
const SOURCE = 'SEC EDGAR Company Facts';
const DAY = 86_400_000;
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

export function missingFundamentals(message = 'Configura SEC_USER_AGENT con nombre de aplicación y contacto en el servidor.'): ResearchFundamentals {
  const missing = (label: string) => missingVariable(`${SOURCE} · ${label}`, message);
  return {
    cik: null, companyName: null, annualRevenue: missing('ingresos anuales'), annualNetIncome: missing('resultado neto anual'),
    assets: missing('activos'), liabilities: missing('pasivos'), cash: missing('efectivo'), sharesOutstanding: missing('acciones'),
    netMargin: missing('margen neto'), liabilitiesToAssets: missing('pasivos/activos'),
    dividendYield: missingVariable('Dividendo futuro continuo q', 'Los pagos pasados no determinan el dividendo futuro continuo; se requiere una fuente prospectiva o un supuesto manual explícito.'),
    status: { source: SOURCE, status: 'missing_config', message }, warnings: [],
  };
}

type SecFact = { variable: ResearchVariable; start: string | null; end: string; filed: string };

/** Filing-day fallback: next day 05:00 UTC is after the full EDGAR Eastern calendar day. */
function conservativeFiledAt(filed: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(filed) && Number.isFinite(Date.parse(filed))
    ? new Date(Date.parse(filed) + DAY + 5 * 3_600_000).toISOString() : null;
}

export function deriveSecFundamentals(companyFacts: unknown, submissions: unknown, asOf: string, cik: string): ResearchFundamentals {
  const result = missingFundamentals('No se encontró un hecho comparable publicado antes del corte.');
  const body = record(companyFacts);
  const filing = record(submissions);
  const gaap = record(record(body.facts)['us-gaap']);
  const dei = record(record(body.facts).dei);
  const recent = record(record(filing.filings).recent);
  const acceptance = new Map<string, string>();
  if (Array.isArray(recent.accessionNumber) && Array.isArray(recent.acceptanceDateTime)) {
    for (let i = 0; i < recent.accessionNumber.length; i++) {
      const date = timestamp(recent.acceptanceDateTime[i]);
      if (date && typeof recent.accessionNumber[i] === 'string') acceptance.set(recent.accessionNumber[i], date);
    }
  }
  const choose = (tags: string[], unit: string, annual = false, taxonomy: Record<string, unknown> = gaap): SecFact | null => {
    const candidates: (SecFact & { priority: number })[] = [];
    tags.forEach((tag, priority) => {
      const values = record(record(taxonomy[tag]).units)[unit];
      if (!Array.isArray(values)) return;
      for (const raw of values) {
        const fact = record(raw);
        const value = numeric(fact.val);
        const end = timestamp(fact.end);
        const start = timestamp(fact.start);
        const filed = typeof fact.filed === 'string' ? fact.filed : '';
        const accession = typeof fact.accn === 'string' ? fact.accn : '';
        const availableAt = acceptance.get(accession) ?? conservativeFiledAt(filed);
        if (value === null || !end || !availableAt || Date.parse(availableAt) > Date.parse(asOf) || Date.parse(end) > Date.parse(asOf)) continue;
        if (!['10-K', '10-Q', '20-F', '40-F', '10-K/A', '10-Q/A', '20-F/A'].includes(String(fact.form))) continue;
        if (annual && (!start || Date.parse(end) - Date.parse(start) < 300 * DAY || Date.parse(end) - Date.parse(start) > 400 * DAY)) continue;
        candidates.push({ priority, start, end, filed,
          variable: { value, source: `${SOURCE} · ${tag} · ${accession}`, observedAt: end, availableAt, kind: 'observed' } });
      }
    });
    candidates.sort((a, b) => b.end.localeCompare(a.end) || a.priority - b.priority || b.filed.localeCompare(a.filed));
    return candidates[0] ?? null;
  };
  const revenue = choose(['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'], 'USD', true);
  const netIncome = choose(['NetIncomeLoss', 'ProfitLoss'], 'USD', true);
  const assets = choose(['Assets'], 'USD');
  const liabilities = choose(['Liabilities'], 'USD');
  const cash = choose(['CashAndCashEquivalentsAtCarryingValue'], 'USD');
  const shares = choose(['EntityCommonStockSharesOutstanding'], 'shares', false, dei) ?? choose(['CommonStockSharesOutstanding'], 'shares');
  const combine = (left: SecFact | null, right: SecFact | null, label: string): ResearchVariable => {
    if (!left || !right || right.variable.value === null || right.variable.value <= 0 || left.start !== right.start || left.end !== right.end) {
      return missingVariable(SOURCE, `${label}: faltan hechos de idéntico período y unidad comparable.`);
    }
    return { value: left.variable.value! / right.variable.value, source: `${SOURCE} · ${label}`, observedAt: left.end,
      availableAt: left.variable.availableAt! > right.variable.availableAt! ? left.variable.availableAt : right.variable.availableAt, kind: 'estimated' };
  };
  result.cik = cik;
  result.companyName = typeof filing.name === 'string' ? filing.name : typeof body.entityName === 'string' ? body.entityName : null;
  if (revenue) result.annualRevenue = revenue.variable;
  if (netIncome) result.annualNetIncome = netIncome.variable;
  if (assets) result.assets = assets.variable;
  if (liabilities) result.liabilities = liabilities.variable;
  if (cash) result.cash = cash.variable;
  if (shares) result.sharesOutstanding = shares.variable;
  result.netMargin = combine(netIncome, revenue, 'resultado neto / ingresos anuales');
  result.liabilitiesToAssets = combine(liabilities, assets, 'pasivos / activos');
  const available = [revenue, netIncome, assets, liabilities, cash, shares].filter(Boolean).length;
  result.status = { source: SOURCE, status: available === 6 ? 'ready' : 'partial', message: `${available}/6 conceptos contables disponibles antes del corte; no todos los emisores usan las mismas etiquetas XBRL.` };
  result.warnings = ['Fundamentales según fecha de aceptación SEC, o cierre conservador del día de presentación cuando no hay hora. El período contable no es la fecha de publicación.',
    'Nombre y correspondencia ticker/CIK son metadatos actuales; no forman parte de una predicción histórica.',
    'Los estados contables aportan contexto; sus ratios no se convierten en una probabilidad de éxito.'];
  return result;
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
