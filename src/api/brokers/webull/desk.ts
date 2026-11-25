import {createHash} from 'node:crypto';
import {ApiError} from '../../http.ts';
import {numeric,record} from '../../../cores/compartido/data-values.ts';
import {webullOptionsInput,webullChangeInput,type WebullOptionsInput,type WebullChangeInput,type WebullOptionReview,type WebullChangeReview,type WebullRemoteOrder} from '../../../cores/compartido/webull-model.ts';
import {normalizeWebullBalances,normalizeWebullPositions} from './data.ts';
import {webullTime} from './options-data.ts';
import type {WebullClient,WebullOrder} from './client.ts';

const fail=(message:string):never=>{throw new ApiError('webull_review',message,409);};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const webullAccountBinding=(client:WebullClient)=>hash([client.config.host,client.config.region,client.config.accountId]);
const active=new Set(['NEW','WORKING','OPEN','SUBMITTED','ACCEPTED','PARTIAL_FILLED','PARTIALLY_FILLED','PENDING','CREATED']);
export class WebullDesk {
  private client:WebullClient;
  constructor(client:WebullClient){this.client=client;}
  async reviewOptions(raw:WebullOptionsInput):Promise<WebullOptionReview>{
    const input=webullOptionsInput.parse(raw),c=this.client;
    if(c.config.region!=='us')fail('Esta mesa de opciones requiere el sandbox US. Conserva tu región; no se cambia automáticamente.');
    await c.verifyAccount();
    const results=await Promise.all(input.legs.map(leg=>c.request('/trading/instruments/options/contracts/list',{category:'US_OPTION',underlying_symbols:input.symbol,option_symbols:leg.symbol,show_deliverables:'true'})));
    const legs=results.map((raw,i)=>{
      const rows=record(raw).data;
      const found=Array.isArray(rows)?rows.map(record).filter(row=>row.symbol===input.legs[i].symbol):[];
      if(found.length!==1)fail('Webull no confirmó un contrato único para cada pata. Actualiza la cadena.');
      const row=found[0],strike=numeric(row.strike_price),expiration=row.expiration_date,multiplier=numeric(row.multiplier);
      const delivers=Array.isArray(row.deliverables)?row.deliverables.map(record):[];
      if(row.underlying_symbol!==input.symbol||row.status!=='LISTING'||!['OC','OPEN'].includes(String(row.tradable_status))||row.style!=='AMERICAN'||!['CALL','PUT'].includes(String(row.option_type))||strike===null||strike<=0||typeof expiration!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(expiration)||!Number.isFinite(Date.parse(expiration))||expiration<=new Date().toISOString().slice(0,10)||multiplier!==100||delivers.length!==1||delivers[0].asset_type!=='EQUITY'||delivers[0].symbol!==input.symbol||numeric(delivers[0].amount)!==100)fail('Solo se admiten contratos americanos estándar vigentes con multiplicador y entrega de 100 acciones confirmados por Webull.');
      return {symbol:String(row.symbol),side:input.legs[i].side,quantity:input.quantity*input.legs[i].ratio,strike:strike!,expiration:String(expiration),type:row.option_type as 'CALL'|'PUT',multiplier:100,shares:100};
    });
    const [a,b]=legs;
    if(input.strategy==='SINGLE'&&input.side!==a.side)fail('La dirección de la orden debe coincidir con la pata.');
    if(b){
      const opposed=a.side!==b.side,sameType=a.type===b.type,sameExpiry=a.expiration===b.expiration,sameStrike=a.strike===b.strike;
      if(input.strategy==='VERTICAL'&&(!opposed||!sameType||!sameExpiry||sameStrike)||input.strategy==='CALENDAR'&&(!opposed||!sameType||sameExpiry||!sameStrike)||input.strategy==='DIAGONAL'&&(!opposed||!sameType||sameExpiry||sameStrike)||input.strategy==='STRADDLE'&&(opposed||sameType||!sameExpiry||!sameStrike)||input.strategy==='STRANGLE'&&(opposed||sameType||!sameExpiry||sameStrike))fail('La combinación de contratos no corresponde a la estrategia seleccionada.');
      // Restrict this desk to debit long-volatility and defined-risk spreads.
      if(['STRADDLE','STRANGLE'].includes(input.strategy)&&input.intent==='OPEN'&&legs.some(l=>l.side!=='BUY'))fail('La mesa admite straddles y strangles comprados; no vende volatilidad descubierta.');
      if(['CALENDAR','DIAGONAL'].includes(input.strategy)&&input.intent==='OPEN'){
        const long=legs.find(l=>l.side==='BUY')!,short=legs.find(l=>l.side==='SELL')!;
        if(long.expiration<=short.expiration||input.side!=='BUY'||long.type==='CALL'&&long.strike>short.strike||long.type==='PUT'&&long.strike<short.strike)fail('Para calendario o PMCC compra la pata larga posterior y vende la corta anterior con strikes compatibles y débito neto.');
      }
    }
    const query={account_id:c.config.accountId};
    const [balances,positions]=await Promise.all([c.request('/trading/assets/balances/get',{...query,total_asset_currency:'USD'}).then(normalizeWebullBalances),c.request('/trading/assets/positions/list',query).then(normalizeWebullPositions)]);
    let cashRequired:number|null=input.side==='BUY'?input.limitPrice*100*input.quantity:0,sharesRequired=0;
    if(input.intent==='CLOSE')for(const leg of legs){
      const held=positions.find(p=>p.type==='OPTION'&&(p.symbol===leg.symbol||p.legs?.length===1&&p.legs.some(l=>l.symbol===input.symbol&&l.type===leg.type&&l.expiration===leg.expiration&&l.strike===leg.strike)));
      if(!held||held.availableQuantity===null||Math.abs(held.availableQuantity)<leg.quantity||leg.side==='SELL'&&held.quantity<=0||leg.side==='BUY'&&held.quantity>=0)fail('No se confirmó una posición disponible con la dirección y cantidad necesarias para cerrar.');
    }
    if(input.intent==='OPEN'&&input.strategy==='SINGLE'&&a.side==='SELL'){
      if(a.type==='PUT')cashRequired=a.strike*100*input.quantity;
      else{sharesRequired=100*input.quantity;const held=positions.find(p=>p.symbol===input.symbol&&p.type==='EQUITY');if(!held||held.availableQuantity===null||held.availableQuantity<sharesRequired)fail('Covered Call necesita 100 acciones disponibles del subyacente por contrato.');}
    }
    if(input.intent==='OPEN'&&b&&input.strategy==='VERTICAL'&&input.side==='SELL')cashRequired=Math.abs(a.strike-b.strike)*100*input.quantity;
    if(cashRequired!==null&&cashRequired>0&&(balances.settledCash===null||balances.settledCash<cashRequired))fail('El efectivo liquidado confirmado no alcanza para el débito o la reserva de esta estrategia.');
    return {strategy:input.strategy,intent:input.intent,legs,cashRequired,sharesRequired,description:'Contratos estándar verificados. El proveedor decide permisos, margen, costes y aceptación; la revisión no garantiza ejecución.'};
  }
  optionsPayload(input:WebullOptionsInput,review:WebullOptionReview,id:string){return {account_id:this.client.config.accountId,new_orders:[{client_order_id:id,combo_type:'NORMAL',option_strategy:input.strategy,instrument_type:'OPTION',symbol:input.symbol,market:'US',order_type:'LIMIT',limit_price:input.limitPrice.toFixed(2),quantity:String(input.quantity),side:input.side,time_in_force:'DAY',entrust_type:'QTY',position_intent:`${input.side}_TO_${input.intent}`,legs:review.legs.map(l=>({side:l.side,quantity:String(l.quantity),symbol:input.symbol,strike_price:String(l.strike),option_expire_date:l.expiration,instrument_type:'OPTION',option_type:l.type,market:'US'}))}]};}
  async previewOptions(input:WebullOptionsInput,review:WebullOptionReview,id:string){
    const response=record(await this.client.request('/trading/orders/preview',{},this.optionsPayload(input,review,id)));
    if(!Object.keys(response).length)fail('Webull no confirmó la revisión de opciones.');
  }
  async submitOptions(input:WebullOptionsInput,review:WebullOptionReview,id:string){await this.client.request('/trading/orders/place',{},this.optionsPayload(input,review,id));}
  async detail(reference:string):Promise<{public:WebullRemoteOrder;raw:Record<string,unknown>;fingerprint:string}>{
    const body=record(await this.client.request('/trading/orders/get',{account_id:this.client.config.accountId,client_order_id:reference}));
    const rows=Array.isArray(body.orders)?body.orders.map(record):[record(body.order??body)];
    const matches=rows.filter(r=>r.client_order_id===reference);
    if(matches.length!==1)fail('La referencia no corresponde a una única orden de esta cuenta.');
    const row:Record<string,unknown>={...matches[0],combo_type:matches[0].combo_type??body.combo_type};
    const quantity=numeric(row.total_quantity??row.quantity),filled=numeric(row.filled_quantity??row.filled_qty),limitPrice=numeric(row.limit_price),state=row.status??row.order_status;
    if(quantity===null||quantity<=0||filled===null||filled<0||filled>quantity||limitPrice===null||typeof state!=='string'||typeof row.symbol!=='string'||!['BUY','SELL'].includes(String(row.side)))fail('El detalle de la orden está incompleto; consúltalo en Webull.');
    const legs=Array.isArray(row.legs)?row.legs.map(record):[];
    const order:WebullRemoteOrder={reference,symbol:String(row.symbol),type:row.instrument_type==='STOCK'?'EQUITY':String(row.instrument_type??''),side:String(row.side),quantity,filled,limitPrice,state:String(state),createdAt:webullTime(row.place_time_at??row.place_time??row.create_time),legs:legs.map(l=>({symbol:String(l.symbol??''),side:String(l.side??''),quantity:numeric(l.quantity??l.total_quantity)}))};
    // Fingerprint only execution-relevant fields, never volatile request timestamps.
    return {public:order,raw:row,fingerprint:hash([order,row.order_type,row.time_in_force,row.combo_type,row.option_strategy,legs.map(l=>[l.id,l.symbol,l.side,l.quantity,l.strike_price,l.option_expire_date])])};
  }
  async lookupOptions(input:WebullOptionsInput,review:WebullOptionReview,id:string):Promise<WebullOrder>{
    const {public:order,raw}=await this.detail(id),legs=Array.isArray(raw.legs)?raw.legs.map(record):[];
    if(order.symbol!==input.symbol||order.type!=='OPTION'||order.quantity!==input.quantity||order.limitPrice!==input.limitPrice||order.side!==input.side||raw.option_strategy!==input.strategy||legs.length!==review.legs.length||!review.legs.every(l=>legs.some(r=>(r.symbol===l.symbol||r.symbol===input.symbol&&r.option_type===l.type&&r.option_expire_date===l.expiration&&numeric(r.strike_price)===l.strike)&&r.side===l.side&&numeric(r.quantity??r.total_quantity)===l.quantity)))fail('La respuesta no permite conciliar las patas y el importe de la estrategia. Conserva la referencia.');
    return {clientOrderId:id,symbol:input.symbol,side:input.side,quantity:input.quantity,limitPrice:input.limitPrice,state:order.state,filledQuantity:order.filled!};
  }
  async reviewChange(raw:WebullChangeInput):Promise<WebullChangeReview>{
    const input=webullChangeInput.parse(raw);await this.client.verifyAccount();
    const detail=await this.detail(input.reference),order=detail.public,row=detail.raw;
    if(!active.has(order.state)||!['EQUITY','OPTION'].includes(order.type)||row.combo_type!=='NORMAL'||row.order_type!=='LIMIT'||!['DAY','GTC'].includes(String(row.time_in_force)))fail('Solo se gestionan órdenes límite simples pendientes; esta orden cambió o no cumple el formato admitido.');
    const quantity=input.kind==='replace'?input.quantity:order.quantity!,limitPrice=input.kind==='replace'?input.limitPrice:order.limitPrice!;
    if(input.kind==='replace'&&(quantity<=order.filled!||quantity>order.quantity!))fail('La cantidad total debe superar lo ejecutado y no puede aumentar. Prepara otra orden para aumentar exposición.');
    const legs=Array.isArray(row.legs)?row.legs.map(record):[];
    const legIds=input.kind==='replace'?legs.map(l=>{const n=numeric(l.quantity??l.total_quantity),scaled=n===null?NaN:quantity*n/order.quantity!;if(typeof l.id!=='string'||!l.id||!Number.isInteger(scaled)||scaled<1)fail('No se pudieron confirmar identificadores y cantidades de las patas.');return {id:String(l.id),quantity:String(scaled)};}):[];
    if(input.kind==='replace'&&order.type==='OPTION'&&!legIds.length)fail('Faltan las patas de la orden de opciones.');
    return {kind:input.kind,reference:input.reference,before:order,fingerprint:detail.fingerprint,quantity,limitPrice,legIds};
  }
  async assertUnchanged(review:WebullChangeReview){const detail=await this.detail(review.reference);if(detail.fingerprint!==review.fingerprint)fail('La orden cambió desde la revisión. Actualiza y prepara una revisión nueva.');}
  async executeChange(review:WebullChangeReview){
    if(review.kind==='cancel')await this.client.request('/trading/orders/cancel',{}, {account_id:this.client.config.accountId,client_order_id:review.reference},review.before.type==='OPTION'?'US_OPTION':'US_EQUITY');
    else await this.client.request('/trading/orders/replace',{}, {account_id:this.client.config.accountId,modify_orders:[{client_order_id:review.reference,quantity:String(review.quantity),limit_price:review.limitPrice.toFixed(2),...(review.before.type==='OPTION'?{instrument_type:'OPTION',legs:review.legIds}:{})}]});
  }
}
