import type { ScreeningCore } from '../compartido/types.ts';

export const riskCore: ScreeningCore = {
  // Relative spot exposure over the tenor; not broker margin or strategy VaR.
  score: ({ company, days, liquidity, tenor }) => .6 / (1 + company.iv * Math.sqrt(days / 365) * 4) + .25 * liquidity + .15 * tenor,
  reason: ({ company, days }) => `Riesgo: movimiento 1σ ${(company.iv * Math.sqrt(days / 365) * 100).toFixed(1)}% a ${days} días`,
};
