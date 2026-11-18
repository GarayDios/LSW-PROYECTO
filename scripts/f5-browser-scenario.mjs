import assert from 'node:assert/strict';

/** Installed before app scripts; all F5 requests are local fixtures, never broker calls. */
export function installF5QA() {
  const key = 'tepic-f5-browser-qa';
  const read = () => JSON.parse(sessionStorage.getItem(key));
  const save = value => sessionStorage.setItem(key, JSON.stringify(value));
  if (!read()) save({ operations: [], positions: [], previews: 0, submits: 0, cancels: 0, ambiguousNext: false });
  const now = () => new Date().toISOString();
  const original = window.fetch.bind(window);
  const contract = (underlying, expiry, type, strike) => ({
    symbol: underlying + expiry.replaceAll('-', '').slice(2) + (type === 'call' ? 'C' : 'P') + String(strike * 1000).padStart(8, '0'),
    underlying, expiry, type, strike, size: 100, tradable: true, style: 'american',
    bid: 1.1, ask: 1.4, quoteTime: now(), delta: type === 'call' ? .4 : -.6,
  });
  const filled = operation => {
    operation.state = 'filled'; operation.brokerOrder.status = 'filled'; operation.brokerOrder.filled_qty = String(operation.quantity);
    operation.brokerOrder.filled_avg_price = String(operation.limitPrice);
    return operation;
  };
  window.__f5QA = {
    inspect: read,
    statusFailure: null,
    complete: () => {
      const data = read();
      data.operations.filter(operation => ['submitted', 'partial', 'ambiguous'].includes(operation.state)).forEach(operation => {
        filled(operation);
        if (operation.action === 'open') data.positions = operation.legs.map(leg => ({ symbol: leg.symbol, quantity: operation.quantity * leg.ratio * (leg.side === 'buy' ? 1 : -1), assetClass: 'us_option', marketValue: -125, averagePrice: 1.25, unrealizedPnl: 0 }));
        if (operation.action === 'close') data.positions = [];
      }); save(data);
    },
    partial: () => { const data = read(); const operation = data.operations.at(-1); operation.state = 'partial'; operation.brokerOrder.status = 'partially_filled'; operation.brokerOrder.filled_qty = '1'; save(data); },
    ambiguous: () => { const data = read(); data.ambiguousNext = true; save(data); },
  };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin || url.pathname !== '/api/f5') return original(input, init);
    const data = read(), method = (init?.method ?? 'GET').toUpperCase();
    const response = (body, status = 200) => Response.json(body, { status, headers: { 'X-QA-Fixture': 'f5' } });
    if (method === 'GET' && url.searchParams.get('resource') === 'contracts') {
      const underlying = url.searchParams.get('underlying'), expiry = url.searchParams.get('expiry');
      if(expiry==='2099-01-01')return response({contracts:[],complete:true,feed:'indicative'});
      return response({ contracts: [contract(underlying, expiry, 'put', 140), contract(underlying, expiry, 'call', 140), contract(underlying, expiry, 'call', 150)], complete: true, feed: 'indicative' });
    }
    if(method==='GET'&&window.__f5QA.statusFailure)return response({error:window.__f5QA.statusFailure},window.__f5QA.statusFailure.code==='auth_required'?401:503);
    if (method === 'GET') return response({
      configured: true, enabled: true, marketOpen: true, mode: 'paper', feed: 'indicative',
      account: { status: 'ACTIVE', cash: 80000, buyingPower: 80000, optionsBuyingPower: 80000, equity: 98765.43, optionsLevel: 3, blocked: false },
      operations: data.operations, positions: data.positions,
      activities: [{ id: 'qa-expiry', type: 'OPEXP', symbol: 'QA-EXAMPLE', date: '2026-11-13', quantity: '1', description: 'Actividad de prueba del navegador.' }],
    });
    const body = JSON.parse(init.body);
    if (body.action === 'preview') {
      const request = body.request, parent = request.operationId && data.operations.find(operation => operation.id === request.operationId);
      const strategy = request.strategy ?? parent.strategy, underlying = request.underlying ?? parent.underlying;
      const quantity = request.quantity ?? parent?.quantity ?? 1;
      const legs = request.action === 'close'
        ? parent.legs.map(leg => ({ ...leg, side: leg.side === 'sell' ? 'buy' : 'sell', intent: leg.side === 'sell' ? 'buy_to_close' : 'sell_to_close' }))
        : request.action === 'hedge' ? [{ symbol: underlying, side: request.side, ratio: 1, intent: request.side === 'buy' ? 'buy_to_open' : 'sell_to_close' }]
          : request.contracts.map((symbol, index) => {
            const side = strategy === 'wheel' || strategy === 'backspread' && index === 0 || strategy === 'pmcc' && index === 1 ? 'sell' : 'buy';
            return { symbol, side, ratio: strategy === 'backspread' && index === 1 ? 2 : 1, intent: side === 'sell' ? 'sell_to_open' : 'buy_to_open' };
          });
      const id = crypto.randomUUID(), clientOrderId = 'f5_qa_' + id.replaceAll('-', '');
      const base = { client_order_id: clientOrderId, qty: String(quantity), limit_price: String(request.limitPrice), type: 'limit', time_in_force: 'day' };
      const order = legs.length > 1 ? { ...base, order_class: 'mleg', legs: legs.map(leg => ({ symbol: leg.symbol, side: leg.side, ratio_qty: String(leg.ratio), position_intent: leg.intent })) }
        : { ...base, symbol: legs[0].symbol, side: legs[0].side, position_intent: legs[0].intent };
      const operation = { id, strategy, underlying, action: request.action, ...(parent ? { parentId: parent.id } : {}), request, quantity, legs,
        limitPrice: request.limitPrice, reservedCapitalUsd: strategy === 'wheel' && request.action === 'open' ? 14000 * quantity : Math.max(0, request.limitPrice * quantity * 100),
        clientOrderId, input: order, createdAt: now(), expiresAt: new Date(Date.now() + 60000).toISOString(), state: 'preview', warnings: ['Fixture de navegador; no envía órdenes externas.'] };
      data.previews++; data.operations.push(operation); save(data); return response({ operation }, 201);
    }
    if (body.action === 'submit') {
      const operation = data.operations.find(item => item.id === body.previewId);
      data.submits++;
      operation.state = data.ambiguousNext ? 'ambiguous' : 'submitted';
      operation.brokerOrder = { ...operation.input, id: 'qa-' + operation.id, status: 'new', filled_qty: '0', filled_avg_price: null };
      operation.message = 'Respuesta del bróker simulada para QA.';
      const ambiguous = data.ambiguousNext; data.ambiguousNext = false; save(data);
      await new Promise(resolve => setTimeout(resolve, 100));
      return ambiguous ? response({ error: { code: 'f5_response_uncertain', message: 'Prueba de respuesta incierta.' } }, 503) : response({ operation });
    }
    if (body.action === 'cancel') {
      const operation = data.operations.find(item => item.id === body.operationId);
      data.cancels++; operation.state = 'canceled'; operation.brokerOrder.status = 'canceled'; save(data); return response({ operation });
    }
    return response({ error: { message: 'Acción QA desconocida.' } }, 400);
  };
}

export async function runF5Scenario({ evaluate, click, input, until, send, screenshot }) {
  const inspect = () => evaluate('window.__f5QA.inspect()');
  async function select(label, value) {
    assert(await evaluate(`(()=>{const e=document.querySelector('select[aria-label="'+${JSON.stringify(label)}+'"]');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`));
  }
  await click('Operar');
  await until(`document.querySelector('.f5-account')?.textContent.includes('98,765.43')`);
  assert.equal(await evaluate(`document.querySelector('.cycle-lab')`), null, 'Default F5 uses broker interface');
  await click('Consultar contratos de Alpaca');
  await until(`document.querySelector('select[aria-label="Contrato F5 1"]').options.length>1`);
  const put = await evaluate(`document.querySelector('select[aria-label="Contrato F5 1"]').options[1].value`);
  await select('Contrato F5 1', put);
  await input('Unidades F5', '2'); await input('Precio límite F5', '1.25'); await input('Capital máximo F5', '30000');
  await click('Revisar orden F5'); await until(`document.querySelector('.f5-review')`);
  assert.equal((await inspect()).submits, 0, 'Review never sends an order');
  assert(await evaluate(`document.querySelector('.f5-review-legs').textContent.includes('Vender para abrir 2')`));
  await input('Precio límite F5', '1.3');
  await until(`!document.querySelector('.f5-review')`);
  await click('Revisar orden F5'); await until(`document.querySelector('.f5-review')`);
  await evaluate(`(()=>{const button=Array.from(document.querySelectorAll('.f5-review button')).find(button=>button.textContent.includes('Confirmar y enviar'));button.click();button.click();})()`);
  await until(`document.querySelector('.f5-order-state.submitted')`);
  assert.equal((await inspect()).submits, 1, 'Double click submits once');
  assert.equal(await evaluate(`!!document.querySelector('.f5-order-state.filled')`), false, 'Accepted never presented as filled');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.f5-order-card button')).some(button=>button.textContent==='Preparar cierre')`), false);
  await evaluate('window.__f5QA.partial()'); await click('Actualizar estado');
  await until(`document.querySelector('.f5-order-state.partial')`);
  assert(await evaluate(`document.querySelector('.f5-order-summary').textContent.includes('1 / 2')`));
  await evaluate('window.__f5QA.complete()'); await click('Actualizar estado');
  await until(`document.querySelector('.f5-order-state.filled')`);
  await click('Preparar cierre');
  await input('Precio límite de gestión F5', '0.8'); await input('Capital de gestión F5', '1000');
  await click('Revisar cierre'); await until(`document.querySelector('.f5-review')`);
  assert(await evaluate(`document.querySelector('.f5-review-legs').textContent.includes('Comprar para cerrar 2')`));
  await click('Confirmar y enviar a Alpaca Paper'); await until(`document.querySelectorAll('.f5-order-card').length===2`);
  await evaluate('window.__f5QA.complete()'); await click('Actualizar estado');
  await until(`document.querySelectorAll('.f5-order-state.filled').length===2`);
  // Start a second request with an uncertain transport, then reload to exercise recovery.
  await click('Revisar orden F5'); await until(`document.querySelector('.f5-review')`);
  await evaluate('window.__f5QA.ambiguous()'); await click('Confirmar y enviar a Alpaca Paper');
  await until(`document.querySelector('.f5-order-state.ambiguous')`);
  const sends = (await inspect()).submits;
  assert(await evaluate(`document.querySelector('.f5-review .primary-button').disabled`), 'Uncertain request cannot be sent again');
  await send('Page.reload');
  await until(`document.querySelector('.terminal-app[aria-busy="false"]') && document.querySelector('.generate-button')`);
  await click('Operar'); await until(`document.querySelector('.f5-order-state.ambiguous')`);
  assert.equal((await inspect()).submits, sends, 'Reload only retrieves status');
  await screenshot('f5-paper-desktop.png', 1440, 1000); await screenshot('f5-paper-mobile.png', 390, 844);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'F5 fits mobile');
  console.log('PASS: F5 contract selection, broker account, preview invalidation, one-click submission, partial/final fills, inverse close, uncertain response and reload recovery, mobile. All F5 API responses mocked; no broker orders sent.');
}
