// Criterio de liquidez de demostración. Sus datos y pesos son ilustrativos; no sustituyen cotizaciones ni
// spreads reales.

// Importa los ayudantes y tipos compartidos que utiliza este archivo; sus nombres se emplean en las
// validaciones y cálculos descritos a continuación.
import { clamp } from '../nucleo-cuantitativo/math.ts';
// Importa únicamente tipos para comprobar estructuras en TypeScript; esta declaración no ejecuta lógica en
// tiempo de ejecución.
import type { ScreeningCore } from '../compartido/types.ts';

// Define el criterio de liquidez del ranking de demostración; trabaja con datos ilustrativos del contexto.
export const liquidityCore: ScreeningCore = {
  // Combina 65% de liquidez, 25% de volumen normalizado frente a 250000 y 10% de ajuste de plazo; clamp limita
  // ese componente a [0,1].
  score: ({ liquidity, company, tenor }) => .65 * liquidity + .25 * clamp(company.volume / 250000) + .10 * tenor,
  // Devuelve el motivo legible con la puntuación de liquidez y el volumen de muestra; no certifica liquidez de
  // contratos reales.
  reason: ({ company }) => `Liquidez demo ${company.liquidity}/100, volumen ${company.volume}`,
// Cierra el bloque, objeto o declaración iniciado anteriormente.
};
