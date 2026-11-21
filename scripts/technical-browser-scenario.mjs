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
  const rankingChoices = `Array.from(document.querySelectorAll('.core-section input[type="checkbox"]')).map(input => ({ name: input.getAttribute('aria-label'), checked: input.checked }))`;
  const rankingScores = `Array.from(document.querySelectorAll('.observed-strategy-analysis > .comparison-table > table > tbody > tr')).map(row => ({ strategy: row.cells[0].textContent, compatibility: row.cells[1].textContent }))`;
  const signalData = `Array.from(document.querySelectorAll('.chart-price-surface [data-signal]')).map(node => ({ action: node.getAttribute('data-signal'), time: node.getAttribute('data-signal-time'), reason: node.querySelector('title').textContent }))`;
  const plotSnapshot = `({ paths: Array.from(document.querySelectorAll('.chart-price-surface svg path')).map(path => path.getAttribute('d')), events: Array.from(document.querySelectorAll('.chart-price-surface [data-technical-event]')).map(node => ({ kind: node.getAttribute('data-technical-event'), count: node.getAttribute('data-event-count'), reason: node.querySelector('title').textContent })), signals: ${signalData} })`;
  await until(`document.querySelectorAll('.observed-strategy-analysis > .comparison-table > table > tbody > tr').length > 0`);
  assert(await evaluate(`!!document.querySelector('.ranking-criteria')&&!document.querySelector('.ranking-criteria').open`), 'Ranking criteria start collapsed');
  const initialChoices = await evaluate(rankingChoices);
  assert.equal(initialChoices.length, 7, 'All seven ranking criteria remain available');
  assert(initialChoices.every(choice => choice.checked), 'Existing default ranking choices stay enabled');
  const initialPlot = await evaluate(plotSnapshot);
  await evaluate(`document.querySelector('.ranking-criteria').open = true; document.querySelector('.core-section input[aria-label="Tendencia"]').click()`);
  await until(`!document.querySelector('.core-section input[aria-label="Tendencia"]').checked`);
  assert.deepEqual(await evaluate(plotSnapshot), initialPlot, 'Changing the ranking trend criterion leaves price paths, indicators, events and signal data unchanged');
  await evaluate(`document.querySelector('.core-section input[aria-label="Tendencia"]').click()`);
  await until(`document.querySelector('.core-section input[aria-label="Tendencia"]').checked`);
  await evaluate(`document.querySelector('.ranking-criteria').open = false`);
  assert.deepEqual(await evaluate(rankingChoices), initialChoices, 'Ranking choices are restored after the isolation check');
  assert(await evaluate(`!!document.querySelector('[data-technical-event=macd]')`));
  assert(await evaluate(`!!document.querySelector('[data-technical-event=gap]')&&!!document.querySelector('[data-gap-zone]')`), 'Fixture renders opening gaps and their price zones');
  await click('Gaps');
  assert(await evaluate(`!document.querySelector('[data-technical-event=gap]')&&!document.querySelector('[data-gap-zone]')`), 'Hiding gaps removes both markers and zones');
  await click('Gaps');
  assert(await evaluate(`!!document.querySelector('[data-technical-event=gap]')&&!!document.querySelector('[data-gap-zone]')`), 'Gap markers and zones can be restored');
  assert(await evaluate(`!!document.querySelector('[data-technical-event=average]')`), 'Fixture renders SMA20/50 crosses');
  await click('Cruces 20/50');
  assert(await evaluate(`!document.querySelector('[data-technical-event=average]')&&!!document.querySelector('[data-analysis-indicator="sma20-50"] path')`), 'Crosses can be hidden independently of average lines');
  await click('Cruces 20/50');
  await click('Medias 20/50');
  assert(await evaluate(`!document.querySelector('[data-analysis-indicator="sma20-50"]')&&!!document.querySelector('[data-technical-event=average]')`), 'Average lines can be hidden independently of crosses');
  await click('Medias 20/50');
  const eventCount = await evaluate(`document.querySelectorAll('[data-technical-event]').length`);
  const annotationCount = `Array.from(document.querySelectorAll('.chart-price-surface > svg:first-child text')).filter(node => /^(MACD|Cruce|GAP)/.test(node.textContent.trim())).length`;
  assert(await evaluate(annotationCount) > 0, 'Visible technical annotations are present before toggling labels');
  await click('Etiquetas');
  assert.equal(await evaluate(annotationCount), 0, 'Hiding labels removes technical text from the price chart');
  assert.equal(await evaluate(`document.querySelectorAll('[data-technical-event]').length`), eventCount, 'Hiding labels preserves every event marker');
  assert(await evaluate(`!!document.querySelector('[data-technical-event] title')`), 'Event descriptions remain available when labels are hidden');
  await click('Etiquetas');
  assert(await evaluate(annotationCount) > 0, 'Technical annotations return when labels are enabled');
  const signalsBeforeMacd = await evaluate(signalData);
  const choicesBeforeMacd = await evaluate(rankingChoices);
  const scoresBeforeMacd = await evaluate(rankingScores);
  assert(scoresBeforeMacd.length > 0, 'Strategy compatibility rows are populated before layer changes');
  await click('MACD');
  assert(await evaluate(`!document.querySelector('[data-technical-panel=macd]')&&!document.querySelector('[data-technical-event=macd]')`), 'MACD visibility controls its panel and technical markers');
  assert.deepEqual(await evaluate(signalData), signalsBeforeMacd, 'Hiding MACD never changes calculated entry/exit signals');
  assert.deepEqual(await evaluate(rankingChoices), choicesBeforeMacd, 'Hiding MACD never changes ranking criteria');
  assert.deepEqual(await evaluate(rankingScores), scoresBeforeMacd, 'Hiding MACD never changes strategy compatibility scores');
  await click('MACD');
  assert(await evaluate(`!document.querySelector('[data-indicator="+1σ HV"]')&&!document.querySelector('[data-indicator="−1σ HV"]')`), 'Volatility bands start hidden');
  await click('Bandas de volatilidad');
  assert(await evaluate(`!!document.querySelector('[data-indicator="+1σ HV"]')&&!!document.querySelector('[data-indicator="−1σ HV"]')`), 'Optional volatility bands use the observed historical volatility');
  assert.deepEqual(await evaluate(rankingChoices), choicesBeforeMacd, 'Showing volatility bands does not select or deselect ranking criteria');
  assert.deepEqual(await evaluate(rankingScores), scoresBeforeMacd, 'Showing volatility bands does not change strategy compatibility scores');
  assert.deepEqual(await evaluate(signalData), signalsBeforeMacd, 'Showing volatility bands preserves entry/exit signal data');
  await click('Bandas de volatilidad');
  assert(await evaluate(`!document.querySelector('[data-indicator="+1σ HV"]')&&!document.querySelector('[data-indicator="−1σ HV"]')`), 'Optional volatility bands can be hidden again');
  await evaluate(`document.querySelector('.quantitative-panel').open = true`);
  assert.equal(await evaluate(`document.querySelectorAll('.option-valuation-summary .research-variable').length`), 4, 'Contract valuation values remain available in their dedicated panel');
  assert(await evaluate(`document.querySelector('.option-valuation-summary').textContent.includes('Probabilidad teórica de beneficio')`), 'The quantitative panel retains theoretical probability separately from price candles');
  await evaluate(`document.querySelector('.quantitative-panel').open = false`);
  await click('Soportes / resistencias'); assert(await evaluate(`!document.querySelector('[data-price-level=confirmed]')`)); await click('Soportes / resistencias');
  await click('Volumen'); assert(await evaluate(`!document.querySelector('[data-volume-bar]')`)); await click('Volumen');
  await evaluate(`document.querySelector('.chart-user-controls').open=true;(() => {const select=document.querySelector('select[aria-label="Regla de señales en gráfica"]');select.value='technical-confluence';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.analysis-rule').textContent.includes('Confluencia')`);
  const confluenceSignals = await evaluate(signalData);
  const confluenceAnalysis = await evaluate(`document.querySelector('.analysis-panel').textContent`);
  await click('MACD');
  assert.deepEqual(await evaluate(signalData), confluenceSignals, 'The confluence rule keeps using MACD even when its panel is hidden');
  assert.equal(await evaluate(`document.querySelector('.analysis-panel').textContent`), confluenceAnalysis, 'Hiding MACD preserves confluence analysis and backtest');
  await click('MACD');
  const metricsBefore = await evaluate(`document.querySelector('.chart-technical-status').textContent`);
  const signalsBeforeZoom = await evaluate(signalData);
  const loadedBefore = await evaluate(`document.querySelector('.history-summary span').textContent`);
  await click('6 meses');
  assert.equal(await evaluate(`document.querySelector('.chart-technical-status').textContent`), metricsBefore, 'Changing visible history never refits the indicators');
  const signalsAfterZoom = await evaluate(signalData);
  assert(signalsAfterZoom.length > 0, 'Six-month view still has entry/exit signals');
  let sharedSignals = 0;
  for (const signal of signalsAfterZoom) {
    const original = signalsBeforeZoom.find(candidate => candidate.time === signal.time && candidate.action === signal.action);
    // Aggregation can retain a different member of a signal bucket; compare shared original bars.
    if (original) {
      sharedSignals++;
      assert.equal(signal.reason.replace(/ · \d+ señales en este grupo$/, ''), original.reason.replace(/ · \d+ señales en este grupo$/, ''), 'A shared original signal keeps its calculated reason after zoom');
    }
  }
  assert(sharedSignals > 0, 'Zoom comparison covers actual shared signal observations');
  assert.equal(await evaluate(`document.querySelector('.history-summary span').textContent`), loadedBefore, 'Visible zoom preserves loaded history');
  await evaluate(`window.__technicalAnchor=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__technicalExport={url:this.href}}`);
  await click('Exportar velas CSV');
  assert((await evaluate(`fetch(window.__technicalExport.url).then(response=>response.text())`)).split('\r\n').length > 700, 'Six-month zoom still exports the full three-year history');
  await evaluate(`HTMLAnchorElement.prototype.click=window.__technicalAnchor`);
  await evaluate(`document.querySelector('.chart-user-controls').open=false`);
  const geometry = async () => evaluate(`(() => {
    const surface = document.querySelector('.chart-price-surface');
    const price = surface.querySelector('svg').getBoundingClientRect();
    const indicators = surface.querySelector('.technical-indicator-panels').getBoundingClientRect();
    return { price: { x: price.x, width: price.width }, indicators: { x: indicators.x, width: indicators.width }, scrollLeft: surface.scrollLeft, scrollWidth: surface.scrollWidth, clientWidth: surface.clientWidth };
  })()`);
  const assertAligned = (bounds, viewport) => {
    assert(bounds.price.width > 0 && bounds.indicators.width > 0, `${viewport}: both SVGs have visible width`);
    assert(Math.abs(bounds.price.x - bounds.indicators.x) <= 1, `${viewport}: price and indicators share their left edge`);
    assert(Math.abs(bounds.price.width - bounds.indicators.width) <= 1, `${viewport}: price and indicators share their scale width`);
  };
  await screenshot('technical-desktop.png', 1440, 1250);
  assertAligned(await geometry(), 'Desktop');
  await screenshot('technical-mobile.png', 390, 1500);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'Technical overlays fit mobile');
  await evaluate(`document.querySelector('.chart-price-surface').scrollLeft = 0`);
  const beforeScroll = await geometry();
  assertAligned(beforeScroll, 'Mobile');
  assert(beforeScroll.scrollWidth > beforeScroll.clientWidth, 'Mobile chart scrolls internally without widening the page');
  await evaluate(`document.querySelector('.chart-price-surface').scrollLeft = 96`);
  await until(`document.querySelector('.chart-price-surface').scrollLeft > 0`);
  const afterScroll = await geometry();
  assertAligned(afterScroll, 'Mobile after horizontal scroll');
  assert(afterScroll.scrollLeft > beforeScroll.scrollLeft, 'Mobile chart scroll position changes');
  assert(Math.abs(beforeScroll.price.x - afterScroll.price.x - afterScroll.scrollLeft) <= 1, 'Price SVG follows the horizontal scroll');
  assert(Math.abs(beforeScroll.indicators.x - afterScroll.indicators.x - afterScroll.scrollLeft) <= 1, 'Indicator SVG follows the same horizontal scroll');
  await evaluate(`document.querySelector('.chart-price-surface').scrollLeft = 0`);
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
  console.log('PASS: independent ranking criteria and visual layers, optional volatility bands, RSI, MACD, opening gaps, SMA crosses/lines, label toggles, confirmed support/resistance, buy/sell markers, confluence rule, 25 financial metrics and aligned mobile chart scrolling. Provider fixtures only; no orders or remote writes.');
}
