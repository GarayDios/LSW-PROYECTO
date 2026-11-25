import { createHash, createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../../http.ts';

export type WebullConfig = { appKey:string; appSecret:string; accountId:string; region:'mx'|'us'; host:string; enabled:boolean };
export function readWebullConfig(env:Record<string,string|undefined>):WebullConfig|null {
  if (!env.WEBULL_APP_KEY&&!env.WEBULL_APP_SECRET&&!env.WEBULL_ACCOUNT_ID) return null;
  const appKey=env.WEBULL_APP_KEY?.trim(),appSecret=env.WEBULL_APP_SECRET?.trim(),accountId=env.WEBULL_ACCOUNT_ID?.trim();
  const region=(env.WEBULL_REGION??env.WEBULL_REGION_ID??'mx').trim().toLowerCase();
  if (!appKey||!appSecret||!accountId||![appKey,appSecret,accountId].every(v=>v.length<=512&&!/[\r\n]/.test(v))||!['mx','us'].includes(region)||!['sandbox','uat'].includes((env.WEBULL_ENVIRONMENT??'').trim().toLowerCase()))
    throw new ApiError('webull_configuration','Configura Webull OpenAPI con credenciales de pruebas, región y cuenta del servidor.',503);
  return {appKey,appSecret,accountId,region:region as 'mx'|'us',host:region==='mx'?'us-openapi-alb.uat.webullbroker.com':'api.sandbox.webull.com',enabled:env.WEBULL_MANUAL_ENABLED==='true'};
}
// Official signature algorithm. The same compact body is hashed and transmitted.
export function webullSignature(path:string,query:Record<string,string>,body:string|undefined,headers:Record<string,string>,secret:string):string {
  const algorithm=headers['x-signature-algorithm']==='HMAC-SHA256'?'sha256':headers['x-signature-algorithm']==='HMAC-SHA1'?'sha1':null;
  if(!algorithm)throw new ApiError('webull_signature','Algoritmo de firma Webull no válido.',503);
  const values={...query,...headers};
  const joined=Object.keys(values).sort().map(k=>`${k}=${values[k]}`).join('&');
  const raw=path+'&'+joined+(body?'&'+createHash(algorithm==='sha256'?'sha256':'md5').update(body).digest('hex').toUpperCase():'');
  const encoded=encodeURIComponent(raw).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  return createHmac(algorithm,secret+'&').update(encoded).digest('base64');
}
export const webullInput=z.object({symbol:z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/),side:z.enum(['BUY','SELL']),quantity:z.number().int().min(1).max(10000),limitPrice:z.number().finite().min(.01).max(100000).refine(v=>Math.abs(v*100-Math.round(v*100))<1e-6)}).strict();
export type WebullInput=z.infer<typeof webullInput>;
export type WebullOrder={clientOrderId:string;symbol:string;side:'BUY'|'SELL';quantity:number;limitPrice:number;state:string;filledQuantity:number};
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
type Session={token:string;status:'NORMAL'|'PENDING';createdAt:number;checkedAt:number;expiresAt:number|null};
export type WebullAuthentication={status:'ready'|'pending'|'error'|'idle';expiresAt:string|null};
export type WebullAccountSummary={maskedId:string;maskedNumber:string|null;type:'CASH'|'MARGIN'|'OTHER';label:string|null};
export class WebullClient {
  config:WebullConfig; fetcher:typeof fetch;
  #session:Session|null=null;
  #auth:Promise<void>|null=null;
  #retryAt=0;
  #authError:ApiError|null=null;
  #now:()=>number;
  #account:WebullAccountSummary|null=null;
  #accountCheck:Promise<void>|null=null;
  #accountVerifiedAt=0;
  #accountIdentity='';
  constructor(config:WebullConfig,fetcher:typeof fetch=fetch,now:()=>number=Date.now){this.config=config;this.fetcher=fetcher;this.#now=now;}
  authenticationState():WebullAuthentication{return {status:this.#authError?'error':this.#session?.status==='NORMAL'?'ready':this.#session?.status==='PENDING'?'pending':'idle',expiresAt:this.#session?.expiresAt?new Date(this.#session.expiresAt).toISOString():null};}
  accountSummary():WebullAccountSummary|null{return this.#account?{...this.#account}:null;}
  private async signedRequest(path:string,query:Record<string,string>={},payload?:unknown,token?:string,category?:'US_EQUITY'|'US_OPTION'):Promise<unknown>{
    const body=payload===undefined?undefined:JSON.stringify(payload);
    const signing={'x-app-key':this.config.appKey,'x-timestamp':new Date(this.#now()).toISOString().replace(/\.\d{3}Z$/,'Z'),'x-signature-algorithm':'HMAC-SHA256','x-signature-version':'1.0','x-signature-nonce':randomUUID().replaceAll('-',''),host:this.config.host};
    const url=new URL('https://'+this.config.host+path);Object.entries(query).forEach(([k,v])=>url.searchParams.set(k,v));
    let response:Response;
    const orders=object(payload).new_orders??object(payload).modify_orders;
    const optionOrder=Array.isArray(orders)&&orders.some(value=>{const row=object(value);return row.instrument_type==='OPTION'||Array.isArray(row.legs)&&row.legs.length>0;});
    try {response=await this.fetcher(url,{method:body?'POST':'GET',headers:{...signing,'x-version':'v3','x-signature':webullSignature(path,query,body,signing,this.config.appSecret),Accept:'application/json',...(token?{'x-access-token':token}:{}),...(body?{'Content-Type':'application/json',...(path.startsWith('/trading/orders/')?{category:category??(optionOrder?'US_OPTION':'US_EQUITY')}:{})}:{})},body,redirect:'manual',signal:AbortSignal.timeout(15000)});}
    catch {throw new ApiError('webull_uncertain','Webull no confirmó la respuesta. Consulta la referencia antes de intentar otra operación.',503);}
    if(response.status>=300&&response.status<400)throw new ApiError('webull_redirect','Webull intentó redirigir la consulta; no se reenviaron credenciales.',503);
    if(!response.ok)throw new ApiError(response.status===401||response.status===403?'webull_auth_rejected':response.status===404?'webull_endpoint':'webull_rejected',response.status===401||response.status===403?'Webull rechazó la autenticación. Verifica que App Key, App Secret y cuenta correspondan a la misma región y al entorno de pruebas.':response.status===429?'Webull limitó las consultas; espera antes de actualizar.':response.status===404?'El endpoint Webull no está disponible en este entorno.':'Webull no confirmó la solicitud. Revisa su estado antes de repetirla.',response.status===429?429:503);
    const text=await response.text();if(text.length>2000000)throw new ApiError('webull_invalid','Respuesta Webull inválida.',503);
    let value:unknown;try{value=JSON.parse(text);}catch{throw new ApiError('webull_invalid','Respuesta Webull inválida.',503);}
    const record=object(value);
    if(record.error||record.error_code||record.success===false||record.code!==undefined&&!['0','200','SUCCESS'].includes(String(record.code)))throw new ApiError('webull_rejected','Webull rechazó la solicitud. Revisa permisos, saldo e instrumento en tu cuenta de pruebas.',409);
    return value;
  }
  private async ensureAuthentication():Promise<void>{
    const now=this.#now();
    if(this.#session?.status==='NORMAL'&&now-this.#session.checkedAt<300000&&(!this.#session.expiresAt||this.#session.expiresAt>now+10000))return;
    if(this.#auth)return this.#auth;
    if(this.#authError&&now<this.#retryAt)throw this.#authError;
    const authenticate=async()=>{
      const pending=this.#session?.status==='PENDING'&&now-this.#session.createdAt<300000;
      if(pending&&now-this.#session!.checkedAt<3000)throw new ApiError('webull_verification_required','Verifica OpenAPI en la app Webull y pulsa «Consultar conexión Webull» después de confirmar. El código SMS se introduce en Webull.',409);
      const path=pending?'/auth/tokens/check':'/auth/tokens/create';
      const payload=this.#session?{token:this.#session.token}:{};
      // Match the current official SDK. Only a confirmed 404 permits the
      // documented legacy token route; trading requests are never replayed.
      let raw:unknown;
      try{raw=await this.signedRequest(path,{},payload);}catch(error){
        if(!(error instanceof ApiError)||error.code!=='webull_endpoint')throw error;
        raw=await this.signedRequest(pending?'/openapi/auth/token/check':'/openapi/auth/token/create',{},payload);
      }
      const row=object(raw),wrapped=object(row.data),data=row.token?row:wrapped;
      const status=typeof data.status==='number'?['PENDING','NORMAL','INVALID','EXPIRED'][data.status]:data.status;
      if(typeof data.token!=='string'||!data.token||data.token.length>4096||/[\r\n]/.test(data.token)||!['NORMAL','PENDING'].includes(String(status))){
        this.#session=null;
        throw new ApiError('webull_token_invalid','Webull no devolvió un token activo o pendiente verificable. Vuelve a consultar la conexión.',503);
      }
      const rawExpiry=data.expires_at??data.expires;
      const numericExpiry=typeof rawExpiry==='number'?rawExpiry:typeof rawExpiry==='string'&&/^\d+$/.test(rawExpiry)?Number(rawExpiry):NaN;
      const absolute=Number.isFinite(numericExpiry)?numericExpiry>1e12?numericExpiry:numericExpiry>1e9?numericExpiry*1000:null:typeof rawExpiry==='string'&&Number.isFinite(Date.parse(rawExpiry))?Date.parse(rawExpiry):null;
      if(absolute!==null&&absolute<=now){this.#session=null;throw new ApiError('webull_token_invalid','El token Webull ya venció; vuelve a consultar la conexión.',503);}
      this.#session={token:data.token,status:status as 'NORMAL'|'PENDING',createdAt:pending?this.#session!.createdAt:now,checkedAt:now,expiresAt:absolute};
      this.#authError=null;this.#retryAt=0;
      if(status==='PENDING')throw new ApiError('webull_verification_required','Verifica OpenAPI en la app Webull y pulsa «Consultar conexión Webull» después de confirmar. El código SMS se introduce en Webull.',409);
    };
    const task=authenticate().catch(error=>{
      const safe=error instanceof ApiError?error:new ApiError('webull_auth_rejected','No se pudo autenticar Webull. Revisa las credenciales y el entorno de pruebas.',503);
      if(safe.code!=='webull_verification_required'){this.#authError=safe;this.#retryAt=this.#now()+15000;}
      throw safe;
    });
    this.#auth=task;
    try{await task;}finally{if(this.#auth===task)this.#auth=null;}
  }
  async request(path:string,query:Record<string,string>={},payload?:unknown,category?:'US_EQUITY'|'US_OPTION'):Promise<unknown>{
    await this.ensureAuthentication();
    // An order rejected or interrupted after sending is not retried here.
    try{return await this.signedRequest(path,query,payload,this.#session!.token,category);}catch(error){
      if(error instanceof ApiError&&error.code==='webull_auth_rejected'){this.#session=null;this.#account=null;this.#authError=error;this.#retryAt=this.#now()+15000;}
      throw error;
    }
  }
  async verifyAccount():Promise<void>{
    await this.ensureAuthentication();
    const identity=JSON.stringify([this.config.host,this.config.region,this.config.accountId]);
    if(this.#account&&this.#accountIdentity===identity&&this.#now()-this.#accountVerifiedAt<10000)return;
    if(this.#accountCheck)return this.#accountCheck;
    const task=this.verifyAccountFresh().then(()=>{this.#accountIdentity=identity;this.#accountVerifiedAt=this.#now();});
    this.#accountCheck=task;
    try{await task;}finally{if(this.#accountCheck===task)this.#accountCheck=null;}
  }
  private async verifyAccountFresh():Promise<void>{
    this.#account=null;
    const value=await this.request('/trading/accounts/list');
    const accounts=Array.isArray(value)?value:Array.isArray(object(value).data)?object(value).data as unknown[]:[];
    const row=accounts.map(object).find(v=>v.account_id===this.config.accountId);
    if(!row)throw new ApiError('webull_account','La cuenta de pruebas configurada no aparece entre las autorizadas por OpenAPI.',403);
    const number=typeof row.account_number==='string'?row.account_number:null;
    let label=typeof row.account_label==='string'&&row.account_label.trim()?row.account_label.trim().slice(0,80):null;
    if(label){for(const value of [this.config.accountId,number,this.config.appKey,this.config.appSecret].filter((value):value is string=>!!value))label=label.replaceAll(value,'…'+value.slice(-4));}
    this.#account={maskedId:'…'+this.config.accountId.slice(-4),maskedNumber:number?'…'+number.slice(-4):null,type:row.account_type==='CASH'?'CASH':row.account_type==='MARGIN'?'MARGIN':'OTHER',label};
  }
  payload(input:WebullInput,clientOrderId:string){return {account_id:this.config.accountId,new_orders:[{combo_type:'NORMAL',client_order_id:clientOrderId,symbol:input.symbol,instrument_type:'EQUITY',market:'US',order_type:'LIMIT',limit_price:input.limitPrice.toFixed(2),quantity:String(input.quantity),support_trading_session:'CORE',side:input.side,time_in_force:'DAY',entrust_type:'QTY'}]};}
  async preview(input:WebullInput,id:string){await this.verifyAccount();const value=await this.request('/trading/orders/preview',{},this.payload(input,id));if(!value||typeof value!=='object'||Array.isArray(value)&&!value.length||!Array.isArray(value)&&!Object.keys(value).length)throw new ApiError('webull_preview','Webull no confirmó una revisión válida.',503);}
  async submit(input:WebullInput,id:string){await this.request('/trading/orders/place',{},this.payload(input,id));}
  async lookup(input:WebullInput,id:string):Promise<WebullOrder>{
    const value=object(await this.request('/trading/orders/get',{account_id:this.config.accountId,client_order_id:id}));
    const rows=Array.isArray(value.orders)?value.orders.map(object):[object(value.order??value)];
    const matches=rows.filter(row=>row.client_order_id===id);
    if(matches.length!==1)throw new ApiError('webull_identity','La respuesta no confirmó una orden única para esta referencia.',503);
    const row=matches[0];
    const quantity=Number(row.total_quantity??row.quantity),limit=Number(row.limit_price),filled=Number(row.filled_quantity??row.filled_qty??NaN);
    const state=row.status??row.order_status;
    if(row.client_order_id!==id||row.symbol!==input.symbol||row.side!==input.side||quantity!==input.quantity||limit!==input.limitPrice||!Number.isFinite(filled)||filled<0||filled>quantity||typeof state!=='string')throw new ApiError('webull_identity','La respuesta de Webull no permite verificar todos los datos de la orden; conserva la referencia y concíliala.',503);
    return {clientOrderId:id,symbol:input.symbol,side:input.side,quantity,limitPrice:limit,state,filledQuantity:filled};
  }
}
