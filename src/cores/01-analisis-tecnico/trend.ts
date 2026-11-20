import { proximity } from '../nucleo-cuantitativo/math.ts';
import type { ScreeningCore } from '../compartido/types.ts';

export const trendCore: ScreeningCore = {
  // Daily sample change is a proxy, not a measured historical trend.
  score: ({ company, strategy, tenor }) => .8 * proximity(company.change, strategy === 'backspread' ? 2.5 : strategy === 'gamma' ? 0 : 1, 2.5) + .2 * tenor,
  reason: ({ company }) => `Tendencia proxy: cambio demo ${company.change.toFixed(2)}%`,
};
