// Catálogo de presentación para métricas Finnhub. Mantiene separados TTM, año fiscal, trimestre y datos de
// mercado; aquí no se consultan proveedores.

// Importa únicamente tipos para comprobar estructuras en TypeScript; esta declaración no ejecuta lógica en
// tiempo de ejecución.
import type { ResearchVariable, ProviderStatus } from '../compartido/research-model.ts';

// Enumera categorías internas de presentación: valoración, rentabilidad, crecimiento, solvencia, mercado y
// otras.
export type MetricCategory = 'valuation' | 'profitability' | 'growth' | 'solvency' | 'market' | 'other';
// Describe una métrica del proveedor: clave exacta, etiqueta, categoría, indicador de porcentaje y período;
// TTM significa últimos doce meses.
export type CompanyMetricDefinition = { key: string; label: string; category: MetricCategory; percent?: boolean; period: 'TTM' | 'anual' | 'trimestral' | 'mercado' | 'publicado' };
// Abre el catálogo de métricas Finnhub; registra cómo mostrarlas, sin descargar ni calcular sus valores.
export const COMPANY_METRICS: CompanyMetricDefinition[] = [
  // Registra P/E para el período TTM.
  { key:'peTTM',label:'P/E',category:'valuation',period:'TTM' },
  // Registra P/E para el período anual.
  { key:'peAnnual',label:'P/E',category:'valuation',period:'anual' },
  // Registra Precio / valor contable para el período trimestral.
  { key:'pbQuarterly',label:'Precio / valor contable',category:'valuation',period:'trimestral' },
  // Registra Precio / valor contable para el período anual.
  { key:'pbAnnual',label:'Precio / valor contable',category:'valuation',period:'anual' },
  // Registra Precio / ventas para el período TTM.
  { key:'psTTM',label:'Precio / ventas',category:'valuation',period:'TTM' },
  // Registra Precio / ventas para el período anual.
  { key:'psAnnual',label:'Precio / ventas',category:'valuation',period:'anual' },
  // Registra Precio / flujo de caja libre por acción para el período TTM.
  { key:'pfcfShareTTM',label:'Precio / flujo de caja libre por acción',category:'valuation',period:'TTM' },
  // Registra Precio / flujo de caja por acción para el período TTM.
  { key:'pcfShareTTM',label:'Precio / flujo de caja por acción',category:'valuation',period:'TTM' },
  // Registra Margen neto para el período TTM; su valor se expresa internamente como fracción y se presenta
  // como porcentaje.
  { key:'netProfitMarginTTM',label:'Margen neto',category:'profitability',percent:true,period:'TTM' },
  // Registra Margen neto para el período anual; su valor se expresa internamente como fracción y se presenta
  // como porcentaje.
  { key:'netProfitMarginAnnual',label:'Margen neto',category:'profitability',percent:true,period:'anual' },
  // Registra Margen bruto para el período TTM; su valor se expresa internamente como fracción y se presenta
  // como porcentaje.
  { key:'grossMarginTTM',label:'Margen bruto',category:'profitability',percent:true,period:'TTM' },
  // Registra Margen bruto para el período anual; su valor se expresa internamente como fracción y se presenta
  // como porcentaje.
  { key:'grossMarginAnnual',label:'Margen bruto',category:'profitability',percent:true,period:'anual' },
  // Registra Margen operativo para el período TTM; su valor se expresa internamente como fracción y se
  // presenta como porcentaje.
  { key:'operatingMarginTTM',label:'Margen operativo',category:'profitability',percent:true,period:'TTM' },
  // Registra Margen operativo para el período anual; su valor se expresa internamente como fracción y se
  // presenta como porcentaje.
  { key:'operatingMarginAnnual',label:'Margen operativo',category:'profitability',percent:true,period:'anual' },
  // Registra Rentabilidad del patrimonio (ROE) para el período TTM; su valor se expresa internamente como
  // fracción y se presenta como porcentaje.
  { key:'roeTTM',label:'Rentabilidad del patrimonio (ROE)',category:'profitability',percent:true,period:'TTM' },
  // Registra Rentabilidad del patrimonio (ROE) para el período anual; su valor se expresa internamente como
  // fracción y se presenta como porcentaje.
  { key:'roeRfy',label:'Rentabilidad del patrimonio (ROE)',category:'profitability',percent:true,period:'anual' },
  // Registra Rentabilidad de activos (ROA) para el período TTM; su valor se expresa internamente como fracción
  // y se presenta como porcentaje.
  { key:'roaTTM',label:'Rentabilidad de activos (ROA)',category:'profitability',percent:true,period:'TTM' },
  // Registra Rentabilidad del capital invertido para el período TTM; su valor se expresa internamente como
  // fracción y se presenta como porcentaje.
  { key:'roicTTM',label:'Rentabilidad del capital invertido',category:'profitability',percent:true,period:'TTM' },
  // Registra Crecimiento de ingresos interanual para el período TTM; su valor se expresa internamente como
  // fracción y se presenta como porcentaje.
  { key:'revenueGrowthTTMYoy',label:'Crecimiento de ingresos interanual',category:'growth',percent:true,period:'TTM' },
  // Registra Crecimiento de ingresos interanual para el período trimestral; su valor se expresa internamente
  // como fracción y se presenta como porcentaje.
  { key:'revenueGrowthQuarterlyYoy',label:'Crecimiento de ingresos interanual',category:'growth',percent:true,period:'trimestral' },
  // Registra Crecimiento de ingresos · 3 años para el período publicado; su valor se expresa internamente como
  // fracción y se presenta como porcentaje.
  { key:'revenueGrowth3Y',label:'Crecimiento de ingresos · 3 años',category:'growth',percent:true,period:'publicado' },
  // Registra Crecimiento de ingresos · 5 años para el período publicado; su valor se expresa internamente como
  // fracción y se presenta como porcentaje.
  { key:'revenueGrowth5Y',label:'Crecimiento de ingresos · 5 años',category:'growth',percent:true,period:'publicado' },
  // Registra Crecimiento de EPS interanual para el período TTM; su valor se expresa internamente como fracción
  // y se presenta como porcentaje.
  { key:'epsGrowthTTMYoy',label:'Crecimiento de EPS interanual',category:'growth',percent:true,period:'TTM' },
  // Registra Crecimiento de EPS interanual para el período trimestral; su valor se expresa internamente como
  // fracción y se presenta como porcentaje.
  { key:'epsGrowthQuarterlyYoy',label:'Crecimiento de EPS interanual',category:'growth',percent:true,period:'trimestral' },
  // Registra Crecimiento de EPS · 3 años para el período publicado; su valor se expresa internamente como
  // fracción y se presenta como porcentaje.
  { key:'epsGrowth3Y',label:'Crecimiento de EPS · 3 años',category:'growth',percent:true,period:'publicado' },
  // Registra Crecimiento de EPS · 5 años para el período publicado; su valor se expresa internamente como
  // fracción y se presenta como porcentaje.
  { key:'epsGrowth5Y',label:'Crecimiento de EPS · 5 años',category:'growth',percent:true,period:'publicado' },
  // Registra Razón corriente para el período trimestral.
  { key:'currentRatioQuarterly',label:'Razón corriente',category:'solvency',period:'trimestral' },
  // Registra Razón corriente para el período anual.
  { key:'currentRatioAnnual',label:'Razón corriente',category:'solvency',period:'anual' },
  // Registra Prueba ácida para el período trimestral.
  { key:'quickRatioQuarterly',label:'Prueba ácida',category:'solvency',period:'trimestral' },
  // Registra Prueba ácida para el período anual.
  { key:'quickRatioAnnual',label:'Prueba ácida',category:'solvency',period:'anual' },
  // Registra Deuda / patrimonio · unidad del proveedor para el período trimestral.
  { key:'totalDebt/totalEquityQuarterly',label:'Deuda / patrimonio · unidad del proveedor',category:'solvency',period:'trimestral' },
  // Registra Deuda / patrimonio · unidad del proveedor para el período anual.
  { key:'totalDebt/totalEquityAnnual',label:'Deuda / patrimonio · unidad del proveedor',category:'solvency',period:'anual' },
  // Registra Capitalización · unidad del proveedor para el período mercado.
  { key:'marketCapitalization',label:'Capitalización · unidad del proveedor',category:'market',period:'mercado' },
  // Registra Beta para el período mercado.
  { key:'beta',label:'Beta',category:'market',period:'mercado' },
  // Registra Máximo de 52 semanas para el período mercado.
  { key:'52WeekHigh',label:'Máximo de 52 semanas',category:'market',period:'mercado' },
  // Registra Mínimo de 52 semanas para el período mercado.
  { key:'52WeekLow',label:'Mínimo de 52 semanas',category:'market',period:'mercado' },
  // Registra Retorno de 52 semanas para el período mercado; su valor se expresa internamente como fracción y
  // se presenta como porcentaje.
  { key:'52WeekPriceReturnDaily',label:'Retorno de 52 semanas',category:'market',percent:true,period:'mercado' },
  // Registra EPS por acción para el período TTM.
  { key:'epsTTM',label:'EPS por acción',category:'profitability',period:'TTM' },
  // Registra Ingresos por acción para el período TTM.
  { key:'revenuePerShareTTM',label:'Ingresos por acción',category:'profitability',period:'TTM' },
  // Registra Valor contable por acción para el período trimestral.
  { key:'bookValuePerShareQuarterly',label:'Valor contable por acción',category:'valuation',period:'trimestral' },
  // Registra Flujo de caja por acción para el período TTM.
  { key:'cashFlowPerShareTTM',label:'Flujo de caja por acción',category:'profitability',period:'TTM' },
  // Registra Rendimiento de dividendo indicado para el período anual; su valor se expresa internamente como
  // fracción y se presenta como porcentaje.
  { key:'dividendYieldIndicatedAnnual',label:'Rendimiento de dividendo indicado',category:'market',percent:true,period:'anual' },
  // Registra Ratio de distribución de dividendos para el período TTM; su valor se expresa internamente como
  // fracción y se presenta como porcentaje.
  { key:'payoutRatioTTM',label:'Ratio de distribución de dividendos',category:'profitability',percent:true,period:'TTM' },
// Cierra la lista de elementos definida en las líneas anteriores.
];
// Define identificadores de categoría y sus nombres en español para agrupar métricas en la interfaz.
export const COMPANY_METRIC_CATEGORIES: { id:MetricCategory; label:string }[] = [
  // Relaciona cada identificador de categoría con su etiqueta en español; agrupa las métricas sin cambiar sus
  // valores.
  {id:'valuation',label:'Valoración'}, {id:'profitability',label:'Rentabilidad y márgenes'}, {id:'growth',label:'Crecimiento'}, {id:'solvency',label:'Liquidez y solvencia'}, {id:'market',label:'Contexto bursátil'}, {id:'other',label:'Otras métricas publicadas'},
// Cierra la lista de elementos definida en las líneas anteriores.
];
// Busca la definición visual de una clave que devuelve el proveedor.
export function companyMetricDefinition(key:string):CompanyMetricDefinition {
  // Devuelve su definición conocida o conserva la clave como etiqueta en Otras métricas; no inventa unidad ni
  // período específico.
  return COMPANY_METRICS.find(m=>m.key===key)??{key,label:key,category:'other',period:'publicado'};
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
// Define la respuesta normalizada de datos adicionales de una empresa procedentes de Finnhub.
export type CompanyDetails = {
  // Registra proveedor, fecha de consulta, estado y variables con fuente y disponibilidad por cada clave de
  // métrica.
  source:'Finnhub'; fetchedAt:string|null; status:ProviderStatus; metrics:Record<string,ResearchVariable>;
  // Describe el perfil opcional: nombre, industria, bolsa, país, moneda, fecha de salida a bolsa y sitio web.
  profile:{name:string|null;industry:string|null;exchange:string|null;country:string|null;currency:string|null;ipo:string|null;website:string|null};
  // Guarda por período los recuentos de recomendaciones de analistas, desde compra fuerte hasta venta fuerte;
  // no son órdenes del sistema.
  recommendations:{period:string;strongBuy:number;buy:number;hold:number;sell:number;strongSell:number}[];
  // Conserva advertencias de cobertura, fechas o unidades para mostrarlas al usuario.
  warnings:string[];
// Cierra el bloque, objeto o declaración iniciado anteriormente.
};
