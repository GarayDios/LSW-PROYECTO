import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { WebullClient,webullInput,type WebullInput,type WebullOrder } from '../../src/api/brokers/webull/client.ts';
import { ApiError } from '../../src/api/http.ts';

export type WebullOperation={id:string;clientOrderId:string;input:WebullInput;state:'preview'|'reserved'|'submitted'|'ambiguous';createdAt:string;expiresAt:string;order?:WebullOrder};
export function createWebullService({filename,ownerId,client,now=Date.now}:{filename:string;ownerId:string;client:WebullClient|null;now?:()=>number}){
  if(filename!==':memory:')mkdirSync(path.dirname(path.resolve(filename)),{recursive:true});
  const db=new DatabaseSync(filename);
  db.exec('pragma journal_mode=WAL; pragma busy_timeout=5000; create table if not exists webull_manual(id text primary key,owner text not null,state text not null,expires integer not null,payload text not null)');
  const get=(id:string)=>{const row=db.prepare('select state,payload from webull_manual where id=? and owner=?').get(id,ownerId);return row?{...JSON.parse(String(row.payload)),state:row.state} as WebullOperation:null;};
  const save=(op:WebullOperation)=>db.prepare('update webull_manual set state=?,payload=? where id=? and owner=?').run(op.state,JSON.stringify(op),op.id,ownerId);
  const broker=()=>{if(!client)throw new ApiError('webull_missing','Solicita acceso Webull OpenAPI y configura credenciales de pruebas en el servidor.',503);return client;};
  return {close:()=>db.close(),async handle(method:string,route:string,user:string,body?:unknown){
    try{
      if(user!==ownerId)throw new ApiError('owner_required','Esta conexión pertenece a otro usuario.',403);
      if(method==='GET'&&route==='/webull/status'){
        const operations=db.prepare('select state,payload from webull_manual where owner=? order by rowid desc limit 30').all(ownerId).map(row=>({...JSON.parse(String(row.payload)),state:row.state}));
        if(!client)return {status:200,value:{configured:false,connected:false,enabled:false,mode:'sandbox',operations,message:'Solicita acceso Webull OpenAPI; todavía no hay credenciales configuradas.'}};
        try{await client.verifyAccount();}catch{return {status:200,value:{configured:true,connected:false,enabled:client.config.enabled,mode:'sandbox',region:client.config.region,operations,message:'No se pudo verificar la cuenta Webull. Revisa credenciales, permisos y conexión; el registro de referencias sigue disponible.'}};}
        return {status:200,value:{configured:true,connected:true,enabled:client.config.enabled,mode:'sandbox',region:client.config.region,operations}};
      }
      if(method!=='POST')throw new ApiError('not_found','Consulta inexistente.',404);
      if(route==='/webull/preview'){
        const input=webullInput.safeParse(body);if(!input.success)throw new ApiError('webull_input','Revisa símbolo, cantidad y precio límite de las acciones.',400);
        const id=randomUUID(),clientOrderId='manual_'+randomUUID().replaceAll('-','');
        await broker().preview(input.data,clientOrderId);
        const op:WebullOperation={id,clientOrderId,input:input.data,state:'preview',createdAt:new Date(now()).toISOString(),expiresAt:new Date(now()+60000).toISOString()};
        db.prepare('insert into webull_manual values(?,?,?,?,?)').run(id,ownerId,op.state,Date.parse(op.expiresAt),JSON.stringify(op));
        return {status:200,value:{operation:op}};
      }
      const parsed=z.object({operationId:z.string().uuid()}).strict().safeParse(body);
      if(!parsed.success)throw new ApiError('webull_input','Selecciona una revisión válida.',400);
      const op=get(parsed.data.operationId);if(!op)throw new ApiError('not_found','La revisión no existe en esta cuenta.',404);
      if(route==='/webull/submit'){
        if(op.state!=='preview')return {status:200,value:{operation:op}};
        if(!broker().config.enabled)throw new ApiError('webull_disabled','El envío Webull de pruebas está deshabilitado en el servidor.',409);
        await broker().verifyAccount();
        const claimed=db.prepare("update webull_manual set state='reserved' where id=? and owner=? and state='preview' and expires>?").run(op.id,ownerId,now());
        if(!claimed.changes)throw new ApiError('webull_expired','La revisión venció o ya tuvo un intento de envío. Consulta su estado.',409);
        op.state='reserved';save(op);
        try{await broker().submit(op.input,op.clientOrderId);op.order=await broker().lookup(op.input,op.clientOrderId);op.state='submitted';}catch{op.state='ambiguous';}
        save(op);return {status:200,value:{operation:op}};
      }
      if(route==='/webull/reconcile'){
        if(op.state==='preview')throw new ApiError('webull_not_sent','Esta revisión todavía no tuvo un intento de envío.',409);
        op.order=await broker().lookup(op.input,op.clientOrderId);op.state='submitted';save(op);return {status:200,value:{operation:op}};
      }
      throw new ApiError('not_found','Acción inexistente.',404);
    }catch(error){return error instanceof ApiError?{status:error.status,value:{error:{code:error.code,message:error.message}}}:{status:503,value:{error:{code:'webull_unavailable',message:'No se pudo confirmar Webull. Consulta el estado antes de repetir una operación.'}}};}
  }};
}
