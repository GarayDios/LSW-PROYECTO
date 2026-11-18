import { analysisSettingsSchema } from '../features/research/analysis-settings.ts';
import { z } from 'zod';
import { isSimCycle } from '../features/cycles/cycle-simulator.ts';
import type { SimCycle } from '../features/cycles/cycle-simulator.ts';
import type { PaperOrder } from '../features/orders/order-ticket.tsx';
import { companies } from '../features/market/data.ts';

export const LOCAL_STORAGE_KEY = 'tepic-terminal-v1';
// Reserve room for revision/owner metadata inside the 2 MiB API envelope.
export const MAX_STATE_BYTES = 2 * 1024 * 1024 - 8192;
const id = z.string().trim().min(1).max(128);
const finite = z.number().finite();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const strategy = z.enum(['wheel', 'pmcc', 'backspread', 'gamma']);
const symbol = z.string().refine(value => companies.some(company => company.symbol === value), 'Empresa desconocida.');
const rate = finite.min(0).max(.25);
const configSchema = z.object({
  cores: z.array(z.enum(['bsm', 'greeks', 'probability', 'volatility', 'trend', 'liquidity', 'risk'])).min(1).max(7),
  operationStart: date, operationEnd: date, startTime: time, endTime: time,
  historyStart: date, historyEnd: date, interval: z.enum(['5m', '15m', '1h', '1d']), rate, analysis: analysisSettingsSchema.optional(),
}).strict().refine(value => value.operationStart <= value.operationEnd && value.historyStart <= value.historyEnd && value.historyEnd <= value.operationStart && value.startTime < value.endTime, 'Fechas u horario inválidos.');

export const watchlistSchema = z.object({
  id, name: z.string().trim().min(1).max(128), symbols: z.array(symbol).min(1).max(1000),
  scores: z.record(z.object({ score: finite.min(0).max(100), reason: z.string().max(4000) }).strict()).optional(),
  strategy: strategy.optional(), config: configSchema.optional(),
  research: z.object({
    source: z.literal('alpaca'), generatedAt: z.string().datetime({ offset: true }), cutoff: z.string().datetime({ offset: true }),
    warnings: z.array(z.string().max(4000)).max(100),
    excluded: z.array(z.object({ symbol: z.string().max(16), reason: z.string().max(4000) }).strict()).max(100),
    snapshots: z.record(z.object({
      spot: finite.positive().nullable(), iv: finite.nonnegative().nullable(), score: finite.min(0).max(100).nullable(),
      probabilityOfProfit: finite.min(0).max(1).nullable(), probabilityLabel: z.string().max(1000),
      analysisSummary: z.string().max(16000).optional(), contractSymbol: z.string().max(64).nullable(), missing: z.array(z.string().max(1000)).max(100),
      sources: z.array(z.string().max(1000)).max(100),
    }).strict()),
  }).strict().optional(),
}).strict().refine(value => new Set(value.symbols).size === value.symbols.length, 'Hay empresas repetidas.');
export type Watchlist = z.infer<typeof watchlistSchema>;

export const paperOrderSchema: z.ZodType<PaperOrder> = z.object({
  id, symbol, side: z.enum(['buy', 'sell']), type: z.enum(['call', 'put']),
  strike: finite.positive().max(1e6), expiry: date, quantity: finite.int().min(1).max(100),
  premium: finite.min(0).max(1e6), total: finite.min(0).max(1e12), createdAt: z.string().datetime({ offset: true }),
  status: z.literal('Simulada'), operationStart: date, operationEnd: date, startTime: time, endTime: time,
  multiplier:finite.positive().max(1e6).optional(),shares:finite.positive().max(1e6).optional(),
  provenance:z.object({mode:z.enum(['demo','observed','estimated','manual']),asOf:z.string().datetime({offset:true}).nullable(),contractSymbol:z.string().max(100).nullable(),
    spotSource:z.string().max(1500),volatilitySource:z.string().max(1500),rateSource:z.string().max(1500),dividendSource:z.string().max(1500),warnings:z.array(z.string().max(2000)).max(30),
    inputs:z.object({spot:finite.positive(),strike:finite.positive(),days:finite.nonnegative(),volatility:finite.nonnegative(),rate:finite,dividendYield:finite.nonnegative().optional(),type:z.enum(['call','put'])}).strict().nullable().optional()}).strict().optional(),
}).strict().refine(value => value.operationStart <= value.operationEnd && value.startTime < value.endTime, 'Fechas u horario inválidos.');

// Cycles retain the simulator's versioned, lossless state, including legs and events.
const cycleSchema = z.custom<SimCycle>(isSimCycle, 'El ciclo guardado no es válido.').superRefine((cycle, context) => {
  if (!cycle || !isSimCycle(cycle)) return;
  if (cycle.id.length > 128 || cycle.events.length > 10000 || cycle.legs.length > 1000 || !companies.some(company => company.symbol === cycle.symbol)) {
    context.addIssue({ code: 'custom', message: 'El ciclo excede los límites admitidos.' });
  }
});

export const terminalStateSchema = z.object({
  lists: z.array(watchlistSchema).max(200), orders: z.array(paperOrderSchema).max(5000),
  cycles: z.array(cycleSchema).max(200), rate,
}).strict().superRefine((state, context) => {
  for (const key of ['lists', 'orders', 'cycles'] as const) {
    if (new Set(state[key].map(item => item.id)).size !== state[key].length) context.addIssue({ code: 'custom', path: [key], message: 'Hay identificadores repetidos.' });
  }
});
export type TerminalState = z.infer<typeof terminalStateSchema>;

export function createDefaultState(): TerminalState {
  return {
    lists: [
      { id: 'favorites', name: 'Mi seguimiento', symbols: ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD'] },
      { id: 'technology', name: 'Tecnología', symbols: ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'META', 'AMD'] },
    ],
    orders: [], cycles: [], rate: .04,
  };
}
