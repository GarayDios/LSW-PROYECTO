import {spawn} from 'node:child_process';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
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
  async function click(text){const clicked=await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)});if(e){e.click();return true;}return false;})()`);assert(clicked,'Missing button '+text);await delay(150);}
  async function input(label,value){assert(await evaluate(`(()=>{const e=document.querySelector('input[aria-label="'+${JSON.stringify(label)}+'"]');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`),'Missing input '+label);await delay(100);}
  async function screenshot(name,width,height){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await delay(400);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.resolve('outputs',name),Buffer.from(r.data,'base64'));}
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:baseURL+'/'});
  await until(`document.querySelector('.terminal-app[aria-busy="false"]') && document.querySelector('button.generate-button') && document.querySelector('.market-chart') && !document.querySelector('vite-error-overlay')`);
  await delay(1200);await mkdir('outputs',{recursive:true});
  if(mode==='screenshots'){
    await screenshot('desktop.png',1440,1000);await screenshot('mobile.png',390,844);
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'Mobile horizontal overflow');
    console.log('Screenshots saved. Mobile document fits viewport.');
  }else if(mode==='features'){
    assert.equal(await evaluate(`document.querySelectorAll('.core-option input').length`),7);
    assert.equal(await evaluate(`document.querySelectorAll('.core-chart-legend [data-core]').length`),7);
    assert.equal(await evaluate(`document.querySelectorAll('.strategy-comparison button').length`),4);
    assert.equal(await evaluate(`document.querySelectorAll('.top-opportunities button').length`),3);
    const initial=await evaluate(`document.querySelector('.top-opportunities').textContent`);
    await evaluate(`document.querySelectorAll('.strategy-comparison button')[3].click()`);await delay(150);
    assert.notEqual(await evaluate(`document.querySelector('.top-opportunities').textContent`),initial,'Strategy updates preview without generating');
    await evaluate(`document.querySelector('.top-opportunities button').click()`);await delay(150);
    assert.equal(await evaluate(`document.querySelector('select[aria-label="Empresa del gráfico"]').value`),await evaluate(`document.querySelector('.top-opportunities strong').firstChild.textContent.trim()`));
    await click('Limpiar');assert.equal(await evaluate(`document.querySelectorAll('.core-chart-legend [data-core]').length`),0);
    assert.equal(await evaluate(`document.querySelectorAll('.market-chart [data-indicator]').length`),0);
    for(const [index,id] of ['bsm','greeks','probability','volatility','trend','liquidity','risk'].entries()){
      await evaluate(`document.querySelectorAll('.core-option input')[${index}].click()`);await delay(100);
      assert(await evaluate(`!!document.querySelector('.core-chart-legend [data-core="${id}"]')`),id+' shown');
      assert.equal(await evaluate(`document.querySelectorAll('.core-chart-legend [data-core]').length`),1);
      if(id!=='liquidity')assert(await evaluate(`document.querySelectorAll('.market-chart [data-indicator]').length>0`),id+' affects SVG');
      await evaluate(`document.querySelectorAll('.core-option input')[${index}].click()`);await delay(100);
    }
    await click('Activar todos');
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
    console.log('PASS: seven independent core indicators, live four-strategy comparison, top companies select chart, true interval counts, weekend empty state, CSV export, generation and mobile layout.');
  }else if(mode==='cycles'){
    async function select(label,value){assert(await evaluate(`(()=>{const e=document.querySelector('select[aria-label="'+${JSON.stringify(label)}+'"]');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`));await delay(120);}
    await click('Simular ciclo');await until(`document.querySelector('.cycle-builder')`);
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
    await send('Page.reload');await until(`!!document.querySelector('.terminal-app[aria-busy="false"] .cycle-launch')`);await click('Simular ciclo');await until(`document.querySelectorAll('.cycle-list-item').length===5`);assert(await evaluate(`!!document.querySelector('.cycle-result.loss')`));
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
    await send('Page.reload');await until(`document.querySelector('.side-nav button:nth-child(3) .count-badge')?.textContent==='1'`);
    await until(`document.querySelector('.terminal-app[aria-busy="false"]') && document.querySelectorAll('.watchlists .watchlist').length===4`);
    assert.equal(await evaluate(`document.querySelectorAll('.watchlists .watchlist').length`),4,'Generated lists persist');
    await click('Operar');await until(`!!document.querySelector('.ticket-dialog')`);await click('Vender');await click('PUT Derecho de venta');await click('Revisar operación');await click('Confirmar simulación');
    await evaluate(`document.querySelector('.side-nav button:nth-child(3)').click()`);await until(`document.querySelectorAll('.order-table tbody tr').length===2`);
    await click('Ventas');assert.equal(await evaluate(`document.querySelectorAll('.order-table tbody tr').length`),1);
    await evaluate(`document.querySelector('.side-nav button').click()`);await until(`!!document.querySelector('.generate-button')`);
    await input('Fecha de fin de operación','2026-01-01');await click('Generar oportunidades');assert(await evaluate(`!!document.querySelector('.form-error')`),'Invalid dates rejected');
    await input('Fecha de fin de operación','2026-12-11');
    await evaluate(`document.querySelectorAll('.core-option input').forEach(e=>{if(e.checked)e.click()})`);await delay(100);await click('Generar oportunidades');assert(await evaluate(`document.querySelector('.form-error').textContent.includes('núcleo')`),'No cores rejected');
    await evaluate(`document.querySelectorAll('.core-option input').forEach(e=>{if(!e.checked)e.click()})`);await delay(100);await click('Generar oportunidades');
    await screenshot('generated-list.png',1440,1000);
    await screenshot('mobile.png',390,844);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Mobile fits');
    console.log('PASS: generation, ranking, strategy change, search, empty state, buy call, sell put, review confirmation, order filter, reload persistence, date validation, core validation, mobile layout.');
    if(process.env.QA_PWA==='1'){
      await until(`!!navigator.serviceWorker.controller`);const manifest=await send('Page.getAppManifest');assert(manifest.url.endsWith('/manifest.webmanifest'));assert.equal(manifest.errors.length,0,'Manifest parses');
      const targets=await send('Target.getTargets');const worker=targets.targetInfos.find(t=>t.type==='service_worker'&&t.url===baseURL+'/sw.js');assert(worker,'Service worker target exists');const attached=await send('Target.attachToTarget',{targetId:worker.targetId,flatten:true});await send('Network.enable',{},attached.sessionId);await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},attached.sessionId);
      await send('Network.enable');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await send('Page.navigate',{url:baseURL+'/'});await until(`document.title.includes('Sin conexión')`);assert(await evaluate(`document.querySelector('h1').textContent.includes('conexión')`));await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},attached.sessionId);console.log('PASS: production PWA manifest, service-worker control and explicit offline fallback.');
    }
  }
  assert.deepEqual(errors,[],'No runtime exceptions');console.log('Runtime errors:',errors.length);
  await send('Browser.close').catch(()=>{});
}finally{ws?.close();chrome.kill();await delay(500);const resolved=path.resolve(profile);if(path.dirname(resolved)===path.resolve(tmpdir())&&path.basename(resolved).startsWith('tepic-qa-'))await rm(resolved,{recursive:true,force:true}).catch(()=>{});}

