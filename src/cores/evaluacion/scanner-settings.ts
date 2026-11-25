import { z } from 'zod';

export const SCANNER_CORE_IDS = ['own', 'fundamental', 'monteCarlo', 'structure', 'institutional', 'technical', 'news'] as const;
export type ScannerCoreId = typeof SCANNER_CORE_IDS[number];
export const scannerCores = [
  { id: 'own', title: 'Estrategia propia', description: 'Regla SMA/RSI o confluencia elegida para las señales.' },
  { id: 'fundamental', title: 'Fundamental', description: 'Margen neto y pasivos sobre activos publicados en la fecha de corte.' },
  { id: 'monteCarlo', title: 'Monte Carlo (PoP)', description: '2,000 trayectorias con semilla fija, primas y costes de la estructura seleccionada.' },
  { id: 'structure', title: 'Soportes y resistencias', description: 'Posición del precio entre niveles confirmados sin información futura.' },
  { id: 'institutional', title: 'Flujo institucional', description: 'Requiere flujo institucional neto normalizado de una fuente identificada; el volumen no lo sustituye.' },
  { id: 'technical', title: 'Indicadores técnicos', description: 'SMA20/50, RSI14 y MACD calculados con velas cerradas.' },
  { id: 'news', title: 'Noticias y earnings', description: 'Sentimiento de titulares conocidos en el corte, con menor peso al envejecer. Clasificación por reglas, sin modelo predictivo entrenado.' },
] as const;
const entry = z.object({ enabled: z.boolean(), weight: z.number().finite().min(0).max(100).default(1) }).strict();
export const scannerSettingsSchema = z.object({
  cores: z.object({ own: entry, fundamental: entry, monteCarlo: entry, structure: entry, institutional: entry, technical: entry, news: entry }).strict(),
  rule: z.enum(['sma-rsi', 'sma-cross', 'technical-confluence']).default('sma-rsi'),
}).strict();
export type ScannerSettings = z.infer<typeof scannerSettingsSchema>;
export const defaultScannerSettings = scannerSettingsSchema.parse({ cores: Object.fromEntries(SCANNER_CORE_IDS.map(id => [id, { enabled: true, weight: 1 }])) });
export const activeScannerCores = (settings: ScannerSettings) => SCANNER_CORE_IDS.filter(id => settings.cores[id].enabled && settings.cores[id].weight > 0);
