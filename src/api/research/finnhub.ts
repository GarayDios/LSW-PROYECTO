import type { CompanyDetails } from '../../cores/04-analisis-fundamental/company-metrics.ts';
import { companyMetricDefinition } from '../../cores/04-analisis-fundamental/company-metrics.ts';
import { record, numeric, researchJson, validateResearchRequest, type ResearchFetch, ResearchProviderError } from './http.ts';

export type FinnhubConfig={apiKey:string};
const SOURCE='Finnhub · Basic Financials';
const caches=new WeakMap<ResearchFetch,Map<string,{expires:number;value:Promise<CompanyDetails>}>>();
const budgets=new WeakMap<ResearchFetch,{starts:number[];tail:Promise<void>}>();
export function missingCompanyDetails(message='Configura FINNHUB_API_KEY para consultar automáticamente métricas empresariales.'):CompanyDetails {
  return {source:'Finnhub',fetchedAt:null,status:{source:SOURCE,status:'missing_config',message},metrics:{},profile:{name:null,industry:null,exchange:null,country:null,currency:null,ipo:null,website:null},recommendations:[],warnings:[]};
}
const clean=(value:unknown,max=300)=>typeof value==='string'&&value.trim()?value.trim().slice(0,max):null;
const calendarDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function normalizeCompanyDetails(symbol:string,at:string,metricBody:unknown,profileBody:unknown,recommendationBody:unknown):CompanyDetails {
  const output=missingCompanyDetails(), body=record(metricBody), rawProfile=record(profileBody);
  output.fetchedAt=at;
  if(body.symbol===symbol&&body.metric&&typeof body.metric==='object'&&!Array.isArray(body.metric)){
    for(const [key,raw] of Object.entries(record(body.metric)).slice(0,250)){
      if(!/^[A-Za-z0-9/._-]{1,100}$/.test(key))continue;
      const value=numeric(raw);if(value===null)continue;
      const definition=companyMetricDefinition(key);
      output.metrics[key]={value:definition.percent?value/100:value,kind:'estimated',source:`${SOURCE} · ${key} · ${definition.period}`,observedAt:at,availableAt:at,
        reason:'Métrica recibida automáticamente del proveedor. Fecha disponible: consulta; no se conoce la publicación original ni se utiliza como dato histórico anterior.'};
    }
  }
  if(rawProfile.ticker===symbol){
    let website:string|null=null;try{const url=new URL(String(rawProfile.weburl));if(url.protocol==='https:'&&!url.username&&!url.password)website=url.href;}catch{/* Untrusted profile links stay absent. */}
    output.profile={name:clean(rawProfile.name),industry:clean(rawProfile.finnhubIndustry),exchange:clean(rawProfile.exchange),country:clean(rawProfile.country,50),currency:clean(rawProfile.currency,10),ipo:calendarDate(rawProfile.ipo)?rawProfile.ipo:null,website};
  }
  if(Array.isArray(recommendationBody))output.recommendations=recommendationBody.flatMap(item=>{
    const row=record(item), values=['strongBuy','buy','hold','sell','strongSell'].map(k=>numeric(row[k]));
    if(row.symbol!==symbol||!calendarDate(row.period)||Date.parse(row.period)>Date.parse(at)||values.some(v=>v===null||!Number.isInteger(v)||v<0))return [];
    return [{period:row.period,strongBuy:values[0]!,buy:values[1]!,hold:values[2]!,sell:values[3]!,strongSell:values[4]!}];
  }).sort((a,b)=>b.period.localeCompare(a.period)).slice(0,12);
  const count=Object.keys(output.metrics).length, profile=!!output.profile.name;
  output.status={source:SOURCE,status:count&&profile?'ready':count||profile?'partial':'unavailable',message:`${count} métricas empresariales numéricas recibidas automáticamente${profile?'; perfil disponible':''}. Los campos ausentes no se rellenan con cero.`};
  output.warnings=['Finnhub complementa los estados SEC: conserva períodos TTM, anuales y trimestrales separados.','Las recomendaciones de analistas son contexto publicado; no se convierten automáticamente en órdenes ni probabilidades de éxito.','El plan gratuito no equivale a toda la ficha de Finviz: propiedad institucional detallada y precios objetivo requieren otro acceso.'];
  return output;
}

async function reserve(fetcher:ResearchFetch){
  let state=budgets.get(fetcher);if(!state){state={starts:[],tail:Promise.resolve()};budgets.set(fetcher,state);}
  const current=state;
  const turn=current.tail.then(async()=>{
    for(;;){
      const now=Date.now();current.starts=current.starts.filter(at=>now-at<60000);
      const second=current.starts.filter(at=>now-at<1000);
      const delay=current.starts.length>=55?current.starts[0]+60000-now:second.length>=25?second[0]+1000-now:0;
      if(delay<=0){current.starts.push(now);return;}await new Promise<void>(resolve=>setTimeout(resolve,delay+1));
    }
  });current.tail=turn.catch(()=>{});await turn;
}

/** Uses only free profile/metrics/recommendation endpoints. No key in the DTO.
 * Current aggregate metrics cannot be backdated into historical decisions. */
export async function fetchCompanyDetails(config:FinnhubConfig|undefined,symbol:string,asOf:string,fetcher:ResearchFetch=fetch,now=new Date()):Promise<CompanyDetails>{
  validateResearchRequest(symbol,asOf);
  if(!config?.apiKey?.trim()||/[\r\n]/.test(config.apiKey))return missingCompanyDetails();
  if(Date.parse(asOf)<now.getTime())return {...missingCompanyDetails(),status:{source:SOURCE,status:'unavailable',message:'Las métricas empresariales actuales no se aplican a un corte histórico. SEC conserva la evidencia publicada disponible en ese corte.'}};
  let cache=caches.get(fetcher);if(!cache){cache=new Map();caches.set(fetcher,cache);}
  const key=JSON.stringify([config.apiKey,symbol]), existing=cache.get(key);
  if(existing&&existing.expires>now.getTime())return structuredClone(await existing.value);
  if(cache.size>=128)cache.delete(cache.keys().next().value!);
  const value=(async()=>{
    const get=async(path:string,params:Record<string,string>={})=>{
      await reserve(fetcher);const url=new URL(path,'https://finnhub.io');url.searchParams.set('symbol',symbol);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
      const body=await researchJson(url,{'X-Finnhub-Token':config.apiKey},fetcher);
      if(record(body).error)throw new ResearchProviderError(null,'Finnhub no autorizó o no completó la consulta. Revisa la clave y los permisos del endpoint.');
      return body;
    };
    const results=await Promise.allSettled([get('/api/v1/stock/metric',{metric:'all'}),get('/api/v1/stock/profile2'),get('/api/v1/stock/recommendation')]);
    const result=normalizeCompanyDetails(symbol,now.toISOString(),...results.map(r=>r.status==='fulfilled'?r.value:null) as [unknown,unknown,unknown]);
    const failed=results.filter(r=>r.status==='rejected');
    if(failed.length){
      result.status.status=Object.keys(result.metrics).length||result.profile.name?'partial':'error';
      const rateLimited=failed.some(r=>r.status==='rejected'&&r.reason instanceof ResearchProviderError&&r.reason.status===429);
      result.status.message+=rateLimited?' Finnhub alcanzó la cuota; se conserva la respuesta parcial y debes esperar antes de reintentar.':' Algunas consultas fallaron. Revisa la conexión y el acceso gratuito de tu clave.';
    }
    return result;
  })();
  const entry={expires:now.getTime()+15*60000,value};cache.set(key,entry);
  try{const result=await value;if(result.status.status==='error')entry.expires=now.getTime()+60000;return structuredClone(result);}catch{cache.delete(key);return {...missingCompanyDetails(),status:{source:SOURCE,status:'error',message:'No se pudo consultar Finnhub. Las fuentes SEC y de mercado conservan su estado independiente.'}};}
}
