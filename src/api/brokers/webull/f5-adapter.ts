import {createHash} from 'node:crypto';
import {BrokerError} from '../alpaca/client.ts';
import {ApiError} from '../../http.ts';
import {numeric,record} from '../../../cores/compartido/data-values.ts';
import type {F5Account,F5Activity,F5BrokerOrder,F5Contract,F5OrderInput,F5Position} from '../../../features/f5/types.ts';
import type {F5AccountingActivity,F5AccountingBatch} from '../../../features/f5/report-types.ts';
import {f5EquitySymbol,f5OptionSymbol} from '../../../features/f5/validation.ts';
import type {F5Broker} from '../../../../services/trading-runner/f5-service.ts';
import {normalizeWebullBalances} from './data.ts';
import {loadWebullContracts,webullTime} from './options-data.ts';
import {webullMarketOpen} from './session.ts';
import type {WebullClient} from './client.ts';

const invalid=(message='Webull no confirmó todos los datos de la operación.'):never=>{throw new BrokerError('broker_response_invalid',503,message,false);};
const occ=(underlying:unknown,expiry:unknown,type:unknown,strike:unknown)=>{
  if(typeof underlying!=='string'||!f5EquitySymbol.test(underlying)||typeof expiry!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(expiry)||!['CALL','PUT'].includes(String(type)))return null;
  const k=numeric(strike);if(k===null||k<=0||!Number.isSafeInteger(Math.round(k*1000)))return null;
  return underlying+expiry.slice(2).replaceAll('-','')+(type==='CALL'?'C':'P')+String(Math.round(k*1000)).padStart(8,'0');
};
const state=(value:unknown)=>({PENDING:'pending_new',SUBMITTED:'new',NEW:'new',ACCEPTED:'accepted',WORKING:'new',FILLED:'filled',PARTIAL_FILLED:'partially_filled',PARTIALLY_FILLED:'partially_filled',CANCELLED:'canceled',CANCELED:'canceled',FAILED:'rejected',REJECTED:'rejected',EXPIRED:'expired',PENDING_CANCEL:'pending_cancel'}[String(value)]??'unknown');
const textNumber=(value:unknown)=>{const n=numeric(value);return n===null?undefined:String(n);};
function checkedContract(row:Record<string,unknown>,snapshot:Record<string,unknown>):F5Contract{
  const underlying=String(row.underlying_symbol??''),symbol=String(row.symbol??''),strike=numeric(row.strike_price),multiplier=numeric(row.multiplier);
  const delivery=Array.isArray(row.deliverables)?row.deliverables.map(record):[];
  const standard=multiplier===100&&delivery.length===1&&delivery[0].asset_type==='EQUITY'&&delivery[0].symbol===underlying&&numeric(delivery[0].amount)===100;
  if(!f5OptionSymbol.test(symbol)||symbol!==occ(underlying,row.expiration_date,row.option_type,strike)||!standard)invalid('Webull no confirmó un contrato OCC estándar con entrega de 100 acciones.');
  return {symbol,underlying,type:row.option_type==='CALL'?'call':'put',expiry:String(row.expiration_date),strike:strike!,size:100,style:row.style==='AMERICAN'?'american':String(row.style??'unknown').toLowerCase(),tradable:row.status==='LISTING'&&['OC','OPEN'].includes(String(row.tradable_status)),bid:numeric(snapshot.bid),ask:numeric(snapshot.ask),quoteTime:webullTime(snapshot.quote_time),delta:numeric(snapshot.delta)};
}

/** Maps provider responses into the shared F5 engine; no Alpaca credentials,
 * fabricated levels, inferred assignment quantities or automatic order retries.
 */
export class WebullF5Adapter implements F5Broker{
  readonly client:WebullClient;
  readonly now:()=>number;
  #cache=new Map<string,{until:number;value:Promise<unknown>}>();
  #attempted=new Map<string,string>();
  #knownOrders:()=>string[];
  #knownInputs:()=>F5OrderInput[];
  #beforePreview:()=>void;
  #activityStart:()=>string;
  #activitiesComplete=false;
  #details=new Map<string,Record<string,unknown>>();
  #positionIds=new Map<string,{id:string;strategy:string;quantity:number;underlying:string;expiry:string;strike:number;type:string}>();
  constructor(client:WebullClient,options:{now?:()=>number;knownOrders?:()=>string[];knownInputs?:()=>F5OrderInput[];beforePreview?:()=>void;activityStart?:()=>string}={}){this.client=client;this.now=options.now??Date.now;this.#knownOrders=options.knownOrders??(()=>[]);this.#knownInputs=options.knownInputs??(()=>[]);this.#beforePreview=options.beforePreview??(()=>{});this.#activityStart=options.activityStart??(()=>new Date(this.now()).getUTCFullYear()+'-01-01T00:00:00.000Z');}
  private async cached<T>(key:string,ttl:number,read:()=>Promise<T>):Promise<T>{const entry=this.#cache.get(key);if(entry&&entry.until>this.now())return structuredClone(await entry.value) as T;if(this.#cache.size>=512)this.#cache.delete(this.#cache.keys().next().value!);const value=read();this.#cache.set(key,{until:this.now()+ttl,value});try{return structuredClone(await value);}catch(e){this.#cache.delete(key);throw e;}}
  private async request(path:string,query:Record<string,string>={},payload?:unknown,category?:'US_EQUITY'|'US_OPTION'){
    try{return await this.client.request(path,query,payload,category);}catch(e){if(e instanceof ApiError)throw new BrokerError(e.status===429?'broker_rate_limited':e.code==='webull_auth_rejected'?'broker_credentials_invalid':e.code==='webull_endpoint'?'broker_endpoint_unavailable':'broker_response_invalid',e.status,e.message,false);throw e;}
  }
  async account():Promise<F5Account>{return this.cached('account',2000,async()=>{
    await this.client.verifyAccount();const b=normalizeWebullBalances(await this.request('/trading/assets/balances/get',{account_id:this.client.config.accountId,total_asset_currency:'USD'}));
    // Missing capital blocks trading, but account and research reads remain available.
    if([b.settledCash,b.buyingPower,b.optionBuyingPower,b.equity].some(n=>n===null))invalid('Webull no confirmó efectivo liquidado, poder de compra y patrimonio de la cuenta.');
    return {status:'OPENAPI_VERIFIED',cash:b.settledCash!,buyingPower:b.buyingPower!,optionsBuyingPower:b.optionBuyingPower!,equity:b.equity!,optionsLevel:null,optionsPermissionSource:'preview',blocked:false};
  });}
  async clock(){return webullMarketOpen(this.now());}
  private async snapshots(names:string[]){
    const found=new Map<string,Record<string,unknown>>();
    for(let i=0;i<names.length;i+=20){const part=names.slice(i,i+20);const raw=await this.cached('quotes:'+part.join(','),15000,()=>this.request('/market-data/options/snapshots/list',{symbols:part.join(','),category:'US_OPTION'}));if(!Array.isArray(raw))invalid();for(const item of raw as unknown[]){const row=record(item);if(typeof row.symbol==='string'&&part.includes(row.symbol))found.set(row.symbol,row);}}
    return found;
  }
  async contracts(underlying:string,expiry?:string){
    if(!f5EquitySymbol.test(underlying)||expiry!==undefined&&!/^\d{4}-\d{2}-\d{2}$/.test(expiry))invalid();
    return this.cached('contracts:'+underlying+':'+expiry,60000,async()=>{
      const metadata=await loadWebullContracts(this.client,underlying,expiry?{start_date:expiry,end_date:expiry}:{});
      const rows=metadata.rows.filter(row=>row.underlying_symbol===underlying&&(!expiry||row.expiration_date===expiry));
      let spot:number|null=null;try{const raw=await this.request('/market-data/stocks/snapshots/list',{symbols:underlying,category:'US_STOCK'});spot=Array.isArray(raw)?numeric(record(raw[0]).price):null;}catch{/* Quotes are independently optional for chain browsing. */}
      const selected=[...rows].sort((a,b)=>Math.abs((numeric(a.strike_price)??Infinity)-(spot??0))-Math.abs((numeric(b.strike_price)??Infinity)-(spot??0))).slice(0,160);
      let snapshots=new Map<string,Record<string,unknown>>();try{snapshots=await this.snapshots(selected.map(row=>String(row.symbol)));}catch{/* A missing snapshot never becomes a synthetic quote. */}
      const contracts:F5Contract[]=[];for(const row of rows){try{contracts.push(checkedContract(row,snapshots.get(String(row.symbol))??{}));}catch{/* Exclude adjusted or inconsistent contracts. */}}
      return {contracts,complete:metadata.complete&&selected.length===rows.length&&snapshots.size===rows.length,feed:'webull-sandbox' as const};
    });
  }
  async contract(symbol:string):Promise<F5Contract>{
    if(!f5OptionSymbol.test(symbol))invalid();
    return this.cached('contract:'+symbol,5000,async()=>{const underlying=symbol.slice(0,-15),raw=record(await this.request('/trading/instruments/options/contracts/list',{category:'US_OPTION',underlying_symbols:underlying,option_symbols:symbol,show_deliverables:'true'}));const matches=Array.isArray(raw.data)?raw.data.map(record).filter(r=>r.symbol===symbol):[];if(matches.length!==1)invalid();const quotes=await this.snapshots([symbol]);return checkedContract(matches[0],quotes.get(symbol)??{});});
  }
  async positions():Promise<F5Position[]>{return this.cached('positions',2000,async()=>{
    const raw=await this.request('/trading/assets/positions/list',{account_id:this.client.config.accountId});if(!Array.isArray(raw))invalid();const positions:F5Position[]=[];
    this.#positionIds.clear();
    for(const item of raw as unknown[]){const row=record(item),q=numeric(row.quantity);if(q===null)invalid();
      if(['EQUITY','STOCK'].includes(String(row.instrument_type))){positions.push({symbol:String(row.symbol),quantity:q!,assetClass:'us_equity',marketValue:numeric(row.market_value)??(numeric(row.last_price)!==null?numeric(row.last_price)!*q!:null),averagePrice:numeric(row.cost_price),unrealizedPnl:numeric(row.unrealized_profit_loss)});continue;}
      if(row.instrument_type!=='OPTION'){positions.push({symbol:String(row.symbol),quantity:q!,assetClass:String(row.instrument_type),marketValue:null,averagePrice:null,unrealizedPnl:null});continue;}
      const legs=Array.isArray(row.legs)?row.legs.map(record):[];if(!legs.length)invalid('Webull no confirmó las patas de la posición de opciones.');
      for(const leg of legs){const symbol=occ(leg.symbol,leg.option_expire_date,leg.option_type,leg.option_exercise_price??leg.strike_price),quantity=numeric(leg.quantity);if(!symbol||quantity===null||numeric(leg.option_contract_multiplier)!==100||numeric(leg.option_contract_deliverable)!==100)invalid('Una posición Webull no tiene cantidades y entregables verificables.');
        if(typeof row.position_id==='string')this.#positionIds.set(symbol!,{id:row.position_id,strategy:String(row.option_strategy),quantity:quantity!,underlying:String(leg.symbol),expiry:String(leg.option_expire_date),strike:numeric(leg.option_exercise_price??leg.strike_price)!,type:String(leg.option_type)});
        // Preserve signed quantities from Webull. A group total cannot price or
        // establish the cost of individual legs in a combined position.
        let mark:number|null=numeric(leg.market_value);if(mark===null)try{const c=await this.contract(symbol!);if(c.bid!==null&&c.ask!==null&&c.bid>=0&&c.ask>=c.bid)mark=(c.bid+c.ask)/2*quantity!*100;}catch{/* Unknown marks remain unknown. */}
        positions.push({symbol:symbol!,quantity:quantity!,assetClass:'us_option',marketValue:mark,averagePrice:numeric(leg.cost_price)??(legs.length===1?numeric(row.cost_price):null),unrealizedPnl:numeric(leg.unrealized_profit_loss)??(legs.length===1?numeric(row.unrealized_profit_loss):null)});
      }
    }return positions;
  });}
  async orders():Promise<F5BrokerOrder[]>{
    const rows:Record<string,unknown>[]=[];let next:string|undefined;const seen=new Set<string>();
    for(let page=0;page<20;page++){const raw=record(await this.request('/trading/orders/open-orders/list',{account_id:this.client.config.accountId,...(next?{pagination_key:next}:{})}));if(!Array.isArray(raw.data))invalid();for(const group of raw.data as unknown[]){const value=record(group);rows.push(...(Array.isArray(value.orders)?value.orders.map(record):[value]));}const cursor=raw.pagination_key;if(!cursor)return rows.map(row=>this.normalizeOrder(row));if(typeof cursor!=='string'||seen.has(cursor))invalid('No se pudo verificar la lista completa de órdenes Webull.');seen.add(cursor as string);next=cursor as string;}
    return invalid('La lista de órdenes Webull excede el límite de páginas verificables.');
  }
  private normalizeOrder(row:Record<string,unknown>):F5BrokerOrder{
    const reference=String(row.client_order_id??''),qty=numeric(row.total_quantity??row.quantity),filled=numeric(row.filled_quantity??row.filled_qty),price=numeric(row.limit_price),side=String(row.side).toLowerCase();
    if(!reference||qty===null||qty<=0||filled===null||filled<0||filled>qty||price===null||!['buy','sell'].includes(side))invalid('El detalle Webull está incompleto; la orden queda pendiente de conciliación.');
    const rawLegs=Array.isArray(row.legs)?row.legs.map(record):[],option=row.instrument_type==='OPTION';
    const parent:F5BrokerOrder={id:reference,client_order_id:reference,status:state(row.status??row.order_status),side:side as 'buy'|'sell',qty:String(qty),filled_qty:String(filled),filled_avg_price:textNumber(row.filled_price??row.filled_avg_price)??null,limit_price:String(price),type:String(row.order_type??'').toLowerCase(),time_in_force:String(row.time_in_force??'').toLowerCase(),created_at:webullTime(row.place_time_at??row.place_time)??undefined};
    const intent=typeof row.position_intent==='string'?row.position_intent.toLowerCase():undefined;
    if(!option){parent.symbol=String(row.symbol);parent.side=side as 'buy'|'sell';return parent;}
    const legs=rawLegs.map(leg=>{
      const symbol=occ(leg.symbol,leg.option_expire_date,leg.option_type,leg.strike_price),count=numeric(leg.quantity),direction=String(leg.side).toLowerCase();
      if(!symbol||count===null||count<=0||!['buy','sell'].includes(direction)||!Number.isInteger(count/qty!))invalid('Webull no confirmó las proporciones de todas las patas.');
      // Filled quantities per leg are accepted only when explicitly reported.
      // A confirmed atomic FILLED order establishes the whole reviewed vector;
      // partial parent fills cannot establish unreported per-leg executions.
      const legFilled=numeric(leg.filled_quantity??leg.filled_qty)??(state(row.status)==='filled'?count:filled===0?0:null);
      return {id:String(leg.id??leg.leg_id??reference+':'+symbol),client_order_id:reference,symbol:symbol!,side:direction as 'buy'|'sell',qty:String(count),filled_qty:legFilled===null?'unknown':String(legFilled),ratio_qty:String(count!/qty!),position_intent:typeof leg.position_intent==='string'?leg.position_intent.toLowerCase():intent?(direction+'_'+intent.split('_').slice(1).join('_')):null,status:parent.status,filled_avg_price:textNumber(leg.filled_price)??null};
    });
    if(legs.length===1){parent.symbol=legs[0].symbol;parent.side=legs[0].side;parent.position_intent=intent??legs[0].position_intent;parent.order_class='simple';}
    else{parent.order_class='mleg';parent.legs=legs;}
    return parent;
  }
  async orderByClientId(id:string):Promise<F5BrokerOrder|null>{
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))invalid();
    const raw=record(await this.request('/trading/orders/get',{account_id:this.client.config.accountId,client_order_id:this.reference(id)}));
    const rows=Array.isArray(raw.orders)?raw.orders.map(record):[];const matching=rows.filter(row=>row.client_order_id===this.reference(id));if(matching.length!==1)invalid('Webull no confirmó una única orden para la referencia.');this.#details.set(id,matching[0]);const normalized=this.normalizeOrder(matching[0]),input=this.#knownInputs().find(value=>this.reference(value.client_order_id)===this.reference(id));return input?this.remap(normalized,input):normalized;
  }
  // Webull accepts at most 32 characters. This deterministic mapping also works
  // after a restart, without storing credentials or relying on in-memory maps.
  private reference(id:string){return id.length<=32?id:createHash('sha256').update(id).digest('hex').slice(0,32);}
  private async payload(input:F5OrderInput){
    const qty=Number(input.qty),price=Number(input.limit_price);if(!Number.isSafeInteger(qty)||qty<1||!Number.isFinite(price)||price===0)invalid();
    const base={client_order_id:this.reference(input.client_order_id),combo_type:'NORMAL',market:'US',order_type:'LIMIT',time_in_force:'DAY',entrust_type:'QTY',quantity:String(qty),support_trading_session:'CORE'};
    if(input.symbol&&!f5OptionSymbol.test(input.symbol)){if(!f5EquitySymbol.test(input.symbol)||price<=0)invalid();return {account_id:this.client.config.accountId,new_orders:[{...base,symbol:input.symbol,instrument_type:'EQUITY',side:input.side!.toUpperCase(),limit_price:price.toFixed(2)}]};}
    const requested=input.legs??[{symbol:input.symbol!,side:input.side!,ratio_qty:'1',position_intent:input.position_intent!}];
    const contracts=await Promise.all(requested.map(l=>this.contract(l.symbol)));if(new Set(contracts.map(c=>c.underlying)).size!==1)invalid();
    const intents=new Set(requested.map(l=>l.position_intent?.split('_').at(-1)));const closing=intents.size===1&&intents.has('close');
    let strategy='SINGLE';if(contracts.length===2){const [a,b]=contracts;strategy=a.type!==b.type?(a.strike===b.strike?'STRADDLE':'STRANGLE'):a.expiry===b.expiry?'VERTICAL':a.strike===b.strike?'CALENDAR':'DIAGONAL';}
    // A roll mixes close and open intents. The Trading API exposes a single
    // top-level intent, so never disguise it or split it into naked leg orders.
    if(intents.size!==1)throw new BrokerError('webull_atomic_roll_unavailable',409,'Webull Trading API no confirmó un roll atómico con intenciones mixtas. Cierra la call corta y revisa una nueva apertura cubierta por separado.',false);
    const side=requested.length===1?requested[0].side.toUpperCase():price>0?'BUY':'SELL';
    let linkage:Record<string,string>={};
    if(requested.length===1){
      const held=this.#positionIds.get(requested[0].symbol);
      if(closing&&held&&held.strategy!=='SINGLE')linkage={leg_in_or_out:'LEG_OUT',position_id:held.id};
      if(!closing&&side==='SELL'&&contracts[0].type==='call'){
        const covering=[...this.#positionIds.values()].filter(p=>p.strategy==='SINGLE'&&p.type==='CALL'&&p.underlying===contracts[0].underlying&&p.expiry>contracts[0].expiry&&p.strike<=contracts[0].strike&&p.quantity>=qty);
        if(covering.length===1)linkage={leg_in_or_out:'LEG_IN',position_id:covering[0].id,leg_in_strategy:'DIAGONAL'};
      }
    }
    return {account_id:this.client.config.accountId,new_orders:[{...base,...linkage,symbol:contracts[0].underlying,instrument_type:'OPTION',option_strategy:strategy,side,limit_price:Math.abs(price).toFixed(2),position_intent:side+'_TO_'+(closing?'CLOSE':'OPEN'),legs:requested.map((l,i)=>({side:l.side.toUpperCase(),quantity:String(qty*Number(l.ratio_qty)),symbol:contracts[i].underlying,strike_price:String(contracts[i].strike),option_expire_date:contracts[i].expiry,option_type:contracts[i].type.toUpperCase(),instrument_type:'OPTION',market:'US'}))}]};
  }
  async preview(input:F5OrderInput){this.#beforePreview();const payload=await this.payload(input);const raw=record(await this.request('/trading/orders/preview',{},payload));if(!Object.keys(raw).length)invalid('Webull no confirmó la revisión y permisos de la estrategia.');}
  private remap(order:F5BrokerOrder,input:F5OrderInput):F5BrokerOrder{
    if(order.client_order_id!==this.reference(input.client_order_id))invalid();
    const mapped={...order,client_order_id:input.client_order_id};
    // F5 uses a signed net debit; Webull returns a positive amount and BUY/SELL.
    if(input.order_class==='mleg'){
      const expectedSide=Number(input.limit_price)>0?'buy':'sell';
      if(order.side!==expectedSide||Number(order.limit_price)!==Math.abs(Number(input.limit_price)))invalid('Webull no confirmó el sentido de débito/crédito y el precio neto de la orden.');
      mapped.limit_price=String(Number(input.limit_price));
      if(mapped.filled_avg_price!==null&&mapped.filled_avg_price!==undefined)mapped.filled_avg_price=String(Math.abs(Number(mapped.filled_avg_price))*(expectedSide==='sell'?-1:1));
    }
    return mapped;
  }
  async assertExecutionReady(symbols:string[],equity?:string){
    if(!await this.clock())throw new ApiError('webull_market_closed','El mercado regular está cerrado. Actualiza la revisión durante la sesión.',409);
    const contracts=await Promise.all(symbols.map(symbol=>this.contract(symbol)));
    for(const c of contracts){const at=c.quoteTime?Date.parse(c.quoteTime):NaN;if(c.bid===null||c.ask===null||c.bid<0||c.ask<=0||c.ask<c.bid||!Number.isFinite(at)||at>this.now()+5000||this.now()-at>1200000)throw new ApiError('webull_quote_stale','Webull no confirmó una cotización reciente. Actualiza contratos y revisa otra vez.',409);}
    if(equity)await this.stockQuote(equity);
  }
  async submit(input:F5OrderInput,notAfter?:number,allowSubmit?:()=>boolean):Promise<F5BrokerOrder>{
    const signature=JSON.stringify(input),prior=this.#attempted.get(input.client_order_id);if(prior&&prior!==signature)invalid();if(prior)throw new BrokerError('broker_order_ambiguous',503,'La referencia ya tuvo un intento de envío; concíliala sin reenviar.',false);
    if(!this.client.config.enabled)throw new BrokerError('f5_disabled',409,'El envío Webull está deshabilitado.',false);
    if(!await this.clock())throw new BrokerError('f5_market_closed',409,'El mercado regular está cerrado.',false);
    const payload=await this.payload(input);await this.preview(input);
    if(notAfter!==undefined&&this.now()>=notAfter)throw new BrokerError('f5_preview_expired',409,'La revisión venció durante la validación.',false);
    if(allowSubmit&&!allowSubmit())throw new BrokerError('f5_paused',409,'La operación está pausada.',false);
    this.#attempted.set(input.client_order_id,signature);
    try{await this.request('/trading/orders/place',{},payload);this.#cache.clear();const order=await this.orderByClientId(input.client_order_id);if(!order)invalid();return this.remap(order!,input);}catch(e){throw e instanceof BrokerError?e:new BrokerError('broker_order_ambiguous',503,'Webull no confirmó el envío; consulta la referencia sin repetirlo.',false);}
  }
  async cancel(id:string){
    if(!this.client.config.enabled)throw new BrokerError('f5_disabled',409,'El envío Webull está deshabilitado.',false);
    const raw=await this.orderByClientId(id);if(!raw||!['new','accepted','pending_new','partially_filled','pending_cancel'].includes(raw.status))throw new BrokerError('f5_cannot_cancel',409,'Webull no confirmó una orden pendiente para cancelar.',false);
    await this.request('/trading/orders/cancel',{}, {account_id:this.client.config.accountId,client_order_id:this.reference(id)},raw.symbol&&f5EquitySymbol.test(raw.symbol)?'US_EQUITY':'US_OPTION');this.#cache.clear();
  }
  async stockQuote(symbol:string){
    if(!f5EquitySymbol.test(symbol))invalid();
    const row=record(await this.request('/market-data/stocks/depths/list',{symbol,category:'US_STOCK',depth:'1',overnight_required:'false'}));
    const bids=Array.isArray(row.bids)?row.bids.map(record):[],asks=Array.isArray(row.asks)?row.asks.map(record):[];
    const bid=numeric(bids[0]?.price),ask=numeric(asks[0]?.price),at=webullTime(row.quote_time);
    if(row.symbol!==symbol||bid===null||ask===null||!at||bid<=0||ask<bid||Date.parse(at)>this.now()+5000||this.now()-Date.parse(at)>1200000)invalid('No hay una cotizaci\u00f3n reciente del subyacente Webull.');
    return {bid:bid!,ask:ask!,time:at!};
  }
  private async cashActivities(types:string):Promise<F5AccountingBatch>{return this.cached('activities:'+types,30000,async()=>{
    const items:F5AccountingActivity[]=[];let next:string|undefined;const seen=new Set<string>();let complete=false;
    try{
      const start=new Date(this.#activityStart()),end=new Date(this.now());if(!Number.isFinite(start.getTime())||start>end||end.getUTCFullYear()-start.getUTCFullYear()>10)invalid('El periodo de actividades no es verificable.');
      complete=true;
      for(let year=start.getUTCFullYear();year<=end.getUTCFullYear();year++){
        const first=year===start.getUTCFullYear()?start:new Date(Date.UTC(year,0,1)),last=year===end.getUTCFullYear()?end:new Date(Date.UTC(year+1,0,1)-1);next=undefined;seen.clear();let yearComplete=false;
        for(let page=0;page<20;page++){
          const raw=record(await this.request('/trading/activities/cash-activities/list',{account_id:this.client.config.accountId,activity_types:types,start_time:first.toISOString(),end_time:last.toISOString(),...(next?{pagination_key:next}:{})}));if(!Array.isArray(raw.data))invalid();
          for(const item of raw.data as unknown[]){const row=record(item),sub=String(row.activity_sub_type??''),type=({OPTION_ASSIGNMENT:'OPASN',OPTION_EXERCISE:'OPEXC',OPTION_EXPIRATION:'OPEXP'} as Record<string,string>)[sub]??(row.activity_type==='FEES'?'FEE':String(row.activity_type));if(typeof row.id!=='string')invalid();items.push({id:String(row.id),type,symbol:typeof row.symbol==='string'?row.symbol:null,orderId:typeof row.client_order_id==='string'?row.client_order_id:null,date:typeof row.trade_date==='string'?row.trade_date:null,transactionTime:webullTime(row.biz_time),quantity:numeric(row.quantity??row.qty),price:numeric(row.price),side:sub==='BUY'?'buy':sub==='SELL'?'sell':null,netAmount:numeric(row.net_amount),groupId:typeof row.group_id==='string'?row.group_id:null,optionSymbol:typeof row.option_symbol==='string'?row.option_symbol:null,relatedActivityId:null,status:typeof row.status==='string'?row.status:null,description:sub,subtype:sub,currency:typeof row.currency==='string'?row.currency:null});}
          const cursor=raw.pagination_key;if(!cursor){yearComplete=true;break;}if(typeof cursor!=='string'||seen.has(cursor))break;seen.add(cursor);next=cursor;
        }
        complete&&=yearComplete;
      }
    }catch{complete=false;}
    return {items,complete,asOf:new Date(this.now()).toISOString(),source:'Webull Sandbox cash activities',warnings:complete?[]:['Webull no confirmó el historial completo de actividades. Las cantidades y atribuciones ausentes no se deducen de cambios de saldo.']};
  });}
  async activities():Promise<F5Activity[]>{const batch=await this.cashActivities('OPTION_EA');this.#activitiesComplete=batch.complete&&batch.items.every(r=>r.quantity!==null&&f5OptionSymbol.test(r.optionSymbol??r.symbol??''));return batch.items.map(r=>({id:r.id,type:r.type,symbol:r.optionSymbol??r.symbol??'',date:r.transactionTime??r.date??'',quantity:r.quantity===null?'unknown':String(r.quantity),description:r.description,...(r.groupId?{groupId:r.groupId}:{})}));}
  activitiesComplete(){return this.#activitiesComplete;}
  async optionActivities(){return this.cashActivities('OPTION_EA');}
  async fillActivities():Promise<F5AccountingBatch>{return {items:[],complete:false,asOf:new Date(this.now()).toISOString(),source:'Webull Sandbox order details',warnings:['El reporte usa cantidades y precios acumulados confirmados en las órdenes; no inventa fills individuales ni su fecha.']};}
  async feeActivities():Promise<F5AccountingBatch>{
    const cash=await this.cashActivities('FEES');const items=[...cash.items];let complete=true;
    for(const id of this.#knownOrders()){try{await this.orderByClientId(id);const row=this.#details.get(id)!;const commission=numeric(record(row.commission).actual_commission),fees=Array.isArray(row.fees)?row.fees.map(record):null;if(commission===null||!fees||!['filled','canceled','rejected','expired'].includes(state(row.status))){complete=false;continue;}const values=[{type:'COMMISSION',amount:commission},...fees.map(f=>({type:String(f.type),amount:numeric(f.actual_value)}))];for(const value of values){if(value.amount===null){complete=false;continue;}items.push({id:'webull-fee:'+this.reference(id)+':'+value.type,type:'FEE',symbol:null,orderId:this.reference(id),date:null,transactionTime:null,quantity:null,price:null,side:null,netAmount:-value.amount,groupId:null,optionSymbol:null,relatedActivityId:null,status:'executed',description:value.type,subtype:value.type,currency:'USD'});}}catch{complete=false;}}
    return {items,complete:complete&&this.#knownOrders().length>0,asOf:new Date(this.now()).toISOString(),source:'Webull Sandbox actual order fees',warnings:[...cash.warnings,...(complete?[]:['Las comisiones finales de algunas órdenes aún no están confirmadas.'])]};
  }
}
