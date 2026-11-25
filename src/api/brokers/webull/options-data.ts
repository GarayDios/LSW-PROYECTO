import {record,numeric,timestamp} from '../../../cores/compartido/data-values.ts';
import {missingVariable,type ObservedOptionContract,type ResearchOptions,type ResearchVariable} from '../../../cores/compartido/research-model.ts';
import type {WebullClient} from './client.ts';
import {webullOptionsQuery} from '../../../cores/compartido/webull-model.ts';
import {webullQuoteUsable} from './session.ts';
import {ApiError} from '../../http.ts';
export function webullTime(value:unknown):string|null{
  const ms=typeof value==='number'?value:typeof value==='string'&&/^\d{13}$/.test(value)?Number(value):NaN;
  return Number.isFinite(ms)&&ms>=1e12&&ms<4102444800000?new Date(ms).toISOString():timestamp(value);
}
const SOURCE='Webull Sandbox · opciones';
export function normalizeWebullOptions(symbol:string,metadata:unknown[],snapshots:unknown[],asOf:string,complete:boolean):ResearchOptions{
  const quotes=new Map(snapshots.map(value=>{const row=record(value);return [row.symbol,row];}));
  const received=Date.parse(asOf),missing=(reason:string)=>missingVariable(SOURCE,reason);
  const observed=(value:number,label:string):ResearchVariable=>({value,source:`${SOURCE} · ${label}`,observedAt:asOf,availableAt:asOf,kind:'observed',reason:'Metadato recibido del proveedor en el entorno de pruebas.'});
  const contracts=metadata.flatMap(value=>{
    const row=record(value),strike=numeric(row.strike_price),name=row.symbol,expiration=row.expiration_date;
    if(row.underlying_symbol!==symbol||typeof name!=='string'||!/^[-A-Z0-9.]{1,40}$/.test(name)||!['CALL','PUT'].includes(String(row.option_type))||strike===null||strike<=0||typeof expiration!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(expiration)||!Number.isFinite(Date.parse(expiration))||new Date(expiration).toISOString().slice(0,10)!==expiration||row.status!=='LISTING')return [];
    const q=quotes.get(name),at=webullTime(q?.quote_time),bid=numeric(q?.bid),ask=numeric(q?.ask);
    const valid=webullQuoteUsable(at,received)&&bid!==null&&ask!==null&&bid>=0&&ask>0&&ask>=bid;
    const quote=(value:unknown,label:string,positive=false):ResearchVariable=>{
      const number=numeric(value),ok=number!==null&&(!positive||number>0);
      return valid&&ok?{value:number,kind:'estimated',source:`${SOURCE} · ${label}`,observedAt:at,availableAt:asOf,reason:`Dato de sandbox; retraso informado ${numeric(q?.delay_minutes)??'no declarado'} minutos.${at&&received-Date.parse(at)>3600000?' Cotización de la última sesión cerrada, conservada para análisis.':''} No es una cotización ejecutable.`}:{...missing(!q?'Este contrato no recibió snapshot en la muestra consultada.':'Falta una cotización coherente reciente o de la última sesión cerrada.'),...(ok&&at&&Date.parse(at)<=received?{lastReceived:{value:number,observedAt:at,receivedAt:asOf}}:{})};
    };
    const multiplier=numeric(row.multiplier),deliverables=Array.isArray(row.deliverables)?row.deliverables.map(record):[];
    const one=deliverables.length===1&&deliverables[0].asset_type==='EQUITY'&&deliverables[0].symbol===symbol&&numeric(deliverables[0].amount)!>0;
    const contract:ObservedOptionContract={symbol:name,underlyingSymbol:symbol,type:row.option_type==='CALL'?'call':'put',expiration,style:row.style==='AMERICAN'?'american':row.style==='EUROPEAN'?'european':'unknown',strike:observed(strike,'strike contractual'),multiplier:multiplier!==null&&multiplier>0?observed(multiplier,'multiplicador'):missing('Multiplicador no confirmado.'),deliverableShares:one?observed(numeric(deliverables[0].amount)!,'acciones entregables'):missing('No se confirmó un entregable simple de acciones.'),deliverableType:one?'single_equity':deliverables.length?'unsupported':'unknown',bid:quote(bid,'bid'),ask:quote(ask,'ask'),premium:quote(valid?(bid!+ask!)/2:null,'punto medio bid/ask'),impliedVolatility:quote(q?.imp_vol,'IV decimal',true),openInterest:q&&numeric(q.open_interest)!==null?observed(numeric(q.open_interest)!,'OI recibido; fecha de actualización no declarada'):missing('OI no disponible.'),delta:quote(q?.delta,'delta'),gamma:quote(q?.gamma,'gamma'),theta:quote(q?.theta,'theta'),vega:quote(q?.vega,'vega')};
    return [contract];
  });
  const unique=[...new Map(contracts.map(c=>[c.symbol,c])).values()],fresh=unique.filter(c=>c.bid.value!==null&&c.impliedVolatility.value!==null).length;
  return {contracts:unique,feed:'webull-sandbox',complete,status:{source:SOURCE,status:unique.length?'partial':'unavailable',message:`${unique.length} contratos del proveedor; ${snapshots.length} snapshots consultados; ${fresh} con bid/ask e IV de la sesión actual o la última sesión cerrada. Cobertura acotada por vencimientos y cuota del sandbox.`},warnings:['Webull Sandbox: las cotizaciones y griegas son datos del entorno de pruebas; no acreditan ejecución en producción.','Se consulta una muestra de hasta 160 snapshots priorizando puts/calls cortas y calls largas ITM. Se conserva la fecha de cada cotización; el envío exige una consulta vigente durante mercado abierto.','No se presupone un entregable de 100 acciones: se verifica el metadato del contrato.']};
}
export async function loadWebullContracts(client:WebullClient,symbol:string,filters:Record<string,string>={}):Promise<{rows:Record<string,unknown>[];complete:boolean}>{
  const rows=new Map<string,Record<string,unknown>>(),cursors=new Set<string>();let next:string|undefined;
  for(let page=0;page<20;page++){
    const body=record(await client.request('/trading/instruments/options/contracts/list',{category:'US_OPTION',underlying_symbols:symbol,show_deliverables:'true',...filters,...(next?{pagination_key:next}:{})}));
    if(!Array.isArray(body.data))throw new ApiError('webull_invalid','Webull no confirmó los contratos de opciones.',503);
    for(const item of body.data){const row=record(item),name=String(row.symbol??'');if(!name)throw new ApiError('webull_invalid','Contrato Webull sin identificador.',503);const previous=rows.get(name);if(previous&&JSON.stringify(previous)!==JSON.stringify(row))throw new ApiError('webull_invalid','La cadena cambió durante la paginación. Actualiza los contratos.',503);rows.set(name,row);}
    const cursor=body.pagination_key;if(typeof cursor!=='string'||!cursor)return {rows:[...rows.values()],complete:true};
    if(cursors.has(cursor))return {rows:[...rows.values()],complete:false};cursors.add(cursor);next=cursor;
  }
  return {rows:[...rows.values()],complete:false};
}
export async function fetchWebullOptions(client:WebullClient,symbol:string,days=30,spot?:number):Promise<ResearchOptions>{
  webullOptionsQuery.parse({symbol,days});
  const now=new Date(),date=(offset:number)=>new Date(now.getTime()+offset*86400000).toISOString().slice(0,10);
  const windows=[{start_date:date(0),end_date:date(Math.min(3650,Math.max(60,days*2)))},{start_date:date(Math.max(days+30,300)),end_date:date(Math.max(days+365,550))}];
  const metadata:unknown[]=[];let metadataComplete=true;
  for(const window of windows){const page=await loadWebullContracts(client,symbol,window);metadata.push(...page.rows);metadataComplete&&=page.complete;}
  const unique=[...new Map(metadata.map(value=>[String(record(value).symbol),record(value)])).values()];
  const distance=(row:Record<string,unknown>,tenor:number,ratio:number)=>Math.abs((Date.parse(String(row.expiration_date))-now.getTime())/86400000-tenor)/Math.max(1,tenor)+(spot&&spot>0?Math.abs((numeric(row.strike_price)??Infinity)/spot-ratio):0);
  const ordered=(type:string,tenor:number,ratio:number,long=false)=>unique.filter(row=>row.option_type===type&&(!long||Date.parse(String(row.expiration_date))-now.getTime()>(days+30)*86400000)).sort((a,b)=>distance(a,tenor,ratio)-distance(b,tenor,ratio));
  const groups=[ordered('PUT',days,.95),ordered('CALL',days,1.05),ordered('CALL',Math.max(365,days+90),.65,true),ordered('CALL',Math.max(365,days+90),.8,true)];
  const selected=new Map<string,Record<string,unknown>>();for(let i=0;selected.size<160&&groups.some(g=>g.length>i);i++)for(const g of groups)if(g[i]&&selected.size<160)selected.set(String(g[i].symbol),g[i]);
  const names=[...selected.keys()],snapshots:unknown[]=[];
  const results=[];for(let i=0;i<names.length;i+=20){try{results.push({status:'fulfilled' as const,value:await client.request('/market-data/options/snapshots/list',{symbols:names.slice(i,i+20).join(','),category:'US_OPTION'})});}catch{results.push({status:'rejected' as const});}}
  for(const result of results)if(result.status==='fulfilled'&&Array.isArray(result.value))snapshots.push(...result.value);
  return normalizeWebullOptions(symbol,unique,snapshots,new Date().toISOString(),metadataComplete&&unique.length===names.length&&results.every(r=>r.status==='fulfilled'));
}
