import { createHash, createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../../http.ts';

export type WebullConfig = { appKey:string; appSecret:string; accountId:string; region:'mx'|'us'; host:string; enabled:boolean };
export function readWebullConfig(env:Record<string,string|undefined>):WebullConfig|null {
  if (!env.WEBULL_APP_KEY&&!env.WEBULL_APP_SECRET&&!env.WEBULL_ACCOUNT_ID) return null;
  const appKey=env.WEBULL_APP_KEY?.trim(),appSecret=env.WEBULL_APP_SECRET?.trim(),accountId=env.WEBULL_ACCOUNT_ID?.trim();
  const region=env.WEBULL_REGION??'mx';
  if (!appKey||!appSecret||!accountId||![appKey,appSecret,accountId].every(v=>v.length<=512&&!/[\r\n]/.test(v))||!['mx','us'].includes(region)||env.WEBULL_ENVIRONMENT!=='sandbox')
    throw new ApiError('webull_configuration','Configura Webull OpenAPI con credenciales de pruebas, región y cuenta del servidor.',503);
  return {appKey,appSecret,accountId,region:region as 'mx'|'us',host:region==='mx'?'us-openapi-alb.uat.webullbroker.com':'api.sandbox.webull.com',enabled:env.WEBULL_MANUAL_ENABLED==='true'};
}
// Official signature algorithm. The same compact body is hashed and transmitted.
export function webullSignature(path:string,query:Record<string,string>,body:string|undefined,headers:Record<string,string>,secret:string):string {
  const values={...query,...headers};
  const joined=Object.keys(values).sort().map(k=>`${k}=${values[k]}`).join('&');
  const raw=path+'&'+joined+(body?'&'+createHash('md5').update(body).digest('hex').toUpperCase():'');
  const encoded=encodeURIComponent(raw).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  return createHmac('sha1',secret+'&').update(encoded).digest('base64');
}
export const webullInput=z.object({symbol:z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/),side:z.enum(['BUY','SELL']),quantity:z.number().int().min(1).max(10000),limitPrice:z.number().finite().min(.01).max(100000).refine(v=>Math.abs(v*100-Math.round(v*100))<1e-6)}).strict();
export type WebullInput=z.infer<typeof webullInput>;
export type WebullOrder={clientOrderId:string;symbol:string;side:'BUY'|'SELL';quantity:number;limitPrice:number;state:string;filledQuantity:number};
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export class WebullClient {
  config:WebullConfig; fetcher:typeof fetch;
  constructor(config:WebullConfig,fetcher:typeof fetch=fetch){this.config=config;this.fetcher=fetcher;}
  async request(path:string,query:Record<string,string>={},payload?:unknown):Promise<unknown>{
    const body=payload===undefined?undefined:JSON.stringify(payload);
    const signing={'x-app-key':this.config.appKey,'x-timestamp':new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),'x-signature-algorithm':'HMAC-SHA1','x-signature-version':'1.0','x-signature-nonce':randomUUID().replaceAll('-',''),host:this.config.host};
    const url=new URL('https://'+this.config.host+path);Object.entries(query).forEach(([k,v])=>url.searchParams.set(k,v));
    let response:Response;
    try {response=await this.fetcher(url,{method:body?'POST':'GET',headers:{...signing,'x-version':'v3','x-signature':webullSignature(path,query,body,signing,this.config.appSecret),Accept:'application/json',...(body?{'Content-Type':'application/json',category:'US_EQUITY'}:{})},body,redirect:'manual',signal:AbortSignal.timeout(15000)});}
    catch {throw new ApiError('webull_uncertain','Webull no confirmó la respuesta. Consulta la referencia antes de intentar otra operación.',503);}
    if(!response.ok)throw new ApiError('webull_rejected',response.status===401||response.status===403?'Webull rechazó las credenciales o permisos OpenAPI.':response.status===429?'Webull limitó las consultas; espera antes de actualizar.':'Webull no confirmó la solicitud. Revisa su estado antes de repetirla.',response.status===429?429:503);
    const text=await response.text();if(text.length>2000000)throw new ApiError('webull_invalid','Respuesta Webull inválida.',503);
    let value:unknown;try{value=JSON.parse(text);}catch{throw new ApiError('webull_invalid','Respuesta Webull inválida.',503);}
    const record=object(value);
    if(record.error||record.error_code||record.success===false||record.code!==undefined&&!['0','200','SUCCESS'].includes(String(record.code)))throw new ApiError('webull_rejected','Webull rechazó la solicitud. Revisa permisos, saldo e instrumento en tu cuenta de pruebas.',409);
    return value;
  }
  async verifyAccount():Promise<void>{
    const value=await this.request('/trading/accounts/list');
    if(!Array.isArray(value)||!value.some(v=>object(v).account_id===this.config.accountId))throw new ApiError('webull_account','La cuenta de pruebas configurada no aparece entre las autorizadas por OpenAPI.',403);
  }
  payload(input:WebullInput,clientOrderId:string){return {account_id:this.config.accountId,new_orders:[{combo_type:'NORMAL',client_order_id:clientOrderId,symbol:input.symbol,instrument_type:'EQUITY',market:'US',order_type:'LIMIT',limit_price:input.limitPrice.toFixed(2),quantity:String(input.quantity),support_trading_session:'CORE',side:input.side,time_in_force:'DAY',entrust_type:'QTY'}]};}
  async preview(input:WebullInput,id:string){await this.verifyAccount();const value=await this.request('/trading/orders/preview',{},this.payload(input,id));if(!value||typeof value!=='object'||Array.isArray(value)&&!value.length||!Array.isArray(value)&&!Object.keys(value).length)throw new ApiError('webull_preview','Webull no confirmó una revisión válida.',503);}
  async submit(input:WebullInput,id:string){await this.request('/trading/orders/place',{},this.payload(input,id));}
  async lookup(input:WebullInput,id:string):Promise<WebullOrder>{
    const value=object(await this.request('/trading/orders/get',{account_id:this.config.accountId,client_order_id:id}));
    const row=object(value.order??value);
    const quantity=Number(row.quantity),limit=Number(row.limit_price),filled=Number(row.filled_quantity??row.filled_qty??0);
    if(row.client_order_id!==id||row.symbol!==input.symbol||row.side!==input.side||quantity!==input.quantity||limit!==input.limitPrice||!Number.isFinite(filled)||filled<0||filled>quantity||typeof row.order_status!=='string')throw new ApiError('webull_identity','La respuesta de Webull no permite verificar todos los datos de la orden; conserva la referencia y concíliala.',503);
    return {clientOrderId:id,symbol:input.symbol,side:input.side,quantity,limitPrice:limit,state:row.order_status,filledQuantity:filled};
  }
}
