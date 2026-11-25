import {ApiError} from '../../http.ts';
export async function readWebull<T>(env:Record<string,string|undefined>,owner:string,action:'market-history'|'market-options'|'market-quote'|'account'|'market-context'|'market-news'|'corporate-actions',query:Record<string,string>,fetcher:typeof fetch=fetch):Promise<T>{
  if(!owner||owner!==env.BROKER_OWNER_USER_ID)throw new ApiError('broker_owner_required','Esta conexión Webull pertenece a otro usuario.',403);
  let base:URL;try{base=new URL(env.TRADING_RUNNER_URL??'');}catch{throw new ApiError('webull_missing','Inicia el servicio de brókers para consultar Webull.',503);}
  const token=env.TRADING_RUNNER_TOKEN??'';
  if(base.username||base.password||base.pathname!=='/'||base.search||base.hash||base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))||token.length<32||token.length>512||/[\r\n]/.test(token))throw new ApiError('webull_configuration','Revisa la conexión privada con el servicio de brókers.',503);
  const url=new URL('/webull/'+action,base);url.searchParams.set('ownerId',owner);for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);
  let response:Response;
  try{response=await fetcher(url,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(60000)});}catch{throw new ApiError('webull_unavailable','No se pudo consultar el servicio de datos Webull.',503);}
  if(response.status>=300&&response.status<400)throw new ApiError('webull_unavailable','El servicio Webull intentó redirigir la consulta.',503);
  if(!response.ok)throw new ApiError('webull_unavailable',response.status===429?'Webull alcanzó su cuota. Espera antes de actualizar.':'Webull no confirmó los datos solicitados. Revisa permisos y conexión.',response.status===429?429:503);
  try{return await response.json() as T;}catch{throw new ApiError('webull_invalid','El servicio Webull devolvió una respuesta inválida.',503);}
}
