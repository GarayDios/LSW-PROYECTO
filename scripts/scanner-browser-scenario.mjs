import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { demoResearch } from '../src/features/research/demo-research.ts';
import { companies } from '../src/features/market/data.ts';

// All account/research requests are isolated fixtures. No provider credentials,
// broker mutations or remote persistence are used by this browser check.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const start = `${Number(today.slice(0,4))-3}${today.slice(4)}`;
const fixture = demoResearch(companies.find(c => c.symbol === 'NVDA'), start, today, 32, .04);
delete fixture.dataMode;fixture.quality.historicalOnly=false;fixture.asOf=new Date().toISOString();fixture.generatedAt=fixture.asOf;
const stamp = new Date(Date.parse(fixture.asOf) - 86400000).toISOString();
fixture.news = { articles: [{ id: 'qa-news', headline: 'QA Company beats earnings estimates and raises guidance', source: 'QA synthetic news', url: null, publishedAt: stamp, availableAt: stamp }], complete: false, status: { source: 'QA', status: 'partial', message: 'QA synthetic headlines' }, warnings: ['QA partial coverage'] };
function installQA(data) {
  const qa = window.__scannerQA = { negative: false, mutations: [], probes: [], authenticated: true, failDatabase: false };
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return original(input, init);
    if ((init?.method ?? 'GET') !== 'GET') { qa.mutations.push(url.pathname); return Response.json({ error: { message: 'QA: remote writes disabled' } }, { status: 409 }); }
    const s = structuredClone(data);
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
    if (url.pathname === '/api/webull') return Response.json({configured:false,connected:false,enabled:false,mode:'sandbox',message:'QA Webull not configured'});

    if (url.pathname === '/api/market/company') return Response.json({ symbol: s.symbol, name: 'QA synthetic company', exchange: 'NASDAQ', tradable: true, assetClass: 'us_equity' });
    if (url.pathname === '/api/market/history') return Response.json({ symbol: s.symbol, start: url.searchParams.get('start'), end: url.searchParams.get('end'), interval: '1d', source: 'alpaca', feed: 'iex', adjustment: 'split', asOf: s.asOf, bars: s.market.bars, warnings: ['QA synthetic candles'], coverage: {} });
    if (url.pathname === '/api/research/company') return Response.json({ research: s });
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
  const screenshot = async (name,width,height) => { await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await evaluate("document.querySelector('.chart-panel').scrollIntoView()");await delay(300);const result=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.resolve('outputs',name),Buffer.from(result.data,'base64')); };
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installQA.toString()})(${JSON.stringify(fixture)});`});
  await send('Page.navigate',{url:process.env.QA_URL || 'http://127.0.0.1:5173/'});
  await until(`document.querySelector('.terminal-app[aria-busy="false"]')&&document.querySelector('[data-core-projection]')&&document.querySelector('[data-news-marker]')`);
  assert.equal(await evaluate(`document.querySelectorAll('.scanner-cores input[type="checkbox"]').length`),7);
  assert(await evaluate(`document.querySelector('.scanner-result').textContent.includes('Cobertura parcial')||document.querySelector('.chart-news-details').textContent.includes('Cobertura parcial')`));
  const originalPath=await evaluate(`document.querySelector('[data-sentiment-projection]').getAttribute('d')`);
  await toggle('Noticias y earnings');
  assert.notEqual(await evaluate(`document.querySelector('[data-sentiment-projection]').getAttribute('d')`),originalPath);
  assert(await evaluate(`document.querySelector('.scanner-result').textContent.includes('+$0.00')`));
  await toggle('Noticias y earnings');
  assert.equal(await evaluate(`document.querySelectorAll('.scanner-cores input[type="number"]').length`),7,'Each core has a weight input');
  assert.equal(await evaluate(`document.querySelector('[data-sentiment-projection]').getAttribute('d')`),originalPath);
  await evaluate(`(()=>{const e=document.querySelector('input[aria-label="Peso de Noticias y earnings"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'8');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(`document.querySelector('input[aria-label="Peso de Noticias y earnings"]').value==='8'`);
  assert.notEqual(await evaluate(`document.querySelector('[data-sentiment-projection]').getAttribute('d')`),originalPath,'Weight changes the scenario');
  await evaluate(`document.querySelector('.finviz-panel details').open=true`);
  await evaluate(`(()=>{for(const [label,value] of [['Finviz Inst Trans','5'],['Finviz Profit Margin','18'],['Finviz ROE','22']]){const e=document.querySelector('input[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await click('Aplicar valores Finviz de NVDA');
  await until(`!!document.querySelector('.finviz-capture')&&Array.from(document.querySelectorAll('.scanner-core-row')).find(e=>e.textContent.includes('Flujo institucional'))?.textContent.includes('Puntuación')`);
  assert(await evaluate(`document.querySelector('.scanner-result').textContent.includes('Proxy Finviz')`),'Institutional participation proxy uses the imported data');
  await evaluate(`window.__scannerQA.negative=true`);await click('Actualizar variables');await click('Actualizar noticias');
  await until(`document.querySelector('[data-sentiment="negativo"]')&&document.querySelector('.scanner-result').textContent.includes('sentimiento negativo')`);
  await mkdir('outputs',{recursive:true});await screenshot('scanner-desktop.png',1440,1050);await screenshot('scanner-mobile.png',390,844);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Mobile fits');
  await click('Retirar captura');
  await click('Limpiar');await toggle('Flujo institucional');
  await until(`document.querySelector('.scanner-coverage').textContent.includes('no evaluable')&&!document.querySelector('[data-core-projection]')`);
  await click('Activar todos');
  await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Fuente del histórico"]');e.value='demo';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.scanner-result').textContent.includes('Demostración')`);
  await click('Generar oportunidades');
  await until(`document.querySelector('.ranking-status')?.textContent.includes('empresas evaluadas')`);
  assert(await evaluate(`JSON.parse(localStorage.getItem('tepic-terminal-v1')).lists.some(l=>l.config?.analysis?.scanner?.cores.news.enabled&&l.config.analysis.scanner.cores.news.weight===8)`),'Core weights persist with the saved scan');

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
  await click('Cadena de opciones');await until(`document.querySelector('.option-chain')&&document.querySelectorAll('.option-chain tbody tr').length>0`);
  await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Tipo de contrato de la cadena"]');e.value='put';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert(await evaluate(`Array.from(document.querySelectorAll('.option-chain tbody tr')).every(row=>row.children[1].textContent==='PUT')`));
  await click('Estrategias');await click('Recomendador CC / CSP');
  await until(`document.querySelector('[aria-label="Recomendador CC y CSP"] tbody tr')`);
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
  console.log('PASS: weighted cores, Finviz free-page manual input, institutional proxy, sentiment, PMCC, connections, account, options, history, mobile and zero remote writes.');
  await send('Browser.close').catch(()=>{});
} finally {
  ws?.close();chrome.kill();await delay(500);
  const resolved=path.resolve(profile);
  if(path.dirname(resolved)===path.resolve(tmpdir())&&path.basename(resolved).startsWith('tepic-scanner-qa-'))await rm(resolved,{recursive:true,force:true}).catch(()=>{});
}
