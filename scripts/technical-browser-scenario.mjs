import assert from 'node:assert/strict';
import { deriveSecFundamentals } from '../src/cores/04-analisis-fundamental/sec-fundamentals.ts';
import { enrichFundamentalValuation } from '../src/cores/04-analisis-fundamental/fundamental-metrics.ts';

export function technicalFundamentalFixture() {
  const year = new Date().getUTCFullYear() - (new Date().getUTCMonth() < 2 ? 2 : 1);
  const annual = (val, y = year) => ({ val, start: `${y}-01-01`, end: `${y}-12-31`, filed: `${y + 1}-03-01`, form: '10-K' });
  const balance = (val, y = year) => ({ val, end: `${y}-12-31`, filed: `${y + 1}-03-01`, form: '10-K' });
  const usd = (...values) => ({ units: { USD: values } });
  const fundamentals = deriveSecFundamentals({ facts: { 'us-gaap': {
    Revenues: usd(annual(500), annual(400, year - 1)), NetIncomeLoss: usd(annual(60), annual(50, year - 1)),
    Assets: usd(balance(500), balance(400, year - 1)), Liabilities: usd(balance(200)),
    StockholdersEquity: usd(balance(300), balance(240, year - 1)), CashAndCashEquivalentsAtCarryingValue: usd(balance(80)),
    AssetsCurrent: usd(balance(250)), LiabilitiesCurrent: usd(balance(100)), InventoryNet: usd(balance(50)),
    GrossProfit: usd(annual(200)), OperatingIncomeLoss: usd(annual(100)),
    NetCashProvidedByUsedInOperatingActivities: usd(annual(80)), PaymentsToAcquirePropertyPlantAndEquipment: usd(annual(20)),
    EarningsPerShareDiluted: { units: { 'USD/shares': [annual(3)] } },
  }, dei: { EntityCommonStockSharesOutstanding: { units: { shares: [balance(20)] } } } } }, {}, new Date().toISOString(), '0000000001');
  const stamp = new Date().toISOString();
  fundamentals.analysis = enrichFundamentalValuation(fundamentals, { value: 100, kind: 'observed', source: 'QA: precio simulado', observedAt: stamp, availableAt: stamp }, stamp);
  for (const variable of Object.values(fundamentals.analysis.metrics)) variable.source = `QA: hechos contables simulados, no datos reales · ${variable.source}`;
  return fundamentals;
}

export function installTechnicalQA(fundamentals) {
  const original = window.fetch.bind(window);
  const qa = window.__technicalQA = { mutations: [] };
  const bars = (start, end) => {
    const output = [];
    for (let day = Date.parse(start); day <= Date.parse(end); day += 86400000) {
      if ([0, 6].includes(new Date(day).getUTCDay())) continue;
      const index = output.length, close = 100 + 4 * Math.sin(index * Math.PI / 6) + .35 * Math.sin(index * .9);
      output.push({ time: day + 15 * 3600000, open: close + .5 * Math.sin(index * 1.2), close, high: close + 1, low: close - 1, volume: 1000 + index % 9 * 200 + (index % 23 === 0 ? 20000 : 0) });
    }
    return output;
  };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin) return original(input, init);
    if (url.pathname.startsWith('/api/') && (init?.method ?? 'GET') !== 'GET') {
      qa.mutations.push(url.pathname); return Response.json({ error: { message: 'QA: sin autorización para escrituras externas.' } }, { status: 409 });
    }
    if (url.pathname === '/api/broker/status') return Response.json({ alpaca: { configured: false, ownerAuthorized: false, mode: 'paper' }, webull: { supported: false }, automation: { configured: false, enabled: false }, identity: null });
    if (url.pathname === '/api/automation') return Response.json({ executions: [], positions: [], events: [], plans: [], configured: false, enabled: false, available: false });
    if (!['/api/research/company', '/api/market/history'].includes(url.pathname)) return original(input, init);
    const response = await original(input, init), body = await response.json();
    if (!response.ok) return Response.json(body, { status: response.status });
    const data = bars(url.searchParams.get('start'), url.searchParams.get('end'));
    if (url.pathname === '/api/market/history') body.bars = data;
    else {
      body.research.market.bars = data; body.research.market.observations = data.length;
      body.research.fundamentals = { ...fundamentals, dividendYield: body.research.fundamentals.dividendYield };
    }
    return Response.json(body);
  };
}

export async function runTechnicalScenario({ evaluate, click, until, screenshot }) {
  await until(`document.querySelector('[data-technical-panel=rsi]')&&document.querySelector('[data-technical-panel=macd]')&&document.querySelector('[data-price-level=confirmed]')&&document.querySelector('[data-signal=buy]')&&document.querySelector('[data-signal=sell]')`);
  assert(await evaluate(`!!document.querySelector('[data-technical-event=macd]')`));
  await click('MACD'); assert(await evaluate(`!document.querySelector('[data-technical-panel=macd]')`)); await click('MACD');
  await click('Soportes / resistencias'); assert(await evaluate(`!document.querySelector('[data-price-level=confirmed]')`)); await click('Soportes / resistencias');
  await click('Volumen'); assert(await evaluate(`!document.querySelector('[data-volume-bar]')`)); await click('Volumen');
  await evaluate(`document.querySelector('.chart-user-controls').open=true;(() => {const select=document.querySelector('select[aria-label="Regla de señales en gráfica"]');select.value='technical-confluence';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.analysis-rule').textContent.includes('Confluencia')`);
  const metricsBefore = await evaluate(`document.querySelector('.chart-core-values').textContent`);
  const loadedBefore = await evaluate(`document.querySelector('.history-summary span').textContent`);
  await click('6 meses');
  assert.equal(await evaluate(`document.querySelector('.chart-core-values').textContent`), metricsBefore, 'Changing visible history never refits the indicators');
  assert.equal(await evaluate(`document.querySelector('.history-summary span').textContent`), loadedBefore, 'Visible zoom preserves loaded history');
  await evaluate(`window.__technicalAnchor=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__technicalExport={url:this.href}}`);
  await click('Exportar velas CSV');
  assert((await evaluate(`fetch(window.__technicalExport.url).then(response=>response.text())`)).split('\r\n').length > 700, 'Six-month zoom still exports the full three-year history');
  await evaluate(`HTMLAnchorElement.prototype.click=window.__technicalAnchor`);
  await evaluate(`document.querySelector('.chart-user-controls').open=false`);
  await screenshot('technical-desktop.png', 1440, 1250); await screenshot('technical-mobile.png', 390, 1500);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'Technical overlays fit mobile');
  await evaluate(`document.querySelector('.research-panel').closest('.analysis-advanced').open=true;document.querySelector('.fundamental-analysis').open=true`);
  await until(`document.querySelector('.fundamental-analysis summary').textContent.includes('25/25')`);
  assert.equal(await evaluate(`document.querySelectorAll('.fundamental-analysis .research-variable').length`), 25);
  assert(await evaluate(`document.querySelector('.fundamental-analysis .research-variable').textContent.includes('Periodo contable al: 31/12/')`), 'Fiscal period dates must not shift into the previous New York day');
  assert(await evaluate(`Array.from(document.querySelectorAll('.fundamental-analysis .research-variable')).some(element=>element.textContent.includes('Flujo de caja libre')&&element.querySelector('strong').textContent.includes('60.00'))`));
  assert(await evaluate(`document.querySelector('.fundamental-analysis').textContent.includes('no P/E TTM')`));
  await screenshot('fundamental-desktop.png', 1440, 1100);
  await screenshot('fundamental-mobile.png', 390, 1100);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'Fundamental metrics fit mobile');
  assert.deepEqual(await evaluate('window.__technicalQA.mutations'), []);
  console.log('PASS: RSI, MACD, confirmed support/resistance, buy/sell markers, technical events, layer controls, confluence rule, 25 financial metrics and mobile. Provider fixtures only; no orders or remote writes.');
}
