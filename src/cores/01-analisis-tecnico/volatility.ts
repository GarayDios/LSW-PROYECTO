// Criterio de IV de demostración. La IV del contexto es distinta de la HV histórica calculada en
// market-analysis.ts.

// Importa únicamente tipos para comprobar estructuras en TypeScript; esta declaración no ejecuta lógica en
// tiempo de ejecución.
import type { ScreeningCore } from '../compartido/types.ts';

// Define el criterio de volatilidad del ranking ilustrativo, separado del cálculo histórico de HV.
export const volatilityCore: ScreeningCore = {
  // Combina 80% de ajuste a la IV objetivo y 20% de ajuste al plazo; estos pesos son elecciones heurísticas
  // del modelo.
  score: ({ ivFit, tenor }) => .8 * ivFit + .2 * tenor,
  // Presenta IV de muestra y objetivo como porcentajes; toFixed solo controla el formato del texto.
  reason: ({ company, settings }) => `Volatilidad IV ${(company.iv * 100).toFixed(1)}%, objetivo ${(settings.targetIv * 100).toFixed(0)}%`,
// Cierra el bloque, objeto o declaración iniciado anteriormente.
};
