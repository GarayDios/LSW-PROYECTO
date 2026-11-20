/** The seven functional cores. Separate from the legacy quantitative criteria. */
export const FUNCTIONAL_CORES = [
  { id: 'technical', title: 'Análisis Técnico', folder: '01-analisis-tecnico', purpose: 'Calcula indicadores y describe precio, tendencia, volumen y volatilidad.' },
  { id: 'ai', title: 'Inteligencia Artificial', folder: '02-inteligencia-artificial', purpose: 'Estima movimientos y compara alternativas según las preferencias del usuario.' },
  { id: 'news', title: 'Noticias Financieras', folder: '03-noticias-financieras', purpose: 'Normaliza noticias y conserva fuente y disponibilidad temporal.' },
  { id: 'fundamental', title: 'Análisis Financiero (Fundamental)', folder: '04-analisis-fundamental', purpose: 'Interpreta los hechos contables y calcula ratios de períodos comparables.' },
  { id: 'signals', title: 'Indicadores y Señales de Compra y Venta', folder: '05-indicadores-y-senales', purpose: 'Convierte indicadores técnicos en reglas de compra, venta o espera y las valida.' },
  { id: 'risk', title: 'Gestión de Riesgos', folder: '06-gestion-de-riesgos', purpose: 'Mide exposición y aplica límites de capital, delta y pérdida diaria.' },
  { id: 'portfolio', title: 'Gestión y Optimización de Portafolio', folder: '07-gestion-de-portafolio', purpose: 'Gestiona ciclos, posiciones y capital; la optimización conjunta sigue pendiente.' },
] as const;

export type FunctionalCoreId = (typeof FUNCTIONAL_CORES)[number]['id'];
