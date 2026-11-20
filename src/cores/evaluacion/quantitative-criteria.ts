import { clamp, proximity } from '../nucleo-cuantitativo/math.ts';
import type { ScreeningCore } from '../compartido/types.ts';

/** Historical demo criteria, separate from the pricing formulas and functional cores. */
export const bsmCore: ScreeningCore = {
  score({ value, company, settings, days, ivFit, tenor }) {
    const premiumFit = proximity(value.price / company.price, settings.targetYield * Math.sqrt(days / settings.targetDays), .06);
    return .46 * premiumFit + .34 * ivFit + .20 * tenor;
  },
  reason: ({ company, value }) => `IV ${(company.iv * 100).toFixed(0)}% · prima BSM ${(value.price / company.price * 100).toFixed(1)}%`,
};

export const greeksCore: ScreeningCore = {
  score({ value, company, settings, strategy, liquidity, tenor }) {
    const deltaFit = proximity(Math.abs(value.delta), settings.targetDelta, .30);
    const scaledGamma = clamp(value.gamma * company.price / 5);
    return .48 * (strategy === 'gamma' ? scaledGamma : deltaFit) + .38 * liquidity + .14 * tenor;
  },
  reason: ({ value, company }) => `Δ ${value.delta.toFixed(2)} · liquidez ${company.liquidity}/100`,
};

export const probabilityCore: ScreeningCore = {
  score: ({ probabilityOfProfit, liquidity, ivFit }) => .5 * probabilityOfProfit + .30 * liquidity + .20 * ivFit,
  reason: ({ probabilityOfProfit }) => `Prob. teórica de la pierna ${(probabilityOfProfit * 100).toFixed(0)}%`,
};
