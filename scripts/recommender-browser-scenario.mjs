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
  const original=await evaluate('document.querySelector(".historical-replay svg path").getAttribute("d")');
  await click('Calcular ejercicio teórico');
  await until('Array.from(document.querySelectorAll("button")).some(e=>e.textContent==="Revelar evolución posterior")');
  await click('Revelar evolución posterior');
  await until('document.querySelectorAll(".historical-replay svg").length===2');
  assert.equal(await evaluate('document.querySelector(".historical-replay svg path").getAttribute("d")'),original,'Revealing future cannot rewrite the state at decision');
  assert(await evaluate('document.querySelector(".historical-replay").textContent.includes("P/L marcado")'));
  const count=await evaluate('window.__recommenderQA.requests.length');
  await input('Strike del ejercicio histórico','95');
  assert.equal(await evaluate('window.__recommenderQA.requests.length'),count,'Editing a theoretical exercise does not refetch company data');
  await evaluate('document.querySelector(".historical-replay").scrollIntoView()');
  await screenshot('historical-replay-desktop.png',1440,1000);
  await screenshot('historical-replay-mobile.png',390,844);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Historical replay fits mobile');
  assert.deepEqual(await evaluate('window.__technicalQA.mutations'),[],'No external writes');
  console.log('PASS: real recommendation worker, actual contract combinations for four strategies with signed quantities/maturities, per-structure analysis, capital sorting, no CC/CSP or Finviz capture, detailed profitability, historical state/PnL, reusable research and mobile. QA provider data.');
}
