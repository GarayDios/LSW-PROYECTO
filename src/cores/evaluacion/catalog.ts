// Catálogo descriptivo de los siete criterios cuantitativos del ranking anterior. No equivale al catálogo de
// los siete cores funcionales del escáner actual.

// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { CoreId } from '../compartido/types.ts';

// Lista los criterios cuantitativos anteriores con identificador estable y textos visibles; aquí no se
// calcula ninguna puntuación.
export const cores: { id: CoreId; title: string; subtitle: string }[] = [
  // Describe Black–Scholes–Merton con su identificador y explicación para la interfaz; esta línea no calcula
  // puntuaciones.
  { id: 'bsm', title: 'Black–Scholes–Merton', subtitle: 'Valor teórico de la opción' },
  // Describe Griegas con su identificador y explicación para la interfaz; esta línea no calcula puntuaciones.
  { id: 'greeks', title: 'Griegas', subtitle: 'Delta, Gamma, Theta y Vega' },
  // Describe Equilibrio y probabilidad con su identificador y explicación para la interfaz; esta línea no
  // calcula puntuaciones.
  { id: 'probability', title: 'Equilibrio y probabilidad', subtitle: 'Umbral y probabilidad teórica' },
  // Describe Volatilidad con su identificador y explicación para la interfaz; esta línea no calcula
  // puntuaciones.
  { id: 'volatility', title: 'Volatilidad', subtitle: 'Compatibilidad de la volatilidad con la estrategia' },
  // Describe Tendencia con su identificador y explicación para la interfaz; esta línea no calcula
  // puntuaciones.
  { id: 'trend', title: 'Tendencia', subtitle: 'Comportamiento retrospectivo del precio' },
  // Describe Liquidez y volumen con su identificador y explicación para la interfaz; esta línea no calcula
  // puntuaciones.
  { id: 'liquidity', title: 'Liquidez y volumen', subtitle: 'Liquidez y spread de los contratos según los datos disponibles' },
  // Describe Riesgo con su identificador y explicación para la interfaz; esta línea no calcula puntuaciones.
  { id: 'risk', title: 'Riesgo', subtitle: 'Componente de riesgo de la puntuación; no desactiva límites operativos' },
// Cierra la lista de entradas o resultados del bloque anterior.
];
