import {spawn} from 'node:child_process';
import { runMonteCarloScenario } from './monte-carlo-browser-scenario.mjs';
import { installNewsQA, runNewsScenario } from './news-browser-scenario.mjs';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { optionValidationExample } from '../src/features/research/validation-example.ts';
import { installF5QA } from './f5-browser-scenario.mjs';
import { installWebullQA,runManualScenario } from './manual-browser-scenario.mjs';
import { installIntelligenceQA,runIntelligenceScenario } from './intelligence-browser-scenario.mjs';
import { installTechnicalQA,runTechnicalScenario,technicalFundamentalFixture } from './technical-browser-scenario.mjs';
const mode=process.argv[2]||'flow';
const baseURL=process.env.QA_URL||'http://127.0.0.1:5173';
const profile=await mkdtemp(path.join(tmpdir(),'tepic-qa-'));
const chrome=spawn(process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9333',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
let ws;let id=0;const pending=new Map();const errors=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let pages;
  for(let i=0;i<80;i++){try{pages=await(await fetch('http://127.0.0.1:9333/json/list')).json();if(pages.some(p=>p.type==='page'))break;}catch{}await delay(250);}
  const page=pages.find(p=>p.type==='page');
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
  function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));setTimeout(()=>{if(pending.has(n)){pending.delete(n);reject(Error('CDP timeout '+method));}},45000).unref();});}
  async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
  async function until(expression){for(let i=0;i<160;i++){if(await evaluate(`Boolean(${expression})`))return;await delay(250);}throw Error('Timed out: '+expression+' Runtime: '+JSON.stringify(errors)+' Page: '+await evaluate('document.body.innerText.slice(0,3500)'));}
  async function reload(){const origin=await evaluate('performance.timeOrigin');await send('Page.reload');await until(`performance.timeOrigin>${origin}`);}
  async function click(text){const clicked=await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)});if(e){e.click();return true;}return false;})()`);assert(clicked,'Missing button '+text);await delay(150);}
  async function input(label,value){assert(await evaluate(`(()=>{const e=document.querySelector('input[aria-label="'+${JSON.stringify(label)}+'"]');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`),'Missing input '+label);await delay(100);}
  async function screenshot(name,width,height){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await delay(400);if(name.startsWith('strategy-comparison')){await evaluate("document.querySelector('.observed-strategy-analysis:not(.ranking-diagnostics)').scrollIntoView()");await delay(150);}if(name.startsWith('intelligence-')){await evaluate("document.querySelector('.intelligence-panel').scrollIntoView()");await delay(150);}if(name.startsWith('technical-')){await evaluate("document.querySelector('.chart-panel').scrollIntoView()");await delay(150);}if(name.startsWith('fundamental-')){await evaluate("document.querySelector('.fundamental-analysis').scrollIntoView()");await delay(150);}const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.resolve('outputs',name),Buffer.from(r.data,'base64'));}
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  if(mode==='persistence'){
    // Exercise the real UI in isolation. Only its persistence endpoint is mocked;
    // HTML, scripts, rendering and user interactions come from the running app.
    function installPersistenceQA(){
      const serverKey='tepic-qa-persistence-server';
      const legacyKey='tepic-terminal-v1';
      const read=()=>JSON.parse(sessionStorage.getItem(serverKey));
      const write=value=>sessionStorage.setItem(serverKey,JSON.stringify(value));
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      if(!sessionStorage.getItem(serverKey)){
        const initial={lists:[
          {id:'favorites',name:'Mi seguimiento',symbols:['NVDA','AAPL','MSFT','AMZN','GOOGL','META','TSLA','AMD']},
          {id:'technology',name:'Tecnología',symbols:['NVDA','AAPL','MSFT','GOOGL','META','AMD']},
          {id:'browser-extra',name:'Lista local de prueba',symbols:['NVDA']},
        ],orders:[],cycles:[],rate:.04};
        localStorage.setItem(legacyKey,JSON.stringify(initial));
        write({revision:0,state:null,puts:0,attempts:[],active:0,maxActive:0,conflictNext:false,originalLegacy:localStorage.getItem(legacyKey)});
      }
      window.__tepicPersistenceQA={
        inspect:read,
        conflict:()=>{const server=read();server.conflictNext=true;write(server);},
      };
      const originalFetch=window.fetch.bind(window);
      window.fetch=async(input,init)=>{
        const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
        if(url.origin!==location.origin||url.pathname!=='/api/persistence')return originalFetch(input,init);
        const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
        if(method==='GET'){
          await wait(1000);
          const server=read();
          return Response.json({mode:'remote',owner:{id:'qa-owner',displayName:'Cuenta de prueba'},revision:server.revision,state:server.state,archive:{enabled:true,pending:0}});
        }
        if(method!=='PUT')return Response.json({error:{code:'unsupported'}},{status:405});
        const body=JSON.parse(init.body);
        const server=read();
        server.puts++;
        server.active++;
        server.maxActive=Math.max(server.maxActive,server.active);
        server.attempts.push({expectedRevision:body.expectedRevision,rate:body.state.rate});
        let conflict=body.expectedRevision!==server.revision;
        if(server.conflictNext){
          server.conflictNext=false;
          server.revision++;
          server.state={...server.state,rate:.03};
          conflict=true;
        }
        if(!conflict){server.revision++;server.state=body.state;}
        write(server);
        await wait(350);
        const settled=read();settled.active--;write(settled);
        return conflict
          ?Response.json({error:{code:'revision_conflict',message:'Datos modificados en otra sesión.'}},{status:409})
          :Response.json({revision:server.revision,archive:{enabled:true,pending:0}});
      };
    }
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installPersistenceQA.toString()})();`});
  }
  if(mode==='history'||mode==='automation'||mode==='comparison'||mode==='strategies'||mode==='delivery'||mode==='manual'||mode==='intelligence'||mode==='technical'||mode==='monte-carlo'||mode==='news'){
    // A tagged provider fixture checks the real chart and controls without
    // claiming a live Alpaca connection or requiring trading credentials.
    function installHistoryQA(){
      const qa=window.__tepicHistoryQA={fail:false,calls:[]};
      const originalFetch=window.fetch.bind(window);
      window.fetch=async(input,init)=>{
        const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
        if(url.origin!==location.origin)return originalFetch(input,init);
        if(url.pathname==='/api/market/company')return Response.json({source:'alpaca',symbol:url.searchParams.get('symbol'),name:'Empresa de prueba de la API',exchange:'NASDAQ',tradable:true,assetClass:'us_equity'});
        if(url.pathname!=='/api/market/history')return originalFetch(input,init);
        const query=Object.fromEntries(url.searchParams);
        qa.calls.push(query);
        await new Promise(resolve=>setTimeout(resolve,80));
        if(qa.fail)return Response.json({error:{code:'market_access_denied',message:'Prueba: el proveedor rechazó el acceso al histórico.'}},{status:403});
        const bars=[];let index=0;
        for(let day=Date.parse(query.start);day<=Date.parse(query.end);day+=86400000){
          const weekday=new Date(day).getUTCDay();
          if(weekday===0||weekday===6)continue;
          const close=120+15*Math.sin(index/25)+4*Math.sin(index*1.7)+index*.015;
          const open=close+Math.sin(index*.9)*1.2;
          bars.push({time:day+15*3600000,open,close,high:Math.max(open,close)+1.5,low:Math.min(open,close)-1.5,volume:10000+index*17});
          index++;
        }
        return Response.json({...query,source:'alpaca',feed:'iex',adjustment:'split',asOf:new Date().toISOString(),bars,warnings:['Prueba de interfaz: proveedor simulado, sin conexión real.'],coverage:{firstBar:bars.length?new Date(bars[0].time).toISOString():null,lastBar:bars.length?new Date(bars.at(-1).time).toISOString():null,requestedStart:query.start,requestedEnd:query.end}});
      };
    }
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installHistoryQA.toString()})();`});
  }
  if(mode==='automation'||mode==='comparison'||mode==='delivery'){
    // Every plan mutation is intercepted. This mode never reaches the real runner.
    function installAutomationQA(){
      const qa=window.__tepicAutomationQA={actions:[],paused:false,plans:[{id:'e8bdfaf4-6066-43ba-988d-a92b28013f7e',symbol:'NVDA',historyYears:3,startDate:'2026-11-09',endDate:'2026-12-11',maxOrderUsd:100,maxPositionUsd:1000,enabled:false}]};
      const originalFetch=window.fetch.bind(window);
      window.fetch=async(input,init)=>{
        const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
        if(url.origin!==location.origin)return originalFetch(input,init);
        if(url.pathname==='/api/broker/status')return Response.json({alpaca:{configured:true,ownerAuthorized:true,mode:'paper'},webull:{supported:false,requiresApproval:true},automation:{configured:true,enabled:true},identity:{userId:'qa-owner'}});
        if(url.pathname!=='/api/automation')return originalFetch(input,init);
        if((init?.method??'GET')==='GET'){
          const resource=url.searchParams.get('resource');
          if(resource==='status')return Response.json({mode:'paper',configured:true,enabled:true,available:true,running:false,maxOrderUsd:1000,buyOnly:true});
          if(resource==='plans')return Response.json({plans:qa.plans});
          if(resource==='events')return Response.json({events:[]});
          if(resource==='executions')return Response.json({executions:[]});
          if(resource==='positions')return Response.json({positions:[]});
          if(resource==='risk')return Response.json({risk:{paused:qa.paused,date:'2026-11-13',equityStartUsd:10000,equityUsd:10000,dailyPnlUsd:0,ownedExposureUsd:0,totalExposureUsd:0,reservedEntryUsd:0,limits:{maxDailyLossUsd:null,maxTotalExposureUsd:null},dailyLossBlocked:false,exposureBlocked:false,uncertain:false,updatedAt:'2026-11-13T16:00:00Z'}});
          return Response.json({error:{message:'Unsupported QA resource'}},{status:400});
        }
        const action=JSON.parse(init.body);qa.actions.push(action);
        if(action.action==='pause'||action.action==='resume'){qa.paused=action.action==='pause';return Response.json({paused:qa.paused});}
        if(action.action==='create'){
          const plan={...action.plan,id:crypto.randomUUID(),enabled:false};qa.plans.push(plan);return Response.json({plan},{status:201});
        }
        const plan=qa.plans.find(value=>value.id===action.planId);
        if(plan&&(action.action==='enable'||action.action==='disable')){plan.enabled=action.action==='enable';return Response.json({plan});}
        return Response.json({error:{message:'Unsupported QA action'}},{status:400});
      };
    }
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installAutomationQA.toString()})();`});
  }
  if(mode==='comparison'){
    function installComparisonQA(){
      const qa=window.__tepicComparisonQA={calls:[]};
      const originalFetch=window.fetch.bind(window);
      window.fetch=async(input,init)=>{
        const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
        if(url.pathname!=='/api/research/comparison')return originalFetch(input,init);
        const body=JSON.parse(init.body);qa.calls.push(body);
        const stability={method:'expanding-window-fixed-rule',folds:[{startTime:Date.parse('2026-04-01'),endTime:Date.parse('2026-06-30'),returnPct:-3,buyHoldReturnPct:-2,maxDrawdownPct:5,completedTrades:2,wins:0,openPosition:false}],completedTrades:2,wins:0,historicalWinRate:0,winRateInterval95:{low:0,high:.65},minimumTrades:30,sufficientSample:false,positiveFolds:0,compoundedReturnPct:-3,compoundedBuyHoldReturnPct:-2,feeBps:body.feeBps,slippageBps:body.slippageBps,warnings:['Fixture de navegador: muestra insuficiente.']};
        return Response.json({source:'alpaca:iex · QA simulado',cutoff:body.end,generatedAt:new Date().toISOString(),feeBps:body.feeBps,slippageBps:body.slippageBps,rows:[{symbol:body.symbols[0],years:body.years[0],rule:'sma-cross',label:'SMA20/50 sin filtro RSI',observations:252,firstBar:'2025-11-10',lastBar:'2026-11-09',validationStartTime:Date.parse('2026-07-01'),returnPct:-7.25,buyHoldReturnPct:-4,maxDrawdownPct:12,completedTrades:2,openPosition:true,stability}],excluded:[{symbol:'MSFT',years:5,reason:'Histórico incompleto simulado.'}],warnings:['Prueba de interfaz, sin consultar un bróker.']});
      };
    }
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installComparisonQA.toString()})();`});
  }
  if(mode==='strategies'||mode==='delivery'||mode==='manual'||mode==='intelligence'||mode==='technical'||mode==='monte-carlo'||mode==='news'){
    function installStrategyQA(automatic=false){
      const qa=window.__strategyQA={fail:false};
      const originalFetch=window.fetch.bind(window);
      window.fetch=async(input,init)=>{
        const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
        if(url.pathname!=='/api/research/company')return originalFetch(input,init);
        if(qa.fail)return Response.json({error:{message:'QA: consulta de variables interrumpida.'}},{status:503});
        const symbol=url.searchParams.get('symbol'),asOf=new Date().toISOString();
        const v=value=>({value,source:'QA: proveedor simulado',observedAt:asOf,availableAt:asOf,kind:'observed'});
        const missing=()=>({value:null,source:'QA: ausente',observedAt:null,availableAt:null,kind:'missing'});
        const expiration=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
        const option=(type,strike,bid,ask,days=32)=>({symbol:`${symbol}-${type}-${strike}-${days}`,underlyingSymbol:symbol,multiplier:v(100),deliverableShares:v(100),deliverableType:'single_equity',type,strike:v(strike),expiration:expiration(days),style:'european',bid:v(bid),ask:v(ask),premium:v((bid+ask)/2),impliedVolatility:v(.3),openInterest:v(1000),delta:v(type==='call'&&strike===80?.9:.5),gamma:v(.02),theta:v(-.04),vega:v(.1)});
        const status={source:'QA simulado',status:'ready',message:'Fixture de interfaz; sin conexi?n real'};
        const research={symbol,asOf,generatedAt:asOf,
          market:{symbol,bars:[],spot:v(100),historicalVolatility:v(.25),momentum20:v(.03),momentum60:v(.1),averageVolume20:v(1e6),averageDollarVolume20:v(1e8),maxDrawdown:v(.2),downsideVolatility:v(.2),observations:100,stale:false,warnings:[]},
          options:{contracts:[option('put',95,2,2.2),option('call',95,8,9),option('call',105,2,2.2),option('call',100,3,3.2),option('put',100,3,3.2),option('call',80,23,24,400)],feed:'opra',complete:true,status,warnings:[]},
          fundamentals:{cik:null,companyName:'QA',annualRevenue:missing(),annualNetIncome:missing(),assets:missing(),liabilities:missing(),cash:missing(),sharesOutstanding:missing(),netMargin:missing(),liabilitiesToAssets:missing(),dividendYield:automatic?{...v(.01),kind:'estimated',source:'QA: dividendos históricos consultados automáticamente'}:missing(),status,warnings:[]},
          macro:{treasury3MonthPercent:v(4),riskFreeRate:v(.04),inflationYearOverYear:v(.02),realGdpGrowth:v(.03),status,warnings:[]},news:{articles:[],complete:true,status,warnings:[]},quality:{historicalOnly:false,missing:automatic?[]:['dividendYield'],stale:[],sources:[status]},warnings:['QA: no son datos de mercado reales']};window.__deliveryResearch=research;return Response.json({research});
      };
    }
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installStrategyQA.toString()})(${mode==='delivery'||mode==='manual'||mode==='intelligence'||mode==='technical'||mode==='monte-carlo'||mode==='news'});`});
  }
  if(mode==='delivery'||mode==='manual'||mode==='intelligence'||mode==='technical'||mode==='monte-carlo'||mode==='news'){
    function installDeliveryQA(){
      const qa=window.__delivery={phase:'submitted',mutations:[],rankingRequests:[]};
      const originalFetch=window.fetch.bind(window);
      window.fetch=async(input,init)=>{
        const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
        if(url.origin!==location.origin)return originalFetch(input,init);
        if(url.pathname==='/api/persistence')return Response.json({mode:'local'});
        if(url.pathname==='/api/research/ranking'){
          const body=JSON.parse(init.body);qa.rankingRequests.push(body);
          const snapshot=window.__deliveryResearch;
          const ready=snapshot.fundamentals.dividendYield.value!==null;
          const analysis={strategy:body.strategy,status:ready?'available':'unavailable',missing:ready?[]:['Dividendo futuro'],warnings:['QA fixture'],legs:[],capitalRequired:9500,entryDebit:-200,maxLoss:9300,maxGain:200,contractMultiplier:100,deliverableShares:100,horizonDays:30,dataMode:ready?'estimated':'observed',financingCost:0,assignmentReserve:null,ivScenarios:[],scenarios:[],diagnostics:{totalContracts:6,eligibleContracts:6,rejected:[],blocker:null,exampleCapitalRequired:null}};
          return Response.json({ranked:[{symbol:snapshot.symbol,score:ready?50:null,reason:'QA: datos incompletos o simulados',probabilityOfProfit:{value:null},probabilityLabel:'QA',contractSymbol:null,strategyAnalysis:analysis}],snapshots:{[snapshot.symbol]:snapshot},excluded:[],generatedAt:snapshot.asOf,cutoff:snapshot.asOf,warnings:['QA: sin datos reales']});
        }
        if(url.pathname==='/api/broker/account')return Response.json({account:{status:'ACTIVE',currency:'USD',buyingPower:'10000',equity:'10000',mode:'paper'}});
        if(url.pathname==='/api/automation' && (init?.method??'GET')==='GET'){
          const resource=url.searchParams.get('resource');
          if(resource==='executions')return Response.json({executions:[{clientOrderId:'fixture-entry',planId:'fixture-plan',state:qa.phase,symbol:'NVDA',side:'buy',quantity:1,filledQuantity:qa.phase==='filled'?1:0,filledAveragePrice:qa.phase==='filled'?100:undefined,brokerOrderId:'fixture-order'}]});
          if(resource==='positions')return Response.json({positions:qa.phase==='filled'?[{planId:'fixture-plan',symbol:'NVDA',quantity:1,averageEntryPrice:100,realizedPnlUsd:0,updatedAt:new Date().toISOString()}]:[]});
        }
        if((init?.method??'GET')!=='GET' && url.pathname!=='/api/persistence'){
          qa.mutations.push(url.pathname);return Response.json({error:{message:'Esta prueba no autoriza acciones externas.'}},{status:409});
        }
        return originalFetch(input,init);
      };
    }
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installDeliveryQA.toString()})();`});
  }
  if(mode==='manual'){
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installF5QA.toString()})();(${installWebullQA.toString()})();`});
  }
  if(mode==='intelligence'){
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installIntelligenceQA.toString()})();`});
  }
  if(mode==='technical'||mode==='monte-carlo'||mode==='news'){
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installTechnicalQA.toString()})(${JSON.stringify(technicalFundamentalFixture())});`});
  }
  if(mode==='news')await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installNewsQA.toString()})();`});
  await send('Page.navigate',{url:baseURL+'/'});
  if(mode==='persistence'){
    await until(`!!document.querySelector('.terminal-app[aria-busy="true"][inert]')`);
    assert(await evaluate(`!!document.querySelector('.persistence-loading-overlay [role="status"]')`),'Loading status remains accessible outside inert terminal');
  }
  if(['quant','cycles','features','flow','screenshots'].includes(mode)){
    await until(`!!document.querySelector('select[aria-label="Fuente del histórico"]')`);
    await delay(3000);
    await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Fuente del histórico"]');e.value='demo';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  }
  if(mode!=='quant') await until(`document.querySelector('.terminal-app[aria-busy="false"]') && document.querySelector('button.generate-button') && document.querySelector('.chart-panel') && !document.querySelector('vite-error-overlay')`);
  await delay(1200);await mkdir('outputs',{recursive:true});
  if(mode==='news'){
    await runNewsScenario({evaluate,click,until,screenshot});
  }else if(mode==='monte-carlo'){
    await runMonteCarloScenario({evaluate,click,input,until,screenshot});
  }else if(mode==='technical'){
    await runTechnicalScenario({evaluate,click,input,until,screenshot});
  }else if(mode==='intelligence'){
    await runIntelligenceScenario({evaluate,click,input,until,screenshot});
  }else if(mode==='manual'){
    await runManualScenario({evaluate,click,input,until,screenshot});
  }else if(mode==='delivery'){
    await until(`!!window.__deliveryResearch && !!document.querySelector('.comparison-assumption')`);
    assert(await evaluate(`Array.from(document.querySelectorAll('.analysis-advanced')).every(e=>!e.open)`),'Advanced panels start collapsed');
    assert(await evaluate(`document.querySelector('.automatic-input-status').innerText.includes('1.00% anual · estimado automáticamente')`),'Automatic dividend is visible and identified without a manual input');
    await evaluate(`(()=>{window.__strategyQA.fail=true;const select=document.querySelector('select[aria-label="Empresa del gráfico"]');select.value='AAPL';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`document.querySelector('.observed-strategy-analysis [role=alert]')?.innerText.includes('consulta de variables interrumpida')`);
    assert(await evaluate(`Array.from(document.querySelectorAll('.analysis-advanced')).every(e=>!e.open)`),'Research failure is visible with advanced panels collapsed');
    await evaluate(`window.__strategyQA.fail=false`);await click('Reintentar consulta');
    await until(`document.querySelector('.observed-strategy-analysis h2').innerText.includes('AAPL')&&!document.querySelector('.observed-strategy-analysis [role=alert]')`);
    await evaluate(`(()=>{const select=document.querySelector('select[aria-label="Empresa del gráfico"]');select.value='NVDA';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`document.querySelector('.observed-strategy-analysis h2').innerText.includes('NVDA')`);
    await evaluate(`document.querySelector('.comparison-advanced').open=true`);
    await until(`document.querySelector('.observed-strategy-analysis:not(.ranking-diagnostics)').innerText.includes('4.000% anual continua')`);
    const toggleRate = `Array.from(document.querySelectorAll('.observed-strategy-analysis label')).find(e=>e.textContent.includes('Usar una tasa continua supuesta')).querySelector('input').click()`;
    await evaluate(toggleRate);
    await input('Tasa continua supuesta','12');
    await until(`document.querySelector('.observed-strategy-analysis:not(.ranking-diagnostics)').innerText.includes('12.000% anual continua')`);
    assert(await evaluate(`document.querySelector('.research-panel').textContent.includes('Tasa manual activada')`),'Applied manual rate is identified in research');
    assert(await evaluate(`Array.from(document.querySelectorAll('.research-variable')).some(e=>e.textContent.includes('Tasa anual continua aplicada')&&e.textContent.includes('12.00%'))`),'Research shows the applied rate');
    await evaluate(toggleRate);
    await until(`document.querySelector('.observed-strategy-analysis:not(.ranking-diagnostics)').innerText.includes('4.000% anual continua')`);
    await evaluate(`document.querySelector('.comparison-advanced').open=false;window.__deliveryResearch.fundamentals.dividendYield.value=null`);
    await click('Generar oportunidades');
    await until(`document.querySelector('.ranking-status')?.textContent.includes('0 empresas evaluadas')`);
    assert(await evaluate(`!document.querySelector('.ranking-pending').open&&document.querySelector('.ranking-pending').textContent.includes('Dividendo futuro')`),'Missing data remains accessible in one collapsed detail');
    assert(await evaluate(`!document.querySelector('.ranking-pending input')`),'Pending results never demand a manual dividend');
    await evaluate(`window.__deliveryResearch.fundamentals.dividendYield.value=.01`);
    await click('Generar oportunidades');
    await until(`document.querySelector('.ranking-status')?.textContent.includes('1 empresas evaluadas')`);
    assert(await evaluate(`!document.querySelector('.ranking-pending')`),'Resolved missing data clears the pending detail');
    assert(await evaluate(`!document.querySelector('.ranking-diagnostics')`),'No manual dividend recovery panel');
    assert(await evaluate(`!document.querySelector('.analysis-advanced').open`),'Advanced panels start collapsed');
    await until(`document.querySelector('.observed-strategy-analysis:not(.ranking-diagnostics)').innerText.includes('Mayor compatibilidad calculable:')`);
    await click('Operar');await until(`!!document.querySelector('.ticket-dialog')`);
    assert(await evaluate(`document.querySelector('.ticket-source').textContent.includes('QA: proveedor simulado')`),'Order displays its data source');
    await click('Revisar operación');await until(`!!document.querySelector('.ticket-review')`);
    await click('Confirmar simulación');await until(`!document.querySelector('.ticket-dialog')`);
    await evaluate(`document.querySelector('.side-nav button:nth-child(3)').click()`);
    await until(`document.querySelectorAll('.order-table tbody tr').length===1`);
    assert(await evaluate(`document.querySelector('.order-table').textContent.includes('Investigaci\u00f3n')`),'Stored provenance remains visible');
    await reload();await until(`document.querySelector('.side-nav button:nth-child(3) .count-badge')?.textContent==='1'`);
    await evaluate(`document.querySelector('.side-nav button:nth-child(3)').click()`);await until(`document.querySelectorAll('.order-table tbody tr').length===1`);
    await evaluate(`document.querySelector('.side-nav button').click()`);await until(`!!document.querySelector('.broker-panel')`);
    await click('Consultar cuenta Paper');await until(`document.querySelector('.broker-account')?.textContent.includes('ACTIVE')`);
    await until(`document.querySelector('.broker-events')?.textContent.includes('Enviada al bróker')`);
    await evaluate(`window.__delivery.phase='filled'`);await click('Actualizar estado');
    await until(`document.querySelector('.broker-panel').textContent.includes('Ejecutada')&&document.querySelector('.broker-panel').textContent.includes('1 acciones')`);
    await evaluate(`Array.from(document.querySelectorAll('.analysis-advanced')).find(e=>e.querySelector('.research-panel')).open=true`);
    const historicalFile=path.resolve('outputs/browser-option-history.json');await writeFile(historicalFile,JSON.stringify(optionValidationExample()));
    const root=await send('DOM.getDocument');
    const historyNode=await send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'input[aria-label="Datos históricos de opciones"]'});
    await send('DOM.setFileInputFiles',{nodeId:historyNode.nodeId,files:[historicalFile]});
    await until(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Validar fuera de muestra').disabled || !!document.querySelector('[aria-label="Validación histórica de opciones"] [role=alert]')`);
    assert(await evaluate(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Validar fuera de muestra').disabled`),await evaluate(`document.querySelector('[aria-label="Validación histórica de opciones"]').textContent`));
    await click('Validar fuera de muestra');await until(`document.body.textContent.includes('DATOS SINTÉTICOS DE PRUEBA')`);
    const gammaFile=path.resolve('outputs/browser-gamma-path.json');
    const at=await evaluate('window.__deliveryResearch.asOf');
    await writeFile(gammaFile,JSON.stringify({source:'QA: trayectoria sintética',kind:'scenario',points:[100,110,90,115,100].map((spot,i)=>({at:new Date(Date.parse(at)+i*86400000).toISOString(),spot,bid:spot-.05,ask:spot+.05}))}));
    const gammaNode=await send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'input[aria-label="Trayectoria Gamma"]'});
    await send('DOM.setFileInputFiles',{nodeId:gammaNode.nodeId,files:[gammaFile]});
    await until(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Evaluar coberturas Gamma').disabled`);
    await evaluate(`document.querySelector('input[aria-label="Trayectoria Gamma"]').closest('details').open=true`);
    await click('Evaluar coberturas Gamma');await until(`document.body.textContent.includes('Resultado con cobertura:')`);
    const operationEnd=await evaluate(`document.querySelector('input[aria-label="Fecha de fin de operación"]').value`);
    await input('Fecha de fin de operación','2020-01-01');await click('Generar oportunidades');
    assert(await evaluate(`!!document.querySelector('.form-error')`),'Invalid operation dates are explained');
    await input('Fecha de fin de operación',operationEnd);
    await evaluate(`window.__tepicHistoryQA.fail=true`);await click('1A');
    await until(`document.body.innerText.includes('Prueba: el proveedor')`);
    assert.equal(await evaluate(`document.querySelector('select[aria-label="Fuente del histórico"]').value`),'alpaca');
    await evaluate(`window.__tepicHistoryQA.fail=false`);await click('3A');
    await until(`!!document.querySelector('.market-chart svg')&&!document.body.innerText.includes('Prueba: el proveedor')`);
    await screenshot('delivery-desktop.png',1440,1000);await screenshot('delivery-mobile.png',390,844);
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Delivery UI fits mobile');
    assert.deepEqual(await evaluate('window.__delivery.mutations'),[],'No external action was submitted');
    console.log('PASS: confirm simulation, Orders and reload; field provenance; Paper account/order-state/position UI with fixtures; historical importer; dynamic Gamma path; mobile. No real broker order.');
  }else if(mode==='strategies'){
    await until(`document.querySelectorAll('.observed-strategy-analysis tbody tr').length===4`);
    assert(await evaluate(`document.querySelector('.observed-strategy-analysis:not(.ranking-diagnostics)').textContent.includes('Dividendo futuro')`),'Missing dividend remains explicit');
    await evaluate(`document.querySelector('.comparison-assumption input[type=checkbox]').click()`);
    await until(`document.querySelector('.observed-strategy-analysis:not(.ranking-diagnostics)').innerText.includes('Mayor compatibilidad calculable:')`);
    assert(await evaluate(`document.querySelector('.observed-strategy-analysis:not(.ranking-diagnostics)').textContent.includes('trayectorias de cobertura')`),'Gamma probability is not fabricated');
    assert(await evaluate(`document.querySelector('.observed-strategy-analysis:not(.ranking-diagnostics)').textContent.includes('vencimientos distintos')`),'PMCC does not borrow single-leg probability');
    await click('Comparar sin el core de probabilidad');
    await until(`Array.from(document.querySelectorAll('.observed-strategy-analysis tbody tr')).find(e=>e.innerText.includes('Poor Man')).innerText.includes('/100')`);
    await evaluate(`Array.from(document.querySelectorAll('.observed-strategy-analysis tbody tr')).find(e=>e.innerText.includes('Poor Man')).querySelector('button').click()`);
    await until(`document.querySelector('.strategy-option[aria-checked=true]').innerText.includes('Poor Man')`);
    await evaluate(`(()=>{const form=document.querySelector('.evaluation-controls form');form.closest('details').open=true;form.elements.namedItem('weight-bsm').value='0';form.elements.namedItem('weight-risk').value='3';form.elements.namedItem('scenarioChanges').value='-50, 0, 50';form.requestSubmit();})()`);
    await until(`document.querySelector('.observed-strategy-analysis:not(.ranking-diagnostics)').textContent.includes('-50%')`);
    assert(await evaluate(`document.querySelector('.observed-strategy-analysis:not(.ranking-diagnostics)').textContent.includes('peso 3')`),'Custom core weights reach the ranking');
    await evaluate(`document.querySelector('.observed-strategy-analysis details').open=true;document.querySelector('.observed-strategy-analysis:not(.ranking-diagnostics)').scrollIntoView()`);
    await screenshot('strategy-comparison-desktop.png',1440,1100);
    await screenshot('strategy-comparison-mobile.png',390,844);
    assert(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth+2`),'Page should not overflow on mobile');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.observed-strategy-analysis:not(.ranking-diagnostics)')).display`),'block');
    console.log(JSON.stringify({mode,strategies:4,explicitDividend:true,staticGammaOnly:true,pmccProbabilityMissing:true,customWeights:true,customScenarios:true,runtimeErrors:errors}));
    assert.deepEqual(errors,[]);process.exitCode=0;
  } else
  if(mode==='persistence'){
    const inspect=()=>evaluate('window.__tepicPersistenceQA.inspect()');
    async function changeRate(value){
      assert(await evaluate(`(()=>{const input=document.querySelector('.modal input[type="number"]');if(!input)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`),'Rate input exists');
    }
    await until(`!!document.querySelector('.persistence-needs-import')`);
    assert.equal((await inspect()).puts,0,'No upload before import choice');
    assert.equal(await evaluate(`document.querySelectorAll('.watchlists .watchlist').length`),2,'Unimported browser list is not assigned to cloud user');
    assert(await evaluate(`!document.querySelector('.terminal-app').inert`),'Import choice is interactive once account lookup finishes');
    await click('Importar datos de este navegador');
    await until(`!!document.querySelector('.persistence-synced')`);
    assert.equal((await inspect()).revision,1);
    assert((await inspect()).state.lists.some(list=>list.id==='browser-extra'),'Explicit import saves the legacy list');
    assert.equal(await evaluate(`document.querySelectorAll('.watchlists .watchlist').length`),3);
    assert.equal(await evaluate(`localStorage.getItem('tepic-terminal-v1')`),(await inspect()).originalLegacy,'Import preserves original browser data');
    await click('Configuración');
    await until(`!!document.querySelector('.modal input[type="number"]')`);
    await changeRate(5);
    await until(`window.__tepicPersistenceQA.inspect().puts===2 && window.__tepicPersistenceQA.inspect().active===1`);
    await changeRate(6);
    await until(`window.__tepicPersistenceQA.inspect().revision===3 && !!document.querySelector('.persistence-synced')`);
    const afterEdits=await inspect();
    assert.equal(afterEdits.state.rate,.06);
    assert.equal(afterEdits.maxActive,1,'Pending saves are serialized');
    assert.deepEqual(afterEdits.attempts.map(attempt=>attempt.expectedRevision),[0,1,2]);
    await click('Listo');
    await evaluate('window.__tepicPersistenceQA.conflict()');
    await click('Configuración');
    await changeRate(7);
    await until(`!!document.querySelector('.persistence-conflict')`);
    await click('Listo');
    assert.equal((await inspect()).state.rate,.03,'The conflicting draft does not overwrite cloud data');
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tepic-terminal-v1:user:qa-owner:provider:local')).state.rate`),.07,'Conflict keeps local draft');
    assert(await evaluate(`Array.from(document.querySelectorAll('.persistence-actions button')).some(button=>button.textContent==='Descargar borrador')`));
    await click('Cargar datos de la cuenta');
    await until(`!!document.querySelector('.persistence-synced')`);
    await click('Configuración');
    assert.equal(await evaluate(`document.querySelector('.modal input[type="number"]').value`),'3','Explicit reload loads the authoritative account state');
    await click('Listo');
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tepic-terminal-v1:user:qa-owner:provider:local')).state.rate`),.07,'Remote reload leaves earlier draft available');
    await reload();
    await until(`!!document.querySelector('.persistence-synced')`);
    assert.equal((await inspect()).puts,4,'Reload does not import or upload records again');
    await screenshot('persistence-desktop.png',1440,1000);await screenshot('persistence-mobile.png',390,844);
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Persistence UI fits mobile');
    console.log('PASS: simulated persistence API, loading guard, explicit legacy import, sequential revision saves, conflict draft, account reload and mobile. No live database connection is claimed.');
  }else if(mode==='automation'){
    await until(`document.querySelectorAll('.broker-plan').length===1`);
    assert.equal(await evaluate(`document.querySelector('.broker-plan button').disabled`),false,'Matching disabled plan can be reviewed for activation');
    await input('Fecha de inicio de operación','2026-11-10');
    await until(`document.querySelector('.broker-plan button').disabled && document.querySelector('.broker-plan').textContent.includes('El rango cambió')`);
    await evaluate(`document.querySelector('.broker-plan button').click()`);
    assert.equal(await evaluate('window.__tepicAutomationQA.actions.length'),0,'Changing the range cannot activate the old dates');
    await evaluate(`(()=>{const input=document.querySelector('select[aria-label="Fuente del histórico"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,'alpaca');input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`!!document.querySelector('.market-chart') && !Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Preparar plan Paper desactivado').disabled`);
    await click('Preparar plan Paper desactivado');
    await until(`document.querySelectorAll('.broker-plan').length===2`);
    const created=await evaluate('window.__tepicAutomationQA.actions[0]');
    assert.equal(created.action,'create');assert.equal(created.plan.startDate,'2026-11-10');assert.equal(created.plan.endDate,'2026-12-11');
    assert.equal(await evaluate(`document.querySelector('.broker-plan:first-child button').disabled`),true);
    assert.equal(await evaluate(`document.querySelector('.broker-plan:last-child button').disabled`),false);
    await evaluate(`document.querySelector('.broker-plan:last-child button').click()`);
    await until(`document.querySelector('.broker-plan:last-child button').textContent==='Desactivar plan'`);
    await input('Fecha de inicio de operación','2026-11-11');
    assert.equal(await evaluate(`document.querySelector('.broker-plan:last-child button').disabled`),false,'Stopping remains available after changing dates');
    await click('Desactivar plan');
    await until(`window.__tepicAutomationQA.actions.length===3`);
    assert.deepEqual(await evaluate('window.__tepicAutomationQA.actions.map(value=>value.action)'),['create','enable','disable']);
    assert.equal(await evaluate(`document.querySelector('.broker-plan:last-child button').disabled`),true,'Stopped plan with outdated range cannot be reactivated');
    await evaluate(`Array.from(document.querySelectorAll('.broker-checkbox')).find(label=>label.textContent.includes('Preparar salidas automáticas')).querySelector('input').click()`);
    await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Modalidad de salidas"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'bracket');e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await evaluate(`(()=>{for(const [label,value] of [['Stop loss (%)','5'],['Take profit (%)','10']]){const e=Array.from(document.querySelectorAll('.broker-plan-fields label')).find(e=>e.textContent.includes(label)).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
    await click('Preparar plan Paper desactivado');await until(`document.querySelectorAll('.broker-plan').length===3`);
    const bracket=await evaluate('window.__tepicAutomationQA.actions.at(-1).plan.exitPolicy');
    assert.equal(bracket.execution,'bracket');assert.equal(bracket.stopLossPct,5);assert.equal(bracket.takeProfitPct,10);assert.equal(bracket.closeAtEnd,false);
    await click('Pausar nuevas entradas');await until(`window.__tepicAutomationQA.paused && document.querySelector('.broker-risk-status').textContent.includes('Reanudar planes habilitados')`);
    assert(await evaluate(`document.querySelector('.broker-risk-status').textContent.includes('mantiene las salidas')`));
    console.log('PASS: automation UI dates, disabled plans, activation, stop, opt-in bracket policy and entry pause. All plan mutations were simulated; no broker orders were sent.');
  }else if(mode==='comparison'){
    assert(await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Comparar empresas y periodos').disabled`));
    await evaluate(`(()=>{const input=document.querySelector('select[aria-label="Fuente del histórico"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,'alpaca');input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`!Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Comparar empresas y periodos').disabled`);
    await input('Empresas para comparar','AAPL, MSFT');await click('Comparar empresas y periodos');
    await until(`document.querySelector('.comparison-panel .validation-table')`);
    assert.deepEqual(await evaluate('window.__tepicComparisonQA.calls[0].symbols'),['AAPL','MSFT']);
    assert(await evaluate(`document.querySelector('.comparison-panel').textContent.includes('-7.25%')`),'Negative returns remain visible');
    assert(await evaluate(`document.querySelector('.comparison-panel').textContent.includes('Histórico incompleto simulado')`),'Exclusions remain visible');
    await evaluate(`document.querySelector('.comparison-panel summary').click()`);
    assert(await evaluate(`document.querySelector('.comparison-panel details').open`));
    await evaluate(`window.__anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__export={name:this.download,url:this.href}}`);
    await click('Exportar comparación CSV');
    const csv=await evaluate(`fetch(window.__export.url).then(r=>r.text())`);assert(csv.includes('-7.25'));assert(csv.includes('Excluida:'));
    await evaluate(`HTMLAnchorElement.prototype.click=window.__anchorClick`);
    await input('Empresas para comparar','AAPL, MSFT, NVDA, TSLA, AMD, META, AMZN');await click('Comparar empresas y periodos');
    assert.equal(await evaluate('window.__tepicComparisonQA.calls.length'),1,'Oversized universe rejected before networking');
    await screenshot('comparison-desktop.png',1440,1100);await screenshot('comparison-mobile.png',390,844);
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Comparison mobile fits');
    console.log('PASS: comparison source guard, symbols, negative returns, incomplete coverage, fold details, CSV, six-company limit and mobile. All provider and runner responses simulated.');
  }else if(mode==='history'){
    async function selectSource(value){
      await evaluate(`(()=>{const input=document.querySelector('select[aria-label="Fuente del histórico"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    }
    await selectSource('alpaca');
    await until(`window.__tepicHistoryQA.calls.length>0 && !!document.querySelector('.market-chart [data-validation-region]')`);
    const query=await evaluate('window.__tepicHistoryQA.calls.at(-1)');
    assert.equal(query.interval,'1d');
    assert.equal(query.end,await evaluate(`document.querySelector('input[aria-label="Fin de histórico de velas"]').value`));
    assert.equal(query.start,await evaluate(`document.querySelector('input[aria-label="Inicio de histórico de velas"]').value`));
    const requestedDays=(Date.parse(query.end)-Date.parse(query.start))/86400000;
    assert(requestedDays>=1095&&requestedDays<=1096,'Three-year preset requests three calendar years');
    assert(await evaluate(`Number(document.querySelector('.history-summary span').textContent.split(' ')[0].replaceAll(',',''))>700`),'Three-year fixture is displayed');
    await until(`document.querySelector('.company-heading p').textContent==='Empresa de prueba de la API'`);
    assert(await evaluate(`Array.from(document.querySelectorAll('.market-chart svg text')).some(element=>element.textContent.includes(${JSON.stringify(query.start.slice(0,4))}))`),'Axes include the year');
    assert(await evaluate(`document.querySelectorAll('.market-chart [data-signal="buy"]').length>0`),'Historical buy signals remain visible after chart aggregation');
    assert(await evaluate(`document.querySelectorAll('.market-chart [data-signal="sell"]').length>0`),'Historical sell signals remain visible after chart aggregation');
    assert(await evaluate(`!!document.querySelector('[data-analysis-indicator="sma20-50"]')`),'Causal rule averages are graphed');
    await evaluate(`window.__anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__export={name:this.download,url:this.href}}`);
    await click('Exportar velas CSV');
    const exported=await evaluate(`fetch(window.__export.url).then(response=>response.text())`);
    assert(exported.split('\r\n').length>700,'CSV preserves original history rather than SVG buckets');
    assert((await evaluate('window.__export.name')).endsWith('-alpaca.csv'));
    await evaluate('HTMLAnchorElement.prototype.click=window.__anchorClick');
    await input('Inicio de histórico de velas','2026-01-01');
    await until(`document.querySelector('.history-summary strong').textContent.startsWith('2026-01-01')`);
    assert(await evaluate(`Number(document.querySelector('.history-summary span').textContent.split(' ')[0].replaceAll(',',''))<300`),'Changing the date range changes the underlying history');
    await evaluate('window.__tepicHistoryQA.fail=true');
    await click('5A');
    await until(`document.querySelector('.history-query-error')?.textContent.includes('rechazó el acceso')`);
    assert.equal(await evaluate(`document.querySelector('select[aria-label="Fuente del histórico"]').value`),'alpaca','Provider errors cannot silently change the selected source');
    assert.equal(await evaluate(`document.querySelectorAll('.market-chart').length`),0,'Failed real request does not display synthetic candles');
    assert(await evaluate(`document.querySelector('.price-row strong').textContent.startsWith('—')`),'Failed request does not label a demo price as real');
    await selectSource('demo');
    await until(`!!document.querySelector('.market-chart')&&document.querySelector('.chart-sim-label').textContent.includes('SIMULADO')`);
    await screenshot('history-desktop.png',1440,1100);await screenshot('history-mobile.png',390,844);
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'History and analysis controls fit mobile');
    console.log('PASS: simulated historical-provider API, three-year candles, calendar range, year axes, causal buy/sell markers, original CSV, company identity, explicit API errors and mobile. No live broker connection is claimed.');
  }else if(mode==='quant'){
    await until(`!!document.querySelector('.quant-lab')`);
    await evaluate(`document.querySelector('.quant-lab').open=true; document.querySelector('.quant-lab').scrollIntoView()`);
    await until(`(()=>{if(document.querySelector('.quant-lab').innerText.includes('Newton–Raphson'))return true;const e=document.querySelector('select[aria-label="Fuente del histórico"]');e.value='demo';e.dispatchEvent(new Event('change',{bubbles:true}));return false;})()`);
    assert(await evaluate(`document.querySelector('.quant-lab').innerText.includes('Americana: $')`),'CRR prices rendered');
    assert(await evaluate(`document.querySelector('.quant-lab').innerText.includes('iteraciones')`),'IV converged');
    await screenshot('quant-desktop.png',1440,1000);
    await evaluate(`(()=>{const e=document.querySelector('.quant-lab input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'999999');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(`document.querySelector('.quant-lab').innerText.includes('fuera de los límites')`);
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate(`document.querySelector('.quant-lab').scrollIntoView()`);
    await screenshot('quant-mobile.png',390,844);
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Quant lab mobile fits');
    console.log('PASS: CRR and IV visible, impossible premium rejected, mobile width fits. No orders submitted.');
  }else if(mode==='screenshots'){
    await screenshot('desktop.png',1440,1000);await screenshot('mobile.png',390,844);
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'Mobile horizontal overflow');
    console.log('Screenshots saved. Mobile document fits viewport.');
  }else if(mode==='features'){
    assert.equal(await evaluate(`document.querySelectorAll('.core-section .ranking-criterion input').length`),7);
    assert.equal(await evaluate(`document.querySelectorAll('.core-section .ranking-criterion input:checked').length`),7);
    assert(await evaluate(`!document.querySelector('.ranking-criteria').open`),'Ranking criteria begin collapsed');
    assert(await evaluate(`!!document.querySelector('[data-analysis-indicator="sma20-50"]')&&!!document.querySelector('[data-technical-panel=rsi]')&&!!document.querySelector('[data-technical-panel=macd]')&&!!document.querySelector('[data-volume-bar]')`),'Technical layers are initially visible independently of ranking');
    assert.equal(await evaluate(`document.querySelectorAll('.strategy-comparison button').length`),4);
    assert.equal(await evaluate(`document.querySelectorAll('.top-opportunities button').length`),3);
    const initial=await evaluate(`document.querySelector('.top-opportunities').textContent`);
    await evaluate(`document.querySelectorAll('.strategy-comparison button')[3].click()`);await delay(150);
    assert.notEqual(await evaluate(`document.querySelector('.top-opportunities').textContent`),initial,'Strategy updates preview without generating');
    await evaluate(`document.querySelector('.top-opportunities button').click()`);await delay(150);
    assert.equal(await evaluate(`document.querySelector('select[aria-label="Empresa del gráfico"]').value`),await evaluate(`document.querySelector('.top-opportunities strong').firstChild.textContent.trim()`));
    await evaluate(`document.querySelector('.ranking-criteria').open=true`);
    const chartBeforeRankingChanges=await evaluate(`document.querySelector('.chart-price-surface').innerHTML`);
    await click('Limpiar');assert.equal(await evaluate(`document.querySelectorAll('.core-section .ranking-criterion input:checked').length`),0);
    assert(await evaluate(`document.querySelector('.ranking-criteria-status').textContent.includes('0 de 7 criterios habilitados')`),'Clearing criteria updates ranking participation');
    assert.equal(await evaluate(`document.querySelector('.chart-price-surface').innerHTML`),chartBeforeRankingChanges,'Clearing ranking criteria preserves chart layers and geometry');
    for(const [index,id] of ['bsm','greeks','probability','volatility','trend','liquidity','risk'].entries()){
      await evaluate(`document.querySelectorAll('.core-section .ranking-criterion input')[${index}].click()`);await delay(100);
      assert(await evaluate(`document.querySelectorAll('.core-section .ranking-criterion input')[${index}].checked`),id+' participates in ranking');
      assert.equal(await evaluate(`document.querySelectorAll('.core-section .ranking-criterion input:checked').length`),1);
      assert(await evaluate(`document.querySelector('.ranking-criteria-status').textContent.includes('1 de 7 criterios habilitados')`),id+' updates ranking status');
      assert.equal(await evaluate(`document.querySelector('.chart-price-surface').innerHTML`),chartBeforeRankingChanges,id+' does not alter chart layers or geometry');
      await evaluate(`document.querySelectorAll('.core-section .ranking-criterion input')[${index}].click()`);await delay(100);
    }
    await click('Activar todos');
    assert.equal(await evaluate(`document.querySelectorAll('.core-section .ranking-criterion input:checked').length`),7);
    assert.equal(await evaluate(`document.querySelector('.chart-price-surface').innerHTML`),chartBeforeRankingChanges,'Restoring all ranking criteria preserves the chart');
    await evaluate(`document.querySelector('.ranking-criteria').open=false`);
    await click('1D');assert(await evaluate(`document.querySelector('.history-summary').textContent.includes('78 velas')`),'One trading day has 78 five-minute bars');
    await click('1d');assert(await evaluate(`document.querySelector('.history-summary').textContent.includes('1 velas')`),'Daily aggregation');
    await input('Inicio de histórico de velas','2026-11-07');await input('Fin de histórico de velas','2026-11-08');
    assert(await evaluate(`document.querySelector('.history-empty').textContent.includes('No hay sesiones')`),'Weekend empty state');
    await input('Inicio de histórico de velas','2026-10-09');await input('Fin de histórico de velas','2026-11-09');await click('1h');
    await evaluate(`window.__anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__export={name:this.download,url:this.href}}`);
    await click('Exportar velas CSV');
    const csv=await evaluate(`fetch(window.__export.url).then(r=>r.text())`);
    assert(csv.startsWith('Fecha UTC,Apertura,Maximo,Minimo,Cierre,Volumen'));assert(csv.split('\r\n').length>100);
    await evaluate(`HTMLAnchorElement.prototype.click=window.__anchorClick`);
    await click('Generar oportunidades');await until(`!!document.querySelector('.generated-badge')`);
    await screenshot('seven-cores-desktop.png',1440,1100);await screenshot('seven-cores-mobile.png',390,844);
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Feature mobile fits');
    console.log('PASS: seven ranking criteria independent of chart layers, live four-strategy comparison, top companies select chart, true interval counts, weekend empty state, CSV export, generation and mobile layout.');
  }else if(mode==='cycles'){
    async function select(label,value){assert(await evaluate(`(()=>{const e=document.querySelector('select[aria-label="'+${JSON.stringify(label)}+'"]');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`));await delay(120);}
    await click('Simular ciclo');await until(`document.querySelector('.cycle-builder')`);await input('Fecha inicial del ciclo','2026-11-09');
    await input('Capital del ciclo · USD','100');await click('Revisar ciclo');assert(await evaluate(`document.querySelector('.cycle-error')?.textContent.includes('Capital insuficiente')`));
    await input('Capital del ciclo · USD','20000');await click('Revisar ciclo');await until(`document.querySelector('.cycle-review')`);await click('Confirmar inicio del ciclo');await until(`document.querySelector('.cycle-phase-badge')?.textContent==='PUT vendida'`);
    assert(await evaluate(`document.querySelector('.cycle-metrics').textContent.includes('$20,400.00')`),'Put premium enters cash');
    await input('Fecha siguiente del escenario','2026-12-11');await input('Precio siguiente del escenario','130');await click('Avanzar paso');await until(`document.querySelector('.cycle-phase-badge')?.textContent==='Acciones asignadas'`);
    assert(await evaluate(`document.querySelector('.cycle-metrics').textContent.includes('$6,400.00')`),'Assignment buys shares at strike');
    await click('Vender call cubierta');await until(`document.querySelector('.cycle-phase-badge')?.textContent==='Call cubierta'`);await evaluate(`document.querySelector('.cycle-expiry-shortcut').click()`);await delay(100);await input('Precio siguiente del escenario','150');await click('Avanzar paso');await until(`document.querySelector('.cycle-result')`);
    assert(await evaluate(`document.querySelector('.cycle-result').textContent.includes('+$1,200.00')`),'Wheel closes +1200');assert.equal(await evaluate(`document.querySelectorAll('.event-assignment').length`),2);
    for(const strategy of ['backspread','pmcc','gamma']){
      await click('Nuevo ciclo');await select('Estrategia del ciclo',strategy);await click('Revisar ciclo');await click('Confirmar inicio del ciclo');await until(`!!document.querySelector('.cycle-controls')`);
      await select('Trayectoria del escenario',strategy==='gamma'?'recovery':'up');await click('Completar escenario');await until(`!!document.querySelector('.cycle-result')`);
      assert(await evaluate(`document.querySelector('.cycle-empty-positions').textContent.includes('Todo cerrado')`),strategy+' positions flat');
      if(strategy==='gamma')assert(await evaluate(`document.querySelectorAll('.event-hedge').length>2`),'Dynamic hedges recorded');
      if(strategy==='pmcc')assert(await evaluate(`document.querySelectorAll('.event-assignment').length>0`),'PMCC assignment resolved');
    }
    await click('Nuevo ciclo');await select('Estrategia del ciclo','wheel');await click('Revisar ciclo');await click('Confirmar inicio del ciclo');await select('Trayectoria del escenario','down');await click('Completar escenario');await until(`document.querySelector('.cycle-result.loss')`);assert(await evaluate(`document.querySelector('.cycle-result strong').textContent.includes('-')`),'Loss is visible');
    assert.equal(await evaluate(`document.querySelectorAll('.cycle-list-item').length`),5);await screenshot('cycles-desktop.png',1440,1000);
    await reload();await until(`!!document.querySelector('.terminal-app[aria-busy="false"] .cycle-launch')`);await click('Simular ciclo');await until(`document.querySelectorAll('.cycle-list-item').length===5`);assert(await evaluate(`!!document.querySelector('.cycle-result.loss')`));
    await screenshot('cycles-mobile.png',390,844);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Cycles mobile fits');
    console.log('PASS: capital guard, review, complete Wheel assignment cycle +1200, all four strategy closures, PMCC assignment, dynamic hedges, loss scenario, persistence and mobile.');
  }else{
    await click('Generar oportunidades');await until(`document.querySelector('.generated-badge')`);
    await evaluate(`document.querySelector('.score-cell').click()`);await until(`!!document.querySelector('.analysis-evidence')`);assert(await evaluate(`document.querySelector('.analysis-config').textContent.includes('4.0%')`),'Original rate is auditable');await evaluate(`document.querySelector('.modal .icon-button').click()`);await delay(100);
    assert.equal(await evaluate(`document.querySelectorAll('.companies-table tbody tr').length`),14);
    assert(await evaluate(`(()=>{const a=Array.from(document.querySelectorAll('.score-cell strong')).map(e=>+e.textContent);return a.every((v,i)=>!i||a[i-1]>=v);})()`),'Scores descending');
    await click('Gamma ScalpingGestión dinámica de Delta');await click('Generar oportunidades');
    assert.equal(await evaluate(`document.querySelectorAll('.watchlists .watchlist').length`),4);
    await input('Buscar empresa','NVDA');assert.equal(await evaluate(`document.querySelectorAll('.companies-table tbody tr').length`),1);
    await input('Buscar empresa','NO_SUCH_COMPANY');assert(await evaluate(`!!document.querySelector('.empty-state')`));await input('Buscar empresa','');
    await click('Operar');await until(`!!document.querySelector('.ticket-dialog')`);
    await click('Revisar operación');await until(`document.querySelector('.ticket-review')`);
    await click('Confirmar simulación');await until(`!document.querySelector('.ticket-dialog')`);
    await evaluate(`document.querySelector('.side-nav button:nth-child(3)').click()`);await until(`!!document.querySelector('.order-table')`);
    assert.equal(await evaluate(`document.querySelectorAll('.order-table tbody tr').length`),1);
    await reload();await until(`document.querySelector('.side-nav button:nth-child(3) .count-badge')?.textContent==='1'`);
    await until(`document.querySelector('.terminal-app[aria-busy="false"]') && document.querySelectorAll('.watchlists .watchlist').length===4`);
    assert.equal(await evaluate(`document.querySelectorAll('.watchlists .watchlist').length`),4,'Generated lists persist');
    await click('Operar');await until(`!!document.querySelector('.ticket-dialog')`);await click('Vender');await click('PUT Derecho de venta');await click('Revisar operación');await click('Confirmar simulación');
    await evaluate(`document.querySelector('.side-nav button:nth-child(3)').click()`);await until(`document.querySelectorAll('.order-table tbody tr').length===2`);
    await click('Ventas');assert.equal(await evaluate(`document.querySelectorAll('.order-table tbody tr').length`),1);
    await evaluate(`document.querySelector('.side-nav button').click()`);await until(`!!document.querySelector('.generate-button')`);
    await input('Fecha de fin de operación','2026-01-01');await click('Generar oportunidades');assert(await evaluate(`!!document.querySelector('.form-error')`),'Invalid dates rejected');
    await input('Fecha de fin de operación','2026-12-11');
    await evaluate(`document.querySelector('.ranking-criteria').open=true`);
    await click('Limpiar');await click('Generar oportunidades');assert(await evaluate(`document.querySelector('.form-error').textContent.includes('Selecciona al menos un criterio del ranking con peso mayor que cero.')`),'No ranking criteria rejected');
    await click('Activar todos');await evaluate(`document.querySelector('.ranking-criteria').open=false`);await click('Generar oportunidades');
    await screenshot('generated-list.png',1440,1000);
    await screenshot('mobile.png',390,844);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Mobile fits');
    console.log('PASS: generation, ranking, strategy change, search, empty state, buy call, sell put, review confirmation, order filter, reload persistence, date validation, ranking criteria validation, mobile layout.');
    if(process.env.QA_PWA==='1'){
      await until(`!!navigator.serviceWorker.controller`);const manifest=await send('Page.getAppManifest');assert(manifest.url.endsWith('/manifest.webmanifest'));assert.equal(manifest.errors.length,0,'Manifest parses');
      const targets=await send('Target.getTargets');const worker=targets.targetInfos.find(t=>t.type==='service_worker'&&t.url===baseURL+'/sw.js');assert(worker,'Service worker target exists');const attached=await send('Target.attachToTarget',{targetId:worker.targetId,flatten:true});await send('Network.enable',{},attached.sessionId);await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},attached.sessionId);
      await send('Network.enable');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await send('Page.navigate',{url:baseURL+'/'});await until(`document.title.includes('Sin conexión')`);assert(await evaluate(`document.querySelector('h1').textContent.includes('conexión')`));await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},attached.sessionId);console.log('PASS: production PWA manifest, service-worker control and explicit offline fallback.');
    }
  }
  assert.deepEqual(errors,[],'No runtime exceptions');console.log('Runtime errors:',errors.length);
  await send('Browser.close').catch(()=>{});
}finally{ws?.close();chrome.kill();await delay(500);const resolved=path.resolve(profile);if(path.dirname(resolved)===path.resolve(tmpdir())&&path.basename(resolved).startsWith('tepic-qa-'))await rm(resolved,{recursive:true,force:true}).catch(()=>{});}

