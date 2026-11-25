import { analysisPolicy, analysisSettingsSchema } from '../../features/research/analysis-settings.ts';
import { z } from 'zod';
import { readBrokerConfig, BrokerConfigError, BrokerError } from '../brokers/index.ts';
import { fetchAlpacaHistory, historyQuerySchema, MarketDataError, symbolSchema } from '../market/alpaca-history.ts';
import { fetchCompanyResearch } from '../research/company.ts';
import { rankObservedCompanies } from '../../cores/evaluacion/observed-ranking.ts';
import type { CompanyResearch } from '../../cores/compartido/research-model.ts';
import { ApiError, privateJson, sameOrigin, smallJson } from '../http.ts';
import { activeScannerCores } from '../../cores/evaluacion/scanner-settings.ts';
import { researchHistoryStart } from '../../features/research/research-history.ts';
import {readWebull} from '../brokers/webull/gateway.ts';
import type {WebullHistory} from '../brokers/webull/data.ts';
import {record} from '../../cores/compartido/data-values.ts';
import type {ResearchOptions} from '../../cores/compartido/research-model.ts';
import {fetchFinnhubNews} from '../research/independent-news.ts';
import {webullSplitFactor,webullSpot,type WebullContext} from '../brokers/webull/research-data.ts';
import type {CompanyResearchRequest} from '../research/company.ts';
import type {NewsTimelinePage} from '../../cores/compartido/research-model.ts';
import {institutionalSplitFactor} from '../research/institutional.ts';
import {researchJson} from '../research/http.ts';

type Environment = Record<string, string | undefined>;
type Dependencies = {
  environment(): Environment; owner(): Promise<{ userId: string } | null>; fetcher?: typeof fetch; now?: () => number;
  history?: typeof fetchAlpacaHistory; research?: typeof fetchCompanyResearch;
};
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
});
const range = historyQuerySchema.omit({ symbol: true, interval: true }).extend({ start: calendarDate, end: calendarDate, cutoff: z.string().datetime({ offset: true }).optional(),provider:z.enum(['alpaca','webull']).optional() });
const rankingInput = range.extend({
  symbols: z.array(symbolSchema).min(1).max(14),
  selectedCores: z.array(z.enum(['bsm', 'greeks', 'probability', 'volatility', 'trend', 'liquidity', 'risk'])).min(1).max(7),
  strategy: z.enum(['wheel', 'pmcc', 'backspread', 'gamma']), days: z.number().int().min(1).max(3650),
  analysis: analysisSettingsSchema.optional(),
}).strict().refine(input=>input.analysis?.scanner ? activeScannerCores(input.analysis.scanner).length > 0 : input.selectedCores.some(core=>(input.analysis?.tuning?.coreWeights?.[core]??1)>0),'Asigna peso positivo a un core seleccionado.');

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
  async function authorize(provider:'alpaca'|'webull'='alpaca') {
    const owner = await dependencies.owner();
    if (!owner) throw new ApiError('auth_required', 'Inicia sesión para consultar los datos de investigación.', 401);
    const environment=dependencies.environment();let config:ReturnType<typeof readBrokerConfig>=null;
    if(provider==='alpaca')config=readBrokerConfig(environment);else try{config=readBrokerConfig(environment);}catch{/* Optional Alpaca news must not prevent Webull market reads. */}
    if(provider==='alpaca'&&!config)throw new ApiError('broker_not_configured','Configura la fuente de datos Alpaca en el servidor.',503);
    if((provider==='alpaca'?config?.ownerUserId:environment.BROKER_OWNER_USER_ID)!==owner.userId)throw new ApiError('broker_owner_required','Esta fuente de datos pertenece a otro usuario.',403);
    return {owner,config,environment,provider};
  }
  function decisionTime(input: { start: string; end: string; cutoff?: string }, now: number) {
    if (input.start > input.end || new Date(input.start + 'T00:00:00Z').toISOString().slice(0, 10) !== input.start || new Date(input.end + 'T00:00:00Z').toISOString().slice(0, 10) !== input.end) throw new ApiError('invalid_dates', 'Revisa el rango de fechas.');
    const requested = input.cutoff ? Date.parse(input.cutoff) : now;
    const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
    const cutoff = Math.min(requested, input.end === today ? now : Date.parse(input.end + 'T23:59:59.999Z'), now);
    if (!Number.isFinite(cutoff) || cutoff < Date.parse(input.start + 'T00:00:00Z')) throw new ApiError('invalid_cutoff', 'La fecha de decisión debe quedar dentro o después del inicio del histórico.');
    return new Date(cutoff);
  }
  async function snapshot(input: { symbol: string; start: string; end: string }, asOf: Date, now: number, auth: Awaited<ReturnType<typeof authorize>>) {
    // Current snapshots may be reused for at most one minute; their original asOf stays visible.
    const current = asOf.getTime() === now;
    const key = JSON.stringify([auth.owner.userId,auth.provider,input.symbol,input.start,input.end,current?'current':asOf.toISOString(),auth.config?.dataFeed,auth.environment.ALPACA_OPTIONS_FEED,Boolean(auth.environment.SEC_USER_AGENT),Boolean(auth.environment.FRED_API_KEY),Boolean(auth.environment.FINNHUB_API_KEY)]);
    const existing = cache.get(key);
    if (existing && existing.expires > now) return existing.value;
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    const value = (async () => {
      const preparationStart = researchHistoryStart(input.start, input.end);
      const history=auth.provider==='webull'?await readWebull<WebullHistory>(auth.environment,auth.owner.userId,'market-history',{symbol:input.symbol,start:preparationStart,end:input.end,interval:'1d'},fetcher):await (dependencies.history??fetchAlpacaHistory)(auth.config!,{symbol:input.symbol,start:preparationStart,end:input.end,interval:'1d'},fetcher,now);
      let webullInputs:Partial<CompanyResearchRequest>={};
      let resolvedAsOf=asOf;
      if(auth.provider==='webull'){
        const [optionsResult,quoteResult,contextResult]=await Promise.allSettled(current?[readWebull<ResearchOptions>(auth.environment,auth.owner.userId,'market-options',{symbol:input.symbol,days:'30'},fetcher),readWebull<unknown>(auth.environment,auth.owner.userId,'market-quote',{symbol:input.symbol},fetcher),readWebull<WebullContext>(auth.environment,auth.owner.userId,'market-context',{symbol:input.symbol},fetcher)]:[]);
        const newsStart=new Date(asOf.getTime()-30*86400000).toISOString().slice(0,10),newsEnd=asOf.toISOString().slice(0,10);
        let news;try{news=(await readWebull<NewsTimelinePage>(auth.environment,auth.owner.userId,'market-news',{symbol:input.symbol,start:newsStart,end:newsEnd,asOf:asOf.toISOString()},fetcher)).news;}catch{news=await fetchFinnhubNews(auth.environment.FINNHUB_API_KEY?{apiKey:auth.environment.FINNHUB_API_KEY}:undefined,input.symbol,newsStart,newsEnd,asOf.toISOString(),fetcher);}
        const options:ResearchOptions=optionsResult?.status==='fulfilled'?optionsResult.value as ResearchOptions:{contracts:[],complete:false,feed:'webull-sandbox',status:{source:'Webull Sandbox · opciones',status:'unavailable',message:current?'No se confirmó la cadena Webull. Los demás cores conservan sus fuentes disponibles.':'La cadena actual de Webull no reconstruye cotizaciones de opciones al corte histórico.'},warnings:[]};
        const raw=quoteResult?.status==='fulfilled'?quoteResult.value:null;
        // A current decision occurs after receiving the market inputs. Historical
        // cutoffs remain fixed and never import today's chain or quote.
        if(current)resolvedAsOf=new Date(Math.max(now,dependencies.now?.()??Date.now()));
        const row=Array.isArray(raw)?record(raw.find(value=>record(value).symbol===input.symbol)):{};
        const quote=webullSpot(row,resolvedAsOf.toISOString());
        webullInputs={options,marketQuote:contextResult?.status==='fulfilled'?(contextResult.value as WebullContext).spot:quote,news,dataMode:'sandbox',...(contextResult?.status==='fulfilled'?{marketContext:contextResult.value as WebullContext}:{}),splitFactor:async(symbol,cusip,start,end)=>{
          try{return {factor:webullSplitFactor(await readWebull(auth.environment,auth.owner.userId,'corporate-actions',{symbol,start,end},fetcher),symbol,start,end),source:'Webull acciones corporativas'};}catch{
            if(!auth.config)throw Error('Webull no confirmó el historial de splits; el complemento de acciones corporativas no está configurado.');
            const url=new URL('https://data.alpaca.markets/v1/corporate-actions');Object.entries({symbols:symbol,types:'forward_split,reverse_split',start,end,data_quality:'all',limit:'1000'}).forEach(([k,v])=>url.searchParams.set(k,v));
            const raw=await researchJson(url,{'APCA-API-KEY-ID':auth.config.apiKey,'APCA-API-SECRET-KEY':auth.config.secretKey},fetcher);
            return {factor:institutionalSplitFactor(raw,symbol,cusip,start,end),source:'Alpaca acciones corporativas (complemento de Webull)'};
          }
        }};
      }
      const result = await (dependencies.research ?? fetchCompanyResearch)({
        symbol:input.symbol,bars:history.bars,asOf:resolvedAsOf.toISOString(),historySource:`${auth.provider}:${history.feed}`,...webullInputs,
        ...(auth.provider==='alpaca'&&auth.config?{alpaca:{apiKey:auth.config.apiKey,secretKey:auth.config.secretKey,stockFeed:auth.config.dataFeed,optionsFeed:auth.environment.ALPACA_OPTIONS_FEED==='opra'?'opra' as const:'indicative' as const}}:{}),
        ...(auth.environment.SEC_USER_AGENT?.trim() ? { sec: { userAgent: auth.environment.SEC_USER_AGENT.trim() } } : {}),
        ...(auth.environment.FRED_API_KEY?.trim() ? { fred: { apiKey: auth.environment.FRED_API_KEY.trim() } } : {}),
        ...(auth.environment.FINNHUB_API_KEY?.trim() ? { finnhub: { apiKey: auth.environment.FINNHUB_API_KEY.trim() } } : {}),
      }, fetcher, current&&auth.provider==='webull'?resolvedAsOf:new Date(now));
      result.warnings = [...new Set([...history.warnings, ...result.warnings, ...(preparationStart < input.start ? ['Se cargan hasta 400 días previos al corte para preparar los indicadores; la ventana visible conserva sus fechas.'] : [])])];
      return result;
    })();
    cache.set(key, { expires: now + 60000, value });
    try { return await value; } catch (error) { cache.delete(key); throw error; }
  }
  return {
    async company(request: Request) {
      try {
        const params=new URL(request.url).searchParams,auth=await authorize(params.get('provider')==='webull'?'webull':'alpaca');
        const parsed = range.extend({ symbol: symbolSchema }).strict().safeParse(Object.fromEntries(params));
        if (!parsed.success) throw new ApiError('invalid_research', 'Selecciona un símbolo y un rango de fechas válidos.');
        const now = dependencies.now?.() ?? Date.now(), asOf = decisionTime(parsed.data, now);
        return privateJson({ research: await snapshot(parsed.data, asOf, now, auth) });
      } catch (error) { return publicError(error); }
    },
    async ranking(request: Request) {
      try {
        sameOrigin(request);
        const parsed=rankingInput.safeParse(await smallJson(request));
        if (!parsed.success) throw new ApiError('invalid_ranking', 'Revisa los símbolos, cores, estrategia y fechas del ranking.');
        const auth=await authorize(parsed.data.provider??'alpaca');
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
        const ranked = Object.values(snapshots).flatMap(snapshot => rankObservedCompanies([snapshot], [...new Set(input.selectedCores)], input.strategy, input.days,
          input.analysis ? analysisPolicy(input.analysis,snapshot) : {})).sort((a,b)=>(b.score??-1)-(a.score??-1)||a.symbol.localeCompare(b.symbol));
        return privateJson({ ranked, snapshots, excluded, generatedAt: new Date(now).toISOString(), cutoff: asOf.toISOString(), warnings: [
          'Puntuación heurística de compatibilidad. No es una probabilidad de ganancia.',
          ...(input.analysis?.modelMode==='estimated'?['ESTIMADO: algunas entradas pueden usar HV y cotizaciones teóricas; las fuentes originales se conservan y esto no valida el ranking históricamente.']:[]),
          'Cada instantánea conserva su propia fecha de corte; la caché puede reutilizar datos consultados durante los últimos 60 segundos.',
          ...(excluded.length ? ['El ranking es parcial: hay empresas sin datos disponibles.'] : []),
        ] });
      } catch (error) { return publicError(error); }
    },
  };
}
