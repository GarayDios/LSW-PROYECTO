// Fórmulas heurísticas de demostración para BSM, griegas y probabilidad. Los cálculos de precio están
// separados en el núcleo cuantitativo.

// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { clamp, proximity } from '../nucleo-cuantitativo/math.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { ScreeningCore } from '../compartido/types.ts';

// Define la heurística BSM del ranking de demostración, separada del motor de valoración matemática.
export const bsmCore: ScreeningCore = {
  // Calcula su puntuación a partir de prima teórica, empresa y objetivos de muestra.
  score({ value, company, settings, days, ivFit, tenor }) {
    // Compara prima/precio con el rendimiento objetivo escalado por raíz del plazo; la tolerancia 0.06 es
    // heurística.
    const premiumFit = proximity(value.price / company.price, settings.targetYield * Math.sqrt(days / settings.targetDays), .06);
    // Combina 46% de ajuste de prima, 34% de IV y 20% de plazo.
    return .46 * premiumFit + .34 * ivFit + .20 * tenor;
  // Cierra el bloque, objeto o llamada definido anteriormente.
  },
  // Explica IV y prima BSM relativas del ejemplo, sin atribuirlas a una cotización real.
  reason: ({ company, value }) => `IV ${(company.iv * 100).toFixed(0)}% · prima BSM ${(value.price / company.price * 100).toFixed(1)}%`,
// Cierra el bloque, objeto o llamada definido anteriormente.
};

// Define el criterio de sensibilidades de demostración.
export const greeksCore: ScreeningCore = {
  // Recibe griegas, objetivos, liquidez y plazo del contexto ilustrativo.
  score({ value, company, settings, strategy, liquidity, tenor }) {
    // Mide cercanía de delta absoluta al objetivo con tolerancia 0.30.
    const deltaFit = proximity(Math.abs(value.delta), settings.targetDelta, .30);
    // Normaliza gamma escalada por precio y la limita a [0,1].
    const scaledGamma = clamp(value.gamma * company.price / 5);
    // Usa gamma para la estrategia Gamma y ajuste de delta para las demás; añade liquidez y plazo con pesos
    // fijos.
    return .48 * (strategy === 'gamma' ? scaledGamma : deltaFit) + .38 * liquidity + .14 * tenor;
  // Cierra el bloque, objeto o llamada definido anteriormente.
  },
  // Explica delta y liquidez de muestra.
  reason: ({ value, company }) => `Δ ${value.delta.toFixed(2)} · liquidez ${company.liquidity}/100`,
// Cierra el bloque, objeto o llamada definido anteriormente.
};

// Define el criterio de probabilidad de una sola pierna del ranking ilustrativo.
export const probabilityCore: ScreeningCore = {
  // Combina 50% de probabilidad modelada, 30% de liquidez y 20% de ajuste de IV; no es una probabilidad
  // conjunta nueva.
  score: ({ probabilityOfProfit, liquidity, ivFit }) => .5 * probabilityOfProfit + .30 * liquidity + .20 * ivFit,
  // La explicación conserva la probabilidad teórica individual antes de mezclarla en la puntuación.
  reason: ({ probabilityOfProfit }) => `Prob. teórica de la pierna ${(probabilityOfProfit * 100).toFixed(0)}%`,
// Cierra el bloque, objeto o llamada definido anteriormente.
};
