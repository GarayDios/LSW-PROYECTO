import type { ResearchVariable, ProviderStatus } from '../compartido/research-model.ts';

export type MetricCategory = 'valuation' | 'profitability' | 'growth' | 'solvency' | 'market' | 'other';
export type CompanyMetricDefinition = { key: string; label: string; category: MetricCategory; percent?: boolean; period: 'TTM' | 'anual' | 'trimestral' | 'mercado' | 'publicado' };
export const COMPANY_METRICS: CompanyMetricDefinition[] = [
  { key:'peTTM',label:'P/E',category:'valuation',period:'TTM' },
  { key:'peAnnual',label:'P/E',category:'valuation',period:'anual' },
  { key:'pbQuarterly',label:'Precio / valor contable',category:'valuation',period:'trimestral' },
  { key:'pbAnnual',label:'Precio / valor contable',category:'valuation',period:'anual' },
  { key:'psTTM',label:'Precio / ventas',category:'valuation',period:'TTM' },
  { key:'psAnnual',label:'Precio / ventas',category:'valuation',period:'anual' },
  { key:'pfcfShareTTM',label:'Precio / flujo de caja libre por acción',category:'valuation',period:'TTM' },
  { key:'pcfShareTTM',label:'Precio / flujo de caja por acción',category:'valuation',period:'TTM' },
  { key:'netProfitMarginTTM',label:'Margen neto',category:'profitability',percent:true,period:'TTM' },
  { key:'netProfitMarginAnnual',label:'Margen neto',category:'profitability',percent:true,period:'anual' },
  { key:'grossMarginTTM',label:'Margen bruto',category:'profitability',percent:true,period:'TTM' },
  { key:'grossMarginAnnual',label:'Margen bruto',category:'profitability',percent:true,period:'anual' },
  { key:'operatingMarginTTM',label:'Margen operativo',category:'profitability',percent:true,period:'TTM' },
  { key:'operatingMarginAnnual',label:'Margen operativo',category:'profitability',percent:true,period:'anual' },
  { key:'roeTTM',label:'Rentabilidad del patrimonio (ROE)',category:'profitability',percent:true,period:'TTM' },
  { key:'roeRfy',label:'Rentabilidad del patrimonio (ROE)',category:'profitability',percent:true,period:'anual' },
  { key:'roaTTM',label:'Rentabilidad de activos (ROA)',category:'profitability',percent:true,period:'TTM' },
  { key:'roicTTM',label:'Rentabilidad del capital invertido',category:'profitability',percent:true,period:'TTM' },
  { key:'revenueGrowthTTMYoy',label:'Crecimiento de ingresos interanual',category:'growth',percent:true,period:'TTM' },
  { key:'revenueGrowthQuarterlyYoy',label:'Crecimiento de ingresos interanual',category:'growth',percent:true,period:'trimestral' },
  { key:'revenueGrowth3Y',label:'Crecimiento de ingresos · 3 años',category:'growth',percent:true,period:'publicado' },
  { key:'revenueGrowth5Y',label:'Crecimiento de ingresos · 5 años',category:'growth',percent:true,period:'publicado' },
  { key:'epsGrowthTTMYoy',label:'Crecimiento de EPS interanual',category:'growth',percent:true,period:'TTM' },
  { key:'epsGrowthQuarterlyYoy',label:'Crecimiento de EPS interanual',category:'growth',percent:true,period:'trimestral' },
  { key:'epsGrowth3Y',label:'Crecimiento de EPS · 3 años',category:'growth',percent:true,period:'publicado' },
  { key:'epsGrowth5Y',label:'Crecimiento de EPS · 5 años',category:'growth',percent:true,period:'publicado' },
  { key:'currentRatioQuarterly',label:'Razón corriente',category:'solvency',period:'trimestral' },
  { key:'currentRatioAnnual',label:'Razón corriente',category:'solvency',period:'anual' },
  { key:'quickRatioQuarterly',label:'Prueba ácida',category:'solvency',period:'trimestral' },
  { key:'quickRatioAnnual',label:'Prueba ácida',category:'solvency',period:'anual' },
  { key:'totalDebt/totalEquityQuarterly',label:'Deuda / patrimonio · unidad del proveedor',category:'solvency',period:'trimestral' },
  { key:'totalDebt/totalEquityAnnual',label:'Deuda / patrimonio · unidad del proveedor',category:'solvency',period:'anual' },
  { key:'marketCapitalization',label:'Capitalización · unidad del proveedor',category:'market',period:'mercado' },
  { key:'beta',label:'Beta',category:'market',period:'mercado' },
  { key:'52WeekHigh',label:'Máximo de 52 semanas',category:'market',period:'mercado' },
  { key:'52WeekLow',label:'Mínimo de 52 semanas',category:'market',period:'mercado' },
  { key:'52WeekPriceReturnDaily',label:'Retorno de 52 semanas',category:'market',percent:true,period:'mercado' },
  { key:'epsTTM',label:'EPS por acción',category:'profitability',period:'TTM' },
  { key:'revenuePerShareTTM',label:'Ingresos por acción',category:'profitability',period:'TTM' },
  { key:'bookValuePerShareQuarterly',label:'Valor contable por acción',category:'valuation',period:'trimestral' },
  { key:'cashFlowPerShareTTM',label:'Flujo de caja por acción',category:'profitability',period:'TTM' },
  { key:'dividendYieldIndicatedAnnual',label:'Rendimiento de dividendo indicado',category:'market',percent:true,period:'anual' },
  { key:'payoutRatioTTM',label:'Ratio de distribución de dividendos',category:'profitability',percent:true,period:'TTM' },
];
export const COMPANY_METRIC_CATEGORIES: { id:MetricCategory; label:string }[] = [
  {id:'valuation',label:'Valoración'}, {id:'profitability',label:'Rentabilidad y márgenes'}, {id:'growth',label:'Crecimiento'}, {id:'solvency',label:'Liquidez y solvencia'}, {id:'market',label:'Contexto bursátil'}, {id:'other',label:'Otras métricas publicadas'},
];
export function companyMetricDefinition(key:string):CompanyMetricDefinition {
  return COMPANY_METRICS.find(m=>m.key===key)??{key,label:key,category:'other',period:'publicado'};
}
export type CompanyDetails = {
  source:'Finnhub'; fetchedAt:string|null; status:ProviderStatus; metrics:Record<string,ResearchVariable>;
  profile:{name:string|null;industry:string|null;exchange:string|null;country:string|null;currency:string|null;ipo:string|null;website:string|null};
  recommendations:{period:string;strongBuy:number;buy:number;hold:number;sell:number;strongSell:number}[];
  warnings:string[];
};
