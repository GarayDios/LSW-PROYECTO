// Catálogo ampliado SEC y múltiplos derivados del precio. Los cálculos preservan fechas, fuentes y faltantes
// y distinguen año fiscal de TTM.

// Importa los ayudantes y tipos compartidos que utiliza este archivo; sus nombres se emplean en las
// validaciones y cálculos descritos a continuación.
import { knownBy, missingVariable, type FundamentalAnalysis, type FundamentalMetricId, type ResearchFundamentals, type ResearchVariable } from '../compartido/research-model.ts';

// Enumera las 25 métricas ampliadas del análisis SEC con su identificador, etiqueta y formato de
// presentación.
export const FUNDAMENTAL_METRICS: { id: FundamentalMetricId; label: string; format: 'number' | 'money' | 'percent' }[] = [
  // Registra Patrimonio contable con formato monetario.
  { id: 'equity', label: 'Patrimonio contable', format: 'money' },
  // Registra Activos corrientes con formato monetario.
  { id: 'currentAssets', label: 'Activos corrientes', format: 'money' },
  // Registra Pasivos corrientes con formato monetario.
  { id: 'currentLiabilities', label: 'Pasivos corrientes', format: 'money' },
  // Registra Inventarios con formato monetario.
  { id: 'inventory', label: 'Inventarios', format: 'money' },
  // Registra Utilidad bruta anual con formato monetario.
  { id: 'grossProfit', label: 'Utilidad bruta anual', format: 'money' },
  // Registra Resultado operativo anual con formato monetario.
  { id: 'operatingIncome', label: 'Resultado operativo anual', format: 'money' },
  // Registra Flujo operativo anual con formato monetario.
  { id: 'operatingCashFlow', label: 'Flujo operativo anual', format: 'money' },
  // Registra Inversión anual en propiedad y equipo (capex) con formato monetario.
  { id: 'capex', label: 'Inversión anual en propiedad y equipo (capex)', format: 'money' },
  // Registra Flujo de caja libre anual · CFO − capex con formato monetario.
  { id: 'freeCashFlow', label: 'Flujo de caja libre anual · CFO − capex', format: 'money' },
  // Registra EPS anual reportado con formato monetario.
  { id: 'annualEps', label: 'EPS anual reportado', format: 'money' },
  // Registra Margen bruto anual con formato porcentaje.
  { id: 'grossMargin', label: 'Margen bruto anual', format: 'percent' },
  // Registra Margen operativo anual con formato porcentaje.
  { id: 'operatingMargin', label: 'Margen operativo anual', format: 'percent' },
  // Registra Razón corriente con formato numérico.
  { id: 'currentRatio', label: 'Razón corriente', format: 'number' },
  // Registra Prueba ácida · (activos corrientes − inventario) / pasivos corrientes con formato numérico.
  { id: 'quickRatio', label: 'Prueba ácida · (activos corrientes − inventario) / pasivos corrientes', format: 'number' },
  // Registra Pasivos totales / patrimonio · no deuda financiera / patrimonio con formato numérico.
  { id: 'liabilitiesToEquity', label: 'Pasivos totales / patrimonio · no deuda financiera / patrimonio', format: 'number' },
  // Registra Flujo operativo / utilidad neta anual con formato numérico.
  { id: 'cashConversion', label: 'Flujo operativo / utilidad neta anual', format: 'number' },
  // Registra Crecimiento de ingresos · año fiscal contra anterior con formato porcentaje.
  { id: 'revenueGrowth', label: 'Crecimiento de ingresos · año fiscal contra anterior', format: 'percent' },
  // Registra Crecimiento de utilidad · base anterior positiva con formato porcentaje.
  { id: 'incomeGrowth', label: 'Crecimiento de utilidad · base anterior positiva', format: 'percent' },
  // Registra ROA · utilidad anual / activos medios con formato porcentaje.
  { id: 'returnOnAssets', label: 'ROA · utilidad anual / activos medios', format: 'percent' },
  // Registra ROE · utilidad anual / patrimonio medio con formato porcentaje.
  { id: 'returnOnEquity', label: 'ROE · utilidad anual / patrimonio medio', format: 'percent' },
  // Registra Capitalización estimada · precio × acciones reportadas con formato monetario.
  { id: 'marketCap', label: 'Capitalización estimada · precio × acciones reportadas', format: 'money' },
  // Registra Precio / EPS del último año fiscal · no P/E TTM con formato numérico.
  { id: 'priceEarningsAnnual', label: 'Precio / EPS del último año fiscal · no P/E TTM', format: 'number' },
  // Registra Capitalización / ingresos del último año fiscal con formato numérico.
  { id: 'priceSalesAnnual', label: 'Capitalización / ingresos del último año fiscal', format: 'number' },
  // Registra Capitalización / patrimonio contable con formato numérico.
  { id: 'priceBook', label: 'Capitalización / patrimonio contable', format: 'number' },
  // Registra Flujo libre anual / capitalización estimada con formato porcentaje.
  { id: 'freeCashFlowYield', label: 'Flujo libre anual / capitalización estimada', format: 'percent' },
// Cierra la lista de elementos definida en las líneas anteriores.
];

// Construye un análisis vacío y explica el motivo de la ausencia de conceptos contables.
export function emptyFundamentalAnalysis(reason: string): FundamentalAnalysis {
  // Crea una variable missing por cada métrica del catálogo; sus valores empiezan en null y conservan una
  // fuente explícita.
  return { metrics: Object.fromEntries(FUNDAMENTAL_METRICS.map(metric => [metric.id, missingVariable('SEC EDGAR · análisis fundamental', reason)])) as Record<FundamentalMetricId, ResearchVariable>,
    // Inicializa cobertura disponible en cero y conserva el total de métricas previstas junto con advertencias.
    coverage: { available: 0, total: FUNDAMENTAL_METRICS.length }, warnings: [
      // Aclara al usuario que un dato ausente no equivale a un valor financiero cero.
      'Los ratios respetan las fechas y períodos reportados; faltante no significa cero.',
      // Distingue los múltiplos del ejercicio fiscal de los últimos doce meses y de previsiones futuras.
      'Los múltiplos anuales no son TTM ni estimaciones de analistas. No constituyen una valoración intrínseca completa.',
    // Cierra la lista de elementos definida en las líneas anteriores.
    ] };
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}

// Recalcula cuántas métricas ampliadas tienen valor conservando el resto del análisis.
export function fundamentalCoverage(analysis: FundamentalAnalysis): FundamentalAnalysis {
  // Cuenta valores distintos de null, incluidos cero y negativos; no confunde cobertura con calidad financiera
  // ni rentabilidad.
  return { ...analysis, coverage: { available: FUNDAMENTAL_METRICS.filter(metric => analysis.metrics[metric.id].value !== null).length, total: FUNDAMENTAL_METRICS.length } };
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}

// Añade múltiplos que combinan conceptos contables y precio conocido en la fecha de corte.
export function enrichFundamentalValuation(fundamentals: ResearchFundamentals, spot: ResearchVariable, asOf: string): FundamentalAnalysis {
  // Toma el análisis SEC previo o construye faltantes si no existe información ampliada.
  const base = fundamentals.analysis ?? emptyFundamentalAnalysis('No hay conceptos contables ampliados disponibles.');
  // Copia el diccionario de métricas para enriquecerlo sin sobrescribir el original recibido.
  const metrics = { ...base.metrics };
  // Solo admite un precio positivo; conserva un faltante con explicación si el precio es nulo o inválido.
  const price = spot.value !== null && spot.value > 0 ? spot : missingVariable(spot.source, 'El precio de mercado debe ser positivo.');
  // Define un ayudante para dividir variables o multiplicarlas cuando se solicita, preservando su
  // trazabilidad.
  const calculate = (left: ResearchVariable, right: ResearchVariable, label: string, multiply = false): ResearchVariable => {
    // Comprueba disponibilidad temporal, valores presentes y denominador positivo; la multiplicación exige ambos
    // factores positivos.
    if (!knownBy(left, asOf) || !knownBy(right, asOf) || left.value === null || right.value === null || (multiply ? left.value <= 0 || right.value <= 0 : right.value <= 0)) {
      // Devuelve un faltante explicable cuando las entradas no cumplen las condiciones de cálculo.
      return missingVariable('Mercado + SEC EDGAR', `${label}: faltan entradas conocidas o un denominador positivo.`);
    // Cierra el bloque, objeto o declaración iniciado anteriormente.
    }
    // Realiza la multiplicación o división con los valores que ya superaron las comprobaciones.
    const value = multiply ? left.value * right.value : left.value / right.value;
    // Evita publicar infinito o NaN, por ejemplo por magnitudes numéricas fuera de rango.
    if (!Number.isFinite(value)) return missingVariable('Mercado + SEC EDGAR', `${label}: resultado no finito; revisa las unidades de entrada.`);
    // Guarda el resultado y una fuente compuesta con la fórmula y las dos procedencias de entrada.
    return { value, source: `${label} · ${left.source} · ${right.source}`,
      // Usa la observación del precio y la disponibilidad más tardía de las entradas; el resultado no podía
      // conocerse antes.
      observedAt: spot.observedAt, availableAt: left.availableAt! > right.availableAt! ? left.availableAt : right.availableAt,
      // Identifica el múltiplo como estimado y aclara que no es TTM ni un precio objetivo.
      kind: 'estimated', reason: 'Combina precio de mercado con el período contable identificado por la fuente. No es un múltiplo TTM ni un precio objetivo.' };
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  };
  // Calcula capitalización estimada = precio × acciones reportadas; no presupone acciones actualizadas en
  // tiempo real.
  metrics.marketCap = calculate(price, fundamentals.sharesOutstanding, 'Capitalización', true);
  // Calcula P/E anual = precio / EPS del ejercicio; exige EPS positivo y no lo etiqueta como P/E TTM.
  metrics.priceEarningsAnnual = calculate(price, metrics.annualEps, 'Precio / EPS anual');
  // Calcula precio/ventas anual = capitalización estimada / ingresos del ejercicio.
  metrics.priceSalesAnnual = calculate(metrics.marketCap, fundamentals.annualRevenue, 'Precio / ventas anuales');
  // Calcula precio/valor contable = capitalización estimada / patrimonio positivo.
  metrics.priceBook = calculate(metrics.marketCap, metrics.equity, 'Precio / patrimonio');
  // Calcula rendimiento de flujo libre = flujo libre anual / capitalización; admite flujo negativo con
  // denominador positivo.
  metrics.freeCashFlowYield = calculate(metrics.freeCashFlow, metrics.marketCap, 'Flujo libre anual / capitalización');
  // Devuelve las métricas enriquecidas y actualiza su cobertura disponible.
  return fundamentalCoverage({ ...base, metrics });
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
