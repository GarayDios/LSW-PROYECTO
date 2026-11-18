import { existsSync,readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createConnection } from 'node:net';
import path from 'node:path';

/**
 * @param {string} root
 * @param {string[]} files
 * @param {Record<string,string|undefined>} [environment]
 * @returns {Record<string,string|undefined>}
 */
export function readLocalEnvironment(root,files,environment=process.env){
  const values={};
  for(const file of files){
    const filename=path.join(root,file);if(!existsSync(filename))continue;
    for(const [key,value] of Object.entries(parseEnv(readFileSync(filename,'utf8'))))if(value.trim())values[key]=value;
  }
  return {...values,...environment};
}
export function localBrokerPort(environment){
  if(!environment.TRADING_RUNNER_URL||!environment.TRADING_RUNNER_TOKEN)return null;
  let url;try{url=new URL(environment.TRADING_RUNNER_URL);}catch{return null;}
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/'||url.username||url.password||url.search||url.hash)return null;
  const port=Number(url.port||80);
  return Number.isInteger(port)&&port>0&&port<=65535?{port,host:url.hostname==='[::1]'?'::1':url.hostname}:null;
}
export function isListening(port,host='127.0.0.1'){
  return new Promise(resolve=>{
    const socket=createConnection({port,host});let done=false;
    const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};
    socket.setTimeout(700);socket.once('connect',()=>finish(true));socket.once('timeout',()=>finish(false));socket.once('error',()=>finish(false));
  });
}
