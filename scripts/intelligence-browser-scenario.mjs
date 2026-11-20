import assert from 'node:assert/strict';

/** Browser-only provider fixture; all writes and broker/account calls are intercepted. */
export function installIntelligenceQA() {
  const original = window.fetch.bind(window);
  const qa = window.__intelligenceQA = { shortHistory: false, bullishHistory: false, mutations: [] };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin) return original(input, init);
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

export async function runIntelligenceScenario({ evaluate, click, until, screenshot }) {
  await until(`document.querySelector('.intelligence-metrics')`);
  assert.equal(await evaluate(`document.querySelector('.research-panel a[href^="https://finviz.com/stock"]').href`), 'https://finviz.com/stock?t=NVDA', 'Finviz is an external reference; SEC remains the fundamental data source');
  const prediction = await evaluate(`document.querySelector('.intelligence-metrics strong').textContent`);
  await evaluate(`(() => {
    const form = document.querySelector('.intelligence-preferences form');
    form.elements.objective.value = 'growth';
    form.elements.capital.value = '100000';
    form.elements.maxLossPercent.value = '0';
    form.elements.experience.value = 'advanced';
    form.querySelectorAll('input[name=strategy]').forEach(input => { input.checked = false; });
  })()`);
  await click('Aplicar preferencias');
  await until(`document.querySelector('.intelligence-panel').textContent.includes('Preferencias aplicadas a esta sesión')`);
  assert.equal(await evaluate(`document.querySelector('.intelligence-metrics strong').textContent`), prediction, 'Preferences cannot change the forecast at the same horizon');
  assert(await evaluate(`document.querySelector('.intelligence-result h3').textContent.includes('Esperar')`));
  assert.equal(await evaluate(`document.querySelector('.intelligence-result button')`), null, 'No eligible strategy means no review action');
  await evaluate(`document.querySelector('.intelligence-preferences select[name=horizonSessions]').value='5'`);
  await click('Aplicar preferencias');
  await until(`document.querySelector('.intelligence-evidence').textContent.includes('5 sesiones')`);
  await evaluate(`document.querySelector('.intelligence-preferences').open=false;document.querySelector('.intelligence-panel').scrollIntoView()`);
  await screenshot('intelligence-desktop.png', 1440, 1100);
  await screenshot('intelligence-mobile.png', 390, 844);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'Intelligence mobile fits the viewport');
  await evaluate(`window.__intelligenceQA.bullishHistory=true;(() => {const select=document.querySelector('select[aria-label="Empresa del gráfico"]');select.value='AAPL';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.intelligence-panel h2').textContent.includes('AAPL')&&document.querySelector('.intelligence-metrics')`);
  assert.equal(await evaluate(`document.querySelector('.research-panel a[href^="https://finviz.com/stock"]').href`), 'https://finviz.com/stock?t=AAPL');
  await evaluate(`(() => {
    const form = document.querySelector('.intelligence-preferences form');
    form.elements.objective.value = 'income';
    form.elements.riskTolerance.value = 'medium';
    form.elements.maxLossPercent.value = '20';
    form.elements.horizonSessions.value = '20';
    form.elements.experience.value = 'intermediate';
    form.querySelectorAll('input[name=strategy]').forEach(input => { input.checked = true; });
  })()`);
  await click('Aplicar preferencias');
  await until(`document.querySelector('.intelligence-result h3').textContent.includes('Revisar The Wheel')`);
  await evaluate(`Array.from(document.querySelectorAll('.strategy-option')).find(button=>button.textContent.includes('Call Ratio Backspread')).click()`);
  await click('Ver estrategia sugerida en el explorador');
  await until(`Array.from(document.querySelectorAll('.strategy-option')).some(button=>button.textContent.includes('The Wheel')&&button.getAttribute('aria-checked')==='true')`);
  await evaluate(`window.__intelligenceQA.shortHistory=true;(() => {const select=document.querySelector('select[aria-label="Empresa del gráfico"]');select.value='MSFT';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.intelligence-panel').textContent.includes('Falta histórico')`);
  assert(await evaluate(`!document.querySelector('.intelligence-metrics')`), 'Insufficient history removes the previous forecast');
  await evaluate(`(() => {const select=document.querySelector('select[aria-label="Fuente del histórico"]');select.value='demo';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.intelligence-panel').textContent.includes('La demostración no genera predicciones')`);
  assert(await evaluate(`!document.querySelector('.intelligence-result')`));
  assert.deepEqual(await evaluate('window.__intelligenceQA.mutations'), [], 'Preference changes never write or send orders');
  console.log('PASS: AI preferences, independent price forecast, horizon, wait/review results, selection of suggested strategy, company changes, insufficient history, demo guard and mobile. Provider fixtures only; no orders or remote writes.');
}
