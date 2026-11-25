// Normalización de hechos SEC con fecha de aceptación o disponibilidad conservadora. Los ratios requieren
// períodos compatibles; una ausencia nunca se convierte automáticamente en cero.

// Importa los ayudantes y tipos compartidos que utiliza este archivo; sus nombres se emplean en las
// validaciones y cálculos descritos a continuación.
import { missingVariable, type ResearchFundamentals, type ResearchVariable } from '../compartido/research-model.ts';
// Importa los ayudantes y tipos compartidos que utiliza este archivo; sus nombres se emplean en las
// validaciones y cálculos descritos a continuación.
import { numeric, record, timestamp } from '../compartido/data-values.ts';
// Importa los ayudantes y tipos compartidos que utiliza este archivo; sus nombres se emplean en las
// validaciones y cálculos descritos a continuación.
import { emptyFundamentalAnalysis, fundamentalCoverage } from './fundamental-metrics.ts';

// Define el nombre de procedencia que acompañará hechos y ratios obtenidos de SEC EDGAR Company Facts.
const SOURCE = 'SEC EDGAR Company Facts';
// Expresa un día en milisegundos para comparar ejercicios y calcular fechas de disponibilidad.
const DAY = 86_400_000;

// Construye fundamentales faltantes cuando no hay configuración o evidencia; el mensaje puede especificar la
// causa real.
export function missingFundamentals(message = 'Configura SEC_USER_AGENT con nombre de aplicación y contacto en el servidor.'): ResearchFundamentals {
  // Define un ayudante que crea una variable missing con etiqueta SEC y la explicación recibida.
  const missing = (label: string) => missingVariable(`${SOURCE} · ${label}`, message);
  // Comienza la estructura completa de respuesta para que los consumidores tengan siempre las mismas
  // propiedades.
  return {
    // Inicializa identidad e ingresos/utilidad como desconocidos, sin sustituirlos por cero.
    cik: null, companyName: null, annualRevenue: missing('ingresos anuales'), annualNetIncome: missing('resultado neto anual'),
    // Inicializa faltantes de activos, pasivos, efectivo y número de acciones.
    assets: missing('activos'), liabilities: missing('pasivos'), cash: missing('efectivo'), sharesOutstanding: missing('acciones'),
    // Inicializa faltantes de margen neto y pasivos/activos hasta disponer de partidas comparables.
    netMargin: missing('margen neto'), liabilitiesToAssets: missing('pasivos/activos'),
    // Prepara también las 25 métricas ampliadas con la misma explicación de ausencia.
    analysis: emptyFundamentalAnalysis(message),
    // Deja el rendimiento de dividendo futuro sin calcular: pagos contables pasados no justifican por sí solos
    // ese supuesto del modelo.
    dividendYield: missingVariable('Dividendo futuro continuo q', 'Los pagos pasados no determinan el dividendo futuro continuo; se requiere una fuente prospectiva o un supuesto manual explícito.'),
    // Incluye el estado inicial missing_config y una lista vacía de advertencias; el llamador puede completar
    // después ambos.
    status: { source: SOURCE, status: 'missing_config', message }, warnings: [],
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  };
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}

// Representa internamente un hecho: variable con procedencia, inicio opcional del período, final y fecha de
// presentación.
type SecFact = { variable: ResearchVariable; start: string | null; end: string; filed: string };

// Estima una disponibilidad conservadora cuando no se encuentra la hora de aceptación del documento.
function conservativeFiledAt(filed: string): string | null {
  // Comprueba que filed tenga formato de fecha y pueda convertirse a un instante finito.
  return /^\d{4}-\d{2}-\d{2}$/.test(filed) && Number.isFinite(Date.parse(filed))
    // Supone disponibilidad a las 05:00 UTC del día siguiente, después del día calendario del Este; retorna null
    // si la fecha no se puede usar.
    ? new Date(Date.parse(filed) + DAY + 5 * 3_600_000).toISOString() : null;
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}

// Normaliza Company Facts y Submissions para un CIK y una fecha de corte; la descarga HTTP se hace en un
// adaptador separado.
export function deriveSecFundamentals(companyFacts: unknown, submissions: unknown, asOf: string, cik: string): ResearchFundamentals {
  // Parte de una respuesta de faltantes; completa únicamente lo que pueda justificar con documentos
  // disponibles.
  const result = missingFundamentals('No se encontró un hecho comparable publicado antes del corte.');
  // Trata companyFacts como registro seguro; record evita acceder directamente a propiedades de valores
  // desconocidos.
  const body = record(companyFacts);
  // Normaliza de la misma forma la respuesta de presentaciones de la empresa.
  const filing = record(submissions);
  // Extrae la taxonomía us-gaap, donde se encuentran la mayoría de conceptos contables utilizados.
  const gaap = record(record(body.facts)['us-gaap']);
  // Extrae la taxonomía dei para conceptos de identidad y acciones del emisor.
  const dei = record(record(body.facts).dei);
  // Localiza las presentaciones recientes en filings.recent.
  const recent = record(record(filing.filings).recent);
  // Crea el mapa número de presentación → instante de aceptación pública.
  const acceptance = new Map<string, string>();
  // Solo recorre números y horas de aceptación si ambas propiedades son listas.
  if (Array.isArray(recent.accessionNumber) && Array.isArray(recent.acceptanceDateTime)) {
    // Recorre por índice las presentaciones para relacionar cada número con su hora correspondiente.
    for (let i = 0; i < recent.accessionNumber.length; i++) {
      // Normaliza la hora de aceptación a una fecha utilizable.
      const date = timestamp(recent.acceptanceDateTime[i]);
      // Guarda el par solamente si hay hora válida y un identificador de presentación de tipo texto.
      if (date && typeof recent.accessionNumber[i] === 'string') acceptance.set(recent.accessionNumber[i], date);
    // Cierra el bloque, objeto o declaración iniciado anteriormente.
    }
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  }
  // Define el selector de hechos por etiquetas alternativas, unidad, exigencia anual, taxonomía y límite
  // opcional de período.
  const choose = (tags: string[], unit: string, annual = false, taxonomy: Record<string, unknown> = gaap, maxEnd?: string): SecFact | null => {
    // Prepara candidatos que conservarán prioridad de etiqueta además del hecho y sus fechas.
    const candidates: (SecFact & { priority: number })[] = [];
    // Recorre etiquetas equivalentes en el orden de preferencia recibido.
    tags.forEach((tag, priority) => {
      // Busca observaciones en la unidad exacta solicitada, por ejemplo USD o shares, sin mezclar unidades.
      const values = record(record(taxonomy[tag]).units)[unit];
      // Omite etiquetas que no ofrezcan una lista de observaciones en esa unidad.
      if (!Array.isArray(values)) return;
      // Revisa individualmente cada observación del concepto contable.
      for (const raw of values) {
        // Normaliza la observación como registro antes de leer sus propiedades.
        const fact = record(raw);
        // Convierte el valor financiero a número o null cuando no es interpretable.
        const value = numeric(fact.val);
        // Normaliza el final del período al que corresponde la cifra.
        const end = timestamp(fact.end);
        // Normaliza el inicio del período; los saldos instantáneos pueden carecer de él.
        const start = timestamp(fact.start);
        // Lee la fecha de presentación y utiliza texto vacío si no fue suministrada.
        const filed = typeof fact.filed === 'string' ? fact.filed : '';
        // Lee el número de presentación que vincula el hecho con el documento aceptado por SEC.
        const accession = typeof fact.accn === 'string' ? fact.accn : '';
        // Prefiere la aceptación exacta; si no la conoce, aplica la espera conservadora a la fecha de presentación.
        const availableAt = acceptance.get(accession) ?? conservativeFiledAt(filed);
        // Descarta valores ausentes, hechos sin fechas y cualquier hecho publicado o correspondiente a un período
        // posterior al corte.
        if (value === null || !end || !availableAt || Date.parse(availableAt) > Date.parse(asOf) || Date.parse(end) > Date.parse(asOf)) continue;
        // Cuando se busca un saldo o ejercicio anterior, excluye períodos que terminen después de maxEnd.
        if (maxEnd && end > maxEnd) continue;
        // Admite los formularios financieros indicados y sus enmiendas listadas; no acepta cualquier documento como
        // estado financiero comparable.
        if (!['10-K', '10-Q', '20-F', '40-F', '10-K/A', '10-Q/A', '20-F/A'].includes(String(fact.form))) continue;
        // Para conceptos anuales exige inicio y una duración entre 300 y 400 días, tolerando diferencias de
        // calendario fiscal.
        if (annual && (!start || Date.parse(end) - Date.parse(start) < 300 * DAY || Date.parse(end) - Date.parse(start) > 400 * DAY)) continue;
        // Añade un candidato con su prioridad de etiqueta, inicio, fin y fecha de presentación.
        candidates.push({ priority, start, end, filed,
          // Conserva número, fuente XBRL y presentación, observación al cierre contable y disponibilidad pública; el
          // hecho es observed.
          variable: { value, source: `${SOURCE} · ${tag} · ${accession}`, observedAt: end, availableAt, kind: 'observed' } });
      // Cierra el bloque, objeto o declaración iniciado anteriormente.
      }
    // Cierra el bloque, objeto o declaración iniciado anteriormente.
    });
    // Ordena por período más reciente, luego prioridad de etiqueta y finalmente presentación más reciente dentro
    // de esos criterios.
    candidates.sort((a, b) => b.end.localeCompare(a.end) || a.priority - b.priority || b.filed.localeCompare(a.filed));
    // Devuelve el primer candidato seleccionado o null si ninguno cumplió las restricciones.
    return candidates[0] ?? null;
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  };
  // Busca ingresos anuales en USD usando varias etiquetas XBRL equivalentes, en el orden especificado.
  const revenue = choose(['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'], 'USD', true);
  // Busca utilidad o pérdida neta anual en USD sin eliminar pérdidas negativas.
  const netIncome = choose(['NetIncomeLoss', 'ProfitLoss'], 'USD', true);
  // Selecciona activos totales como saldo contable; no exige duración anual porque es una cifra a una fecha.
  const assets = choose(['Assets'], 'USD');
  // Selecciona pasivos totales bajo el mismo criterio de saldo contable.
  const liabilities = choose(['Liabilities'], 'USD');
  // Selecciona efectivo y equivalentes reportados en USD.
  const cash = choose(['CashAndCashEquivalentsAtCarryingValue'], 'USD');
  // Busca acciones en dei y, si faltan, en us-gaap; conserva la unidad shares y evita inferirla de un importe
  // monetario.
  const shares = choose(['EntityCommonStockSharesOutstanding'], 'shares', false, dei) ?? choose(['CommonStockSharesOutstanding'], 'shares');
  // Define cómo formar ratios a partir de dos hechos ya seleccionados.
  const combine = (left: SecFact | null, right: SecFact | null, label: string): ResearchVariable => {
    // Exige ambas partidas, denominador positivo e inicio y fin idénticos para impedir mezclar ejercicios o
    // fechas.
    if (!left || !right || right.variable.value === null || right.variable.value <= 0 || left.start !== right.start || left.end !== right.end) {
      // Devuelve un faltante cuando los hechos no tienen períodos y unidades comparables para el ratio solicitado.
      return missingVariable(SOURCE, `${label}: faltan hechos de idéntico período y unidad comparable.`);
    // Cierra el bloque, objeto o declaración iniciado anteriormente.
    }
    // Divide numerador por denominador y registra el final del período como observación del ratio.
    return { value: left.variable.value! / right.variable.value, source: `${SOURCE} · ${label}`, observedAt: left.end,
      // Asigna la disponibilidad más tardía de ambas partidas y marca el ratio derivado como estimated.
      availableAt: left.variable.availableAt! > right.variable.availableAt! ? left.variable.availableAt : right.variable.availableAt, kind: 'estimated' };
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  };
  // Incluye el CIK que identifica al emisor en SEC.
  result.cik = cik;
  // Prefiere el nombre de Submissions; si falta usa entityName de Company Facts y, si ambos faltan, null.
  result.companyName = typeof filing.name === 'string' ? filing.name : typeof body.entityName === 'string' ? body.entityName : null;
  // Publica ingresos anuales solamente si el selector encontró un hecho utilizable.
  if (revenue) result.annualRevenue = revenue.variable;
  // Publica utilidad o pérdida neta anual cuando existe evidencia.
  if (netIncome) result.annualNetIncome = netIncome.variable;
  // Publica el saldo de activos seleccionado.
  if (assets) result.assets = assets.variable;
  // Publica el saldo de pasivos seleccionado.
  if (liabilities) result.liabilities = liabilities.variable;
  // Publica efectivo y equivalentes seleccionados.
  if (cash) result.cash = cash.variable;
  // Publica el número de acciones seleccionado, sin suponer que sea una cifra en tiempo real.
  if (shares) result.sharesOutstanding = shares.variable;
  // Calcula margen neto anual = resultado neto / ingresos, con períodos coincidentes.
  result.netMargin = combine(netIncome, revenue, 'resultado neto / ingresos anuales');
  // Calcula pasivos / activos a una misma fecha; pasivos no equivale únicamente a deuda financiera.
  result.liabilitiesToAssets = combine(liabilities, assets, 'pasivos / activos');
  // Toma el análisis ampliado inicializado por missingFundamentals; ! afirma que aquí existe.
  const analysis = result.analysis!;
  // Obtiene su diccionario para incorporar partidas y métricas derivadas.
  const metrics = analysis.metrics;
  // Define las dos etiquetas admitidas de patrimonio, incluida la variante con intereses no controladores.
  const equityTags = ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'];
  // Selecciona el saldo de patrimonio en USD.
  const equity = choose(equityTags, 'USD');
  // Selecciona activos y pasivos corrientes para medir liquidez financiera.
  const currentAssets = choose(['AssetsCurrent'], 'USD'), currentLiabilities = choose(['LiabilitiesCurrent'], 'USD');
  // Selecciona inventarios netos para calcular la prueba ácida.
  const inventory = choose(['InventoryNet'], 'USD');
  // Selecciona utilidad bruta y resultado operativo de un ejercicio completo.
  const grossProfit = choose(['GrossProfit'], 'USD', true), operatingIncome = choose(['OperatingIncomeLoss'], 'USD', true);
  // Selecciona flujo de efectivo operativo anual, que no es lo mismo que utilidad contable.
  const cfo = choose(['NetCashProvidedByUsedInOperatingActivities'], 'USD', true);
  // Selecciona pagos anuales por propiedad, planta y equipo como capex.
  const capex = choose(['PaymentsToAcquirePropertyPlantAndEquipment'], 'USD', true);
  // Prefiere EPS diluido y utiliza EPS básico si no hay alternativa de mayor prioridad, siempre en USD por
  // acción y período anual.
  const eps = choose(['EarningsPerShareDiluted', 'EarningsPerShareBasic'], 'USD/shares', true);
  // Comienza la lista de pares que relacionan identificadores internos de métricas con hechos contables
  // seleccionados.
  for (const [key, fact] of [['equity', equity], ['currentAssets', currentAssets], ['currentLiabilities', currentLiabilities],
    // Completa los pares de inventario, resultados, flujo, capex y EPS; as const conserva las claves literales
    // admitidas.
    ['inventory', inventory], ['grossProfit', grossProfit], ['operatingIncome', operatingIncome], ['operatingCashFlow', cfo], ['capex', capex], ['annualEps', eps]] as const) {
    // Copia cada hecho existente al análisis ampliado y conserva los demás como faltantes.
    if (fact) metrics[key] = fact.variable;
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  }
  // Define el envoltorio de un cálculo derivado con valor, entradas y etiqueta de fórmula.
  const computed = (value: number, inputs: SecFact[], label: string): ResearchVariable => ({ value,
    // Concatena la procedencia de todas las entradas para poder auditar el resultado.
    source: `${SOURCE} · ${label} · ${inputs.map(fact => fact.variable.source).join(' | ')}`,
    // Usa el final del último hecho como observación y la fecha de disponibilidad máxima de todas las entradas.
    observedAt: inputs.at(-1)!.end, availableAt: inputs.map(fact => fact.variable.availableAt!).sort().at(-1)!,
    // Marca el resultado como estimado y añade la fórmula como explicación de cómo se obtuvo.
    kind: 'estimated', reason: `Fórmula: ${label}. Solo usa hechos publicados en el corte y períodos comparables.` });
  // Solo calcula flujo libre si flujo operativo y capex existen, pertenecen al mismo ejercicio y capex no es
  // negativo.
  if (cfo && capex && cfo.start === capex.start && cfo.end === capex.end && capex.variable.value! >= 0) {
    // Calcula flujo de caja libre anual = flujo operativo − inversión en propiedad y equipo; admite un resultado
    // negativo.
    metrics.freeCashFlow = computed(cfo.variable.value! - capex.variable.value!, [cfo, capex], 'flujo operativo − inversión en propiedad y equipo');
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  }
  // Calcula margen bruto anual = utilidad bruta / ingresos del mismo ejercicio.
  metrics.grossMargin = combine(grossProfit, revenue, 'utilidad bruta / ingresos anuales');
  // Calcula margen operativo anual = resultado operativo / ingresos del mismo ejercicio.
  metrics.operatingMargin = combine(operatingIncome, revenue, 'resultado operativo / ingresos anuales');
  // Calcula conversión a efectivo = flujo operativo / utilidad neta; exige utilidad neta positiva como
  // denominador.
  metrics.cashConversion = combine(cfo, netIncome, 'flujo operativo / utilidad neta anual positiva');
  // Calcula razón corriente = activos corrientes / pasivos corrientes positivos y de la misma fecha.
  metrics.currentRatio = combine(currentAssets, currentLiabilities, 'activos corrientes / pasivos corrientes');
  // Calcula pasivos totales / patrimonio positivo; el nombre distingue este ratio de deuda financiera /
  // patrimonio.
  metrics.liabilitiesToEquity = combine(liabilities, equity, 'pasivos totales / patrimonio positivo');
  // Comprueba que activos corrientes, inventarios y pasivos corrientes existan y correspondan a una misma
  // fecha.
  if (currentAssets && inventory && currentLiabilities && currentAssets.end === inventory.end && inventory.end === currentLiabilities.end
    // Exige pasivos positivos e inventarios no negativos que no superen los activos corrientes.
    && currentLiabilities.variable.value! > 0 && inventory.variable.value! >= 0 && currentAssets.variable.value! >= inventory.variable.value!) {
    // Calcula prueba ácida = (activos corrientes − inventarios) / pasivos corrientes.
    metrics.quickRatio = computed((currentAssets.variable.value! - inventory.variable.value!) / currentLiabilities.variable.value!,
      // Conserva como evidencia las tres partidas y la fórmula completa de la prueba ácida.
      [currentAssets, inventory, currentLiabilities], '(activos corrientes − inventarios) / pasivos corrientes');
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  }
  // Define el cálculo de crecimiento entre un ejercicio anual actual y otro anterior comparable.
  const growth = (current: SecFact | null, tags: string[], label: string): ResearchVariable => {
    // Requiere un inicio de ejercicio conocido antes de intentar localizar el período previo.
    if (!current?.start) return missingVariable(SOURCE, `${label}: falta un año fiscal completo.`);
    // Fija como límite del ejercicio previo el día anterior al inicio del ejercicio actual.
    const priorEnd = new Date(Date.parse(current.start) - DAY).toISOString();
    // Busca la observación anual anterior con las mismas etiquetas y unidad USD.
    const previous = choose(tags, 'USD', true, gaap, priorEnd);
    // Mide en días la distancia entre finales de ejercicios para verificar que sean aproximadamente
    // consecutivos.
    const separation = previous ? (Date.parse(current.end) - Date.parse(previous.end)) / DAY : 0;
    // Exige ejercicio previo, base anterior positiva y separación entre 300 y 400 días; un salto desde pérdidas
    // no produce aquí un porcentaje engañoso.
    if (!previous || previous.variable.value! <= 0 || separation < 300 || separation > 400) return missingVariable(SOURCE, `${label}: falta el año anterior comparable con base positiva.`);
    // Calcula crecimiento = valor actual / valor anterior − 1 y conserva ambas fuentes.
    return computed(current.variable.value! / previous.variable.value! - 1, [previous, current], label);
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  };
  // Aplica el ayudante a ingresos anuales usando las alternativas XBRL previstas.
  metrics.revenueGrowth = growth(revenue, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'], 'crecimiento de ingresos anuales');
  // Aplica el ayudante a utilidad neta anual con una base anterior positiva.
  metrics.incomeGrowth = growth(netIncome, ['NetIncomeLoss', 'ProfitLoss'], 'crecimiento de utilidad neta anual');
  // Define ROA y ROE usando el promedio de los balances de apertura y cierre del mismo ejercicio.
  const returnOnAverageBalance = (tags: string[], label: string): ResearchVariable => {
    // Exige un ejercicio completo de utilidad neta para conocer qué fechas de balance deben compararse.
    if (!netIncome?.start) return missingVariable(SOURCE, `${label}: falta utilidad anual comparable.`);
    // Obtiene la fecha del balance inicial como el día anterior al comienzo del ejercicio de utilidad.
    const openingDate = new Date(Date.parse(netIncome.start) - DAY).toISOString();
    // Selecciona saldos de apertura y cierre hasta sus respectivas fechas límite.
    const opening = choose(tags, 'USD', false, gaap, openingDate), closing = choose(tags, 'USD', false, gaap, netIncome.end);
    // Exige que los saldos seleccionados coincidan exactamente con las fechas pedidas y ambos sean positivos.
    if (!opening || !closing || opening.end !== openingDate || closing.end !== netIncome.end || opening.variable.value! <= 0 || closing.variable.value! <= 0) {
      // Si faltan esos balances compatibles, conserva un faltante explicativo en lugar de usar un saldo de otro
      // período.
      return missingVariable(SOURCE, `${label}: faltan balances positivos al inicio y al final del mismo ejercicio.`);
    // Cierra el bloque, objeto o declaración iniciado anteriormente.
    }
    // Divide la utilidad anual entre el promedio de ambos saldos; conserva la evidencia de apertura, cierre y
    // utilidad.
    return computed(netIncome.variable.value! / ((opening.variable.value! + closing.variable.value!) / 2), [opening, closing, netIncome], label);
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  };
  // Calcula ROA = utilidad anual / promedio de activos iniciales y finales.
  metrics.returnOnAssets = returnOnAverageBalance(['Assets'], 'utilidad anual / activos medios del ejercicio');
  // Calcula ROE = utilidad anual / promedio del patrimonio inicial y final.
  metrics.returnOnEquity = returnOnAverageBalance(equityTags, 'utilidad anual / patrimonio medio del ejercicio');
  // Actualiza la cobertura de las 25 métricas ampliadas después de incorporar hechos y cálculos.
  result.analysis = fundamentalCoverage(analysis);
  // Cuenta por separado la cobertura de los seis conceptos base: ingresos, utilidad, activos, pasivos,
  // efectivo y acciones.
  const available = [revenue, netIncome, assets, liabilities, cash, shares].filter(Boolean).length;
  // Marca ready si existen los seis conceptos base o partial si falta alguno; ese estado no garantiza
  // cobertura de las 25 métricas.
  result.status = { source: SOURCE, status: available === 6 ? 'ready' : 'partial', message: `${available}/6 conceptos contables disponibles antes del corte; no todos los emisores usan las mismas etiquetas XBRL.` };
  // Explica que la disponibilidad depende de aceptación o fecha conservadora y que cierre contable no equivale
  // a publicación.
  result.warnings = ['Fundamentales según fecha de aceptación SEC, o cierre conservador del día de presentación cuando no hay hora. El período contable no es la fecha de publicación.',
    // Aclara que nombre y correspondencia ticker/CIK son metadatos actuales, no evidencia histórica para una
    // predicción.
    'Nombre y correspondencia ticker/CIK son metadatos actuales; no forman parte de una predicción histórica.',
    // Recuerda que los ratios contables aportan contexto y no representan por sí mismos una probabilidad de
    // éxito.
    'Los estados contables aportan contexto; sus ratios no se convierten en una probabilidad de éxito.'];
  // Entrega los fundamentales, métricas ampliadas, fuentes, fechas, cobertura y advertencias al resto del
  // sistema.
  return result;
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
