import assert from 'node:assert/strict';

/** Browser-only provider fixture; all writes and broker/account calls are intercepted. */
export function installIntelligenceQA() {
  const original = window.fetch.bind(window);
  const qa = window.__intelligenceQA = { shortHistory: false, bullishHistory: false, mutations: [], chatRequests: [], failChat: false, slowChat: false, partialChat: false };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin) return original(input, init);
    if(url.pathname==='/api/intelligence'){
      if((init?.method??'GET')==='GET')return Response.json({configured:true,model:'QA fixture'});
      const body=JSON.parse(init.body);qa.chatRequests.push(body);
      await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,qa.slowChat?10000:150);init.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});});
      if(qa.failChat)return Response.json({error:{message:'QA: OpenRouter no disponible'}},{status:503});
      return Response.json({answer:`QA: revisión de ${body.symbol}. Con este perfil conviene esperar y revisar la evidencia. Pregunta recibida: ${body.messages.at(-1).content}`,truncated:qa.partialChat,model:'QA fixture',asOf:body.provider==='demo'?null:new Date().toISOString(),dataError:null,recommendation:{action:'wait',title:'Esperar antes de abrir una operación',reason:'QA: evidencia insuficiente para una propuesta específica.',best:null,alternatives:[],capitalLimit:5000,lossLimit:400}});
    }
    if (url.pathname.startsWith('/api/') && (init?.method ?? 'GET') !== 'GET') {
      qa.mutations.push(url.pathname);
      return Response.json({ error: { message: 'La prueba de IA no autoriza escrituras ni órdenes.' } }, { status: 409 });
    }
    if (url.pathname === '/api/broker/status') return Response.json({ alpaca: { configured: false, ownerAuthorized: false, mode: 'paper' }, webull: { supported: false }, automation: { configured: false, enabled: false }, identity: null });
    if (url.pathname === '/api/automation') return Response.json({ executions: [], positions: [], events: [], plans: [], configured: false, enabled: false, available: false });
    if (url.pathname !== '/api/research/company') return original(input, init);
    const response = await original(input, init);
    const body = await response.json();
    if (!response.ok) return Response.json(body, { status: response.status });
    const research = body.research;
    const bars = [];
    const today = new Date().toISOString().slice(0, 10);
    for (let time = Date.parse(today) - 1700 * 86400000; time < Date.parse(today) - 86400000; time += 86400000) {
      if ([0, 6].includes(new Date(time).getUTCDay())) continue;
      const index = bars.length;
      const price = 100 * Math.exp(.0001 * index + .025 * Math.sin(index / 7) + .02 * Math.cos(index / 31));
      bars.push({ time, open: price, close: price, high: price + 1, low: price - 1, volume: 1000000 });
    }
    if (qa.bullishHistory) {
      for (let index = 0; index < bars.length; index++) {
        const price = 100 * Math.exp(.05 * (Math.sin(2 * Math.PI * (index - bars.length + 1) / 100 - Math.PI / 2) + 1));
        Object.assign(bars[index], { open: price, close: price, high: price + 1, low: price - 1 });
      }
    }
    research.market.bars = qa.shortHistory ? bars.slice(-70) : bars;
    research.market.observations = research.market.bars.length;
    research.market.historicalVolatility.source = 'QA: histórico simulado para verificar la interfaz, no evidencia predictiva';
    return Response.json({ research });
  };
}

export async function runIntelligenceScenario({evaluate,click,until,screenshot}) {
  await evaluate(`Array.from(document.querySelectorAll('.side-nav button')).find(e=>e.textContent.includes('Asistente IA')).click()`);
  await until(`document.querySelector('.intelligence-chat')&&document.querySelector('.intelligence-chat-context').textContent.includes('OpenRouter configurado')`);
  const ask=async text=>{await evaluate(`(()=>{const e=document.querySelector('#intelligence-question');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('Preguntar');};
  await ask('Compara mi perfil y mi capital.');
  await until(`document.querySelectorAll('.intelligence-message-assistant').length===1`);
  await evaluate(`Array.from(document.querySelectorAll('.workspace-mode-tabs button')).find(e=>e.textContent.startsWith('Simulaci')).click()`);
  await evaluate(`Array.from(document.querySelectorAll('.side-nav button')).find(e=>e.textContent.includes('Asistente IA')).click()`);
  await until(`document.querySelector('.intelligence-chat').getClientRects().length>0`);
  assert.equal(await evaluate(`document.querySelectorAll('.intelligence-message-assistant').length`),1,'Conversation survives navigation between sections');
  await ask('Y con menos capital?');
  await until(`document.querySelectorAll('.intelligence-message-assistant').length===2`);
  assert.equal(await evaluate('window.__intelligenceQA.chatRequests.at(-1).messages.length'),3,'Follow-up includes preceding question and answer');
  assert(await evaluate(`!!document.querySelector('.intelligence-chat-recommendation')`),'Verified recommendation card is separate from generated prose');
  await evaluate(`document.querySelector('.intelligence-preferences').open=true`);
  await evaluate(`document.querySelector('.intelligence-preferences form').elements.capital.value='100000'`);
  await click('Aplicar preferencias');
  await ask('Revisa mi nuevo capital.');
  await until(`document.querySelectorAll('.intelligence-message-assistant').length===3`);
  assert.equal(await evaluate('window.__intelligenceQA.chatRequests.at(-1).preferences.capital'),100000,'Applied profile reaches assistant');
  await evaluate('window.__intelligenceQA.failChat=true');
  await ask('Pregunta que falla');
  await until(`!!document.querySelector('.intelligence-chat-error')`);
  assert.equal(await evaluate(`document.querySelector('#intelligence-question').value`),'Pregunta que falla','Failed questions remain available to retry');
  await evaluate('window.__intelligenceQA.failChat=false;window.__intelligenceQA.slowChat=true');
  await click('Preguntar');await until(`!!document.querySelector('.intelligence-thinking')`);await click('Detener');
  await until(`!document.querySelector('.intelligence-thinking')`);
  assert.equal(await evaluate(`document.querySelectorAll('.intelligence-message-assistant').length`),3,'Cancelled generation cannot add an answer');
  await evaluate('window.__intelligenceQA.slowChat=false');
  await click('Nueva conversación');
  await until(`!!document.querySelector('.intelligence-chat-empty')`);
  await evaluate('window.__intelligenceQA.partialChat=true');
  await ask('Explica mi perfil.');
  await until(`!!document.querySelector('.intelligence-partial-response')`);
  assert(await evaluate(`document.querySelectorAll('.intelligence-message-assistant').length===1&&!document.querySelector('.intelligence-chat-error')`),'Partial answer is preserved as a message');
  await evaluate('window.__intelligenceQA.partialChat=false');
  await click('Continuar respuesta');
  await until(`document.querySelectorAll('.intelligence-message-assistant').length===2`);
  assert(await evaluate(`window.__intelligenceQA.chatRequests.at(-1).messages.at(-1).content.startsWith('Continúa')`),'Continuation includes the partial-answer context');
  await click('Nueva conversación');
  await screenshot('assistant-desktop.png',1440,1100);
  await screenshot('assistant-mobile.png',390,844);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Assistant fits mobile');
  await ask('Explica Wheel.');await until(`document.querySelectorAll('.intelligence-message-assistant').length===1`);
  await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Empresa del análisis"]');e.value='AAPL';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.intelligence-chat-context').textContent.includes('AAPL')&&document.querySelector('.intelligence-chat-empty')`);
  assert.deepEqual(await evaluate('window.__intelligenceQA.mutations'),[],'Chat does not call trading or persistence endpoints');
  console.log('PASS: assistant navigation, follow-up context, applied preferences, verified recommendation, retry, cancellation, company reset and mobile. Mock OpenRouter; no model charges or orders.');
}
