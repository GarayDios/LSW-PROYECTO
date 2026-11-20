import { clamp } from '../nucleo-cuantitativo/math.ts';
import type { ScreeningCore } from '../compartido/types.ts';

export const liquidityCore: ScreeningCore = {
  score: ({ liquidity, company, tenor }) => .65 * liquidity + .25 * clamp(company.volume / 250000) + .10 * tenor,
  reason: ({ company }) => `Liquidez demo ${company.liquidity}/100, volumen ${company.volume}`,
};
