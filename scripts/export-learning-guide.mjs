import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const temp=process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA,'Temp','opencode') : root;
await mkdir(temp,{recursive:true});
const profile=await mkdtemp(path.join(temp,'tepic-guide-chrome-'));
const port=9344;
const chrome=spawn(process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
chrome.on('error',e=>console.error(e.message));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let ws,id=0;const pending=new Map();
try {
  let pages;
  for(let i=0;i<80;i++){try{pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(pages.some(p=>p.type==='page'))break;}catch{}await delay(150);}
  assert(pages?.some(p=>p.type==='page'),'Chrome did not start');
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  ws.addEventListener('message',e=>{const msg=JSON.parse(e.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);if(p)msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result);}});
  function send(method,params={}){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));setTimeout(()=>{if(pending.has(n)){pending.delete(n);reject(Error(`Timeout ${method}`));}},30000).unref();});}
  async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
  await send('Page.enable');
  await send('Page.navigate',{url:pathToFileURL(path.join(root,'docs','guia-pmcc-call-ratio-desde-cero.html')).href});
  for(let i=0;i<100;i++){if(await evaluate(`document.readyState==='complete' && document.querySelectorAll('.foot').length===16`))break;await delay(100);}
  await evaluate('document.fonts.ready.then(()=>true)');
  const checks=await evaluate(`Array.from(document.querySelectorAll('.page')).map((p,i)=>{const f=p.querySelector('.foot').getBoundingClientRect();const content=Array.from(p.children).filter(c=>!c.classList.contains('foot')).map(c=>c.getBoundingClientRect().bottom);return {page:i+1,overflow:p.scrollHeight>p.clientHeight+2,contentBottom:Math.max(...content),footerTop:f.top,clearance:Math.round(f.top-Math.max(...content))};})`);
  assert.equal(checks.length,16);
  assert.ok(checks.every(p=>!p.overflow&&p.clearance>=8),`Content overlaps a footer: ${JSON.stringify(checks)}`);
  await send('Emulation.setDeviceMetricsOverride',{width:920,height:1260,deviceScaleFactor:1,mobile:false});
  await mkdir(path.join(root,'outputs'),{recursive:true});
  const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(path.join(root,'outputs','guide-cover.png'),Buffer.from(screenshot.data,'base64'));
  const pdf=await send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});
  const destination=path.join(root,'docs','Guia-PMCC-Call-Ratio-Desde-Cero.pdf');
  await writeFile(destination,Buffer.from(pdf.data,'base64'));
  const buffer=await readFile(destination);
  assert.equal(buffer.subarray(0,5).toString(),'%PDF-');
  const pageCount=(buffer.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
  assert.equal(pageCount,16,'PDF page count');
  console.log(JSON.stringify({destination,bytes:buffer.length,pages:pageCount,minimumFooterClearancePx:Math.min(...checks.map(p=>p.clearance))},null,2));
  await send('Browser.close').catch(()=>{});
} finally {
  ws?.close();chrome.kill();await delay(400);
  if(path.dirname(profile)===path.resolve(temp)&&path.basename(profile).startsWith('tepic-guide-chrome-'))await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
