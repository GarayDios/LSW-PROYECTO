// Punto de entrada del análisis técnico. Reexporta funciones y tipos; no realiza consultas ni genera
// órdenes.

// Reexporta estas funciones o constantes desde su archivo de implementación para ofrecer una entrada común
// al core.
export { calculateTechnicalIndicators } from './indicators.ts';
// Reexporta estos tipos para que otros módulos conozcan la estructura de los resultados sin ejecutar
// cálculos.
export type { TechnicalIndicator } from './indicators.ts';
// Reexporta estas funciones o constantes desde su archivo de implementación para ofrecer una entrada común
// al core.
export { deriveObservedMarket } from './market-analysis.ts';
// Reexporta estas funciones o constantes desde su archivo de implementación para ofrecer una entrada común
// al core.
export { analyzeSupportResistance } from './support-resistance.ts';
// Reexporta estos tipos para que otros módulos conozcan la estructura de los resultados sin ejecutar
// cálculos.
export type { PriceLevel, SupportResistance, StructurePoint } from './support-resistance.ts';
