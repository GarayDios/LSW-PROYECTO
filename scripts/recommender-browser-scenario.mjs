import assert from 'node:assert/strict';

export function installRecommenderQA(){
  const original=window.fetch.bind(window);
  const qa=window.__recommenderQA={requests:[],research:null,brokerRequests:[],mutations:[],missingSymbol:null};
  window.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
    if(url.origin===location.origin&&['/api/f5','/api/webull-f5'].includes(url.pathname)){
      const broker=url.pathname==='/api/f5'?'alpaca':'webull',feed=broker==='alpaca'?'opra':'webull-sandbox';
      qa.brokerRequests.push({broker,...Object.fromEntries(url.searchParams)});
      if((init?.method??'GET')!=='GET'){qa.mutations.push(JSON.parse(init.body));return Response.json({error:'QA: envío no permitido'},{status:400});}
      if(url.searchParams.get('resource')==='contracts')return Response.json({complete:true,feed,contracts:(qa.research?.options.contracts??[]).filter(c=>c.expiration===url.searchParams.get('expiry')&&c.symbol!==qa.missingSymbol).map(c=>({symbol:c.symbol,underlying:c.underlyingSymbol,expiry:c.expiration,type:c.type,strike:c.strike.value,size:100,tradable:true,style:c.style,bid:c.bid.value,ask:c.ask.value,quoteTime:c.bid.observedAt,delta:c.delta.value}))});
      return Response.json({configured:true,enabled:true,marketOpen:true,mode:broker==='alpaca'?'paper':'sandbox',feed,account:{status:'ACTIVE',cash:80000,buyingPower:80000,optionsBuyingPower:80000,equity:80000,optionsLevel:3,blocked:false},operations:[],positions:[],activities:[]});
    }
    const response=await original(input,init);
    if(url.pathname!=='/api/research/company'||!response.ok)return response;
    window.__recommenderQA.requests.push(Object.fromEntries(url.searchParams));
    const body=await response.json(),research=body.research;
    for(const c of research.options.contracts)c.style='american';
    qa.research=research;
    const cutoff=url.searchParams.get('cutoff');if(!cutoff)return Response.json(body);
    research.asOf=cutoff;research.options.contracts=[];research.options.status.message='QA: sin cotizaciones de opciones históricas.';
    for(const variable of [research.macro.riskFreeRate,research.fundamentals.dividendYield]){variable.observedAt=cutoff;variable.availableAt=cutoff;variable.source='QA: entrada histórica conocida al corte';}
    return Response.json(body);
  };
}

export async function runRecommenderScenario({evaluate,click,input,until,screenshot}){
  const choose=async(label,value)=>evaluate('(()=>{const e=document.querySelector('+JSON.stringify('select[aria-label="'+label+'"]')+');e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("change",{bubbles:true}));})()');
  assert(await evaluate('!document.querySelector(".finviz-panel")&&!document.querySelector(".quick-strategy-comparison .observed-strategy-analysis")'),'Manual capture removed and comparison work deferred');
  const past=new Date();past.setUTCDate(past.getUTCDate()-16);
  await input('Fin de histórico de velas',past.toISOString().slice(0,10));
  await click('Recomendador');await until('!!document.querySelector(".strategy-recommender")');
  await until(`document.querySelector('.recommender-source-status').textContent.includes('Corte histórico')&&document.querySelector('.recommender-empty')`);
  assert(await evaluate(`document.querySelector('.recommender-source-status').textContent.includes('no reconstruyen cotizaciones históricas')`),'Historical chain blocker explains how to recover');
  await click('Consultar contratos actuales');
  await until(`document.querySelector('.recommender-source-status').textContent.includes('Consulta actual')&&document.querySelector('.contract-recommendation')`);
  assert(await evaluate(`window.__recommenderQA.requests.at(-1).cutoff===undefined`),'Current-data action clears the historical cutoff');
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
  for(const provider of ['alpaca','webull']){
    await choose('Fuente del análisis',provider);
    for(const strategy of ['wheel','pmcc','backspread','gamma']){
      await choose('Estrategia del análisis',strategy);
      await until(`!!document.querySelector('.contract-recommendation[data-contract-strategy="${strategy}"]')&&!document.querySelector('.strategy-recommender').textContent.includes('Buscando y comparando')&&!document.querySelector('.recommender-source-status').textContent.includes('Consultando la cadena')`);
      const expected=await evaluate(`(()=>{const cards=document.querySelectorAll('.contract-recommendation'),card=cards[Math.min(1,cards.length-1)];return {id:card.dataset.contractId,legs:Array.from(card.querySelectorAll('tbody tr')).map(row=>({symbol:row.cells[2].textContent,expiry:row.cells[5].textContent}))};})()`);
      // Open a specific proposal, including alternatives beyond the first recommendation.
      await evaluate(`Array.from(document.querySelectorAll('.contract-recommendation')).find(card=>card.dataset.contractId===${JSON.stringify(expected.id)}).querySelector('.recommender-next-step button').click()`);
      await until(`document.querySelector('.f5-recommendation')?.textContent.includes('Contratos recomendados seleccionados')`);
      const ticket=await evaluate(`({symbols:Array.from(document.querySelectorAll('.f5-legs-grid select')).map(e=>e.value),quantity:document.querySelector('[aria-label="Unidades F5"]').value,expiry:document.querySelector('[aria-label="Vencimiento F5"]').value,longExpiry:document.querySelector('[aria-label="Vencimiento largo F5"]')?.value,budget:document.querySelector('[aria-label="Capital máximo F5"]').value,limit:document.querySelector('[aria-label="Precio límite F5"]').value,enabled:document.querySelector('.manual-toggle input[type=checkbox]').checked})`);
      assert.deepEqual(ticket.symbols,expected.legs.map(leg=>leg.symbol),`${provider}/${strategy}: exact recommended contracts selected`);
      assert.equal(ticket.expiry,expected.legs[strategy==='pmcc'?1:0].expiry);
      if(strategy==='pmcc')assert.equal(ticket.longExpiry,expected.legs[0].expiry);
      assert.equal(ticket.quantity,'1');assert.equal(ticket.budget,'20000');assert.equal(ticket.limit,'');assert.equal(ticket.enabled,false);
      assert(await evaluate(`window.__recommenderQA.brokerRequests.some(r=>r.broker===${JSON.stringify(provider)}&&r.resource==='contracts'&&r.expiry===${JSON.stringify(ticket.expiry)})`),'Correct broker and expiry queried');
      await input('Unidades F5','2');
      await evaluate(`document.querySelector('.manual-toggle input[type=checkbox]').click()`);
      assert.equal(await evaluate(`document.querySelector('[aria-label="Unidades F5"]').value`),'2','Enabling manual trading preserves user edits');
      await evaluate(`document.querySelector('.manual-toggle input[type=checkbox]').click()`);
      await click('Recomendador');
    }
  }
  // An unavailable recommended leg stays empty and can be retried without replacing it.
  await choose('Estrategia del análisis','pmcc');
  await until(`!!document.querySelector('.contract-recommendation[data-contract-strategy="pmcc"]')`);
  const missing=await evaluate(`document.querySelector('.contract-recommendation tbody tr').cells[2].textContent`);
  await evaluate(`window.__recommenderQA.missingSymbol=${JSON.stringify(missing)};document.querySelector('.recommender-next-step button').click()`);
  await until(`document.querySelector('.f5-recommendation[role=alert]')?.textContent.includes(${JSON.stringify(missing)})`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Contrato F5 1"]').value`),'','Unavailable contract is never substituted');
  await evaluate(`window.__recommenderQA.missingSymbol=null`);await click('Consultar contratos de Webull');
  await until(`document.querySelector('[aria-label="Contrato F5 1"]')?.value===${JSON.stringify(missing)}`);
  assert.deepEqual(await evaluate('window.__recommenderQA.mutations'),[],'Opening recommendations never previews or submits orders');
  await click('Recomendador');
  await choose('Fuente del análisis','alpaca');
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
  await click('Cargar rango');
  await until('window.__recommenderQA.requests.some(r=>r.cutoff)&&!document.querySelector(".historical-replay").textContent.includes("Consultando empresa")');
  assert(await evaluate('document.querySelectorAll(".historical-replay svg").length===1'),'Only historical state is visible before revealing outcomes');
  const original=await evaluate('document.querySelector(".replay-entry-summary").getAttribute("data-replay-entry-date")');
  const originalCandles=await evaluate('Array.from(document.querySelectorAll("[data-replay-candle]")).map(e=>[e.dataset.replayCandle,e.dataset.close])');
  await click('Línea');assert(await evaluate('!!document.querySelector("[data-replay-series=price]")'),'Line view renders actual closes');await click('Velas');
  await click('RSI');assert(await evaluate('!document.querySelector("[data-replay-series=rsi]")'),'RSI can be hidden');await click('RSI');
  const zoomInfo=()=>evaluate('(()=>{const e=document.querySelector("[data-chart-zoom=historical]");return {start:Number(e.dataset.visibleStart),end:Number(e.dataset.visibleEnd),total:Number(e.dataset.total)}})()');
  const zoomAction=label=>evaluate(`document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}).click()`);
  await evaluate('document.querySelector(".replay-chart svg[role=slider]").dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}))');
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
  await evaluate('document.querySelector(".replay-run-actions .primary-button").click()');
  await until('!!document.querySelector("[data-backtest-result]")');
  await evaluate('document.querySelector(".replay-pnl-card").closest("details").open=true');
  await until('document.querySelectorAll(".historical-replay svg").length===2');
  assert.equal(await evaluate('document.querySelector(".replay-entry-summary").getAttribute("data-replay-entry-date")'),original,'Revealing future preserves the entry date');
  const revealedCandles=await evaluate('Array.from(document.querySelectorAll("[data-replay-candle]")).map(e=>[e.dataset.replayCandle,e.dataset.close])');
  assert.deepEqual(revealedCandles.slice(0,originalCandles.length),originalCandles,'Revealing future preserves all preceding close values');
  assert(await evaluate(`!!document.querySelector('[aria-label="Resultado del backtesting de la estrategia"]')`));
  const finalPnl=await evaluate('document.querySelector(".replay-pnl-card .replay-price-heading").textContent');
  await zoomAction('Acercar gráfica de resultado');
  assert(await evaluate('(()=>{const e=document.querySelector("[data-chart-zoom=pnl]");return Number(e.dataset.visibleEnd)-Number(e.dataset.visibleStart)<Number(e.dataset.total)})()'),'P/L chart supports independent zoom');
  assert.equal(await evaluate('document.querySelector(".replay-pnl-card .replay-price-heading").textContent'),finalPnl,'P/L zoom preserves the complete exercise result');
  await zoomAction('Restablecer gráfica de resultado');
  const count=await evaluate('window.__recommenderQA.requests.length');
  await input(await evaluate('document.querySelector(".replay-parameters input[aria-label^=Strike]").getAttribute("aria-label")'),'95');
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
  console.log('PASS: recommendation worker, exact contract preselection for four strategies in Alpaca/Webull, alternate proposals, missing-contract retry, preserved edits, no automatic orders, capital sorting, detailed profitability, historical state/PnL and mobile. QA provider data.');
}
