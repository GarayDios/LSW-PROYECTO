import assert from 'node:assert/strict';

export function installNewsQA() {
  const original = window.fetch.bind(window);
  const qa = window.__newsQA = { calls: [], fail: false, failMore: false, slowSymbol: null };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin || url.pathname !== '/api/research/news') return original(input, init);
    const query = Object.fromEntries(url.searchParams); qa.calls.push(query);
    await new Promise(resolve => setTimeout(resolve, query.symbol === qa.slowSymbol ? 800 : 100));
    if (qa.fail || query.pageToken && qa.failMore) return Response.json({ error: { message: 'QA: noticias temporalmente no disponibles.' } }, { status: 503 });
    const asOf = query.cutoff || new Date().toISOString();
    const day = value => { const d = new Date(value); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
    const end = Date.parse(query.end + 'T12:00:00Z');
    const recent = day(end - 10 * 86400000), middle = day(end - 85 * 86400000), older = day(Date.parse(query.start + 'T12:00:00Z') + 60 * 86400000);
    const article = (id, date, minute = '00', patch = {}) => ({ id: query.symbol + '-' + id, headline: `QA ${query.symbol}: titular ${id}`, source: 'QA: proveedor simulado', url: 'https://example.org/news/' + id, publishedAt: date + 'T15:' + minute + ':00.000Z', availableAt: date + 'T15:' + minute + ':00.000Z', ...patch });
    const articles = query.pageToken
      ? [article('anterior', older, '00', { url: 'javascript:alert(1)' }), article('uno', recent)]
      : [article('uno', recent), article('dos', recent, '05'), article('tres', middle), article('revision-futura', recent, '00', { availableAt: new Date(Date.parse(asOf) + 86400000).toISOString() })];
    return Response.json({ symbol: query.symbol, start: query.start, end: query.end, asOf, nextPageToken: query.pageToken ? null : 'older', news: { articles, complete: !!query.pageToken,
      status: { source: 'QA: Alpaca noticias simulado', status: query.pageToken ? 'ready' : 'partial', message: 'QA: titulares simulados' }, warnings: query.pageToken ? [] : ['QA: faltan páginas anteriores.'] } });
  };
}

export async function runNewsScenario({ evaluate, click, until, screenshot }) {
  const markers = `Array.from(document.querySelectorAll('[data-news-marker]'))`;
  const count = `${markers}.reduce((n,e)=>n+Number(e.getAttribute('data-news-count')),0)`;
  const selectSource = async value => evaluate(`(()=>{const e=document.querySelector('select[aria-label="Fuente del histórico"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`!!document.querySelector('.chart-news-coverage')&&${count}===3`);
  assert(await evaluate(`!!document.querySelector('[data-news-rail]')`));
  assert(await evaluate(`document.querySelector('.chart-news-details').innerText.includes('Cobertura parcial')`));
  const signals = await evaluate(`Array.from(document.querySelectorAll('[data-signal]')).map(e=>e.getAttribute('data-signal-time'))`);
  const rankings = await evaluate(`document.querySelector('.ranking-criteria-status').textContent`);
  await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('[data-news-marker]')).find(e=>e.getAttribute('data-news-count')==='2');e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await until(`document.querySelectorAll('.chart-news-selection li').length===2`);
  assert(await evaluate(`!!document.querySelector('.chart-news-selection a[href^="https://"]')`));
  assert(await evaluate(`document.querySelector('.chart-news-selection').innerText.includes('QA: proveedor simulado')`));
  await evaluate(`window.__newsQA.failMore=true`); await click('Cargar noticias anteriores');
  await until(`!!document.querySelector('.chart-news-details [role="alert"]')`);
  assert.equal(await evaluate(count), 3, 'Failed pagination retains the loaded stories');
  await evaluate(`window.__newsQA.failMore=false`); await click('Cargar noticias anteriores');
  await until(`${count}===4&&!document.querySelector('.chart-news-partial')`);
  assert(await evaluate(`window.__newsQA.calls.filter(q=>q.pageToken).every(q=>q.cutoff===window.__newsQA.calls.find(q=>q.pageToken).cutoff)`), 'Pagination keeps the cutoff');
  await evaluate(`document.querySelector('[data-news-marker]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await until(`document.querySelector('.chart-news-selection')?.innerText.includes('anterior')`);
  assert.equal(await evaluate(`document.querySelectorAll('.chart-news-details a[href^="javascript:"]').length`), 0);
  await click('3 meses'); await until(`${count}===3`);
  assert(await evaluate(`!document.querySelector('.chart-news-selection')`), 'An out-of-view selection disappears');
  await click('Todo el rango'); await until(`${count}===4`);
  await click('Noticias'); await until(`!document.querySelector('[data-news-rail]')&&!document.querySelector('.chart-news-details')`);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[data-signal]')).map(e=>e.getAttribute('data-signal-time'))`), signals);
  assert.equal(await evaluate(`document.querySelector('.ranking-criteria-status').textContent`), rankings);
  await click('Noticias'); await until(`${count}===3`);
  await evaluate(`window.__newsQA.fail=true`); await click('Actualizar noticias');
  await until(`!!document.querySelector('.chart-news-details [role="alert"]')`); assert.equal(await evaluate(count), 0);
  await evaluate(`window.__newsQA.fail=false`); await click('Actualizar noticias'); await until(`${count}===3`);
  await selectSource('demo'); await until(`document.querySelector('.chart-news-details')?.innerText.includes('velas de demostración')`);
  assert.equal(await evaluate(count), 0, 'Real headlines never appear on synthetic candles');
  await selectSource('alpaca'); await until(`${count}===3`);
  await evaluate(`window.__newsQA.slowSymbol='AAPL';(()=>{const e=document.querySelector('select[aria-label="Empresa del gráfico"]');e.value='AAPL';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`window.__newsQA.calls.some(q=>q.symbol==='AAPL')`);
  await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Empresa del gráfico"]');e.value='MSFT';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`${count}===3&&Array.from(document.querySelectorAll('[data-news-marker]')).every(e=>e.getAttribute('data-news-marker').startsWith('MSFT-'))`);
  await evaluate(`new Promise(r=>setTimeout(r,1000))`);
  assert(await evaluate(`Array.from(document.querySelectorAll('[data-news-marker]')).every(e=>e.getAttribute('data-news-marker').startsWith('MSFT-'))`), 'A slow old response cannot replace the selected company');
  await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Empresa del gráfico"]');e.value='NVDA';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`${count}===3&&Array.from(document.querySelectorAll('[data-news-marker]')).every(e=>e.getAttribute('data-news-marker').startsWith('NVDA-'))`);
  await evaluate(`document.querySelector('[data-news-marker]').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelector('.chart-panel').scrollIntoView()`);
  await screenshot('news-timeline-desktop.png', 1440, 1100);
  await screenshot('news-timeline-mobile.png', 390, 844);
  await evaluate(`document.querySelector('.chart-news-details').scrollIntoView()`);
  await screenshot('news-timeline-mobile.png', 390, 844);
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), 'News details fit mobile');
  assert.deepEqual(await evaluate(`window.__technicalQA.mutations`), []);
  console.log('PASS: aligned news rail, grouping, keyboard selection, safe links, historical pagination, partial/error states, narrowed view, company races, independent visibility, demo separation and mobile. All news are QA fixtures.');
}
