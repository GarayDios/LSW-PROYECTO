import assert from 'node:assert/strict';

export function installMonteCarloQA() {
  const original = window.fetch.bind(window);
  const qa = window.__monteCarloQA = { stale: true };
  window.fetch = async (input, init) => {
    const response = await original(input, init);
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin || url.pathname !== '/api/research/company' || !response.ok || !qa.stale) return response;
    const body = await response.json(), research = body.research;
    const stamp = new Date(Date.parse(research.asOf) - 2 * 3600000).toISOString();
    for (const contract of research.options.contracts) {
      for (const field of ['impliedVolatility', 'bid', 'ask', 'premium']) {
        const previous = contract[field];
        contract[field] = { value: null, kind: 'missing', source: 'QA: cotización vencida', observedAt: null, availableAt: null,
          reason: 'La cotización supera una hora.', lastReceived: { ...previous, observedAt: stamp, availableAt: stamp } };
      }
    }
    research.options.feed = 'indicative';
    research.options.status.message = 'QA: contratos existentes sin cotización vigente.';
    return Response.json(body);
  };
}

export async function runMonteCarloScenario({ evaluate, click, input, until, screenshot }) {
  const choose = async (label, value) => {
    await evaluate('(()=>{const e=document.querySelector('+JSON.stringify('select[aria-label="'+label+'"]')+');e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("change",{bubbles:true}));})()');
  };
  const open = async () => {
    await until('!!document.querySelector(".monte-carlo-panel .mc-inputs")');
    await evaluate('document.querySelector(".monte-carlo-panel").open=true;document.querySelector(".monte-carlo-panel").scrollIntoView()');
  };
  const completed = async () => until('!!document.querySelector(".mc-results")&&!document.querySelector(".mc-stale")&&!Array.from(document.querySelectorAll("button")).some(e=>e.textContent==="Cancelar simulación")');
  const mcRow = 'Array.from(document.querySelectorAll(".scanner-core-row")).find(e=>e.textContent.includes("Monte Carlo"))';

  await until('!!document.querySelector(\'select[aria-label="Datos del core Monte Carlo"]\')&&'+mcRow+'?.textContent.includes("estimación automática")');
  assert.equal(await evaluate('document.querySelector(\'select[aria-label="Datos del core Monte Carlo"]\').value'), 'auto');
  await choose('Datos del core Monte Carlo', 'observed');
  await until(mcRow+'?.textContent.includes("Sin datos")');
  await choose('Datos del core Monte Carlo', 'auto');
  await until(mcRow+'?.textContent.includes("estimación automática")');
  await click('Simulación histórica');
  await open();
  await input('Trayectorias Monte Carlo', '1000'); await input('Pasos Monte Carlo', '8'); await input('Semilla Monte Carlo', '42');
  await completed(); // No manual click: the real worker starts automatically.
  assert(await evaluate('document.querySelector(".mc-results").innerText.includes("estimación automática")'));
  assert.equal(await evaluate('document.querySelectorAll(".mc-results svg").length'), 2);
  const first = await evaluate('document.querySelector(".mc-results").innerText');
  await click('Simular Monte Carlo'); await completed();
  assert.equal(await evaluate('document.querySelector(".mc-results").innerText'), first, 'Seed reproduces the UI result');
  await input('Semilla Monte Carlo', '7'); await completed();
  assert(await evaluate('document.querySelector(".mc-results").innerText.includes("semilla 7")'), 'Controls automatically update the result');

  // Manual mode retains the previous captured execution until the next run.
  await evaluate('document.querySelector(\'input[aria-label="Actualizar Monte Carlo automáticamente"]\').click()');
  await input('Semilla Monte Carlo', '0');
  await until('!!document.querySelector(".mc-stale")');
  await evaluate('(()=>{const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download==="monte-carlo-resultado.json"){window.__mcExport=fetch(this.href).then(r=>r.json());return;}return original.call(this);};})()');
  await click('Exportar simulación JSON');
  assert.equal(await evaluate('window.__mcExport.then(value=>value.request.seed)'), 7);
  assert.equal(await evaluate('window.__mcExport.then(value=>value.scenario.automaticEstimation)'), true);
  await click('Simular Monte Carlo'); await completed();
  assert(await evaluate('document.querySelector(".mc-results").innerText.includes("semilla 0")'));
  await input('Trayectorias Monte Carlo', '50001'); await click('Simular Monte Carlo');
  await until('!!document.querySelector(".monte-carlo-panel [role=alert]")');
  await input('Trayectorias Monte Carlo', '1000');
  await choose('Posición Monte Carlo', 'single');
  await click('Simular Monte Carlo'); await completed();
  assert(await evaluate('document.querySelector(".mc-results").innerText.includes("opción individual")'));
  await choose('Posición Monte Carlo', 'strategy');
  await click('Simular Monte Carlo'); await completed();
  assert(await evaluate('document.querySelector(".mc-results").innerText.includes("put inicial")'));

  await click('Screener');
  await evaluate('Array.from(document.querySelectorAll(".strategy-option")).find(e=>e.textContent.includes("Gamma")).click()');
  await click('Simulación histórica'); await open();
  await until('document.querySelector(".mc-inputs").innerText.includes("straddle")');
  await input('Trayectorias Monte Carlo', '2000'); await input('Pasos Monte Carlo', '32');
  await evaluate('document.querySelector(\'input[aria-label="Cobertura delta Monte Carlo"]\').click()');
  await completed();
  assert(await evaluate('document.querySelector(".mc-results").innerText.includes("Costes medios de cobertura")&&document.querySelector(".mc-results").innerText.includes("con cobertura delta")'));
  // Cancel a real worker; the same signature must stay cancelled in auto mode.
  await input('Trayectorias Monte Carlo', '10000'); await input('Pasos Monte Carlo', '64');
  await evaluate('(async()=>{Array.from(document.querySelectorAll("button")).find(e=>e.textContent==="Simular Monte Carlo").click();await new Promise(r=>requestAnimationFrame(r));const cancel=Array.from(document.querySelectorAll("button")).find(e=>e.textContent==="Cancelar simulación");if(!cancel)throw Error("Cancel button missing");cancel.click();})()');
  await evaluate('new Promise(resolve=>setTimeout(resolve,800))');
  assert(await evaluate('!!document.querySelector(".mc-stale")&&!Array.from(document.querySelectorAll("button")).some(e=>e.textContent==="Cancelar simulación")'), 'Cancellation preserves the old result without restarting');
  await input('Semilla Monte Carlo', '123'); await input('Trayectorias Monte Carlo', '1000'); await input('Pasos Monte Carlo', '8');
  await completed();
  assert(await evaluate('document.querySelector(".mc-results").innerText.includes("semilla 123")'), 'A changed input resumes automatic calculation');
  await evaluate('document.querySelector(".mc-results").scrollIntoView()');
  await screenshot('monte-carlo-desktop.png', 1440, 1000);
  await screenshot('monte-carlo-mobile.png', 390, 844);
  await evaluate('document.querySelector(".mc-results").scrollIntoView()');
  await screenshot('monte-carlo-mobile.png', 390, 844);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'Monte Carlo fits mobile');

  await click('Screener');
  await evaluate('window.__monteCarloQA.stale=false');
  await choose('Empresa del gráfico', 'AAPL');
  await until(mcRow+'?.textContent.includes("proveedor")');
  await click('Simulación histórica'); await open(); await completed();
  assert(await evaluate('document.querySelector(".mc-results").innerText.includes("AAPL")&&!document.querySelector(".mc-results").innerText.includes("estimación automática")'), 'Fresh provider data replace the estimated company scenario');
  assert.deepEqual(await evaluate('window.__technicalQA.mutations'), [], 'No external mutations');
  console.log('PASS: automatic core reconstruction, strict source mode, automatic worker/recalculation, reproducible seed, captured export, bounds, individual/Wheel/Gamma, hedge costs, cancellation, company/source changes and mobile. Provider data are QA fixtures.');
}
