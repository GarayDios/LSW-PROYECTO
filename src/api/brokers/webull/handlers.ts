import { z } from 'zod';
import { ApiError,privateJson,sameOrigin,smallJson } from '../../http.ts';
import { webullInput } from './client.ts';
import {webullReviewMessages} from '../../../cores/compartido/webull-messages.ts';
import {webullHistoryQuery,webullOptionsQuery,webullOrderPage,webullSymbol,webullOptionsInput,webullChangeInput} from '../../../cores/compartido/webull-model.ts';
type Dependencies={environment():Record<string,string|undefined>;owner():Promise<{userId:string}|null>;fetcher?:typeof fetch};
export function createWebullHandlers(deps:Dependencies){
  async function forward(action:string,body?:unknown,query:Record<string,string>={}){
    const owner=await deps.owner(),env=deps.environment();
    if(!owner)throw new ApiError('auth_required','Inicia sesión para consultar Webull.',401);
    if(owner.userId!==env.BROKER_OWNER_USER_ID)throw new ApiError('owner_required','Esta conexión pertenece a otro usuario.',403);
    let url:URL;try{url=new URL(env.TRADING_RUNNER_URL??'');}catch{throw new ApiError('webull_runner','Inicia el servicio de brókers con npm run trading:serve.',503);}
    const token=env.TRADING_RUNNER_TOKEN??'';
    if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))||token.length<32||token.length>512||/[\r\n]/.test(token))throw new ApiError('webull_runner','Revisa la configuración privada del servicio de brókers.',503);
    if(action==='submit'&&env.WEBULL_MANUAL_ENABLED!=='true')throw new ApiError('webull_disabled','El envío manual Webull de pruebas está deshabilitado en el terminal.',409);
    const target=new URL('/webull/'+action,url);
    if(body===undefined)target.searchParams.set('ownerId',owner.userId);
    for(const [key,value] of Object.entries(query))target.searchParams.set(key,value);
    const response=await (deps.fetcher??fetch)(target,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify({...body as object,ownerId:owner.userId})}),redirect:'manual',signal:AbortSignal.timeout(60000)});
    if(response.status>=300&&response.status<400)throw new ApiError('webull_unavailable','El servicio de brókers no confirmó su respuesta.',503);
    const value=await response.json() as Record<string,unknown>&{error?:{code?:unknown;message?:unknown};enabled?:boolean};
    if(!response.ok){if(value?.error?.code==='webull_review'&&typeof value.error.message==='string'&&webullReviewMessages.has(value.error.message))throw new ApiError('webull_review',value.error.message,409);const code=typeof value?.error?.code==='string'?value.error.code:'';const messages:Record<string,string>={webull_missing:'Solicita acceso Webull OpenAPI y configura credenciales de pruebas en el servidor.',webull_disabled:'El servicio mantiene deshabilitado el envío Webull de pruebas.',webull_expired:'La revisión venció o ya tuvo un intento de envío. Consulta el estado.',webull_account:'La cuenta configurada no está autorizada por Webull OpenAPI.',webull_identity:'La orden no pudo verificarse. Conserva la referencia y concíliala en Webull.',webull_rejected:'Webull rechazó la consulta o la orden. Revisa permisos, saldo e instrumento.'};throw new ApiError(code in messages?code:'webull_unavailable',messages[code]??'No se pudo confirmar Webull. Consulta el estado antes de intentar otra orden.',[400,401,403,404,409,429].includes(response.status)?response.status:503);}
    if(action==='status'||action==='account')value.enabled=value.enabled===true&&env.WEBULL_MANUAL_ENABLED==='true';
    return privateJson(value);
  }
  const failure=(error:unknown)=>error instanceof ApiError?privateJson({error:{code:error.code,message:error.message}},error.status):privateJson({error:{code:'webull_unavailable',message:'No se confirmó la respuesta de Webull. Consulta el estado antes de repetir una operación.'}},503);
  return {async get(request?:Request){try{
    const params=Object.fromEntries(request?new URL(request.url).searchParams:[]),{action='status',...query}=params;
    if(['status','account'].includes(action)){if(Object.keys(query).length)throw new ApiError('webull_input','Consulta Webull no válida.',400);return await forward(action);}
    const parsed=action==='market-history'?webullHistoryQuery.safeParse(query):action==='market-options'?webullOptionsQuery.safeParse(query):action==='market-quote'?z.object({symbol:webullSymbol}).strict().safeParse(query):action==='orders'?webullOrderPage.safeParse(query):null;
    if(!parsed?.success)throw new ApiError('webull_input','Revisa los filtros de la consulta Webull.',400);
    return await forward(action,undefined,Object.fromEntries(Object.entries(parsed.data).map(([key,value])=>[key,String(value)])));
  }catch(error){return failure(error);}},async post(request:Request){try{
    sameOrigin(request);const data=z.discriminatedUnion('action',[z.object({action:z.literal('preview'),input:webullInput}).strict(),z.object({action:z.literal('preview-options'),input:webullOptionsInput}).strict(),z.object({action:z.literal('preview-change'),input:webullChangeInput}).strict(),z.object({action:z.enum(['submit','reconcile']),operationId:z.string().uuid()}).strict()]).safeParse(await smallJson(request));
    if(!data.success)throw new ApiError('webull_input','Revisa los datos de la orden Webull.',400);
    return 'input' in data.data?await forward(data.data.action,data.data.input):await forward(data.data.action,{operationId:data.data.operationId});
  }catch(error){return failure(error);}}};
}
