import {readLocalEnvironment} from './local-services.mjs';
import {readWebullConfig,WebullClient} from '../src/api/brokers/webull/client.ts';
import {WebullData} from '../src/api/brokers/webull/data.ts';
import {webullSymbol} from '../src/cores/compartido/webull-model.ts';
import {WebullF5Adapter} from '../src/api/brokers/webull/f5-adapter.ts';
import {WebullResearchData} from '../src/api/brokers/webull/research-data.ts';
import {randomUUID} from 'node:crypto';
const environment=readLocalEnvironment(process.cwd(),['.env.local','.env.trading.local']);
try{
  const config=readWebullConfig(environment);
  if(!config)throw Error('unconfigured');
  const client=new WebullClient(config,async(input,init)=>{
    const url=new URL(String(input));
    const token=url.pathname.startsWith('/auth/tokens/')||url.pathname.startsWith('/openapi/auth/token/');
    const reads=['/trading/accounts/list','/trading/assets/balances/get','/trading/assets/positions/list','/trading/orders/open-orders/list','/trading/orders/historical-orders/list','/trading/instruments/options/contracts/list','/market-data/stocks/snapshots/list','/market-data/options/snapshots/list','/trading/activities/cash-activities/list','/market-data/fundamentals/dividend-calendars/list'];
    const bars=url.pathname==='/market-data/stocks/bars/list'&&init?.method==='POST';
    const preview=process.argv.includes('--preview')&&url.pathname==='/trading/orders/preview'&&init?.method==='POST';
    if(url.hostname!==config.host||!(token&&init?.method==='POST'||reads.includes(url.pathname)&&init?.method==='GET'||bars||preview))throw Error('read-only diagnostic');
    return fetch(input,init);
  });
  try{
    await client.verifyAccount();
    const result={configured:true,connected:true,region:config.region,mode:'sandbox',enabled:config.enabled,account:client.accountSummary(),authentication:client.authenticationState(),readOnly:true};
    if(process.argv.includes('--data')||process.argv.includes('--preview')){
      const symbol=webullSymbol.parse(process.argv.find(arg=>arg.startsWith('--symbol='))?.slice(9)??'NVDA'),data=new WebullData(client);
      const end=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),start=`${Number(end.slice(0,4))-3}${end.slice(4)}`;
      const portfolio=await data.portfolio(),history=await data.history({symbol,start,end,interval:'1d'}),options=await data.options(symbol);
      Object.assign(result,{sections:{balances:portfolio.balances.available,positions:portfolio.positions.available,openOrders:portfolio.openOrders.available,history:portfolio.history.available},positions:portfolio.positions.data?.length,openOrders:portfolio.openOrders.data?.length,historyOrders:portfolio.history.data?.length,market:{symbol,bars:history.bars.length,feed:history.feed,adjustment:history.adjustment,coverage:history.coverage},options:{contracts:options.contracts.length,recentIv:options.contracts.filter(c=>c.impliedVolatility.value!==null).length,partial:!options.complete,message:options.status.message}});
      const adapter=new WebullF5Adapter(client),context=await new WebullResearchData(client).context(symbol),activities=await adapter.activities();
      Object.assign(result,{f5:{accountVerified:!!(await adapter.account()),marketOpen:await adapter.clock(),permissions:'provider-preview',activities:activities.length,activitiesComplete:adapter.activitiesComplete()},context:{spotAvailable:context.spot.value!==null,spotSource:context.spot.source,dividends:context.dividends.events.length,dividendCoverage:context.dividends.status.status}});
      if(process.argv.includes('--preview')){
        const spot=context.spot.value??history.bars.at(-1)?.close;
        const contracts=options.contracts.filter(c=>c.style==='american'&&c.multiplier?.value===100&&c.deliverableShares?.value===100&&c.expiration>end&&c.strike.value!==null);
        const expiry=contracts.map(c=>c.expiration).filter(d=>Date.parse(d)-Date.parse(end)>=14*86400000).sort((a,b)=>Math.abs(Date.parse(a)-Date.parse(end)-30*86400000)-Math.abs(Date.parse(b)-Date.parse(end)-30*86400000))[0];
        const calls=contracts.filter(c=>c.type==='call'&&c.expiration===expiry).sort((a,b)=>Math.abs(a.strike.value-spot)-Math.abs(b.strike.value-spot)),call=calls[0],put=contracts.find(c=>c.type==='put'&&c.expiration===expiry&&c.strike.value===call?.strike.value),upper=calls.filter(c=>c.strike.value>call?.strike.value).sort((a,b)=>a.strike.value-b.strike.value)[0];
        const long=contracts.filter(c=>c.type==='call'&&Date.parse(c.expiration)-Date.parse(expiry)>=180*86400000&&c.strike.value<=call?.strike.value).sort((a,b)=>Math.abs(a.strike.value-spot*.7)-Math.abs(b.strike.value-spot*.7))[0];
        const leg=(contract,side,ratio='1')=>({symbol:contract.symbol,side,ratio_qty:ratio,position_intent:side+'_to_open'}),previews={};
        const inputs={wheel:put?{symbol:put.symbol,side:'sell',position_intent:'sell_to_open',limit_price:'1.00'}:null,pmcc:long&&call?{order_class:'mleg',legs:[leg(long,'buy'),leg(call,'sell')],limit_price:'2.00'}:null,backspread:call&&upper?{order_class:'mleg',legs:[leg(call,'sell'),leg(upper,'buy','2')],limit_price:'1.00'}:null,gamma:call&&put?{order_class:'mleg',legs:[leg(call,'buy'),leg(put,'buy')],limit_price:'2.00'}:null};
        for(const [strategy,input] of Object.entries(inputs)){if(!input){previews[strategy]={accepted:false,errorCode:'contracts_unavailable'};continue;}try{await adapter.preview({client_order_id:randomUUID().replaceAll('-',''),qty:'1',type:'limit',time_in_force:'day',...input});previews[strategy]={accepted:true};}catch(e){previews[strategy]={accepted:false,errorCode:typeof e?.code==='string'?e.code:'unavailable'};}}
        Object.assign(result,{previews,diagnosticOnly:true});
      }
    }
    console.log(JSON.stringify(result,null,2));
  }catch(error){
    console.log(JSON.stringify({configured:true,connected:false,region:config.region,mode:'sandbox',authentication:client.authenticationState(),errorCode:typeof error?.code==='string'?error.code:'webull_unavailable',readOnly:true},null,2));
    process.exitCode=1;
  }
}catch{console.error('Configura Webull OpenAPI de pruebas en .env.trading.local. No se muestran claves ni se envían órdenes.');process.exitCode=1;}
