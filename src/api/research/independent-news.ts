import {researchJson,record,numeric,type ResearchFetch} from './http.ts';
import type {FinnhubConfig} from './finnhub.ts';
import type {ResearchNews} from '../../cores/compartido/research-model.ts';

/** Explicit independent complement when Webull Sandbox lacks its news endpoint. */
export async function fetchFinnhubNews(config:FinnhubConfig|undefined,symbol:string,start:string,end:string,asOf:string,fetcher:ResearchFetch=fetch):Promise<ResearchNews>{
  const source='Finnhub · noticias empresariales';
  if(!config)return {articles:[],complete:false,status:{source,status:'missing_config',message:'Configura FINNHUB_API_KEY para el complemento de noticias.'},warnings:[]};
  const url=new URL('https://finnhub.io/api/v1/company-news');Object.entries({symbol,from:start,to:end}).forEach(([k,v])=>url.searchParams.set(k,v));
  try{const raw=await researchJson(url,{'X-Finnhub-Token':config.apiKey},fetcher);if(!Array.isArray(raw))throw Error('invalid');
    const articles=raw.map(record).flatMap(row=>{const t=numeric(row.datetime),id=row.id;if(t===null||t*1000>Date.parse(asOf)||typeof row.headline!=='string'||!['string','number'].includes(typeof id))return [];const publishedAt=new Date(t*1000).toISOString();if(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(publishedAt))<start||new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(publishedAt))>end)return [];let link:string|null=null;try{const u=new URL(String(row.url));if(u.protocol==='https:'&&!u.username&&!u.password)link=u.href;}catch{/* Untrusted URLs stay absent. */}return [{id:'finnhub:'+String(id),headline:row.headline.slice(0,500),url:link,source:typeof row.source==='string'?row.source.slice(0,100):'Finnhub',publishedAt,availableAt:publishedAt}];});
    return {articles:[...new Map(articles.map(a=>[a.id,a])).values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)),complete:false,status:{source,status:'partial',message:`${articles.length} noticias del complemento Finnhub; cobertura y revisiones históricas no exhaustivas.`},warnings:['Noticias suministradas por Finnhub como complemento de Webull. La API no acredita un historial completo de revisiones.']};
  }catch{return {articles:[],complete:false,status:{source,status:'unavailable',message:'No se pudo verificar el complemento de noticias Finnhub.'},warnings:[]};}
}
