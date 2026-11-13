import { z } from 'zod';
import { readBrokerConfig, BrokerConfigError, BrokerError } from '../brokers/index.ts';
import { fetchAlpacaHistory, historyQuerySchema, MarketDataError, symbolSchema } from '../market/alpaca-history.ts';
import { fetchCompanyResearch } from '../research/company.ts';
import { rankObservedCompanies } from '../../cores/observed-ranking.ts';
import type { CompanyResearch } from '../../features/research/model.ts';
import { ApiError, privateJson, sameOrigin, smallJson } from '../http.ts';

type Environment = Record<string, string | undefined>;
type Dependencies = {
  environment(): Environment; owner(): Promise<{ userId: string } | null>; fetcher?: typeof fetch; now?: () => number;
  history?: typeof fetchAlpacaHistory; research?: typeof fetchCompanyResearch;
};
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
});
const range = historyQuerySchema.omit({ symbol: true, interval: true }).extend({ start: calendarDate, end: calendarDate, cutoff: z.string().datetime({ offset: true }).optional() });
const rankingInput = range.extend({
  symbols: z.array(symbolSchema).min(1).max(14),
  selectedCores: z.array(z.enum(['bsm', 'greeks', 'probability', 'volatility', 'trend', 'liquidity', 'risk'])).min(1).max(7),
  strategy: z.enum(['wheel', 'pmcc', 'backspread', 'gamma']), days: z.number().int().min(1).max(3650),
}).strict();

function publicError(error: unknown): Response {
  if (error instanceof ApiError || error instanceof BrokerConfigError || error instanceof BrokerError || error instanceof MarketDataError) {
    return privateJson({ error: { code: error.code, message: error.message } }, error.status);
  }
  return privateJson({ error: { code: 'research_unavailable', message: 'No fue posible consultar las fuentes de investigación. Intenta de nuevo.' } }, 503);
}

/** No shared market credential or provider diagnostic crosses this authenticated boundary. */
export function createResearchHandlers(dependencies: Dependencies) {
  const fetcher = dependencies.fetcher ?? fetch;
  const cache = new Map<string, { expires: number; value: Promise<CompanyResearch> }>();
  async function authorize() {
    const owner = await dependencies.owner();
    if (!owner) throw new ApiError('auth_required', 'Inicia sesión para consultar los datos de investigación.', 401);
    const environment = dependencies.environment(), config = readBrokerConfig(environment);
    if (!config) throw new ApiError('broker_not_configured', 'Configura la fuente de datos Alpaca en el servidor.', 503);
    if (config.ownerUserId !== owner.userId) throw new ApiError('broker_owner_required', 'Esta fuente de datos pertenece a otro usuario.', 403);
    return { owner, config, environment };
  }
  function decisionTime(input: { start: string; end: string; cutoff?: string }, now: number) {
    if (input.start > input.end || new Date(input.start + 'T00:00:00Z').toISOString().slice(0, 10) !== input.start || new Date(input.end + 'T00:00:00Z').toISOString().slice(0, 10) !== input.end) throw new ApiError('invalid_dates', 'Revisa el rango de fechas.');
    const requested = input.cutoff ? Date.parse(input.cutoff) : now;
    const cutoff = Math.min(requested, Date.parse(input.end + 'T23:59:59.999Z'), now);
    if (!Number.isFinite(cutoff) || cutoff < Date.parse(input.start + 'T00:00:00Z')) throw new ApiError('invalid_cutoff', 'La fecha de decisión debe quedar dentro o después del inicio del histórico.');
    return new Date(cutoff);
  }
  async function snapshot(input: { symbol: string; start: string; end: string }, asOf: Date, now: number, auth: Awaited<ReturnType<typeof authorize>>) {
    // Current snapshots may be reused for at most one minute; their original asOf stays visible.
    const current = asOf.getTime() === now;
    const key = JSON.stringify([auth.owner.userId, input.symbol, input.start, input.end, current ? 'current' : asOf.toISOString(), auth.config.dataFeed, auth.environment.ALPACA_OPTIONS_FEED, Boolean(auth.environment.SEC_USER_AGENT), Boolean(auth.environment.FRED_API_KEY)]);
    const existing = cache.get(key);
    if (existing && existing.expires > now) return existing.value;
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    const value = (async () => {
      const history = await (dependencies.history ?? fetchAlpacaHistory)(auth.config, { symbol: input.symbol, start: input.start, end: input.end, interval: '1d' }, fetcher, now);
      const result = await (dependencies.research ?? fetchCompanyResearch)({
        symbol: input.symbol, bars: history.bars, asOf: asOf.toISOString(), historySource: `alpaca:${history.feed}`,
        alpaca: { apiKey: auth.config.apiKey, secretKey: auth.config.secretKey, optionsFeed: auth.environment.ALPACA_OPTIONS_FEED === 'opra' ? 'opra' : 'indicative' },
        ...(auth.environment.SEC_USER_AGENT?.trim() ? { sec: { userAgent: auth.environment.SEC_USER_AGENT.trim() } } : {}),
        ...(auth.environment.FRED_API_KEY?.trim() ? { fred: { apiKey: auth.environment.FRED_API_KEY.trim() } } : {}),
      }, fetcher, new Date(now));
      result.warnings = [...new Set([...history.warnings, ...result.warnings])];
      return result;
    })();
    cache.set(key, { expires: now + 60000, value });
    try { return await value; } catch (error) { cache.delete(key); throw error; }
  }
  return {
    async company(request: Request) {
      try {
        const auth = await authorize(), params = new URL(request.url).searchParams;
        const parsed = range.extend({ symbol: symbolSchema }).strict().safeParse(Object.fromEntries(params));
        if (!parsed.success) throw new ApiError('invalid_research', 'Selecciona un símbolo y un rango de fechas válidos.');
        const now = dependencies.now?.() ?? Date.now(), asOf = decisionTime(parsed.data, now);
        return privateJson({ research: await snapshot(parsed.data, asOf, now, auth) });
      } catch (error) { return publicError(error); }
    },
    async ranking(request: Request) {
      try {
        sameOrigin(request);
        const auth = await authorize(), parsed = rankingInput.safeParse(await smallJson(request));
        if (!parsed.success) throw new ApiError('invalid_ranking', 'Revisa los símbolos, cores, estrategia y fechas del ranking.');
        const input = parsed.data, now = dependencies.now?.() ?? Date.now(), asOf = decisionTime(input, now);
        const symbols = [...new Set(input.symbols)], snapshots: Record<string, CompanyResearch> = {};
        const excluded: { symbol: string; reason: string }[] = [];
        let index = 0;
        // Bounded parallelism protects provider quotas; partial results explicitly name omissions.
        await Promise.all(Array.from({ length: Math.min(2, symbols.length) }, async () => {
          while (index < symbols.length) {
            const symbol = symbols[index++];
            try { snapshots[symbol] = await snapshot({ symbol, start: input.start, end: input.end }, asOf, now, auth); }
            catch { excluded.push({ symbol, reason: 'La fuente no devolvió un histórico válido; no se sustituyó con datos de muestra.' }); }
          }
        }));
        const ranked = rankObservedCompanies(Object.values(snapshots), [...new Set(input.selectedCores)], input.strategy, input.days);
        return privateJson({ ranked, snapshots, excluded, generatedAt: new Date(now).toISOString(), cutoff: asOf.toISOString(), warnings: [
          'Puntuación heurística de compatibilidad. No es una probabilidad de ganancia.',
          'Cada instantánea conserva su propia fecha de corte; la caché puede reutilizar datos consultados durante los últimos 60 segundos.',
          ...(excluded.length ? ['El ranking es parcial: hay empresas sin datos disponibles.'] : []),
        ] });
      } catch (error) { return publicError(error); }
    },
  };
}
