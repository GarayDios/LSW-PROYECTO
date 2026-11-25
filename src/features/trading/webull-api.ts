import type {WebullAuthentication,WebullAccountSummary} from '../../api/brokers/webull/client';
import type {WebullPortfolio} from '../../cores/compartido/webull-model';
import type {WebullOperation} from '../../../services/trading-runner/webull-service';
export type WebullStatus={configured:boolean;connected:boolean;enabled:boolean;region?:'mx'|'us';account?:WebullAccountSummary|null;authentication?:WebullAuthentication;message?:string;operations:WebullOperation[];portfolio?:WebullPortfolio|null};
export async function webullRequest<T>(body?:unknown,query:Record<string,string>={},signal?:AbortSignal):Promise<T>{
  const response=await fetch('/api/webull'+(Object.keys(query).length?'?'+new URLSearchParams(query):''),{credentials:'same-origin',cache:'no-store',signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const value=await response.json() as T&{error?:{message?:string}};
  if(!response.ok)throw Error(value.error?.message??'No se pudo confirmar Webull.');
  return value;
}
