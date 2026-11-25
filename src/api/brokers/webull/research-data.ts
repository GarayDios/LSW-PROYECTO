import {record,numeric} from '../../../cores/compartido/data-values.ts';
import {missingVariable,type CompanyResearch,type ResearchNews,type NewsTimelinePage,type ResearchVariable} from '../../../cores/compartido/research-model.ts';
import {ApiError} from '../../http.ts';
import {webullTime} from './options-data.ts';
import {webullQuoteUsable} from './session.ts';
import type {WebullClient} from './client.ts';

export type WebullContext={spot:ResearchVariable;dividends:NonNullable<CompanyResearch['cashDividends']>;annualDividend:ResearchVariable};
export function webullSpot(quote:Record<string,unknown>,at:string):ResearchVariable{
  const quoteAt=webullTime(quote.quote_time),tradeAt=webullTime(quote.last_trade_time),bid=numeric(quote.bid),ask=numeric(quote.ask),price=numeric(quote.price);
  if(webullQuoteUsable(quoteAt,Date.parse(at))&&bid!==null&&ask!==null&&bid>0&&ask>=bid)return {value:(bid+ask)/2,kind:'estimated',source:'Webull Sandbox · punto medio de la acción',observedAt:quoteAt,availableAt:at,reason:'Cotización de pruebas; se conserva la fecha de la cotización, posiblemente retrasada o de la última sesión cerrada.'};
  if(webullQuoteUsable(tradeAt,Date.parse(at))&&price!==null&&price>0)return {value:price,kind:'observed',source:'Webull Sandbox · última operación de la acción',observedAt:tradeAt,availableAt:at,reason:'Último precio negociado recibido del entorno de pruebas. Su fecha no se atribuye al bid/ask y no garantiza ejecución.'};
  return missingVariable('Webull Sandbox','Sin precio con fecha verificable de la sesión actual o la última sesión cerrada.');
}
export function webullSplitFactor(raw:{data:unknown[];complete:boolean},symbol:string,start:string,end:string):number{
  if(!raw.complete||!Array.isArray(raw.data))throw new Error('Webull no confirmó cobertura completa de splits.');
  let factor=1;const seen=new Map<string,string>();
  for(const value of raw.data){const row=record(value),date=row.event_date;
    if(row.symbol!==symbol||typeof date!=='string'||date<start||date>end||!['FORWARD_SPLIT','REVERSE_SPLIT'].includes(String(row.event_type)))throw new Error('La identidad del valor o sus acciones corporativas requiere revisión.');
    const old=numeric(row.ratio_old),next=numeric(row.ratio_new);if(old===null||next===null||old<=0||next<=0||row.event_id===undefined||row.event_action==='D')throw new Error('Split no verificable o corregido.');
    const id=String(row.event_id),signature=JSON.stringify([date,old,next]);if(seen.has(id)){if(seen.get(id)!==signature)throw new Error('Splits contradictorios.');continue;}seen.set(id,signature);factor*=next/old;
  }
  if(!Number.isFinite(factor)||factor<=0)throw new Error('Factor de split no válido.');return factor;
}
export class WebullResearchData{
  private client:WebullClient;
  private now:()=>number;
  constructor(client:WebullClient,now:()=>number=Date.now){this.client=client;this.now=now;}
  async context(symbol:string):Promise<WebullContext>{
    const at=new Date(this.now()).toISOString(),source='Webull Sandbox · dividendos';
    const results=await Promise.allSettled([this.client.request('/market-data/stocks/snapshots/list',{symbols:symbol,category:'US_STOCK'}),this.client.request('/market-data/fundamentals/dividend-calendars/list',{symbol,category:'US_STOCK'})]);
    const quote=results[0].status==='fulfilled'&&Array.isArray(results[0].value)?record(results[0].value.find(r=>record(r).symbol===symbol)):{};
    const spot=webullSpot(quote,at);
    const rows=results[1].status==='fulfilled'&&Array.isArray(results[1].value)?results[1].value.map(record):[];
    const validDate=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
    const events=rows.flatMap(row=>{const amount=numeric(row.amount),date=row.ex_div_date;if(row.symbol!==symbol||row.currency!=='USD'||row.div_type!=='CASH_DIVIDEND'||amount===null||amount<0||!validDate(date))return [];return [{id:`${symbol}:${date}:${amount}`,exDate:date,payableDate:validDate(row.pay_date)?row.pay_date:null,amount,currency:'USD' as const,availableAt:at,source}];});
    const unique=[...new Map(events.map(e=>[e.id,e])).values()].sort((a,b)=>a.exDate.localeCompare(b.exDate));
    // The endpoint has no coverage bounds; an empty/short calendar cannot
    // establish a complete trailing-year sum or a zero dividend yield.
    const annualDividend=missingVariable(source,'El calendario no acredita cobertura completa de doce meses. La tasa anual se obtiene de métricas empresariales con procedencia, si están disponibles.');
    return {spot,annualDividend,dividends:{events:unique.filter(e=>e.exDate>=at.slice(0,10)),complete:false,status:{source,status:results[1].status==='fulfilled'?'partial':'unavailable',message:`${unique.length} dividendos recibidos; cobertura y anuncios originales no completos.`},warnings:['Los eventos se conocen desde esta consulta; no se retrofechan anuncios ni se supone que una lista vacía signifique dividendo cero.']}};
  }
  async news(symbol:string,start:string,end:string,asOf:string,next?:string):Promise<NewsTimelinePage>{
    const raw=record(await this.client.request('/market-data/news/stock-news/list',{symbol,category:'US_STOCK',...(next?{pagination_key:next}:{})}));
    if(!Array.isArray(raw.data))throw new ApiError('webull_invalid','Webull no confirmó la lista de noticias.',503);
    const day=(at:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
    const articles:ResearchNews['articles']=raw.data.map(record).flatMap(row=>{const at=webullTime(row.publish_time),updated=webullTime(row.update_time??row.updated_at)??at;if(!at||!updated||Date.parse(at)>Date.parse(asOf)||Date.parse(updated)>Date.parse(asOf)||day(at)<start||day(at)>end||typeof row.title!=='string'||typeof row.news_id!=='string')return [];let url:string|null=null;try{const parsed=new URL(String(row.url));if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password)url=parsed.href;}catch{/* Invalid links remain absent. */}return [{id:'webull:'+row.news_id,headline:row.title.slice(0,500),url,source:typeof row.source==='string'?row.source.slice(0,100):'Webull',publishedAt:at,availableAt:updated}];});
    const cursor=typeof raw.pagination_key==='string'&&raw.pagination_key?raw.pagination_key:null;
    return {symbol,start,end,asOf,news:{articles:[...new Map(articles.map(a=>[a.id,a])).values()],complete:!cursor,status:{source:'Webull · noticias',status:cursor?'partial':'ready',message:`${articles.length} noticias recibidas antes del corte.`},warnings:['El historial de revisiones depende de las fechas publicadas por el proveedor.']},nextPageToken:cursor};
  }
  async corporateActions(symbol:string,start:string,end:string){
    const rows:Record<string,unknown>[]=[];let next:string|undefined;const seen=new Set<string>();
    for(let page=0;page<20;page++){const raw=record(await this.client.request('/market-data/instruments/stocks/corporate-actions/list',{symbol,category:'US_STOCK',start_date:start,end_date:end,event_types:'FORWARD_SPLIT,REVERSE_SPLIT,NAME_CHANGE,MERGER',...(next?{pagination_key:next}:{})}));if(!Array.isArray(raw.data))throw new ApiError('webull_invalid','No se confirmó el historial de acciones corporativas.',503);rows.push(...raw.data.map(record));if(!raw.pagination_key)return {data:rows,complete:true};const cursor=String(raw.pagination_key);if(seen.has(cursor))break;seen.add(cursor);next=cursor;}
    return {data:rows,complete:false};
  }
}
