import type { StrategyId } from '../../cores/types.ts';

export const strategies: { id: StrategyId; title: string; subtitle: string; tag: string; description: string }[] = [
  { id: 'wheel', title: 'The Wheel', subtitle: 'Primas y generación de ingresos', tag: 'Ingresos', description: 'Venta de puts con efectivo reservado y, tras una posible asignación, calls cubiertas. El filtro favorece liquidez y una volatilidad moderada. La prima no elimina el riesgo de caída del subyacente.' },
  { id: 'pmcc', title: 'Poor Man’s Covered Call', subtitle: 'Diagonal con calls de distinto plazo', tag: 'Alcista', description: 'Call larga de vencimiento lejano y delta alto, combinada con una call corta de menor plazo. Requiere revisar débito, strikes, vencimientos y riesgo de asignación; el filtro utiliza proxies de una sola pierna.' },
  { id: 'backspread', title: 'Call Ratio Backspread', subtitle: '1 call vendida · 2 calls compradas', tag: 'Expansión', description: 'Venta de una call de strike inferior y compra de dos calls de strike superior al mismo vencimiento. Busca movimientos alcistas amplios; puede perder entre strikes. El filtro utiliza proxies teóricos, no el payoff completo.' },
  { id: 'gamma', title: 'Gamma Scalping', subtitle: 'Straddle y cobertura de Delta', tag: 'Dinámica', description: 'Compra de call y put con igual strike y vencimiento, seguida de coberturas revisadas en acciones completas de Alpaca Paper. Cada ajuste requiere confirmación y las ventas usan acciones disponibles. Su resultado depende de volatilidad realizada, theta, frecuencia y costes.' },
];
