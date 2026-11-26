import { randomUUID, timingSafeEqual } from 'node:crypto';
import getRawBody from 'raw-body';

const endpoint = '/__local_research/fred';
const virtualId = 'virtual:local-research-fetch';
const fredOrigin = 'https://api.stlouisfed.org';
const fields = new Set(['series_id', 'file_type', 'realtime_start', 'realtime_end', 'observation_end', 'sort_order', 'limit']);
const series = new Set(['DGS3MO', 'CPIAUCSL', 'A191RL1Q225SBEA']);

/** workerd on Windows can time out connecting to FRED while Node succeeds.
 * Keep this fixed-provider bridge private and absent from production builds. */
export function localResearchFetch({ enabled = true, fetcher = fetch } = {}) {
  const token = randomUUID();
  let development = false, server;
  return {
    name: 'local-research-fetch',
    configResolved(config) { development = enabled && config.command === 'serve'; },
    configureServer(vite) {
      server = vite;
      if (!development) return;
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== endpoint) return next();
        const supplied = Buffer.from(request.headers.authorization ?? '');
        const expected = Buffer.from('Bearer ' + token);
        const reply = (status, value) => {
          response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify(value));
        };
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(401, { error: 'unauthorized' });
        if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
        try {
          const query = JSON.parse(await getRawBody(request, { limit: 4096, encoding: 'utf8' }));
          if (!query || Array.isArray(query) || !series.has(query.series_id) || query.file_type !== 'json' ||
            Object.entries(query).some(([key, value]) => !fields.has(key) || typeof value !== 'string' || value.length > 128)) return reply(400, { error: 'invalid_query' });
          if (!process.env.FRED_API_KEY?.trim()) return reply(503, { error: 'missing_config' });
          const url = new URL('/fred/series/observations', fredOrigin);
          for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
          url.searchParams.set('api_key', process.env.FRED_API_KEY.trim());
          const upstream = await fetcher(url, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
          if (!upstream.ok) return reply(upstream.status >= 300 && upstream.status < 400 ? 502 : upstream.status, { error: 'provider_unavailable' });
          const body = await upstream.text();
          if (body.length > 1000000) return reply(502, { error: 'invalid_response' });
          response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(body);
        } catch { reply(502, { error: 'provider_unavailable' }); }
      });
    },
    resolveId(id) { if (id === virtualId) return '\0' + virtualId; },
    load(id, options) {
      if (id !== '\0' + virtualId) return;
      if (this.environment?.name === 'client' || (!this.environment && !options?.ssr)) throw new Error('Research transport is server-only.');
      if (!development) return 'export default (input, init) => fetch(input, init);';
      const address = `http://127.0.0.1:${server.config.server.port}${endpoint}`;
      return `export default async function(input, init) {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (url.origin !== ${JSON.stringify(fredOrigin)} || url.pathname !== '/fred/series/observations') return fetch(input, init);
        const query = Object.fromEntries(url.searchParams); delete query.api_key;
        return fetch(${JSON.stringify(address)}, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: ${JSON.stringify('Bearer ' + token)}}, body: JSON.stringify(query), redirect: 'manual', signal: init?.signal});
      }`;
    },
  };
}
