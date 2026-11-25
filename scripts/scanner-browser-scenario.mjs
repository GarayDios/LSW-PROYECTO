import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { demoResearch } from '../src/features/research/demo-research.ts';
import { companies } from '../src/features/market/data.ts';
import { normalizeCompanyDetails } from '../src/api/research/finnhub.ts';

// All account/research requests are isolated fixtures. No provider credentials,
// broker mutations or remote persistence are used by this browser check.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const start = `${Number(today.slice(0,4))-3}${today.slice(4)}`;
const fixture = demoResearch(companies.find(c => c.symbol === 'NVDA'), start, today, 32, .04);
delete fixture.dataMode;fixture.quality.historicalOnly=false;fixture.asOf=new Date().toISOString();fixture.generatedAt=fixture.asOf;
// The isolated current-data fixture must carry current option timestamps;
// synthetic end-of-day quotes otherwise become stale during after-hours runs.
for(const contract of fixture.options.contracts){for(const value of Object.values(contract))if(value&&typeof value==='object'&&'kind' in value&&value.kind!=='missing'){value.observedAt=fixture.asOf;value.availableAt=fixture.asOf;}contract.valuationExpiry.availableAt=fixture.asOf;}
const stamp = new Date(Date.parse(fixture.asOf) - 86400000).toISOString();
fixture.companyDetails=normalizeCompanyDetails(fixture.symbol,fixture.asOf,
  {symbol:fixture.symbol,metric:{netProfitMarginTTM:27.5,roeTTM:31,currentRatioQuarterly:2.1,peTTM:29.2,revenueGrowthTTMYoy:22.4}},
  {ticker:fixture.symbol,name:'QA corporate profile',finnhubIndustry:'Semiconductors',currency:'USD',weburl:'https://example.com'},
  [{symbol:fixture.symbol,period:today.slice(0,7)+'-01',strongBuy:10,buy:6,hold:2,sell:0,strongSell:0}]);
fixture.quality.sources.push(fixture.companyDetails.status);
fixture.institutional={status:{source:'QA SEC 13F fixture',status:'partial',message:'QA: 2/2 gestores comparables; muestra sintética.'},cusip:'67066G104',configured:2,comparable:2,direction:{value:.1,kind:'estimated',source:'QA SEC 13F fixture',observedAt:fixture.asOf,availableAt:fixture.asOf},managers:['Geode QA','State Street QA'].map((name,i)=>({cik:String(i+1),name,message:'QA comparison',direction:.1,change:.222222,splitFactor:1,previous:{period:'2026-06-30',shares:900,availableAt:stamp,accession:'qa-old-'+i,url:'https://www.sec.gov',amended:false},current:{period:'2026-09-30',shares:1100,availableAt:stamp,accession:'qa-new-'+i,url:'https://www.sec.gov',amended:i===1}})),warnings:['QA synthetic institutional sample, not live data.']};
fixture.news = { articles: [{ id: 'qa-news', headline: 'QA Company beats earnings estimates and raises guidance', source: 'QA synthetic news', url: null, publishedAt: stamp, availableAt: stamp }], complete: false, status: { source: 'QA', status: 'partial', message: 'QA synthetic headlines' }, warnings: ['QA partial coverage'] };
function installQA(data) {
  const qa = window.__scannerQA = { negative: false, institutional:false, webullPending:false, mutations: [], probes: [], authenticated: true, failDatabase: false };
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return original(input, init);
    if ((init?.method ?? 'GET') !== 'GET') { qa.mutations.push(url.pathname); return Response.json({ error: { message: 'QA: remote writes disabled' } }, { status: 409 }); }
    const s = structuredClone(data);
    if(!qa.institutional)delete s.institutional;
    if (qa.negative) s.news.articles[0].headline = 'QA Company misses earnings estimates and cuts guidance';
    if (url.pathname === '/api/persistence') return Response.json({ mode: 'local' });
    if (url.pathname === '/api/connections') {
      const probe=url.searchParams.get('probe');if(probe)qa.probes.push(probe);
      return Response.json({identity:qa.authenticated?{displayName:'QA fixture user',authenticated:true}:null,connections:[
        ...['supabase','mongodb'].map(id=>({id,title:id==='supabase'?'PostgreSQL / Supabase':'MongoDB',category:'database',status:!qa.authenticated?'auth_required':probe===id?(qa.failDatabase?'error':'ready'):'configured',message:probe===id?'QA database read checked':'QA configured database',capabilities:['Lists','Cycles'],setup:['QA server configuration']})),
        ...['alpaca','webull'].map(id=>({id,title:id==='alpaca'?'Alpaca Paper':'Webull Sandbox',category:'broker',status:qa.authenticated?'configured':'auth_required',message:'QA configured broker',capabilities:['Stocks','Options'],setup:['QA credentials']})),
        {id:'sec',title:'SEC EDGAR',category:'data',status:'configured',message:'QA fundamentals',capabilities:['Fundamentals'],setup:['SEC_USER_AGENT']},
        {id:'institutional',title:'Institutional flow',category:'data',status:'missing_config',message:'No feed',capabilities:['Net flow'],setup:['Provider required']},
      ]});
    }
    if (url.pathname === '/api/broker/account') return qa.authenticated?Response.json({account:{status:'ACTIVE',cash:'20000',equity:'25000',buyingPower:'40000',currency:'USD',mode:'paper'}}):Response.json({error:{message:'QA sign in required'}},{status:401});
    if (url.pathname === '/api/webull') {
      const action=url.searchParams.get('action');
      if(action==='market-history')return Response.json({symbol:url.searchParams.get('symbol'),start:url.searchParams.get('start'),end:url.searchParams.get('end'),interval:'1d',source:'webull',feed:'sandbox',adjustment:'unverified',asOf:s.asOf,bars:s.market.bars,warnings:['QA Webull sandbox history; adjustment unverified'],coverage:{}});
      if(action==='market-options')return Response.json({...s.options,contracts:s.options.contracts.map(c=>({...c,style:'american',symbol:c.underlyingSymbol+c.expiration.slice(2).replaceAll('-','')+c.type[0].toUpperCase()+String(Math.round(c.strike.value*1000)).padStart(8,'0')})),feed:'webull-sandbox',status:{source:'QA Webull Sandbox',status:'partial',message:'QA Webull contracts loaded'}});
      const order={reference:'qa-webull-existing',symbol:'NVDA',type:'EQUITY',side:'BUY',quantity:2,filled:0,limitPrice:95,state:'SUBMITTED',createdAt:s.asOf,legs:[]};
      if(action==='orders')return Response.json({orders:[{...order,reference:'qa-webull-history',state:'FILLED'}],next:null});
      const section=data=>({available:true,data,complete:true,next:null,message:'QA sandbox read'});
      const portfolio={asOf:s.asOf,mode:'sandbox',balances:section({currency:'USD',cash:15000,settledCash:14000,unsettledCash:1000,equity:25000,marketValue:10000,buyingPower:15000,optionBuyingPower:14000,unrealizedPnl:100}),positions:section([{symbol:'NVDA',type:'EQUITY',quantity:100,availableQuantity:100,averagePrice:95,marketValue:10000,unrealizedPnl:500}]),openOrders:section([order]),history:section([{...order,reference:'qa-webull-filled',state:'FILLED',filled:2}])};
      return Response.json({configured:true,connected:!qa.webullPending,enabled:false,mode:'sandbox',region:'us',operations:[],authentication:{status:qa.webullPending?'pending':'ready',expiresAt:null},account:qa.webullPending?null:{maskedId:'…2M5A',maskedNumber:null,type:'CASH',label:'QA sandbox account'},message:qa.webullPending?'QA: verifica desde la app Webull':undefined,...(action==='account'?{portfolio}:{})});
    }

    if (url.pathname === '/api/market/company') return Response.json({ symbol: s.symbol, name: 'QA synthetic company', exchange: 'NASDAQ', tradable: true, assetClass: 'us_equity' });
    if (url.pathname === '/api/market/history') return Response.json({ symbol: s.symbol, start: url.searchParams.get('start'), end: url.searchParams.get('end'), interval: '1d', source: 'alpaca', feed: 'iex', adjustment: 'split', asOf: s.asOf, bars: s.market.bars, warnings: ['QA synthetic candles'], coverage: {} });
    if (url.pathname === '/api/research/company') {if(url.searchParams.get('provider')==='webull'){s.dataMode='sandbox';s.options.feed='webull-sandbox';}return Response.json({research:s});}
    if (url.pathname === '/api/research/news') return Response.json({ symbol: s.symbol, start: url.searchParams.get('start'), end: url.searchParams.get('end'), asOf: s.asOf, news: s.news, nextPageToken: null });
    if (url.pathname === '/api/broker/status') return Response.json({ alpaca: { configured: false, ownerAuthorized: false, mode: 'paper' }, webull: { supported: false }, identity: null });
    return Response.json({ configured: false, enabled: false, available: false, plans: [], executions: [], positions: [], events: [] });
  };
}
const profile = await mkdtemp(path.join(tmpdir(), 'tepic-scanner-qa-'));
const chrome = spawn(process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9334', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws, id = 0;
const pending = new Map(), errors = [];
try {
  let pages;
  for (let i = 0; i < 60; i++) { try { pages = await (await fetch('http://127.0.0.1:9334/json/list')).json(); if (pages.some(p => p.type === 'page')) break; } catch { /* Wait for Chrome. */ } await delay(250); }
  ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true}); });
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { const task = pending.get(message.id); if (task) { pending.delete(message.id); if (message.error) task.reject(Error(JSON.stringify(message.error))); else task.resolve(message.result); } } if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); });
  const send = (method,params={}) => new Promise((resolve,reject) => { const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));setTimeout(()=>{if(pending.has(n)){pending.delete(n);reject(Error('CDP timeout '+method));}},45000).unref(); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value; };
  const until = async expression => { for(let i=0;i<160;i++){if(await evaluate(`Boolean(${expression})`))return;await delay(250);}throw Error('Timed out: '+expression+'; errors: '+JSON.stringify(errors)+'; page: '+await evaluate('document.body.innerText.slice(0,1800)')); };
  const click = async label => { assert(await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(label)});e?.click();return !!e;})()`),'Missing button '+label);await delay(120); };
  const toggle = async label => { assert(await evaluate(`(()=>{const e=document.querySelector('input[type="checkbox"][aria-label="'+${JSON.stringify(label)}+'"]');e?.click();return !!e;})()`));await delay(120); };
  const screenshot = async (name,width,height,target='.chart-panel') => { await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await evaluate(`document.querySelector(${JSON.stringify(target)}).scrollIntoView()`);await delay(300);const result=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.resolve('outputs',name),Buffer.from(result.data,'base64')); };
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installQA.toString()})(${JSON.stringify(fixture)});`});
  await send('Page.navigate',{url:process.env.QA_URL || 'http://127.0.0.1:5173/'});
  await until(`document.querySelector('.terminal-app[aria-busy="false"]')&&document.querySelector('[data-core-projection]')&&document.querySelector('[data-news-marker]')`);
  assert.equal(await evaluate(`document.querySelectorAll('.scanner-cores input[type="checkbox"]').length`),7);
  await until(`document.querySelector('.company-details')?.textContent.includes('QA corporate profile')`);
  await evaluate(`(()=>{for(let e=document.querySelector('.company-details').parentElement;e;e=e.parentElement)if(e.tagName==='DETAILS')e.open=true;})()`);
  assert(await evaluate(`document.querySelector('.company-details').textContent.includes('27.50%')&&document.querySelector('.company-details').textContent.includes('29.2')`),'Automatic corporate data are rendered as actual metrics');
  assert(await evaluate(`document.querySelector('.scanner-result').textContent.includes('Finnhub')`),'The fundamental core actually consumes automatic metrics');
  await evaluate(`(()=>{const e=document.querySelector('input[type="search"][placeholder="Margen, P/E, crecimiento…"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'crecimiento');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(`document.querySelector('.company-details .research-grid')?.textContent.includes('22.40%')`);
  assert(await evaluate(`!document.querySelector('.company-details .research-grid').textContent.includes('27.50%')`),'Corporate metric filtering works');
  await evaluate(`(()=>{const e=document.querySelector('.company-metrics-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await mkdir('outputs',{recursive:true});
  await screenshot('company-details-desktop.png',1440,1050,'.company-details');
  await screenshot('company-details-mobile.png',390,844,'.company-details');
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Corporate metrics fit mobile');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  assert(await evaluate(`document.querySelector('.scanner-result').textContent.includes('Cobertura parcial')||document.querySelector('.chart-news-details').textContent.includes('Cobertura parcial')`));
  const originalPath=await evaluate(`document.querySelector('[data-sentiment-projection]').getAttribute('d')`);
  await toggle('Noticias y earnings');
  assert.notEqual(await evaluate(`document.querySelector('[data-sentiment-projection]').getAttribute('d')`),originalPath);
  assert(await evaluate(`document.querySelector('.scanner-result').textContent.includes('+$0.00')`));
  await toggle('Noticias y earnings');
  assert.equal(await evaluate(`document.querySelectorAll('.scanner-core-weight input[type="number"]').length`),7,'Each core has a weight input');
  await evaluate(`document.querySelector('.scanner-mc-controls').open=true`);
  await evaluate(`(()=>{const e=document.querySelector('input[aria-label="Semilla del core Monte Carlo"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'42');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(`document.querySelector('.scanner-result').textContent.includes('semilla 42')`);
  await evaluate(`(()=>{const p=document.querySelector('select[aria-label="Trayectorias del core Monte Carlo"]');p.value='500';p.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('select[aria-label="Trayectorias del core Monte Carlo"]').value==='500'`);
  assert.equal(await evaluate(`document.querySelector('[data-sentiment-projection]').getAttribute('d')`),originalPath);
  await evaluate(`(()=>{const e=document.querySelector('input[aria-label="Peso de Noticias y earnings"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'8');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(`document.querySelector('input[aria-label="Peso de Noticias y earnings"]').value==='8'`);
  assert.notEqual(await evaluate(`document.querySelector('[data-sentiment-projection]').getAttribute('d')`),originalPath,'Weight changes the scenario');
  assert(await evaluate(`!document.querySelector('.finviz-panel')&&!document.querySelector('[aria-label="Archivo Finviz CSV"]')`),'Manual Finviz capture has been removed');
  await evaluate(`window.__scannerQA.negative=true`);await click('Actualizar variables');await click('Actualizar noticias');
  await until(`document.querySelector('[data-sentiment="negativo"]')&&document.querySelector('.scanner-result').textContent.includes('sentimiento negativo')`);
  await mkdir('outputs',{recursive:true});await screenshot('scanner-desktop.png',1440,1050);await screenshot('scanner-mobile.png',390,844);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Mobile fits');
  const beforeInstitutional=await evaluate(`document.querySelector('[data-sentiment-projection]').getAttribute('d')`);
  await evaluate(`window.__scannerQA.institutional=true`);await click('Actualizar variables');
  await until(`document.querySelector('.scanner-result')?.textContent.includes('Participación SEC 13F')&&document.querySelector('.institutional-research')?.textContent.includes('Geode QA')`);
  assert.notEqual(await evaluate(`document.querySelector('[data-sentiment-projection]').getAttribute('d')`),beforeInstitutional,'SEC 13F participation actually affects the chart scenario');
  assert(await evaluate(`document.querySelector('.institutional-research').textContent.includes('22.22%')&&document.querySelector('.institutional-research').textContent.includes('enmienda de reemplazo')`),'13F sample dates, changes and restatements are visible');
  await screenshot('institutional-mobile.png',390,844,'.institutional-research');
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Institutional panel fits mobile');
  await evaluate(`window.__scannerQA.institutional=false`);await click('Actualizar variables');
  await until(`document.querySelector('.scanner-result')&&!document.querySelector('.scanner-result').textContent.includes('Participación SEC 13F')`);
  await click('Limpiar');await toggle('Flujo institucional');
  await until(`document.querySelector('.scanner-coverage').textContent.includes('no evaluable')&&!document.querySelector('[data-core-projection]')`);
  await click('Activar todos');
  await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Fuente del histórico"]');e.value='demo';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.scanner-result').textContent.includes('Demostración')`);
  for(const [label,value] of [['Universo del escaneo','technology'],['Máximo de resultados del escaneo','5'],['Orden del escaneo','pop']]){await evaluate(`(()=>{const e=document.querySelector('select[aria-label="'+${JSON.stringify(label)}+'"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await delay(150);}
  await until(`document.querySelector('.scanner-universe').textContent.includes('6 activos')`);
  await click('Generar oportunidades');
  await until(`document.querySelector('.ranking-status')?.textContent.includes('empresas evaluadas')`);
  assert(await evaluate(`JSON.parse(localStorage.getItem('tepic-terminal-v1')).lists.some(l=>l.config?.analysis?.scanner?.cores.news.enabled&&l.config.analysis.scanner.cores.news.weight===8)`),'Core weights persist with the saved scan');
  assert(await evaluate(`JSON.parse(localStorage.getItem('tepic-terminal-v1')).lists.some(l=>l.symbols.length===5&&l.config?.analysis?.scanner?.scan.universe==='technology'&&l.config.analysis.scanner.scan.order==='pop'&&l.config.analysis.scanner.monteCarlo.seed===42)`),'Universe, result limit and seed are actually used and saved');

  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await click('Conexiones');await until(`document.querySelector('[aria-label="Bases de datos"]')`);
  await evaluate(`document.querySelector('.connections-page').scrollIntoView();window.scrollBy(0,-80)`);
  await evaluate(`Array.from(document.querySelectorAll('.connection-card')).find(e=>e.textContent.includes('PostgreSQL / Supabase')).querySelector('button').click()`);
  await until(`window.__scannerQA.probes.includes('supabase')&&document.querySelector('.connections-page').textContent.includes('Lectura verificada')`);
  const desktop=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.resolve('outputs','connections-desktop.png'),Buffer.from(desktop.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('.connections-page').scrollIntoView();window.scrollBy(0,-80)`);await delay(300);
  const mobile=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.resolve('outputs','connections-mobile.png'),Buffer.from(mobile.data,'base64'));
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Connections mobile fits');
  await click('Mi cuenta');await until(`document.querySelector('.account-overview')?.textContent.includes('$20,000.00')`);
  assert(await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('Brókers · órdenes manuales'));e?.click();return !!e;})()`));
  await click('Webull pruebas · acciones y opciones');
  await until(`document.querySelector('[aria-label="Órdenes manuales Webull"]')?.textContent.includes('Cuenta OpenAPI verificada')`);
  assert(await evaluate(`document.querySelector('[aria-label="Órdenes manuales Webull"]').textContent.includes('2M5A')&&document.querySelector('[aria-label="Órdenes manuales Webull"]').textContent.includes('Región US')`),'Verified masked Webull test account and region are visible');
  await evaluate(`window.__scannerQA.webullPending=true`);await click('Consultar conexión Webull');
  await until(`document.querySelector('[aria-label="Órdenes manuales Webull"]')?.textContent.includes('Verificación pendiente')`);
  assert(await evaluate(`document.querySelector('[aria-label="Órdenes manuales Webull"] fieldset').disabled`),'Pending authentication cannot prepare orders');
  await evaluate(`window.__scannerQA.webullPending=false`);await click('Consultar conexión Webull');
  await until(`document.querySelector('[aria-label="Órdenes manuales Webull"]')?.textContent.includes('Cuenta OpenAPI verificada')`);
  await until(`document.querySelector('[aria-label="Cuenta y actividad Webull"]')?.textContent.includes('$15,000.00')`);
  await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Empresa para órdenes manuales"]');e.value='NVDA';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('[aria-label="Órdenes manuales Webull"] fieldset')&&!document.querySelector('[aria-label="Órdenes manuales Webull"] fieldset').disabled`);
  await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Instrumento Webull"]');e.value='options';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('Cargar contratos Webull');await until(`document.querySelector('select[aria-label="Contrato Webull pata 1"]').options.length>1`);
  await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Estrategia Webull"]');e.value='DIAGONAL';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert(await evaluate(`!!document.querySelector('select[aria-label="Contrato Webull pata 2"]')`),'Webull PMCC offers two verified contract selectors');
  await click('Gestionar orden');await until(`!!document.querySelector('select[aria-label="Gestión de orden Webull"]')`);
  await click('Cerrar gestión');
  await screenshot('webull-mobile.png',390,844,'[aria-label="Órdenes manuales Webull"]');
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Webull mobile fits');
  await click('Screener');
  await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Fuente del histórico"]');e.value='webull';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.market-source-controls').textContent.includes('SANDBOX')&&document.querySelector('.market-chart')?.textContent.includes('Webull Sandbox')`);
  assert(await evaluate(`document.querySelector('.chart-sim-label').textContent.includes('WEBULL SANDBOX')`),'Chart labels the Webull source');
  await click('Mi cuenta');await until(`document.querySelector('.account-overview')?.textContent.includes('$15,000.00')`);
  await click('Órdenes');await until(`document.querySelector('[aria-label="Cuenta y actividad Webull"]')?.textContent.includes('qa-webull-existing')`);
  await click('Filtrar historial Webull');await until(`document.querySelector('[aria-label="Cuenta y actividad Webull"]').textContent.includes('qa-webull-history')`);
  await click('Cadena de opciones');await until(`document.querySelector('.option-chain')&&document.querySelectorAll('.option-chain tbody tr').length>0`);
  await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Tipo de contrato de la cadena"]');e.value='put';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert(await evaluate(`Array.from(document.querySelectorAll('.option-chain tbody tr')).every(row=>row.children[1].textContent==='PUT')`));
  await click('Estrategias');await click('Recomendador');
  await until(`document.querySelector('.contract-recommendation tbody tr')`);
  await click('Screener');
  await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Empresa del gráfico"]');e.value='NVDA';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await evaluate(`Array.from(document.querySelectorAll('.strategy-option')).find(e=>e.textContent.includes('Poor')).click()`);
  await click('Simulación histórica');await until(`document.querySelector('.monte-carlo-panel')`);
  await evaluate(`document.querySelector('.monte-carlo-panel').open=true`);
  assert(await evaluate(`document.querySelector('.monte-carlo-panel').textContent.includes('PMCC')`),'PMCC scenario is available');
  await evaluate(`(()=>{const e=document.querySelector('input[aria-label="Trayectorias Monte Carlo"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'500');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('Simular Monte Carlo');await until(`document.querySelector('.mc-results')?.textContent.includes('PMCC')`);

  await click('Evaluación detallada');await until(`document.querySelector('[aria-label="Comparación de estrategias por empresa"]')`);
  await click('Conexiones');await evaluate(`window.__scannerQA.authenticated=false`);await click('Actualizar conexiones');
  await until(`document.querySelector('.connection-session')?.textContent.includes('Inicia sesión')`);
  assert(await evaluate(`Array.from(document.querySelectorAll('.connection-card')).filter(e=>e.textContent.includes('PostgreSQL / Supabase')||e.textContent.includes('MongoDB')).every(e=>Array.from(e.querySelectorAll('button')).every(b=>b.disabled))`),'Unauthenticated database actions stay disabled');
  assert.deepEqual(await evaluate('window.__scannerQA.mutations'),[],'No remote mutation');
  assert.deepEqual(errors,[],'No runtime errors');
  console.log('PASS: corporate data, SEC 13F, seed, universe, weighted cores, sentiment, PMCC, Webull verified/pending auth, connections, account, options, history, mobile and zero remote writes.');
  await send('Browser.close').catch(()=>{});
} finally {
  ws?.close();chrome.kill();await delay(500);
  const resolved=path.resolve(profile);
  if(path.dirname(resolved)===path.resolve(tmpdir())&&path.basename(resolved).startsWith('tepic-scanner-qa-'))await rm(resolved,{recursive:true,force:true}).catch(()=>{});
}
