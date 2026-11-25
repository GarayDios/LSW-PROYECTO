import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { WebullClient,webullInput,type WebullInput,type WebullOrder } from '../../src/api/brokers/webull/client.ts';
import { ApiError } from '../../src/api/http.ts';
import {WebullData} from '../../src/api/brokers/webull/data.ts';
import {webullHistoryQuery,webullOptionsQuery,webullOrderPage,webullSymbol,webullOptionsInput,webullChangeInput,type WebullOptionsInput,type WebullOptionReview,type WebullChangeReview} from '../../src/cores/compartido/webull-model.ts';
import {WebullDesk,webullAccountBinding} from '../../src/api/brokers/webull/desk.ts';
import {webullCorporateQuery,webullNewsQuery} from '../../src/cores/compartido/webull-model.ts';
import {WebullResearchData} from '../../src/api/brokers/webull/research-data.ts';
import type {F5Store} from './f5-store.ts';

export type WebullOperation={id:string;clientOrderId:string;input:WebullInput;options?:WebullOptionsInput;optionReview?:WebullOptionReview;change?:WebullChangeReview;accountBinding?:string;state:'preview'|'reserved'|'submitted'|'ambiguous';createdAt:string;expiresAt:string;order?:WebullOrder;result?:string};
export function createWebullService({filename,ownerId,client,now=Date.now,coordination,validateSubmission}:{filename:string;ownerId:string;client:WebullClient|null;now?:()=>number;coordination?:F5Store;validateSubmission?:(op:WebullOperation)=>Promise<void>}){
  if(filename!==':memory:')mkdirSync(path.dirname(path.resolve(filename)),{recursive:true});
  const db=new DatabaseSync(filename);
  db.exec('pragma journal_mode=WAL; pragma busy_timeout=5000; create table if not exists webull_manual(id text primary key,owner text not null,state text not null,expires integer not null,payload text not null)');
  const get=(id:string)=>{const row=db.prepare('select state,payload from webull_manual where id=? and owner=?').get(id,ownerId);return row?{...JSON.parse(String(row.payload)),state:row.state} as WebullOperation:null;};
  const save=(op:WebullOperation)=>db.prepare('update webull_manual set state=?,payload=? where id=? and owner=?').run(op.state,JSON.stringify(op),op.id,ownerId);
  const broker=()=>{if(!client)throw new ApiError('webull_missing','Solicita acceso Webull OpenAPI y configura credenciales de pruebas en el servidor.',503);return client;};
  const data=client?new WebullData(client):null;
  const desk=client?new WebullDesk(client):null;
  const research=client?new WebullResearchData(client,now):null;
  const hasUnresolved=()=>db.prepare('select state,payload from webull_manual where owner=? and state in (\'reserved\',\'submitted\',\'ambiguous\')').all(ownerId).some(row=>{const op=JSON.parse(String(row.payload)) as WebullOperation;return row.state!=='submitted'||!['FILLED','CANCELED','CANCELLED','REJECTED','FAILED','EXPIRED'].includes(op.order?.state??op.result??'');});
  return {close:()=>db.close(),hasUnresolved,async handle(method:string,route:string,user:string,body?:unknown){
    let lease:string|null=null;
    try{
      if(user!==ownerId)throw new ApiError('owner_required','Esta conexión pertenece a otro usuario.',403);
      if(method==='POST'&&coordination){lease=coordination.acquire(ownerId,now());if(!lease)throw new ApiError('webull_busy','La cuenta Webull está procesando otra solicitud. Actualiza el estado.',409);}
      if(method==='GET'&&route!=='/webull/status'){
        broker();
        if(route==='/webull/account'){
          const portfolio=await data!.portfolio();
          return {status:200,value:{configured:true,connected:true,enabled:client!.config.enabled,mode:'sandbox',region:client!.config.region,account:client!.accountSummary(),authentication:client!.authenticationState(),portfolio}};
        }
        if(route==='/webull/market-context'){const parsed=z.object({symbol:webullSymbol}).strict().safeParse(body);if(!parsed.success)throw new ApiError('webull_input','Símbolo no válido.',400);return {status:200,value:await research!.context(parsed.data.symbol)};}
        if(route==='/webull/market-news'){const parsed=webullNewsQuery.safeParse(body);if(!parsed.success)throw new ApiError('webull_input','Consulta de noticias no válida.',400);const q=parsed.data;return {status:200,value:await research!.news(q.symbol,q.start,q.end,q.asOf,q.next)};}
        if(route==='/webull/corporate-actions'){const parsed=webullCorporateQuery.safeParse(body);if(!parsed.success)throw new ApiError('webull_input','Fechas de acciones corporativas no válidas.',400);const q=parsed.data;return {status:200,value:await research!.corporateActions(q.symbol,q.start,q.end)};}
        const parsed=route==='/webull/market-history'?webullHistoryQuery.safeParse(body??{}):route==='/webull/market-options'?webullOptionsQuery.safeParse(body??{}):route==='/webull/market-quote'?z.object({symbol:webullSymbol}).strict().safeParse(body??{}):route==='/webull/orders'?webullOrderPage.safeParse(body??{}):null;
        if(!parsed?.success)throw new ApiError('webull_input','Revisa los filtros de la consulta Webull.',400);
        if(route==='/webull/market-history')return {status:200,value:await data!.history(webullHistoryQuery.parse(parsed.data))};
        if(route==='/webull/market-options'){const query=webullOptionsQuery.parse(parsed.data);return {status:200,value:await data!.options(query.symbol,query.days)};}
        if(route==='/webull/market-quote')return {status:200,value:await data!.quote(z.object({symbol:webullSymbol}).parse(parsed.data).symbol)};
        const query=webullOrderPage.parse(parsed.data);return {status:200,value:await data!.orders(query.kind,query.next,query.start,query.end)};
      }
      if(method==='GET'&&route==='/webull/status'){
        const operations=db.prepare('select state,payload from webull_manual where owner=? order by rowid desc limit 30').all(ownerId).map(row=>({...JSON.parse(String(row.payload)),state:row.state}));
        if(!client)return {status:200,value:{configured:false,connected:false,enabled:false,mode:'sandbox',operations,message:'Solicita acceso Webull OpenAPI; todavía no hay credenciales configuradas.'}};
        try{await client.verifyAccount();}catch(error){
          const messages:Record<string,string>={webull_verification_required:'Abre la app Webull, entra a Menú → Mensajes → Notificaciones OpenAPI y confirma la verificación. Después pulsa «Consultar conexión Webull». El código SMS se introduce solo en Webull.',webull_auth_rejected:'Webull rechazó la autenticación del entorno de pruebas. Revisa que las claves, región y cuenta sean del mismo sandbox/UAT; las credenciales de una cuenta real no se cambian de entorno automáticamente.',webull_account:'La autenticación pasó, pero el ID de cuenta configurado no aparece entre las cuentas autorizadas de Webull.',webull_token_invalid:'Webull no devolvió un token válido. Vuelve a consultar la conexión.',webull_endpoint:'El endpoint de Webull no está disponible en el entorno configurado.'};
          const code=error instanceof ApiError&&error.code in messages?error.code:'webull_unavailable';
          return {status:200,value:{configured:true,connected:false,enabled:client.config.enabled,mode:'sandbox',region:client.config.region,operations,authentication:client.authenticationState(),connectionCode:code,message:messages[code]??'No se pudo verificar la cuenta Webull. Revisa la conexión; el registro de referencias sigue disponible.'}};
        }
        return {status:200,value:{configured:true,connected:true,enabled:client.config.enabled,mode:'sandbox',region:client.config.region,operations,authentication:client.authenticationState(),account:client.accountSummary()}};
      }
      if(method!=='POST')throw new ApiError('not_found','Consulta inexistente.',404);
      if(['/webull/preview','/webull/preview-options','/webull/preview-change'].includes(route)){
        broker();
        const input=route==='/webull/preview'?webullInput.safeParse(body):route==='/webull/preview-options'?webullOptionsInput.safeParse(body):webullChangeInput.safeParse(body);
        if(!input.success)throw new ApiError('webull_input','Revisa los datos de la orden y sus contratos.',400);
        const id=randomUUID();let clientOrderId=randomUUID().replaceAll('-','');
        let options:WebullOptionsInput|undefined,optionReview:WebullOptionReview|undefined,change:WebullChangeReview|undefined,stock:WebullInput;
        if(route==='/webull/preview-options'){
          options=webullOptionsInput.parse(input.data);optionReview=await desk!.reviewOptions(options);stock={symbol:options.symbol,side:options.side,quantity:options.quantity,limitPrice:options.limitPrice};
          await desk!.previewOptions(options,optionReview,clientOrderId);
        }else if(route==='/webull/preview-change'){
          change=await desk!.reviewChange(webullChangeInput.parse(input.data));clientOrderId=change.reference;stock={symbol:change.before.symbol,side:change.before.side as 'BUY'|'SELL',quantity:change.quantity,limitPrice:change.limitPrice};
        }else{stock=webullInput.parse(input.data);await broker().preview(stock,clientOrderId);}
        const op:WebullOperation={id,clientOrderId,input:stock,...(options?{options,optionReview}:{}),...(change?{change}:{}),accountBinding:webullAccountBinding(broker()),state:'preview',createdAt:new Date(now()).toISOString(),expiresAt:new Date(now()+60000).toISOString()};
        db.prepare('insert into webull_manual values(?,?,?,?,?)').run(id,ownerId,op.state,Date.parse(op.expiresAt),JSON.stringify(op));
        return {status:200,value:{operation:op}};
      }
      const parsed=z.object({operationId:z.string().uuid()}).strict().safeParse(body);
      if(!parsed.success)throw new ApiError('webull_input','Selecciona una revisión válida.',400);
      const op=get(parsed.data.operationId);if(!op)throw new ApiError('not_found','La revisión no existe en esta cuenta.',404);
      if(op.accountBinding!==webullAccountBinding(broker()))throw new ApiError('webull_account','La revisión corresponde a otra configuración de cuenta. No puede reenviarse ni conciliarse aquí.',409);
      if(route==='/webull/submit'){
        if(op.state!=='preview')return {status:200,value:{operation:op}};
        if(!broker().config.enabled)throw new ApiError('webull_disabled','El envío Webull de pruebas está deshabilitado en el servidor.',409);
        if(!op.change&&coordination?.list(ownerId).some(value=>['reserved','submitted','partial','ambiguous'].includes(value.state)))throw new ApiError('webull_busy','Hay operaciones F5 pendientes de conciliar en esta cuenta.',409);
        await broker().verifyAccount();
        if(op.change)await desk!.assertUnchanged(op.change);
        if(op.options){const updated=await desk!.reviewOptions(op.options);if(JSON.stringify(updated.legs)!==JSON.stringify(op.optionReview?.legs))throw new ApiError('webull_review','Los contratos cambiaron desde la revisión. Revisa otra vez.',409);}
        await validateSubmission?.(op);
        if(coordination&&(!lease||!coordination.owns(ownerId,lease,now())))throw new ApiError('webull_busy','La reserva de la cuenta venció durante la validación. Revisa otra vez.',409);
        const claimed=db.prepare("update webull_manual set state='reserved' where id=? and owner=? and state='preview' and expires>?").run(op.id,ownerId,now());
        if(!claimed.changes)throw new ApiError('webull_expired','La revisión venció o ya tuvo un intento de envío. Consulta su estado.',409);
        op.state='reserved';save(op);
        try{
          if(op.change){await desk!.executeChange(op.change);const detail=await desk!.detail(op.clientOrderId);op.result=detail.public.state;op.state='ambiguous';
            if(op.change.kind==='cancel'&&['CANCELLED','CANCELED'].includes(detail.public.state)||op.change.kind==='replace'&&detail.public.quantity===op.change.quantity&&detail.public.limitPrice===op.change.limitPrice)op.state='submitted';
          }else if(op.options){await desk!.submitOptions(op.options,op.optionReview!,op.clientOrderId);op.order=await desk!.lookupOptions(op.options,op.optionReview!,op.clientOrderId);op.state='submitted';}
          else{await broker().submit(op.input,op.clientOrderId);op.order=await broker().lookup(op.input,op.clientOrderId);op.state='submitted';}
        }catch{op.state='ambiguous';}
        data!.invalidateAccount();save(op);return {status:200,value:{operation:op}};
      }
      if(route==='/webull/reconcile'){
        if(op.state==='preview')throw new ApiError('webull_not_sent','Esta revisión todavía no tuvo un intento de envío.',409);
        if(op.change){const detail=await desk!.detail(op.clientOrderId);op.result=detail.public.state;
          op.state=op.change.kind==='cancel'&&['CANCELED','CANCELLED'].includes(detail.public.state)||op.change.kind==='replace'&&detail.public.quantity===op.change.quantity&&detail.public.limitPrice===op.change.limitPrice?'submitted':'ambiguous';
        }else{op.order=op.options?await desk!.lookupOptions(op.options,op.optionReview!,op.clientOrderId):await broker().lookup(op.input,op.clientOrderId);op.state='submitted';}
        save(op);return {status:200,value:{operation:op}};
      }
      throw new ApiError('not_found','Acción inexistente.',404);
    }catch(error){return error instanceof ApiError?{status:error.status,value:{error:{code:error.code,message:error.message}}}:{status:503,value:{error:{code:'webull_unavailable',message:'No se pudo confirmar Webull. Consulta el estado antes de repetir una operación.'}}};}finally{if(lease)coordination?.release(ownerId,lease);}
  }};
}
