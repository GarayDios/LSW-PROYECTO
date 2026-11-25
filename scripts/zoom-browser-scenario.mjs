import assert from 'node:assert/strict';

export async function runZoomScenario({evaluate,until,screenshot}){
  await until(`document.querySelector('[data-chart-zoom=market]')&&document.querySelector('.chart-technical-status')`);
  const info=()=>evaluate(`(()=>{const e=document.querySelector('[data-chart-zoom=market]');return {start:Number(e.dataset.visibleStart),end:Number(e.dataset.visibleEnd),total:Number(e.dataset.total)}})()`);
  const action=label=>evaluate(`document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}).click()`);
  const signals=`Array.from(document.querySelectorAll('.chart-price-surface [data-signal]')).map(e=>[e.dataset.signalTime,e.dataset.signal,e.querySelector('title').textContent])`;
  const initial=await info(),signalSnapshot=await evaluate(signals);
  const metrics=await evaluate(`document.querySelector('.chart-technical-status').textContent`);
  const loaded=await evaluate(`document.querySelector('.history-summary span').textContent`);
  await action('Acercar gráfica de mercado');
  const enlarged=await info();assert(enlarged.end-enlarged.start<initial.total,'Market zoom narrows the time range');
  assert.equal(await evaluate(`document.querySelector('.chart-technical-status').textContent`),metrics,'Zoom never refits full-history indicators');
  assert.equal(await evaluate(`document.querySelector('.history-summary span').textContent`),loaded,'Zoom preserves all loaded data');
  await action('Tramo anterior de gráfica de mercado');
  assert((await info()).start<enlarged.start,'Market view can pan to an earlier period');
  await action('Alejar gráfica de mercado');
  const widened=await info();assert(widened.end-widened.start>enlarged.end-enlarged.start,'Zoom out expands the visible range');
  await action('Restablecer gráfica de mercado');assert.deepEqual(await info(),initial);
  assert.deepEqual(await evaluate(signals),signalSnapshot,'Reset restores the original signals and their reasons');
  const wheel=await evaluate(`(()=>{const svg=document.querySelector('.chart-price-surface svg'),r=svg.getBoundingClientRect();const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-120,clientX:r.left+r.width/2,clientY:r.top+r.height/2});svg.dispatchEvent(event);return event.defaultPrevented})()`);
  assert(wheel,'Ctrl+wheel zoom prevents browser-wide zoom');
  assert((await info()).end-(await info()).start<initial.total,'Ctrl+wheel changes the chart viewport');
  await evaluate(`window.__zoomAnchor=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__zoomExport=this.href}`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Exportar velas CSV').click()`);
  const rows=await evaluate(`fetch(window.__zoomExport).then(r=>r.text()).then(text=>text.split(String.fromCharCode(13,10)).length-1)`);
  await evaluate(`HTMLAnchorElement.prototype.click=window.__zoomAnchor`);
  assert.equal(rows,initial.total,'Zoomed CSV exports every original candle');
  await screenshot('technical-zoom-desktop.png',1440,1250);
  await screenshot('technical-zoom-mobile.png',390,1000);
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),'Zoom and pan controls fit mobile');
  assert(await evaluate(`(()=>{const surface=document.querySelector('.chart-price-surface'),price=surface.querySelector('svg').getBoundingClientRect(),indicators=surface.querySelector('.technical-indicator-panels').getBoundingClientRect();return Math.abs(price.x-indicators.x)<=1&&Math.abs(price.width-indicators.width)<=1})()`),'Zoomed price and indicator panels stay aligned');
  await action('Restablecer gráfica de mercado');assert.deepEqual(await info(),initial);
  assert.deepEqual(await evaluate('window.__technicalQA.mutations'),[],'Zoom never places orders or writes external state');
  console.log('PASS: market zoom in/out, pan, Ctrl+wheel, reset, unchanged full-history indicators and CSV, mobile and panel alignment. Provider fixtures only.');
}
