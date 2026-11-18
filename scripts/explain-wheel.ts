/** Recorrido educativo: usa el motor existente, sin red, claves ni órdenes de bróker.
 * Ejecutar con Node >=22.18: node scripts/explain-wheel.ts
 */
import { blackScholes } from '../src/cores/bsm.ts';
import { profitMetrics } from '../src/cores/probability.ts';
import { companies } from '../src/features/market/data.ts';
import {
  advanceCycle, closeCycle, createCycle, cycleValue, defaultCycleConfig, writeNextOption,
  type SimCycle,
} from '../src/features/cycles/cycle-simulator.ts';

const company = companies.find(item => item.symbol === 'NVDA');
if (!company) throw new Error('Falta la empresa de muestra NVDA.');

// Fecha fija para que el ejemplo dé los mismos resultados en cualquier sesión.
const config = {
  ...defaultCycleConfig(company, 'wheel', .04),
  id: 'explicacion-wheel', startDate: '2026-11-09', capital: 20000, contracts: 1,
  shortStrike: 140, shortPremium: 4, longStrike: 145, longPremium: 3,
  shortDays: 32, feePerContract: 0, feePerShare: 0,
};
const input = {
  spot: config.spot, strike: config.shortStrike, days: config.shortDays,
  volatility: config.iv, rate: config.rate, dividendYield: config.dividendYield,
  type: 'put' as const,
};
const theoretical = blackScholes(input);
const probability = profitMetrics({ ...input, premium: config.shortPremium, side: 'sell' });

console.log('THE WHEEL — DATOS DE MUESTRA, NO COTIZACIONES ACTUALES');
console.table([{
  S: input.spot, K: input.strike, dias: input.days, T: input.days / 365,
  sigma: input.volatility, r: input.rate, q: input.dividendYield,
  primaElegida: config.shortPremium, primaBSM: theoretical.price,
  deltaOpcion: theoretical.delta, gamma: theoretical.gamma,
  thetaPorDia: theoretical.theta, vegaPor1pp: theoretical.vega,
  equilibrioPut: probability.breakeven, probabilidadPut: probability.probabilityOfProfit,
}]);

const rows: Record<string, string | number>[] = [];
function show(paso: string, cycle: SimCycle) {
  const value = cycleValue(cycle);
  rows.push({
    paso, fecha: cycle.date, fase: cycle.phase, spot: cycle.spot, efectivo: cycle.cash,
    acciones: cycle.shares, valorOpciones: value.optionsValue, patrimonio: value.equity,
    resultado: value.pnl, realizado: value.realized, noRealizado: value.unrealized,
    deltaNeta: value.delta,
  });
}

let cycle = createCycle(config);
show('1. Vender PUT: +$400', cycle);
cycle = advanceCycle(cycle, { date: '2026-12-11', spot: 130 });
show('2. Asignación PUT: comprar 100 a $140', cycle);
cycle = writeNextOption(cycle);
show('3. Vender CALL cubierta: +$300', cycle);
cycle = advanceCycle(cycle, { date: cycle.legs[0].expiry, spot: 150 });
show('4. Asignación CALL: vender 100 a $145', cycle);
console.log('\nRECORRIDO PASO A PASO');
console.table(rows);
console.log('Resultado final = 100 × (145 − 140 + 4 + 3) = $1,200; retorno sobre $20,000 = 6%.');

const expired = advanceCycle(createCycle(config), { date: '2026-12-11', spot: 160 });
const losing = closeCycle(advanceCycle(createCycle(config), { date: '2026-12-11', spot: 100 }));
let withFees = advanceCycle(createCycle({ ...config, feePerContract: .65 }), { date: '2026-12-11', spot: 130 });
withFees = writeNextOption(withFees);
withFees = advanceCycle(withFees, { date: withFees.legs[0].expiry, spot: 150 });
console.log('\nOTROS DESENLACES CON EL MISMO MOTOR');
console.table([
  { caso: 'PUT vence sin ejercicio', resultado: cycleValue(expired).pnl },
  { caso: 'Asignación y venta de acciones a $100', resultado: cycleValue(losing).pnl },
  { caso: 'Vuelta completa con $0.65 por apertura de contrato', resultado: cycleValue(withFees).pnl },
]);

console.log('\nEVENTOS REGISTRADOS POR EL MOTOR');
console.table(cycle.events.map(event => ({
  paso: event.sequence, fecha: event.date, evento: event.title,
  efectivo: event.cash, acciones: event.shares, patrimonio: event.equity, resultado: event.pnl,
})));
