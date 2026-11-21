import { z } from 'zod';
import { readBrokerConfig, BrokerConfigError } from '../brokers/config.ts';
import { ApiError, privateJson } from '../http.ts';
import { symbolSchema } from '../market/alpaca-history.ts';
import { historyIssue } from '../../features/market/chart-history.ts';
import { easternTime } from '../../features/research/contract-terms.ts';
import { fetchAlpacaNews } from '../research/alpaca.ts';
import type { NewsTimelinePage } from '../../cores/compartido/research-model.ts';

type Dependencies = { environment(): Record<string, string | undefined>; owner(): Promise<{ userId: string } | null>; fetcher?: typeof fetch; now?: () => number };
const querySchema = z.object({ symbol: symbolSchema, start: z.string(), end: z.string(), cutoff: z.string().datetime({ offset: true }).optional(), pageToken: z.string().min(1).max(8000).optional() }).strict();

/** One bounded batch of news only: do not reload option chains or financial data.
 * Later batches keep the first response's cutoff so the timeline cannot gain
 * future revisions while paging through a historical query.
 */
export function createNewsHandler(deps: Dependencies) {
  const cache = new Map<string, { expires: number; value: Promise<NewsTimelinePage> }>();
  return async (request: Request): Promise<Response> => {
    try {
      const owner = await deps.owner();
      if (!owner) throw new ApiError('auth_required', 'Inicia sesión para consultar noticias.', 401);
      const config = readBrokerConfig(deps.environment());
      if (!config) throw new ApiError('broker_not_configured', 'Configura Alpaca en el servidor para consultar noticias.', 503);
      if (owner.userId !== config.ownerUserId) throw new ApiError('broker_owner_required', 'Esta fuente de noticias pertenece a otro usuario.', 403);
      const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) throw new ApiError('invalid_news', 'Revisa el símbolo, las fechas y la continuación de noticias.');
      const input = parsed.data, issue = historyIssue(input.start, input.end);
      if (issue) throw new ApiError('invalid_news', issue);
      if (input.pageToken && !input.cutoff) throw new ApiError('invalid_news', 'La continuación necesita la fecha de corte de la consulta inicial.');
      const start = easternTime(input.start, '00:00:00'), end = easternTime(input.end, '23:59:59');
      const now = deps.now?.() ?? Date.now();
      const cutoff = Math.min(now, Date.parse(end ?? '') + 999, input.cutoff ? Date.parse(input.cutoff) : now);
      if (!start || !Number.isFinite(cutoff) || cutoff < Date.parse(start)) throw new ApiError('invalid_news', 'El periodo de noticias debe incluir fechas conocidas antes del corte.');
      const asOf = new Date(cutoff).toISOString();
      const key = JSON.stringify([owner.userId, config.apiKey, config.secretKey, input.symbol, input.start, input.end, input.cutoff ?? 'current', input.pageToken]);
      let entry = cache.get(key);
      if (!entry || entry.expires <= now) {
        if (cache.size >= 64) cache.delete(cache.keys().next().value!);
        const value = (async (): Promise<NewsTimelinePage> => {
          const { nextPageToken = null, ...news } = await fetchAlpacaNews({ apiKey: config.apiKey, secretKey: config.secretKey, maxPages: 2 }, input.symbol, asOf, deps.fetcher ?? fetch, { start, ...(input.pageToken ? { pageToken: input.pageToken } : {}) });
          if (news.status.status === 'error' || news.status.status === 'missing_config') throw new ApiError('news_unavailable', news.status.message, 503);
          return { symbol: input.symbol, start: input.start, end: input.end, asOf, news, nextPageToken };
        })();
        entry = { expires: now + 60000, value }; cache.set(key, entry);
        void value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
      }
      return privateJson(await entry.value);
    } catch (error) {
      if (error instanceof ApiError || error instanceof BrokerConfigError) return privateJson({ error: { code: error.code, message: error.message } }, error.status);
      return privateJson({ error: { code: 'news_unavailable', message: 'No se pudieron consultar las noticias. Intenta de nuevo.' } }, 503);
    }
  };
}
