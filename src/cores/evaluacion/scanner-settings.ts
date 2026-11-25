// Identificadores, etiquetas y esquemas de configuración de los siete cores funcionales, regla de señales,
// Monte Carlo y selección del universo.

// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { z } from 'zod';

// Enumera los siete identificadores funcionales del escáner actual; son distintos de los siete criterios
// cuantitativos anteriores.
export const SCANNER_CORE_IDS = ['own', 'fundamental', 'monteCarlo', 'structure', 'institutional', 'technical', 'news'] as const;
// Deriva el tipo de identificador a partir de esa lista de valores literales.
export type ScannerCoreId = typeof SCANNER_CORE_IDS[number];
// Abre las definiciones visibles de cada core funcional.
export const scannerCores = [
  // Describe Estrategia propia con su identificador y explicación para la interfaz; esta línea no calcula
  // puntuaciones.
  { id: 'own', title: 'Estrategia propia', description: 'Regla SMA/RSI o confluencia elegida para las señales.' },
  // Describe Fundamental con su identificador y explicación para la interfaz; esta línea no calcula
  // puntuaciones.
  { id: 'fundamental', title: 'Fundamental', description: 'Margen, solvencia, ROE y liquidez disponibles al corte. Finnhub y SEC conservan sus fuentes y períodos.' },
  // Describe Monte Carlo (PoP) con su identificador y explicación para la interfaz; esta línea no calcula
  // puntuaciones.
  { id: 'monteCarlo', title: 'Monte Carlo (PoP)', description: 'Trayectorias y semilla configurables, con primas y costes de la estructura seleccionada.' },
  // Describe Soportes y resistencias con su identificador y explicación para la interfaz; esta línea no
  // calcula puntuaciones.
  { id: 'structure', title: 'Soportes y resistencias', description: 'Posición del precio entre niveles confirmados sin información futura.' },
  // Describe Flujo institucional con su identificador y explicación para la interfaz; esta línea no calcula
  // puntuaciones.
  { id: 'institutional', title: 'Flujo institucional', description: 'Flujo observado, cambios de participación SEC 13F en una muestra de gestores recibidos automáticamente. Se identifica el tipo de evidencia; volumen y OI no acreditan compras institucionales.' },
  // Describe Indicadores técnicos con su identificador y explicación para la interfaz; esta línea no calcula
  // puntuaciones.
  { id: 'technical', title: 'Indicadores técnicos', description: 'SMA20/50, RSI14 y MACD calculados con velas cerradas.' },
  // Describe Noticias y earnings con su identificador y explicación para la interfaz; esta línea no calcula
  // puntuaciones.
  { id: 'news', title: 'Noticias y earnings', description: 'Sentimiento de titulares conocidos en el corte, con menor peso al envejecer. Clasificación por reglas, sin modelo predictivo entrenado.' },
// Cierra el catálogo como conjunto de valores literales para preservar sus identificadores.
] as const;
// Cada core necesita habilitación y peso finito de 0 a 100; peso predeterminado 1.
const entry = z.object({ enabled: z.boolean(), weight: z.number().finite().min(0).max(100).default(1) }).strict();
// Abre el esquema de toda la configuración del escáner.
export const scannerSettingsSchema = z.object({
  // Exige configuración de participación de cada uno de los siete cores funcionales.
  cores: z.object({ own: entry, fundamental: entry, monteCarlo: entry, structure: entry, institutional: entry, technical: entry, news: entry }).strict(),
  // Permite SMA/RSI, cruce de medias o confluencia técnica, con SMA/RSI como regla predeterminada.
  rule: z.enum(['sma-rsi', 'sma-cross', 'technical-confluence']).default('sma-rsi'),
  // Configura semilla reproducible, entre 100 y 10000 trayectorias y modo de datos; por defecto 2000
  // trayectorias.
  monteCarlo:z.object({seed:z.number().int().min(0).max(0xffffffff).default(20261124),paths:z.number().int().min(100).max(10000).default(2000),dataMode:z.enum(['auto','observed','estimated']).optional()}).strict().default({seed:20261124,paths:2000}),
  // Configura universo, confluencia mínima, límites 5/10/14 y orden por confluencia o PoP.
  scan:z.object({universe:z.enum(['catalog','current-list','technology']).default('catalog'),minConfluence:z.number().finite().min(0).max(100).default(0),limit:z.union([z.literal(5),z.literal(10),z.literal(14)]).default(14),order:z.enum(['confluence','pop']).default('confluence')}).strict().default({universe:'catalog',minConfluence:0,limit:14,order:'confluence'}),
// Rechaza propiedades de configuración no reconocidas.
}).strict();
// Deriva el tipo completo de ajustes desde el esquema validado.
export type ScannerSettings = z.infer<typeof scannerSettingsSchema>;
// Inicializa los siete cores habilitados con peso 1 y aplica el resto de valores predeterminados.
export const defaultScannerSettings = scannerSettingsSchema.parse({ cores: Object.fromEntries(SCANNER_CORE_IDS.map(id => [id, { enabled: true, weight: 1 }])) });
// Solo considera activos los cores habilitados y con peso estrictamente positivo.
export const activeScannerCores = (settings: ScannerSettings) => SCANNER_CORE_IDS.filter(id => settings.cores[id].enabled && settings.cores[id].weight > 0);
