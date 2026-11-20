import { knownBy, missingVariable, type FundamentalAnalysis, type FundamentalMetricId, type ResearchFundamentals, type ResearchVariable } from '../compartido/research-model.ts';

export const FUNDAMENTAL_METRICS: { id: FundamentalMetricId; label: string; format: 'number' | 'money' | 'percent' }[] = [
  { id: 'equity', label: 'Patrimonio contable', format: 'money' },
  { id: 'currentAssets', label: 'Activos corrientes', format: 'money' },
  { id: 'currentLiabilities', label: 'Pasivos corrientes', format: 'money' },
  { id: 'inventory', label: 'Inventarios', format: 'money' },
  { id: 'grossProfit', label: 'Utilidad bruta anual', format: 'money' },
  { id: 'operatingIncome', label: 'Resultado operativo anual', format: 'money' },
  { id: 'operatingCashFlow', label: 'Flujo operativo anual', format: 'money' },
  { id: 'capex', label: 'Inversión anual en propiedad y equipo (capex)', format: 'money' },
  { id: 'freeCashFlow', label: 'Flujo de caja libre anual · CFO − capex', format: 'money' },
  { id: 'annualEps', label: 'EPS anual reportado', format: 'money' },
  { id: 'grossMargin', label: 'Margen bruto anual', format: 'percent' },
  { id: 'operatingMargin', label: 'Margen operativo anual', format: 'percent' },
  { id: 'currentRatio', label: 'Razón corriente', format: 'number' },
  { id: 'quickRatio', label: 'Prueba ácida · (activos corrientes − inventario) / pasivos corrientes', format: 'number' },
  { id: 'liabilitiesToEquity', label: 'Pasivos totales / patrimonio · no deuda financiera / patrimonio', format: 'number' },
  { id: 'cashConversion', label: 'Flujo operativo / utilidad neta anual', format: 'number' },
  { id: 'revenueGrowth', label: 'Crecimiento de ingresos · año fiscal contra anterior', format: 'percent' },
  { id: 'incomeGrowth', label: 'Crecimiento de utilidad · base anterior positiva', format: 'percent' },
  { id: 'returnOnAssets', label: 'ROA · utilidad anual / activos medios', format: 'percent' },
  { id: 'returnOnEquity', label: 'ROE · utilidad anual / patrimonio medio', format: 'percent' },
  { id: 'marketCap', label: 'Capitalización estimada · precio × acciones reportadas', format: 'money' },
  { id: 'priceEarningsAnnual', label: 'Precio / EPS del último año fiscal · no P/E TTM', format: 'number' },
  { id: 'priceSalesAnnual', label: 'Capitalización / ingresos del último año fiscal', format: 'number' },
  { id: 'priceBook', label: 'Capitalización / patrimonio contable', format: 'number' },
  { id: 'freeCashFlowYield', label: 'Flujo libre anual / capitalización estimada', format: 'percent' },
];

export function emptyFundamentalAnalysis(reason: string): FundamentalAnalysis {
  return { metrics: Object.fromEntries(FUNDAMENTAL_METRICS.map(metric => [metric.id, missingVariable('SEC EDGAR · análisis fundamental', reason)])) as Record<FundamentalMetricId, ResearchVariable>,
    coverage: { available: 0, total: FUNDAMENTAL_METRICS.length }, warnings: [
      'Los ratios respetan las fechas y períodos reportados; faltante no significa cero.',
      'Los múltiplos anuales no son TTM ni estimaciones de analistas. No constituyen una valoración intrínseca completa.',
    ] };
}

export function fundamentalCoverage(analysis: FundamentalAnalysis): FundamentalAnalysis {
  return { ...analysis, coverage: { available: FUNDAMENTAL_METRICS.filter(metric => analysis.metrics[metric.id].value !== null).length, total: FUNDAMENTAL_METRICS.length } };
}

/** Price-based multiples keep market/filing provenance and never pretend to be TTM. */
export function enrichFundamentalValuation(fundamentals: ResearchFundamentals, spot: ResearchVariable, asOf: string): FundamentalAnalysis {
  const base = fundamentals.analysis ?? emptyFundamentalAnalysis('No hay conceptos contables ampliados disponibles.');
  const metrics = { ...base.metrics };
  const price = spot.value !== null && spot.value > 0 ? spot : missingVariable(spot.source, 'El precio de mercado debe ser positivo.');
  const calculate = (left: ResearchVariable, right: ResearchVariable, label: string, multiply = false): ResearchVariable => {
    if (!knownBy(left, asOf) || !knownBy(right, asOf) || left.value === null || right.value === null || (multiply ? left.value <= 0 || right.value <= 0 : right.value <= 0)) {
      return missingVariable('Mercado + SEC EDGAR', `${label}: faltan entradas conocidas o un denominador positivo.`);
    }
    const value = multiply ? left.value * right.value : left.value / right.value;
    if (!Number.isFinite(value)) return missingVariable('Mercado + SEC EDGAR', `${label}: resultado no finito; revisa las unidades de entrada.`);
    return { value, source: `${label} · ${left.source} · ${right.source}`,
      observedAt: spot.observedAt, availableAt: left.availableAt! > right.availableAt! ? left.availableAt : right.availableAt,
      kind: 'estimated', reason: 'Combina precio de mercado con el período contable identificado por la fuente. No es un múltiplo TTM ni un precio objetivo.' };
  };
  metrics.marketCap = calculate(price, fundamentals.sharesOutstanding, 'Capitalización', true);
  metrics.priceEarningsAnnual = calculate(price, metrics.annualEps, 'Precio / EPS anual');
  metrics.priceSalesAnnual = calculate(metrics.marketCap, fundamentals.annualRevenue, 'Precio / ventas anuales');
  metrics.priceBook = calculate(metrics.marketCap, metrics.equity, 'Precio / patrimonio');
  metrics.freeCashFlowYield = calculate(metrics.freeCashFlow, metrics.marketCap, 'Flujo libre anual / capitalización');
  return fundamentalCoverage({ ...base, metrics });
}
