// Criterio de tendencia de demostración basado en cercanía a objetivos de cambio diario; no reconstruye una
// tendencia histórica.

// Importa los ayudantes y tipos compartidos que utiliza este archivo; sus nombres se emplean en las
// validaciones y cálculos descritos a continuación.
import { proximity } from '../nucleo-cuantitativo/math.ts';
// Importa únicamente tipos para comprobar estructuras en TypeScript; esta declaración no ejecuta lógica en
// tiempo de ejecución.
import type { ScreeningCore } from '../compartido/types.ts';

// Define la heurística de tendencia usada en la demostración; el cambio diario de muestra funciona como
// aproximación.
export const trendCore: ScreeningCore = {
  // Da 80% a la cercanía del cambio al objetivo: 2.5 para Backspread, 0 para Gamma y 1 para las demás; añade
  // 20% de ajuste de plazo.
  score: ({ company, strategy, tenor }) => .8 * proximity(company.change, strategy === 'backspread' ? 2.5 : strategy === 'gamma' ? 0 : 1, 2.5) + .2 * tenor,
  // Explica que el valor proviene del cambio diario de demostración, sin presentarlo como tendencia histórica
  // medida.
  reason: ({ company }) => `Tendencia proxy: cambio demo ${company.change.toFixed(2)}%`,
// Cierra el bloque, objeto o declaración iniciado anteriormente.
};
