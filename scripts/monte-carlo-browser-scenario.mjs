import assert from 'node:assert/strict';

export async function runMonteCarloScenario({ evaluate, click, input, until, screenshot }) {
  const select = async value => {
    await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Posición Monte Carlo"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  };
  const open = async () => {
    await until(`!!document.querySelector('.monte-carlo-panel .mc-inputs')`);
    await evaluate(`document.querySelector('.monte-carlo-panel').open=true;document.querySelector('.monte-carlo-panel').scrollIntoView()`);
  };
  await open();
  await input('Trayectorias Monte Carlo', '1000'); await input('Pasos Monte Carlo', '8');
  await click('Simular Monte Carlo');
  await until(`!!document.querySelector('.mc-results')||!!document.querySelector('.monte-carlo-panel [role="alert"]')`);
  assert(await evaluate(`!!document.querySelector('.mc-results')`), await evaluate(`document.querySelector('.monte-carlo-panel').innerText`));
  assert.equal(await evaluate(`document.querySelectorAll('.mc-results svg').length`), 2);
  const first = await evaluate(`document.querySelector('.mc-results').innerText`);
  await click('Simular Monte Carlo');
  await until(`!Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='Simulando…')`);
  assert.equal(await evaluate(`document.querySelector('.mc-results').innerText`), first, 'Seed reproduces the UI result');
  await input('Semilla Monte Carlo', '0');
  await until(`!!document.querySelector('.mc-stale')`);
  // Export must describe the captured execution, even after the controls change.
  await evaluate(`(()=>{const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download==='monte-carlo-resultado.json'){window.__mcExport=fetch(this.href).then(r=>r.json());return;}return original.call(this);};})()`);
  await click('Exportar simulación JSON');
  assert.equal(await evaluate(`window.__mcExport.then(value=>value.request.seed)`), 42);
  await click('Simular Monte Carlo'); await until(`!document.querySelector('.mc-stale')`);
  assert(await evaluate(`document.querySelector('.mc-results').innerText.includes('semilla 0')`));
  await input('Trayectorias Monte Carlo', '50001'); await click('Simular Monte Carlo');
  await until(`!!document.querySelector('.monte-carlo-panel [role="alert"]')`);
  await input('Trayectorias Monte Carlo', '1000');
  await select('strategy');
  await until(`document.querySelector('.mc-inputs').innerText.includes('Wheel')`);
  await click('Simular Monte Carlo'); await until(`!document.querySelector('.mc-stale')`);
  assert(await evaluate(`document.querySelector('.mc-results').innerText.includes('put inicial')`));
  // Changing the selected strategy remounts the panel; choose the complete Gamma position.
  await evaluate(`Array.from(document.querySelectorAll('.strategy-option')).find(e=>e.textContent.includes('Gamma')).click()`);
  await open(); await select('strategy');
  await until(`document.querySelector('.mc-inputs').innerText.includes('straddle')`);
  await input('Trayectorias Monte Carlo', '2000'); await input('Pasos Monte Carlo', '32');
  await evaluate(`document.querySelector('input[aria-label="Cobertura delta Monte Carlo"]').click()`);
  await click('Simular Monte Carlo');
  await until(`document.querySelector('.mc-results')?.innerText.includes('Costes medios de cobertura')`);
  assert(await evaluate(`document.querySelector('.mc-results').innerText.includes('con cobertura delta')`));
  // Cancel a real worker before accepting another execution.
  await input('Trayectorias Monte Carlo', '10000'); await input('Pasos Monte Carlo', '64');
  await evaluate(`(async()=>{Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Simular Monte Carlo').click();await new Promise(r=>requestAnimationFrame(r));const cancel=Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Cancelar simulación');if(!cancel)throw Error('Cancel button missing');cancel.click();})()`);
  await until(`!Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='Cancelar simulación')`);
  assert(await evaluate(`!!document.querySelector('.mc-stale')`), 'Cancel keeps the previous result identified');
  await evaluate(`document.querySelector('.mc-results').scrollIntoView()`);
  await screenshot('monte-carlo-desktop.png', 1440, 1000);
  await screenshot('monte-carlo-mobile.png', 390, 844);
  await evaluate(`document.querySelector('.mc-results').scrollIntoView()`);
  await screenshot('monte-carlo-mobile.png', 390, 844);
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), 'Monte Carlo fits mobile');
  assert.deepEqual(await evaluate(`window.__technicalQA.mutations`), [], 'No external mutations');
  console.log('PASS: real Monte Carlo worker, seed reproducibility, stale results, captured JSON export, bounds, Wheel/Gamma inputs, hedge costs, cancellation and mobile. Provider data are QA fixtures.');
}
