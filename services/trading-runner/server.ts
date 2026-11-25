import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createRunner, type RunnerOptions } from './runner.ts';
import { ownerSchema, planInputSchema } from './model.ts';
import { createAlertDispatcher, readAlertConfig, type AlertConfig } from './alerts.ts';
import { createF5Service } from './f5-service.ts';
import { openF5Store } from './f5-store.ts';
import { AlpacaOptionsClient } from '../../src/api/brokers/alpaca/options.ts';
import { WebullClient,readWebullConfig } from '../../src/api/brokers/webull/client.ts';
import { createWebullService } from './webull-service.ts';
import {WebullF5Adapter} from '../../src/api/brokers/webull/f5-adapter.ts';
import {webullAccountBinding} from '../../src/api/brokers/webull/desk.ts';
import {ApiError} from '../../src/api/http.ts';
import {BrokerError} from '../../src/api/brokers/alpaca/client.ts';

const MAX_BODY = 16384;
const switchSchema = z.object({ ownerId: ownerSchema, enabled: z.boolean() }).strict();
const tickSchema = z.object({ ownerId: ownerSchema }).strict();
const pauseSchema = z.object({ ownerId: ownerSchema, paused: z.boolean() }).strict();
class RequestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
const respond = (response: ServerResponse, status: number, data: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
};
async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new RequestError(415, 'json_required');
  if (Number(request.headers['content-length']) > MAX_BODY) throw new RequestError(413, 'payload_too_large');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY) throw new RequestError(413, 'payload_too_large');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new RequestError(400, 'invalid_json'); }
}

/** Internal service. The application's authenticated proxy supplies ownerId. */
export function createRunnerService(options: RunnerOptions & { token: string; alerts?: AlertConfig | null; alertFetcher?: typeof fetch; f5?: ReturnType<typeof createF5Service>; webullF5?:ReturnType<typeof createF5Service>; webull?:ReturnType<typeof createWebullService>; manualOnly?:boolean }) {
  const expected = Buffer.from(options.token);
  if (expected.length < 32 || expected.length > 512 || /[\r\n]/.test(options.token)) throw new Error('Configure un token privado de entre 32 y 512 bytes.');
  const runner = createRunner({...options,enabled:options.manualOnly?false:options.enabled});
  const now = options.now ?? Date.now;
  const dispatchAlerts = createAlertDispatcher({ queue: options.store, ownerId: options.ownerId, config: options.alerts ?? null, fetcher: options.alertFetcher, now });
  let lastCompletedAt: number | null = null;
  const tick = async (ownerId = options.ownerId) => {
    if (runner.status().running) return [];
    const events = await runner.tick(ownerId); lastCompletedAt = now();
    void dispatchAlerts().catch(() => {}); return events;
  };
  const owner = (value: unknown) => {
    const parsed = ownerSchema.safeParse(value);
    if (!parsed.success || parsed.data !== options.ownerId) throw new RequestError(403, 'owner_not_allowed');
    return parsed.data;
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://runner.local');
      if (request.method === 'GET' && url.pathname === '/healthz') {
        const healthy = lastCompletedAt === null || now() - lastCompletedAt < 240000;
        return respond(response, healthy ? 200 : 503, { status: healthy ? 'ok' : 'stalled' });
      }
      const header = request.headers.authorization;
      const supplied = header?.startsWith('Bearer ') ? Buffer.from(header.slice(7)) : Buffer.alloc(0);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return respond(response, 401, { error: 'unauthorized' });
      if(url.pathname.startsWith('/webull/f5/')&&options.webullF5){
        const value=request.method==='GET'?null:await body(request),record=value&&typeof value==='object'?value as Record<string,unknown>:{};
        const user=owner(request.method==='GET'?url.searchParams.get('ownerId'):record.ownerId);
        const {ownerId:_owner,...payload}=record;
        const result=await options.webullF5.handle(request.method??'GET',url.pathname.replace('/webull/f5/','/f5/')+url.search,user,value===null?undefined:payload);
        return respond(response,result.status,result.value);
      }
      if(url.pathname.startsWith('/webull/')&&options.webull){
        const value=request.method==='GET'?null:await body(request);
        const record=value&&typeof value==='object'?value as Record<string,unknown>:{};
        const user=owner(request.method==='GET'?url.searchParams.get('ownerId'):record.ownerId);
        const {ownerId:_owner,...payload}=record;
        const result=await options.webull.handle(request.method??'GET',url.pathname,user,value===null?Object.fromEntries([...url.searchParams].filter(([key])=>key!=='ownerId')):payload);
        return respond(response,result.status,result.value);
      }
      if(options.manualOnly&&request.method!=='GET'&&!url.pathname.startsWith('/f5/'))return respond(response,409,{error:'manual_orders_only'});
      if (url.pathname.startsWith('/f5/') && options.f5) {
        const value = request.method === 'GET' ? null : await body(request);
        const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
        const ownerId = owner(request.method === 'GET' ? url.searchParams.get('ownerId') : record.ownerId);
        const { ownerId: _owner, ...payload } = record;
        if(options.manualOnly&&url.pathname==='/f5/control'&&['enable-plan','tick'].includes(String(payload.action)))return respond(response,409,{error:{code:'manual_orders_only',message:'Confirma cada orden manualmente.'}});
        const key = 'tick:' + ownerId;
        if (!options.store.acquireLease(key, now(), now() + 120000)) return respond(response, 409, { error: 'account_busy' });
        try {
          const result = await options.f5.handle(request.method ?? 'GET', url.pathname + url.search, ownerId, value === null ? undefined : payload);
          return respond(response, result.status, result.value);
        } finally { options.store.releaseLease(key); }
      }
      if (request.method === 'GET') {
        const ownerId = owner(url.searchParams.get('ownerId'));
        if (url.pathname === '/status') return respond(response, 200, runner.status());
        if (url.pathname === '/plans') return respond(response, 200, { plans: options.store.listPlans(ownerId) });
        if (url.pathname === '/events') return respond(response, 200, { events: options.store.listEvents(ownerId) });
        if (url.pathname === '/executions') return respond(response, 200, { executions: options.store.listExecutions(ownerId).slice(0, 200) });
        if (url.pathname === '/positions') return respond(response, 200, { positions: options.store.listOwnedPositions(ownerId) });
        if (url.pathname === '/risk') return respond(response, 200, { risk: runner.risk() });
      }
      if ((request.method === 'POST' || request.method === 'PATCH') && url.pathname === '/pause') {
        const parsed = pauseSchema.safeParse(await body(request));
        if (!parsed.success) throw new RequestError(400, 'invalid_pause');
        options.store.setPaused(owner(parsed.data.ownerId), parsed.data.paused);
        return respond(response, 200, { risk: runner.risk() });
      }
      if (request.method === 'POST' && url.pathname === '/plans') {
        const parsed = planInputSchema.safeParse(await body(request));
        if (!parsed.success) throw new RequestError(400, 'invalid_plan');
        owner(parsed.data.ownerId);
        if (parsed.data.maxOrderUsd > runner.status().maxOrderUsd) throw new RequestError(400, 'service_budget_exceeded');
        return respond(response, 201, { plan: options.store.createPlan(parsed.data, new Date(now()).toISOString()) });
      }
      if (request.method === 'PATCH' && /^\/plans\/[^/]+$/.test(url.pathname)) {
        const parsed = switchSchema.safeParse(await body(request));
        if (!parsed.success) throw new RequestError(400, 'invalid_switch');
        const ownerId = owner(parsed.data.ownerId);
        if (parsed.data.enabled && (!options.enabled || !options.broker)) throw new RequestError(409, 'automation_not_enabled');
        let plan;
        try { plan = options.store.setEnabled(ownerId, url.pathname.slice('/plans/'.length), parsed.data.enabled, new Date(now()).toISOString()); }
        catch { throw new RequestError(409, 'symbol_already_enabled'); }
        if (!plan) throw new RequestError(404, 'plan_not_found');
        return respond(response, 200, { plan });
      }
      if (request.method === 'POST' && url.pathname === '/tick') {
        const parsed = tickSchema.safeParse(await body(request));
        if (!parsed.success) throw new RequestError(400, 'invalid_tick');
        return respond(response, 200, { events: await tick(owner(parsed.data.ownerId)) });
      }
      return respond(response, 404, { error: 'not_found' });
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      if (error instanceof RequestError) return respond(response, error.status, { error: error.code });
      return respond(response, 503, { error: 'runner_unavailable' });
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  let interval: ReturnType<typeof setInterval> | undefined;
  return {
    server, runner,
    startLoop() {
      if(options.manualOnly)return;
      if (interval) return;
      lastCompletedAt = now();
      interval = setInterval(() => { void tick().catch(() => { console.error('No se pudo completar la evaluación Paper.'); }); }, 60000);
      interval.unref();
    },
    stopLoop() { if (interval) clearInterval(interval); interval = undefined; },
  };
}

async function main(): Promise<void> {
  const [{ readBrokerConfig, AlpacaPaperClient }, { fetchAlpacaHistory }, { openRunnerStore }] = await Promise.all([
    import('../../src/api/brokers/index.ts'), import('../../src/api/market/alpaca-history.ts'), import('./store.ts'),
  ]);
  const config = process.env.ALPACA_API_KEY||process.env.ALPACA_SECRET_KEY?readBrokerConfig(process.env):null;
  const ownerId = ownerSchema.parse(process.env.BROKER_OWNER_USER_ID);
  const port = Number(process.env.TRADING_RUNNER_PORT ?? 8790);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Puerto inválido.');
  const alerts = readAlertConfig(process.env);
  const store = openRunnerStore(process.env.TRADING_RUNNER_DB || '.sites-runtime/trading-runner.sqlite');
  const f5Store = openF5Store(process.env.TRADING_F5_DB || '.sites-runtime/trading-f5.sqlite');
  const webullConfig=readWebullConfig(process.env);
  const webullClient=webullConfig?new WebullClient(webullConfig):null;
  const webullStore=openF5Store(process.env.TRADING_WEBULL_F5_DB||`.sites-runtime/webull-f5-${webullClient?webullAccountBinding(webullClient).slice(0,16):'unconfigured'}.sqlite`);
  if(webullClient)webullStore.bind(ownerId,webullAccountBinding(webullClient));
  const webullAdapter=webullClient?new WebullF5Adapter(webullClient,{knownOrders:()=>webullStore.list(ownerId).filter(op=>op.state!=='preview').map(op=>op.clientOrderId),knownInputs:()=>webullStore.list(ownerId).map(op=>op.input),activityStart:()=>webullStore.list(ownerId).map(op=>op.createdAt).sort()[0]??new Date().getUTCFullYear()+'-01-01T00:00:00.000Z',beforePreview:()=>{if(webull.hasUnresolved())throw new BrokerError('f5_pending_operations',409,'Hay órdenes manuales Webull pendientes de completar o conciliar.',false);}}):null;
  const webull=createWebullService({filename:process.env.TRADING_WEBULL_DB||'.sites-runtime/trading-webull.sqlite',ownerId,client:webullClient,coordination:webullStore,validateSubmission:async op=>{
    if(!webullAdapter||op.change)return;
    if(webull.hasUnresolved())throw new ApiError('webull_busy','Hay una orden manual pendiente de conciliación.',409);
    await webullAdapter.assertExecutionReady(op.options?.legs.map(l=>l.symbol)??[],op.options?undefined:op.input.symbol);
    if((await webullAdapter.orders()).length)throw new ApiError('webull_busy','Hay órdenes abiertas en Webull. Concílialas antes de comprometer más capital.',409);
    if(!op.options){const account=await webullAdapter.account();if(op.input.side==='BUY'&&op.input.quantity*op.input.limitPrice>Math.min(account.cash,account.buyingPower))throw new ApiError('webull_review','El efectivo liquidado no cubre esta compra.',409);if(op.input.side==='SELL'&&!(await webullAdapter.positions()).some(p=>p.symbol===op.input.symbol&&p.assetClass==='us_equity'&&p.quantity>=op.input.quantity))throw new ApiError('webull_review','No se confirmó una posición larga suficiente para vender.',409);}
  }});
  const webullF5=createF5Service({store:webullStore,broker:webullAdapter,ownerId,enabled:webullConfig?.enabled??false,provider:'webull',feed:'webull-sandbox'});
  const f5 = createF5Service({store:f5Store, broker:config ? new AlpacaOptionsClient(config,{feed:process.env.ALPACA_OPTIONS_FEED === 'opra' ? 'opra' : 'indicative'}) : null,
    ownerId, enabled:process.env.ALPACA_F5_ENABLED === 'true', reservedShares: symbol => store.listOwnedPositions(ownerId).filter(p=>p.symbol===symbol).reduce((n,p)=>n+p.quantity,0)});
  const service = createRunnerService({
    store, ownerId, broker: config ? new AlpacaPaperClient(config) : null, alerts, f5, webull, webullF5, manualOnly:true,
    token: process.env.TRADING_RUNNER_TOKEN ?? '', enabled: false,
    maxOrderUsd: Number(process.env.TRADING_MAX_ORDER_USD || 1000),
    ...(process.env.TRADING_MAX_DAILY_LOSS_USD ? { maxDailyLossUsd: Number(process.env.TRADING_MAX_DAILY_LOSS_USD) } : {}),
    ...(process.env.TRADING_MAX_TOTAL_EXPOSURE_USD ? { maxTotalExposureUsd: Number(process.env.TRADING_MAX_TOTAL_EXPOSURE_USD) } : {}),
    history: async (symbol, start, end) => {
      if (!config) throw new Error('broker_not_configured');
      return (await fetchAlpacaHistory(config, { symbol, start, end, interval: '1d' })).bars;
    },
  });
  await new Promise<void>((resolve, reject) => { service.server.once('error', reject); service.server.listen(port, process.env.TRADING_RUNNER_HOST || '127.0.0.1', resolve); });
  service.startLoop();
  console.log(`Servicio de brókers en modo manual disponible en el puerto ${port}.`);
  const shutdown = () => {
    service.stopLoop();
    service.server.close(() => { store.close(); f5Store.close(); webull.close(); webullStore.close();process.exit(0); });
    service.server.closeIdleConnections();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('No se pudo iniciar el servicio de práctica. Revisa su configuración y conectividad.'); process.exitCode = 1; });
}
