import {numeric,record,timestamp} from '../../../cores/compartido/data-values.ts';
import type {WebullBalances,WebullPosition,WebullRemoteOrder,WebullPortfolio,WebullSection,WebullHistoryQuery} from '../../../cores/compartido/webull-model.ts';
import {webullHistoryQuery,webullOptionsQuery} from '../../../cores/compartido/webull-model.ts';
import type {Candle} from '../../../features/market/chart-history.ts';
import {ApiError} from '../../http.ts';
import type {WebullClient} from './client.ts';
import {fetchWebullOptions,webullTime} from './options-data.ts';
import type {ResearchOptions} from '../../../cores/compartido/research-model.ts';

const text=(value:unknown,max=120)=>typeof value==='string'?value.slice(0,max):'';
const array=(value:unknown):unknown[]=>Array.isArray(value)?value:Array.isArray(record(value).data)?record(value).data as unknown[]:[];
export function normalizeWebullBalances(raw:unknown):WebullBalances{
  const body=record(raw),currency=text(body.total_asset_currency,3);
  if(currency!=='USD')throw new ApiError('webull_currency','Webull no confirmó los saldos en USD.',503);
  const assets=Array.isArray(body.account_currency_assets)?body.account_currency_assets.map(record):[];
  const usd=assets.find(row=>row.currency==='USD');
  return {currency,cash:numeric(usd?.cash_balance??body.total_cash_balance),settledCash:numeric(usd?.settled_cash),unsettledCash:numeric(usd?.unsettled_cash),equity:numeric(body.total_net_liquidation_value),marketValue:numeric(body.total_market_value),buyingPower:numeric(usd?.buying_power),optionBuyingPower:numeric(usd?.option_buying_power),unrealizedPnl:numeric(body.total_unrealized_profit_loss)};
}
export function normalizeWebullPositions(raw:unknown):WebullPosition[]{
  if(!Array.isArray(raw)&&!Array.isArray(record(raw).data))throw new ApiError('webull_invalid','Webull no confirmó la lista de posiciones.',503);
  return array(raw).map(value=>{const row=record(value),symbol=text(row.symbol),quantity=numeric(row.quantity??row.total_quantity);
    if(!/^[A-Z][A-Z0-9. -]{0,30}$/.test(symbol)||quantity===null)throw new ApiError('webull_invalid','Una posición Webull está incompleta.',503);
    const legs=Array.isArray(row.legs)?row.legs.map(value=>{const l=record(value);return {symbol:text(l.symbol),quantity:numeric(l.quantity),type:text(l.option_type),expiration:text(l.option_expire_date),strike:numeric(l.option_exercise_price??l.strike_price)};}):[];
    const singleAvailable=legs.length===1&&legs[0].quantity!==null&&Math.abs(legs[0].quantity)<=Math.abs(quantity)?Math.abs(legs[0].quantity):null;
    return {symbol,type:row.instrument_type==='STOCK'?'EQUITY':text(row.instrument_type),quantity,availableQuantity:numeric(row.available_quantity)??singleAvailable,averagePrice:numeric(row.cost_price??row.avg_cost??row.average_price??row.unit_cost),marketValue:numeric(row.market_value),unrealizedPnl:numeric(row.unrealized_profit_loss),legs};
  });
}
export function normalizeWebullOrders(raw:unknown):{orders:WebullRemoteOrder[];next:string|null}{
  if(!Array.isArray(raw)&&!Array.isArray(record(raw).data))throw new ApiError('webull_invalid','Webull no confirmó la lista de órdenes.',503);
  const next=record(raw).pagination_key;
  const rows=array(raw).flatMap(value=>{const group=record(value);return Array.isArray(group.orders)?group.orders:[group];});
  const orders=rows.map(value=>{const row=record(value),reference=text(row.client_order_id,128);
    if(!reference)throw new ApiError('webull_invalid','Una orden Webull no tiene referencia verificable.',503);
    return {reference,symbol:text(row.symbol??row.underlying_symbol),type:row.instrument_type==='STOCK'?'EQUITY':text(row.instrument_type),side:text(row.side),quantity:numeric(row.total_quantity??row.quantity),filled:numeric(row.filled_quantity??row.filled_qty),limitPrice:numeric(row.limit_price),state:text(row.status??row.order_status),createdAt:webullTime(row.place_time_at??row.place_time??row.create_time??row.created_time),legs:Array.isArray(row.legs)?row.legs.map(value=>{const leg=record(value);return {symbol:text(leg.symbol),side:text(leg.side),quantity:numeric(leg.quantity??leg.total_quantity)};}):[]};
  });
  return {orders,next:typeof next==='string'&&next&&next.length<=2048?next:null};
}
export type WebullHistory={source:'webull';feed:'sandbox';symbol:string;interval:string;start:string;end:string;asOf:string;adjustment:'forward'|'unadjusted';bars:Candle[];warnings:string[];coverage:{firstBar:string|null;lastBar:string|null;requestedStart:string;requestedEnd:string}};
export function normalizeWebullBars(raw:unknown,query:WebullHistoryQuery,asOf:string):WebullHistory{
  const groups=record(raw).result;
  if(!Array.isArray(groups))throw new ApiError('webull_invalid','Webull no devolvió una serie de velas verificable.',503);
  const group=groups.map(record).find(row=>row.symbol===query.symbol);
  if(!group||!Array.isArray(group.result))throw new ApiError('webull_invalid','Las velas no corresponden al símbolo solicitado.',503);
  const bars=new Map<number,Candle>(),start=Date.parse(query.start),end=Math.min(Date.parse(query.end)+86400000,Date.parse(asOf));
  for(const value of group.result){const row=record(value),date=timestamp(row.time),time=date?Date.parse(date):NaN;
    const open=numeric(row.open),high=numeric(row.high),low=numeric(row.low),close=numeric(row.close),volume=numeric(row.volume);
    if(!Number.isFinite(time)||open===null||high===null||low===null||close===null||volume===null||open<=0||low<=0||close<=0||volume<0||high<Math.max(open,close)||low>Math.min(open,close))throw new ApiError('webull_invalid','Webull devolvió una vela incompleta o incoherente.',503);
    if(time<start||time>=end)continue;
    const candle={time,open,high,low,close,volume},prior=bars.get(time);
    if(prior&&JSON.stringify(prior)!==JSON.stringify(candle))throw new ApiError('webull_invalid','Webull devolvió velas duplicadas contradictorias.',503);
    bars.set(time,candle);
  }
  const sorted=[...bars.values()].sort((a,b)=>a.time-b.time);
  return {source:'webull',feed:'sandbox',...query,asOf,adjustment:query.interval==='1d'?'forward':'unadjusted',bars:sorted,warnings:['Webull Sandbox: datos recibidos del entorno de pruebas; no acreditan precios ejecutables ni cobertura de producción.',query.interval==='1d'?'Velas diarias forward-adjusted según el contrato de Webull; no se presumen equivalentes a retorno total.':'Velas intradía sin ajuste según el contrato de Webull.'],coverage:{firstBar:sorted.length?new Date(sorted[0].time).toISOString():null,lastBar:sorted.length?new Date(sorted.at(-1)!.time).toISOString():null,requestedStart:query.start,requestedEnd:query.end}};
}

export class WebullData {
  #client:WebullClient;
  #cache=new Map<string,{expires:number;promise:Promise<unknown>}>();
  constructor(client:WebullClient){this.#client=client;}
  invalidateAccount(){this.#cache.delete('portfolio');}
  private async cached<T>(key:string,ttl:number,load:()=>Promise<T>):Promise<T>{const previous=this.#cache.get(key);if(previous&&previous.expires>Date.now())return structuredClone(await previous.promise) as T;if(this.#cache.size>=100)this.#cache.delete(this.#cache.keys().next().value!);const entry={expires:Date.now()+ttl,promise:load()};this.#cache.set(key,entry);try{return structuredClone(await entry.promise);}catch(error){this.#cache.delete(key);throw error;}}
  async portfolio():Promise<WebullPortfolio>{return this.cached('portfolio',10000,async()=>{
    const c=this.#client,query={account_id:c.config.accountId};await c.verifyAccount();
    const results=await Promise.allSettled([c.request('/trading/assets/balances/get',{...query,total_asset_currency:'USD'}).then(normalizeWebullBalances),c.request('/trading/assets/positions/list',query).then(normalizeWebullPositions),this.orders('open'),this.orders('history')]);
    const section=<T>(result:PromiseSettledResult<T>):WebullSection<T>=>result.status==='fulfilled'?{available:true,data:result.value,complete:true,next:null,message:'Consulta Webull Sandbox verificada.'}:{available:false,data:null,complete:false,next:null,message:result.reason instanceof ApiError?result.reason.message:'Webull no confirmó esta sección.'};
    const page=(result:typeof results[2]):WebullSection<WebullRemoteOrder[]>=>result.status==='fulfilled'?{available:true,data:result.value.orders,next:result.value.next,complete:!result.value.next,message:result.value.next?'Hay más órdenes; carga la siguiente página.':'Página de órdenes recibida.'}:{available:false,data:null,complete:false,next:null,message:'No se pudieron consultar las órdenes Webull.'};
    return {asOf:new Date().toISOString(),mode:'sandbox' as const,balances:section(results[0]),positions:section(results[1]),openOrders:page(results[2]),history:page(results[3])};
  });}
  async orders(kind:'open'|'history',next?:string,start?:string,end?:string){return this.#client.request(kind==='open'?'/trading/orders/open-orders/list':'/trading/orders/historical-orders/list',{account_id:this.#client.config.accountId,...(next?{pagination_key:next}:{}),...(start&&end?{start_time:start+'T00:00:00.000Z',end_time:end+'T23:59:59.999Z'}:{})}).then(normalizeWebullOrders);}
  async history(input:WebullHistoryQuery):Promise<WebullHistory>{const q=webullHistoryQuery.parse(input);return this.cached('history:'+JSON.stringify(q),30000,async()=>{
    const start=Date.parse(q.start),asOf=new Date().toISOString(),bars=new Map<number,Candle>();let end=Math.min(Date.parse(q.end)+86400000,Date.parse(asOf)),complete=false;
    for(let page=0;page<80;page++){
      const raw=await this.#client.request('/market-data/stocks/bars/list',{}, {symbols:[q.symbol],category:'US_STOCK',timespan:{'5m':'M5','15m':'M15','1h':'M60','1d':'D'}[q.interval],count:1200,start_time:start,end_time:end,real_time_required:false,trading_sessions:'RTH'});
      const batch=normalizeWebullBars(raw,q,asOf);for(const bar of batch.bars){const previous=bars.get(bar.time);if(previous&&JSON.stringify(previous)!==JSON.stringify(bar))throw new ApiError('webull_invalid','El histórico cambió durante la descarga. Actualiza la consulta.',503);bars.set(bar.time,bar);}
      const groups=record(raw).result as unknown[],group=groups.map(record).find(r=>r.symbol===q.symbol),count=Array.isArray(group?.result)?group.result.length:0;
      const oldest=batch.bars[0]?.time;if(count<1200||oldest!==undefined&&oldest<=start){complete=true;break;}
      if(oldest===undefined||oldest>=end)throw new ApiError('webull_invalid','La descarga histórica no avanzó.',503);end=oldest-1;
    }
    if(!complete)throw new ApiError('webull_history_partial','El histórico excede el límite de descarga. Acota el rango o aumenta la temporalidad.',409);
    const sorted=[...bars.values()].sort((a,b)=>a.time-b.time),result=normalizeWebullBars({result:[{symbol:q.symbol,result:sorted.map(b=>({...b,time:new Date(b.time).toISOString()}))}]},q,asOf);
    return result;
  });}
  async quote(symbol:string):Promise<unknown>{const q=webullOptionsQuery.parse({symbol});return this.cached('quote:'+q.symbol,15000,()=>this.#client.request('/market-data/stocks/snapshots/list',{symbols:q.symbol,category:'US_STOCK',extend_hour_required:'false',overnight_required:'false'}));}
  async options(symbol:string,days=30):Promise<ResearchOptions>{const q=webullOptionsQuery.parse({symbol,days});return this.cached('options:'+JSON.stringify(q),60000,async()=>{const quotes=await this.quote(symbol),row=Array.isArray(quotes)?record(quotes[0]):{};return fetchWebullOptions(this.#client,symbol,days,numeric(row.price)??undefined);});}
}
