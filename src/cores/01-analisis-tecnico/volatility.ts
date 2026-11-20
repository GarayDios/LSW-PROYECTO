import type { ScreeningCore } from '../compartido/types.ts';

export const volatilityCore: ScreeningCore = {
  score: ({ ivFit, tenor }) => .8 * ivFit + .2 * tenor,
  reason: ({ company, settings }) => `Volatilidad IV ${(company.iv * 100).toFixed(1)}%, objetivo ${(settings.targetIv * 100).toFixed(0)}%`,
};
