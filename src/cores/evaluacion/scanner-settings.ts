import { z } from 'zod';

export const SCANNER_CORE_IDS = ['own', 'fundamental', 'monteCarlo', 'structure', 'institutional', 'technical', 'news'] as const;
export type ScannerCoreId = typeof SCANNER_CORE_IDS[number];
export const scannerCores = [
  { id: 'own', title: 'Estrategia propia', description: 'Regla SMA/RSI o confluencia elegida para las señales.' },
  { id: 'fundamental', title: 'Fundamental', description: 'Margen, solvencia, ROE y liquidez disponibles al corte. Finnhub y SEC conservan sus fuentes y períodos.' },
  { id: 'monteCarlo', title: 'Monte Carlo (PoP)', description: 'Trayectorias y semilla configurables, con primas y costes de la estructura seleccionada.' },
  { id: 'structure', title: 'Soportes y resistencias', description: 'Posición del precio entre niveles confirmados sin información futura.' },
  { id: 'institutional', title: 'Flujo institucional', description: 'Flujo observado, cambios de participación SEC 13F en una muestra de gestores recibidos automáticamente. Se identifica el tipo de evidencia; volumen y OI no acreditan compras institucionales.' },
  { id: 'technical', title: 'Indicadores técnicos', description: 'SMA20/50, RSI14 y MACD calculados con velas cerradas.' },
  { id: 'news', title: 'Noticias y earnings', description: 'Sentimiento de titulares conocidos en el corte, con menor peso al envejecer. Clasificación por reglas, sin modelo predictivo entrenado.' },
] as const;
const entry = z.object({ enabled: z.boolean(), weight: z.number().finite().min(0).max(100).default(1) }).strict();
export const scannerSettingsSchema = z.object({
  cores: z.object({ own: entry, fundamental: entry, monteCarlo: entry, structure: entry, institutional: entry, technical: entry, news: entry }).strict(),
  rule: z.enum(['sma-rsi', 'sma-cross', 'technical-confluence']).default('sma-rsi'),
  monteCarlo:z.object({seed:z.number().int().min(0).max(0xffffffff).default(20261124),paths:z.number().int().min(100).max(10000).default(2000),dataMode:z.enum(['auto','observed','estimated']).optional()}).strict().default({seed:20261124,paths:2000}),
  scan:z.object({universe:z.enum(['catalog','current-list','technology']).default('catalog'),minConfluence:z.number().finite().min(0).max(100).default(0),limit:z.union([z.literal(5),z.literal(10),z.literal(14)]).default(14),order:z.enum(['confluence','pop']).default('confluence')}).strict().default({universe:'catalog',minConfluence:0,limit:14,order:'confluence'}),
}).strict();
export type ScannerSettings = z.infer<typeof scannerSettingsSchema>;
export const defaultScannerSettings = scannerSettingsSchema.parse({ cores: Object.fromEntries(SCANNER_CORE_IDS.map(id => [id, { enabled: true, weight: 1 }])) });
export const activeScannerCores = (settings: ScannerSettings) => SCANNER_CORE_IDS.filter(id => settings.cores[id].enabled && settings.cores[id].weight > 0);
