import assert from 'node:assert/strict';

export function installRecommenderQA(){
  const original=window.fetch.bind(window);
  window.__recommenderQA={requests:[]};
  window.fetch=async(input,init)=>{
    const response=await original(input,init);
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
    if(url.pathname!=='/api/research/company'||!response.ok)return response;
    window.__recommenderQA.requests.push(Object.fromEntries(url.searchParams));
    const cutoff=url.searchParams.get('cutoff');if(!cutoff)return response;
    const body=await response.json(),research=body.research;
    research.asOf=cutoff;research.options.contracts=[];research.options.status.message='QA: sin cotizaciones de opciones históricas.';
    for(const variable of [research.macro.riskFreeRate,research.fundamentals.dividendYield]){variable.observedAt=cutoff;variable.availableAt=cutoff;variable.source='QA: entrada histórica conocida al corte';}
    return Response.json(body);
  };
}

export async function runRecommenderScenario({evaluate,click,input,until,screenshot}){
  const choose=async(label,value)=>evaluate('(()=>{const e=document.querySelector('+JSON.stringify('select[aria-label="'+label+'"]')+');e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("change",{bubbles:true}));})()');
  assert(await evaluate('!document.querySelector(".finviz-panel")&&!document.querySelector(".quick-strategy-comparison .observed-strategy-analysis")'),'Manual capture removed and comparison work deferred');
  await click('Recomendador');await until('!!document.querySelector(".strategy-recommender")');
  const requests=await evaluate('window.__recommenderQA.requests.length');
  for(const [strategy,title] of [['wheel','Wheel'],['pmcc','Poor'],['backspread','Backspread'],['gamma','Gamma']]){
    await choose('Estrategia del análisis',strategy);
    await until('document.querySelector(".strategy-recommender h2")?.textContent.includes('+JSON.stringify(title)+')');
    await until(`!!document.querySelector('.contract-recommendation[data-contract-strategy="${strategy}"] tbody tr')`);
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="Recomendador CC y CSP"]')`),false,'CC/CSP are absent for every strategy');
    const legs=await evaluate(`Array.from(document.querySelector('.contract-recommendation tbody').rows).map(row=>({action:row.cells[0].textContent,quantity:Number(row.cells[1].textContent),symbol:row.cells[2].textContent,type:row.cells[3].textContent,strike:row.cells[4].textContent,expiry:row.cells[5].textContent}))`);
    assert(legs.every(leg=>leg.symbol.startsWith('NVDA-')),'Actual contracts from the selected company');
    if(strategy==='wheel'){assert.deepEqual(legs.map(leg=>[leg.action,leg.quantity,leg.type]),[['Vender',1,'PUT']]);}
    if(strategy==='pmcc'){assert.deepEqual(legs.map(leg=>[leg.action,leg.quantity,leg.type]),[['Comprar',1,'CALL'],['Vender',1,'CALL']]);assert(legs[0].expiry>legs[1].expiry);}
    if(strategy==='backspread'){assert.deepEqual(legs.map(leg=>[leg.action,leg.quantity,leg.type]),[['Vender',1,'CALL'],['Comprar',2,'CALL']]);}
    if(strategy==='gamma'){assert.deepEqual(legs.map(leg=>[leg.action,leg.quantity,leg.type]),[['Comprar',1,'CALL'],['Comprar',1,'PUT']]);assert.equal(legs[0].strike,legs[1].strike);assert.equal(legs[0].expiry,legs[1].expiry);}
  }
  assert.equal(await evaluate('window.__recommenderQA.requests.length'),requests,'Strategy changes reuse the research snapshot');
  await choose('Estrategia del análisis','wheel');
  await choose('Orden de contratos recomendados','capital');
  await until(`!!document.querySelector('.contract-recommendation[data-contract-strategy="wheel"]')&&!document.querySelector('.strategy-recommender').textContent.includes('Buscando y comparando')`);
  const capital=await evaluate(`Array.from(document.querySelectorAll('.contract-recommendation')).map(card=>Number(Array.from(card.querySelectorAll('.contract-metrics span')).find(node=>node.textContent.includes('Capital requerido')).querySelector('b').textContent.replace(/[^0-9.-]/g,'')))`);
  assert(capital.every((value,i)=>!i||value>=capital[i-1]),'Contract combinations sort by actual capital');
  await evaluate('document.querySelector(".contract-recommendation").scrollIntoView()');
  await screenshot('contract-recommender-desktop.png',1440,1000);await screenshot('contract-recommender-mobile.png',390,844);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Contract tables fit within mobile');
  await click('Ver evaluación detallada');await until('!!document.querySelector(".observed-strategy-analysis .profitability-outlook")');
  assert(await evaluate('document.querySelector(".profitability-outlook").textContent.includes("validación")'),'Profitability retains validation evidence');
  assert(await evaluate('!document.querySelector(".finviz-panel")'),'Detailed evaluation has no manual Finviz flow');
  await screenshot('recommender-detail-desktop.png',1440,1000);
  await click('Simulación histórica');await until('!!document.querySelector(".historical-replay")');
  await click('Cargar fecha pasada');
  await until('window.__recommenderQA.requests.some(r=>r.cutoff)&&!document.querySelector(".historical-replay").textContent.includes("Consultando empresa")');
  assert(await evaluate('document.querySelectorAll(".historical-replay svg").length===1'),'Only historical state is visible before revealing outcomes');
  const original=await evaluate('document.querySelector(".replay-entry-summary").getAttribute("data-replay-entry-date")');
  const originalCandles=await evaluate('Array.from(document.querySelectorAll("[data-replay-candle]")).map(e=>[e.dataset.replayCandle,e.dataset.close])');
  await click('Línea');assert(await evaluate('!!document.querySelector("[data-replay-series=price]")'),'Line view renders actual closes');await click('Velas');
  await click('RSI');assert(await evaluate('!document.querySelector("[data-replay-series=rsi]")'),'RSI can be hidden');await click('RSI');
  const zoomInfo=()=>evaluate('(()=>{const e=document.querySelector("[data-chart-zoom=historical]");return {start:Number(e.dataset.visibleStart),end:Number(e.dataset.visibleEnd),total:Number(e.dataset.total)}})()');
  const zoomAction=label=>evaluate(`document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}).click()`);
  const beforeZoom=await zoomInfo();
  const pointBeforeZoom=await evaluate('document.querySelector(".replay-chart-point").dataset.replayChartPoint');
  await zoomAction('Acercar gráfica histórica');
  const enlarged=await zoomInfo();assert(enlarged.end-enlarged.start<beforeZoom.total,'Zoom enlarges a smaller set of original candles');
  assert.equal(await evaluate('document.querySelector(".replay-chart-point").dataset.replayChartPoint'),pointBeforeZoom,'Zoom preserves the inspected point');
  await zoomAction('Tramo anterior de gráfica histórica');
  assert((await zoomInfo()).start<enlarged.start,'Earlier periods can be explored without changing zoom');
  assert.equal(await evaluate('document.querySelector(".replay-chart-point").dataset.replayChartPoint'),pointBeforeZoom,'Panning preserves the selected observation');
  await evaluate('document.querySelector(".replay-chart svg[role=slider]").dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}))');
  const followed=await zoomInfo();assert.equal(followed.end,followed.total,'Keyboard selection reveals the point after panning');
  assert.equal(followed.end-followed.start,enlarged.end-enlarged.start,'Following the cursor preserves zoom');
  await zoomAction('Restablecer gráfica histórica');
  assert.deepEqual(await zoomInfo(),beforeZoom,'Reset restores the full viewport');
  const wheelResult=await evaluate('(()=>{const e=document.querySelector(".replay-chart svg[role=slider]"),r=e.getBoundingClientRect();const normal=new WheelEvent("wheel",{bubbles:true,cancelable:true,deltaY:-120,clientX:r.left+r.width/2,clientY:r.top+r.height/2});e.dispatchEvent(normal);const modified=new WheelEvent("wheel",{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-120,clientX:r.left+r.width/2,clientY:r.top+r.height/2});e.dispatchEvent(modified);return {normal:normal.defaultPrevented,modified:modified.defaultPrevented};})()');
  assert.deepEqual(wheelResult,{normal:false,modified:true},'Ctrl+wheel zooms without hijacking ordinary page scrolling');
  assert((await zoomInfo()).end-(await zoomInfo()).start<beforeZoom.total,'Wheel zoom changes the viewport');
  await zoomAction('Restablecer gráfica histórica');
  await evaluate('(()=>{const chart=document.querySelector(".replay-chart svg[role=slider]");chart.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}));})()');
  assert(await evaluate('document.querySelector(".replay-chart svg[role=slider]").getAttribute("aria-valuenow")!==document.querySelector(".replay-chart svg[role=slider]").getAttribute("aria-valuemax")'),'Keyboard selects a preceding close');
  await click('Calcular ejercicio teórico');
  await until('Array.from(document.querySelectorAll("button")).some(e=>e.textContent==="Revelar evolución posterior")');
  await click('Revelar evolución posterior');
  await until('document.querySelectorAll(".historical-replay svg").length===2');
  assert.equal(await evaluate('document.querySelector(".replay-entry-summary").getAttribute("data-replay-entry-date")'),original,'Revealing future preserves the entry date');
  const revealedCandles=await evaluate('Array.from(document.querySelectorAll("[data-replay-candle]")).map(e=>[e.dataset.replayCandle,e.dataset.close])');
  assert.deepEqual(revealedCandles.slice(0,originalCandles.length),originalCandles,'Revealing future preserves all preceding close values');
  assert(await evaluate('document.querySelector(".historical-replay").textContent.includes("P/L marcado")'));
  const finalPnl=await evaluate('document.querySelector(".replay-pnl-card .replay-price-heading").textContent');
  await zoomAction('Acercar gráfica de resultado');
  assert(await evaluate('(()=>{const e=document.querySelector("[data-chart-zoom=pnl]");return Number(e.dataset.visibleEnd)-Number(e.dataset.visibleStart)<Number(e.dataset.total)})()'),'P/L chart supports independent zoom');
  assert.equal(await evaluate('document.querySelector(".replay-pnl-card .replay-price-heading").textContent'),finalPnl,'P/L zoom preserves the complete exercise result');
  await zoomAction('Restablecer gráfica de resultado');
  const count=await evaluate('window.__recommenderQA.requests.length');
  await input('Strike del ejercicio histórico','95');
  assert.equal(await evaluate('window.__recommenderQA.requests.length'),count,'Editing a theoretical exercise does not refetch company data');
  await evaluate('document.querySelector(".historical-replay").scrollIntoView()');
  await screenshot('historical-replay-desktop.png',1440,1000);
  await screenshot('historical-replay-mobile.png',390,844);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Historical replay fits mobile');
  await evaluate('document.querySelector(".replay-chart").scrollIntoView()');
  await screenshot('historical-chart-desktop.png',1440,1100);
  await screenshot('historical-chart-mobile.png',390,844);
  await zoomAction('Acercar gráfica histórica');
  await screenshot('historical-chart-zoom-mobile.png',390,844);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Zoomed historical controls fit mobile');
  await zoomAction('Restablecer gráfica histórica');
  await evaluate('document.querySelector(".replay-pnl-card").scrollIntoView()');
  await screenshot('historical-pnl-desktop.png',1440,900);
  assert.deepEqual(await evaluate('window.__technicalQA.mutations'),[],'No external writes');
  console.log('PASS: real recommendation worker, actual contract combinations for four strategies with signed quantities/maturities, per-structure analysis, capital sorting, no CC/CSP or Finviz capture, detailed profitability, historical state/PnL, reusable research and mobile. QA provider data.');
}
