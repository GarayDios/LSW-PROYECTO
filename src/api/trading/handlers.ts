import { z } from 'zod';
import { AlpacaPaperClient, BrokerConfigError, BrokerError, readBrokerConfig, type BrokerConfig } from '../brokers/index.ts';
import { fetchAlpacaHistory, historyQuerySchema, MarketDataError, symbolSchema } from '../market/alpaca-history.ts';
import { ApiError, privateJson, sameOrigin, smallJson } from '../http.ts';

type Environment = Record<string, string | undefined>;
type Owner = { userId: string };
type Dependencies = { environment(): Environment; owner(): Promise<Owner | null>; fetcher?: typeof fetch; now?: () => number; manualOnly?:boolean };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const planSchema = z.object({
  symbol: symbolSchema, historyYears: z.union([z.literal(3), z.literal(5)]), startDate: date, endDate: date,
  maxOrderUsd: z.number().finite().positive().max(10000), maxPositionUsd: z.number().finite().positive().max(10000),
  exitPolicy: z.object({
    stopLossPct: z.number().finite().min(0.1).max(50), takeProfitPct: z.number().finite().min(0.1).max(200),
    exitOnSignal: z.boolean().optional(), closeAtEnd: z.boolean().optional(),
    execution: z.enum(['monitored', 'bracket']).optional(),
  }).strict().refine(policy => policy.execution !== 'bracket' || !policy.exitOnSignal && !policy.closeAtEnd).nullable().optional(),
  maxDailyLossUsd: z.number().finite().min(1).max(25000).optional(),
  maxTotalExposureUsd: z.number().finite().min(1).max(1000000).optional(),
}).strict().refine(value => value.startDate <= value.endDate && value.maxOrderUsd <= value.maxPositionUsd);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), plan: planSchema }).strict(),
  z.object({ action: z.literal('enable'), planId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('disable'), planId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('tick') }).strict(),
  z.object({ action: z.literal('pause') }).strict(),
  z.object({ action: z.literal('resume') }).strict(),
]);

function errorResponse(error: unknown): Response {
  if (error instanceof ApiError || error instanceof MarketDataError || error instanceof BrokerError || error instanceof BrokerConfigError) {
    return privateJson({ error: { code: error.code, message: error.message } }, error.status);
  }
  return privateJson({ error: { code: 'service_unavailable', message: 'El servicio no respondió correctamente. No se confirmó ninguna nueva operación.' } }, 503);
}
function runnerConfiguration(environment: Environment) {
  const value = environment.TRADING_RUNNER_URL?.trim(), token = environment.TRADING_RUNNER_TOKEN?.trim();
  if (!value && !token) return null;
  if (!value || !token || token.length < 32 || token.length > 512 || /[\r\n]/.test(token)) throw new ApiError('runner_configuration_invalid', 'Revisa la configuración del servicio de práctica en el servidor.', 503);
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError('runner_configuration_invalid', 'La URL del servicio de práctica no es válida.', 503); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new ApiError('runner_configuration_invalid', 'El servicio de práctica requiere HTTPS o una dirección local.', 503);
  return { url: url.origin, token };
}

/** Shared server request boundary for historical data and the private paper account. */
export function createTradingHandlers(dependencies: Dependencies) {
  const fetcher = dependencies.fetcher ?? fetch;
  async function authorized(): Promise<{ config: BrokerConfig; environment: Environment; owner: Owner }> {
    const environment = dependencies.environment();
    const config = readBrokerConfig(environment);
    if (!config) throw new ApiError('broker_not_configured', 'Configura las claves de Alpaca Paper y el propietario de la cuenta en el servidor.', 503);
    const owner = await dependencies.owner();
    if (!owner) throw new ApiError('auth_required', 'Inicia sesión para consultar la cuenta de práctica y sus datos.', 401);
    if (owner.userId !== config.ownerUserId) throw new ApiError('broker_owner_required', 'Esta cuenta de práctica pertenece a otro usuario del terminal.', 403);
    return { config, environment, owner };
  }
  async function runner(path: string, ownerId: string, environment: Environment, method = 'GET', body?: Record<string, unknown>) {
    const config = runnerConfiguration(environment);
    if (!config) throw new ApiError('runner_not_configured', 'Configura e inicia el servicio de automatización de práctica.', 503);
    const url = new URL(path, config.url);
    if (method === 'GET') url.searchParams.set('ownerId', ownerId);
    let response: Response;
    try {
      response = await fetcher(url.href, {
        method, headers: { Authorization: `Bearer ${config.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify({ ...body, ownerId }) } : {}),
        redirect: 'manual', signal: AbortSignal.timeout(method === 'GET' ? 10000 : 90000), cache: 'no-store',
      });
    } catch { throw new ApiError('runner_unavailable', 'El servicio de automatización no está disponible. Revisa que siga ejecutándose.', 503); }
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // The runner is a separate process. Return known public messages, never raw server diagnostics.
      const status = [400, 403, 404, 409, 413, 422, 429].includes(response.status) ? response.status : 503;
      throw new ApiError('runner_request_rejected', status === 409 ? 'El plan no puede activarse o ejecutarse en su estado actual. Revisa el servicio y sus límites.' : 'El servicio de práctica rechazó la solicitud. Revisa el plan y la configuración.', status);
    }
    if (!value || typeof value !== 'object') throw new ApiError('runner_invalid_response', 'El servicio de práctica devolvió una respuesta inválida.', 503);
    return privateJson(value, response.status);
  }
  return {
    async status() {
      try {
        const environment = dependencies.environment(), config = readBrokerConfig(environment), owner = await dependencies.owner();
        return privateJson({
          alpaca: { configured: Boolean(config), ownerAuthorized: Boolean(config && owner?.userId === config.ownerUserId), mode: 'paper' },
          webull: { supported: true, requiresApproval: true, mode:'sandbox', connected:false },
          automation: { configured: Boolean(environment.TRADING_RUNNER_URL && environment.TRADING_RUNNER_TOKEN), enabled: dependencies.manualOnly===false&&environment.ALPACA_AUTOMATION_ENABLED === 'true' },
          identity: owner ? { userId: owner.userId } : null,
        });
      } catch (error) { return errorResponse(error); }
    },
    async account() {
      try {
        const { config } = await authorized(), account = await new AlpacaPaperClient(config, fetcher).getAccount();
        return privateJson({ account: { status: account.status, currency: typeof account.currency === 'string' ? account.currency : 'USD', buyingPower: account.buying_power, equity: account.equity, cash: account.cash, mode: 'paper' } });
      } catch (error) { return errorResponse(error); }
    },
    async company(request: Request) {
      try {
        const { config } = await authorized(), input = symbolSchema.safeParse(new URL(request.url).searchParams.get('symbol'));
        if (!input.success) throw new ApiError('invalid_symbol', 'Selecciona un símbolo válido.');
        const asset = await new AlpacaPaperClient(config, fetcher).getAsset(input.data);
        return privateJson({ symbol: asset.symbol, name: asset.name, exchange: asset.exchange ?? '', tradable: asset.tradable, assetClass: asset.class, source: 'alpaca' });
      } catch (error) { return errorResponse(error); }
    },
    async history(request: Request) {
      try {
        const { config } = await authorized(), params = new URL(request.url).searchParams;
        if (params.has('source') && params.get('source') !== 'alpaca') throw new ApiError('invalid_source', 'La API de histórico real utiliza Alpaca.');
        const parsed = historyQuerySchema.safeParse({ symbol: params.get('symbol'), start: params.get('start'), end: params.get('end'), interval: params.get('interval') });
        if (!parsed.success) throw new ApiError('invalid_history', 'Selecciona símbolo, fechas y temporalidad válidos.');
        return privateJson(await fetchAlpacaHistory(config, parsed.data, fetcher, dependencies.now?.() ?? Date.now()));
      } catch (error) { return errorResponse(error); }
    },
    async automationGet(request: Request) {
      try {
        const { environment, owner } = await authorized(), resource = new URL(request.url).searchParams.get('resource') ?? 'status';
        if (!['status', 'plans', 'events', 'executions', 'positions', 'risk'].includes(resource)) throw new ApiError('invalid_resource', 'La consulta de automatización no es válida.');
        return await runner('/' + resource, owner.userId, environment);
      } catch (error) { return errorResponse(error); }
    },
    async automationPost(request: Request) {
      try {
        sameOrigin(request);
        const { environment, owner } = await authorized(), parsed = actionSchema.safeParse(await smallJson(request));
        if (!parsed.success) throw new ApiError('invalid_plan', 'Revisa las fechas, el presupuesto y el símbolo del plan.');
        const action = parsed.data;
        if(dependencies.manualOnly!==false&&!['pause','disable'].includes(action.action))throw new ApiError('manual_orders_only','El terminal usa órdenes manuales. Cada envío requiere una revisión y confirmación individual.',409);
        if ((action.action === 'enable' || action.action === 'tick') && environment.ALPACA_AUTOMATION_ENABLED !== 'true') throw new ApiError('automation_disabled', 'La automatización de práctica está desactivada en el servidor.', 409);
        if (action.action === 'create') return await runner('/plans', owner.userId, environment, 'POST', { ...action.plan, enabled: false });
        if (action.action === 'tick') return await runner('/tick', owner.userId, environment, 'POST', {});
        if (action.action === 'pause' || action.action === 'resume') return await runner('/pause', owner.userId, environment, 'POST', { paused: action.action === 'pause' });
        return await runner('/plans/' + action.planId, owner.userId, environment, 'PATCH', { enabled: action.action === 'enable' });
      } catch (error) { return errorResponse(error); }
    },
  };
}
