import type { CoreId } from '../compartido/types.ts';

export const cores: { id: CoreId; title: string; subtitle: string }[] = [
  { id: 'bsm', title: 'Black–Scholes–Merton', subtitle: 'Valor teórico de la opción' },
  { id: 'greeks', title: 'Griegas', subtitle: 'Delta, Gamma, Theta y Vega' },
  { id: 'probability', title: 'Equilibrio y probabilidad', subtitle: 'Umbral y probabilidad teórica' },
  { id: 'volatility', title: 'Volatilidad', subtitle: 'Compatibilidad de la volatilidad con la estrategia' },
  { id: 'trend', title: 'Tendencia', subtitle: 'Comportamiento retrospectivo del precio' },
  { id: 'liquidity', title: 'Liquidez y volumen', subtitle: 'Liquidez y spread de los contratos según los datos disponibles' },
  { id: 'risk', title: 'Riesgo', subtitle: 'Componente de riesgo de la puntuación; no desactiva límites operativos' },
];
