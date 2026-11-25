// Selección de contratos e inputs con evidencia temporal. Conserva ranking cuantitativo anterior y delega en
// el escáner actual cuando se suministra su configuración.

// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { analyzeStrategy, selectStrategyLegs, type AnalysisPolicy, type StrategyAnalysis } from './strategy-analysis.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { CORE_IDS, type CoreId, type OptionInputs, type StrategyId } from '../compartido/types.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { knownBy, missingVariable, type CompanyResearch, type CoreEvidence, type ObservedCoreResult, type ObservedOptionContract, type ResearchVariable } from '../compartido/research-model.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { equityTerms, valuationExpiry,modelDividendYield,cashDividendPv } from '../../features/research/contract-terms.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { activeCoreWeight, coreWeight, evaluationTuning } from './evaluation-policy.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { evaluateScanner, type ScannerEvaluation } from './scanner.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { withFinviz } from '../04-analisis-fundamental/finviz-data.ts';

// Amplía la política con entradas documentadas y selección opcional de un símbolo de contrato existente.
export type ObservedInputOverrides = { dividendYield?: ResearchVariable; riskFreeRate?: ResearchVariable; contractSymbol?: string } & AnalysisPolicy;
// Describe la fila de ranking de una empresa junto con evidencia y análisis contractual.
export type ObservedRankedCompany = {
  // Identifica la empresa evaluada.
  symbol: string;
  // Guarda puntuación o null si no es evaluable.
  score: number | null;
  // Guarda la explicación legible de la clasificación.
  reason: string;
  // Conserva aportes cuantitativos y evidencia por criterio.
  coreResults: ObservedCoreResult[];
  // Cuenta criterios que disponen de entradas utilizables.
  availableCoreCount: number;
  // Conserva PoP como variable con fuente y fechas, separada de la puntuación.
  probabilityOfProfit: ResearchVariable;
  // Explica el alcance de la probabilidad publicada.
  probabilityLabel: string;
  // Identifica el contrato de referencia o conserva null cuando falta.
  contractSymbol: string | null;
  // Conserva estructura, capital, escenarios y faltantes de la estrategia.
  strategyAnalysis: StrategyAnalysis;
  // Adjunta la evaluación del escáner funcional actual si se configuró.
  scannerEvaluation?: ScannerEvaluation;
// Cierra el bloque, objeto o llamada definido anteriormente.
};
// Define conversión de milisegundos a días.
const DAY = 86_400_000;
// Limita un criterio normalizado al intervalo [0,1].
const clamp = (x: number) => Math.max(0, Math.min(1, x));
// Define tipo y lado de la pierna de referencia por estrategia; no representa por sí sola todas las piernas
// de las combinadas.
const settings = {
  // Wheel usa una put vendida como referencia inicial.
  wheel: { type: 'put' as const, side: 'sell' as const },
  // PMCC usa una call comprada como referencia.
  pmcc: { type: 'call' as const, side: 'buy' as const },
  // Backspread usa una call comprada como referencia individual.
  backspread: { type: 'call' as const, side: 'buy' as const },
  // Gamma usa una call comprada como referencia individual.
  gamma: { type: 'call' as const, side: 'buy' as const },
// Cierra el bloque, objeto o llamada definido anteriormente.
};

// Selecciona un contrato ya existente; primero intenta obtenerlo de una estructura compatible.
export function selectObservedOption(snapshot: CompanyResearch, strategy: StrategyId, days: number, overrides: ObservedInputOverrides = {}): ObservedOptionContract | null {
  // Sin estrategia reconocida y plazo positivo no devuelve un contrato.
  if (!(strategy in settings) || !Number.isFinite(days) || days <= 0) return null;
  // Valida los ajustes de selección y devuelve null si fallan.
  let tuning;try {tuning=evaluationTuning(overrides.tuning);}catch{return null;}
  // Si no se pidió un símbolo concreto, intenta la primera pierna del selector estructural.
  const structural = !overrides.contractSymbol ? selectStrategyLegs(snapshot,strategy,days,overrides)[0]?.contract : null;
  // Prefiere esa selección estructural cuando existe.
  if (structural) return structural;
  // Obtiene el tipo de opción esperado para la estrategia.
  const config = settings[strategy];
  // Lee el spot con sus fechas y fuente.
  const spot = snapshot.market.spot;
  // Sin spot positivo conocido no intenta elegir un contrato.
  if (!knownBy(spot, snapshot.asOf) || spot.value! <= 0) return null;
  // Filtra por subyacente, tipo y strike conocido.
  const eligible = snapshot.options.contracts.filter(contract => contract.underlyingSymbol === snapshot.symbol && contract.type === config.type && knownBy(contract.strike, snapshot.asOf)
    // Exige strike positivo y fecha de vencimiento interpretable.
    && contract.strike.value! > 0 && Number.isFinite(Date.parse(contract.expiration))
    // Exige vencimiento de valoración posterior al corte.
    && valuationExpiry(contract,snapshot.asOf).time > Date.parse(snapshot.asOf)
    // Si se pidió contrato concreto, limita a ese símbolo.
    && (!overrides.contractSymbol || contract.symbol === overrides.contractSymbol));
  // Ordena los contratos de referencia que superaron los requisitos básicos.
  return eligible.sort((a, b) => {
    // Identifica cuáles tienen IV, prima y bid/ask conocidos al corte para darles prioridad.
    const quoted = (contract: ObservedOptionContract) => [contract.impliedVolatility, contract.premium, contract.bid, contract.ask].every(value => knownBy(value, snapshot.asOf));
    // Mide diferencia relativa al plazo solicitado con el peso configurado.
    const distance = (contract: ObservedOptionContract) => tuning.tenorWeight*Math.abs((valuationExpiry(contract,snapshot.asOf).time - Date.parse(snapshot.asOf)) / DAY - days) / Math.max(days, 1)
      // Añade distancia del strike efectivo al spot con su propio peso.
      + Math.abs((equityTerms(contract,snapshot.asOf)?.effectiveStrike??contract.strike.value!) / spot.value! - 1) * tuning.strikeDistanceWeight;
    // Prioriza cotizaciones completas, luego menor distancia y finalmente símbolo.
    return Number(quoted(b)) - Number(quoted(a)) || distance(a) - distance(b) || a.symbol.localeCompare(b.symbol);
  // Devuelve el primer contrato o null si no hay candidatos.
  })[0] ?? null;
// Cierra el bloque, objeto o llamada definido anteriormente.
}

// Construye entradas de una opción individual y su evidencia temporal para BSM o explicaciones del ranking.
export function observedOptionInputs(snapshot: CompanyResearch, contract: ObservedOptionContract | null, overrides: ObservedInputOverrides = {}): {
  // La salida distingue entradas válidas, prima convertida, faltantes, fuentes y advertencias.
  input: OptionInputs | null; premium: number | null; missing: string[]; evidence: CoreEvidence[]; warnings: string[];
// Abre el cuerpo de validación de las entradas individuales.
} {
  // Inicializa requisitos que todavía no se cumplen.
  const missing: string[] = [];
  // Inicializa advertencias que no siempre bloquean el cálculo.
  const warnings: string[] = [];
  // Valida límites de calidad y selección.
  const tuning=evaluationTuning(overrides.tuning);
  // Obtiene términos del contrato elegido o null si no existe.
  const terms=contract?equityTerms(contract,snapshot.asOf):null;
  // Construye el registro de evidencia financiera por nombre de entrada.
  const evidence: CoreEvidence[] = [
    // Conserva spot y su procedencia.
    { input: 'spot', variable: snapshot.market.spot },
    // Conserva strike o un faltante explícito si no hay contrato.
    { input: 'strike', variable: contract?.strike ?? missingVariable('Alpaca contrato', 'No hay contrato observado seleccionado.') },
    // Conserva IV del contrato o una explicación de ausencia.
    { input: 'impliedVolatility', variable: contract?.impliedVolatility ?? missingVariable('Alpaca IV', 'No hay IV observada de un contrato.') },
    // Prefiere tasa explícita de la política frente a la macro de la instantánea.
    { input: 'riskFreeRate', variable: overrides.riskFreeRate ?? snapshot.macro.riskFreeRate },
    // Resuelve el dividendo según la política elegida.
    { input: 'dividendYield', variable: modelDividendYield(snapshot,overrides) },
    // Conserva prima media del contrato o faltante.
    { input: 'premium', variable: contract?.premium ?? missingVariable('Alpaca prima media', 'No hay prima de contrato observada.') },
    // Conserva bid del proveedor o faltante.
    { input: 'bid', variable: contract?.bid ?? missingVariable('Alpaca bid', 'No hay bid observado.') },
    // Conserva ask del proveedor o faltante.
    { input: 'ask', variable: contract?.ask ?? missingVariable('Alpaca ask', 'No hay ask observado.') },
  // Cierra la lista de entradas o resultados del bloque anterior.
  ];
  // Exige disponibilidad al corte para cada variable de la evidencia.
  for (const { input, variable } of evidence) if (!knownBy(variable, snapshot.asOf)) missing.push(input);
  // Registra ausencia de contrato.
  if (!contract) missing.push('contract');
  // Registra falta de multiplicador y acciones entregables verificados.
  if(!terms)missing.push('multiplicador y entregable de acciones verificados');
  // Impide usar un contrato de otro subyacente.
  if (contract && contract.underlyingSymbol !== snapshot.symbol) missing.push('contrato del subyacente correcto');
  // Compara antigüedad de la prima con el límite configurado.
  if(contract?.premium.observedAt && Date.parse(snapshot.asOf)-Date.parse(contract.premium.observedAt)>tuning.quoteMaxAgeMinutes*60000)
    // Si lo supera, agrega motivo de cotización demasiado antigua.
    missing.push(`cotización de hasta ${tuning.quoteMaxAgeMinutes} minutos`);
  // Extrae los números de la evidencia, manteniendo null para variables sin valor.
  const values = Object.fromEntries(evidence.map(item => [item.input, item.variable.value])) as Record<string, number | null>;
  // Exige spot positivo cuando hay valor.
  if (values.spot !== null && values.spot <= 0) missing.push('spot positivo');
  // Exige strike positivo cuando hay valor.
  if (values.strike !== null && values.strike <= 0) missing.push('strike positivo');
  // Exige IV positiva cuando hay valor.
  if (values.impliedVolatility !== null && values.impliedVolatility <= 0) missing.push('IV positiva');
  // Permite prima cero pero no negativa.
  if (values.premium !== null && values.premium < 0) missing.push('prima no negativa');
  // No permite dividendo continuo negativo.
  if (values.dividendYield !== null && values.dividendYield < 0) missing.push('q no negativo');
  // Exige bid no negativo, ask positivo y bid menor o igual al ask.
  if (values.bid !== null && values.ask !== null && (values.bid < 0 || values.ask <= 0 || values.bid > values.ask)) missing.push('spread válido');
  // Calcula días hasta el horizonte de valoración contractual o NaN si no hay contrato.
  const remainingDays = contract ? (valuationExpiry(contract,snapshot.asOf).time - Date.parse(snapshot.asOf)) / DAY : NaN;
  // Exige plazo restante positivo y finito.
  if (!Number.isFinite(remainingDays) || remainingDays <= 0) missing.push('vencimiento futuro');
  // Rechaza histórico desactualizado.
  if (snapshot.market.stale) missing.push('cierre reciente');
  // Comienza el control de desfase entre la hora del spot y la prima del contrato.
  if (contract?.premium.observedAt && snapshot.market.spot.observedAt
    // Usa umbral en minutos para spot de cotización y en días para cierre diario.
    && Math.abs(Date.parse(contract.premium.observedAt) - Date.parse(snapshot.market.spot.observedAt)) > (snapshot.market.spotBasis==='quote'?tuning.spotOptionSkewMinutes*60000:tuning.spotOptionGapDays * DAY)) missing.push('spot y opción dentro del desfase permitido');
  // Identifica el feed indicative como estimado y retrasado.
  if (snapshot.options.feed === 'indicative') warnings.push('El feed indicative utiliza cotizaciones modificadas y retrasadas; es una estimación educativa.');
  // Identifica el alcance europeo de BSM para contratos americanos o de estilo desconocido.
  if (contract?.style !== 'european') warnings.push('BSM europeo es una aproximación para este contrato americano o de estilo desconocido; no modela ejercicio anticipado.');
  // Incluye la fuente de la fecha efectiva de vencimiento.
  if(contract)warnings.push(valuationExpiry(contract,snapshot.asOf).source);
  // Explica la conversión de unidades cuando multiplicador y entregables no coinciden.
  if(terms&&terms.multiplier!==terms.shares)warnings.push('Strike efectivo y prima por acción entregable ajustados con multiplicador/acciones. No son el strike ni la prima unitaria cotizados.');
  // Identifica spot de cotización o cierre y prima media; estas entradas no son instrucciones de ejecución.
  warnings.push(`${snapshot.market.spotBasis==='quote'?'Spot de punto medio de la acción':'Spot de cierre diario'}, prima media bid/ask y horizonte estimado; no son instrucciones de ejecución.`);
  // Construye la salida con entradas solo cuando no faltan requisitos.
  return {
    // Prepara spot ajustado por dividendos discretos cuando se eligieron, strike efectivo, plazo e IV de
    // contrato.
    input: missing.length ? null : { spot: Math.max(1e-8,values.spot!-(overrides.dividendModel==='declared-cash'?cashDividendPv(snapshot,valuationExpiry(contract!,snapshot.asOf).time,values.riskFreeRate!):0)), strike: terms!.effectiveStrike, days: remainingDays, volatility: values.impliedVolatility!,
      // Completa tasa, dividendo y tipo de opción de las entradas BSM.
      rate: values.riskFreeRate!, dividendYield: values.dividendYield!, type: contract!.type },
    // Convierte prima a unidad de acción entregable y deduplica motivos de faltantes.
    premium: missing.length ? null : values.premium!*terms!.multiplier/terms!.shares, missing: [...new Set(missing)], evidence, warnings,
  // Cierra el bloque, objeto o llamada definido anteriormente.
  };
// Cierra el bloque, objeto o llamada definido anteriormente.
}

// Ordena empresas con evidencia observada o escenarios explícitos; puede delegar la puntuación al escáner
// funcional actual.
export function rankObservedCompanies(snapshots: readonly CompanyResearch[], selectedCores: readonly CoreId[], strategy: StrategyId, days: number, overrides: ObservedInputOverrides = {}): ObservedRankedCompany[] {
  // Deduplica criterios cuantitativos solicitados.
  const requested = [...new Set(selectedCores)];
  // Exige criterios del catálogo cuantitativo reconocido.
  if (!requested.length || requested.some(id => !CORE_IDS.includes(id))) throw new RangeError('Selecciona al menos un núcleo válido.');
  // Valida ajustes numéricos.
  const tuning=evaluationTuning(overrides.tuning);
  // Elimina criterios con peso cero.
  const selected=requested.filter(id=>coreWeight(tuning,id)>0);
  // Suma pesos de criterios cuantitativos activos.
  const totalWeight=activeCoreWeight(tuning,selected);
  // Sin escáner alternativo exige algún peso positivo.
  if(!totalWeight && !overrides.scanner)throw new RangeError('Asigna peso positivo a por lo menos un core seleccionado.');
  // Valida estrategia y plazo de hasta 3650 días.
  if (!(strategy in settings) || !Number.isFinite(days) || days <= 0 || days > 3650) throw new RangeError('Selecciona una estrategia y un plazo válidos.');
  // Evalúa cada empresa del universo recibido.
  return snapshots.map(original => {
    // Incorpora capturas manuales aplicables sin retrofecharlas.
    const snapshot = withFinviz(original, overrides.finviz);
    // Selecciona y analiza estructura contractual con capital y calidad comunes.
    const analysis = analyzeStrategy(snapshot, strategy, days, overrides);
    // Prefiere el contrato de su primera pierna y usa el selector individual si falta estructura.
    const contract = analysis.legs[0]?.contract ?? selectObservedOption(snapshot, strategy, days, overrides);
    // Valida entradas individuales conservando su evidencia.
    const observed = observedOptionInputs(snapshot, contract, overrides);
    // Reúne spot, tasa, dividendo y evidencia de cada contrato, incluidos multiplicador y entregables.
    const strategyEvidence = [...observed.evidence.filter(e=>['spot','riskFreeRate','dividendYield'].includes(e.input)), ...analysis.legs.flatMap(l=>['strike','impliedVolatility','bid','ask','openInterest','multiplier','deliverableShares'].map(key=>({input:l.contract.symbol+'.'+key,variable:l.contract[key as 'strike'|'impliedVolatility'|'bid'|'ask'|'openInterest'|'multiplier'|'deliverableShares']!})))];
    // Define cómo evaluar un criterio cuantitativo solo cuando existen sus entradas necesarias.
    const result = (core: CoreId, needed: [string, ResearchVariable][], calculate: () => number, reason: string): ObservedCoreResult => {
      // Localiza entradas no conocidas al corte.
      const absent = needed.filter(([, value]) => !knownBy(value, snapshot.asOf)).map(([name]) => name);
      // Añade histórico reciente como requisito de estos criterios.
      if (snapshot.market.stale) absent.push('histórico reciente');
      // Si falta evidencia, devuelve criterio no disponible con motivo y variables.
      return absent.length ? { core, status: 'unavailable', score: null, reason: `Faltan datos verificables: ${absent.join(', ')}.`, evidence: needed.map(([input, variable]) => ({ input, variable })) }
        // Si está completa, normaliza el cálculo a 0–100 y conserva la evidencia.
        : { core, status: 'available', score: Math.round(clamp(calculate()) * 100), reason, evidence: needed.map(([input, variable]) => ({ input, variable })) };
    // Cierra el bloque, objeto o llamada definido anteriormente.
    };
    // Obtiene las métricas de mercado de la empresa.
    const m = snapshot.market;
    // Construye aportes de volatilidad, tendencia, liquidez y riesgo.
    const marketCores: Record<string, ObservedCoreResult> = {
      // Para volatilidad exige HV conocida y calcula una relación con IV cuando existe estructura.
      volatility: result('volatility', [['historicalVolatility', m.historicalVolatility]], () => {
        // Lee HV anualizada disponible.
        const hv = m.historicalVolatility.value!;
        // Lee IV de la primera pierna si existe.
        const iv = analysis.legs[0]?.contract.impliedVolatility.value;
        // Con IV y HV, Wheel/PMCC puntúan IV relativa; Backspread/Gamma puntúan HV relativa.
        if (iv && hv > 0) return strategy === 'wheel' || strategy === 'pmcc' ? iv / (iv + hv) : hv / (iv + hv);
        // Sin IV utiliza una transformación heurística de HV, sin afirmar ventaja futura.
        return strategy === 'wheel' || strategy === 'pmcc' ? 1 / (1 + hv) : hv / (1 + hv);
      // Explica que la relación IV/HV no predice una rentabilidad futura.
      }, 'Relación IV/HV cuando hay contrato: favorece prima relativa para venta y movimiento histórico relativo para compra. Sin IV solo describe HV; no estima ventaja futura.'),
      // Calcula tendencia con retornos retrospectivos de 20/60 sesiones; Gamma usa magnitudes y las otras
      // estrategias conservan signo.
      trend: result('trend', [['momentum20', m.momentum20], ['momentum60', m.momentum60]], () => strategy === 'gamma' ? clamp(tuning.trend20Coefficient*Math.abs(m.momentum20.value!) + tuning.trend60Coefficient*Math.abs(m.momentum60.value!)) : tuning.trendBase + tuning.trend20Coefficient * m.momentum20.value! + tuning.trend60Coefficient * m.momentum60.value!,
        // Publica los coeficientes configurados para que la heurística sea inspeccionable.
        `Tendencia retrospectiva: base ${tuning.trendBase}, coeficientes20/60 ${tuning.trend20Coefficient}/${tuning.trend60Coefficient}. Gamma usa magnitudes sin base. No anticipa movimientos.`),
      // Si hay piernas usa sus cotizaciones para evaluar liquidez.
      liquidity: analysis.legs.length ? {
        // Puntúa por el peor spread relativo de las piernas; un contrato ilíquido limita al conjunto.
        core: 'liquidity', status: 'available', score: Math.round(100 * Math.min(...analysis.legs.map(l => clamp(1 - (l.contract.ask.value! - l.contract.bid.value!) / Math.max(.01,l.contract.premium.value!))))),
        // Aclara que spread y OI no garantizan ejecución.
        reason: 'Peor spread relativo entre todas las piernas. Consulta también OI; no garantiza ejecución.',
        // Conserva bid, ask y OI de cada pierna como evidencia.
        evidence: analysis.legs.flatMap(l => [{input: l.contract.symbol + '.bid',variable:l.contract.bid},{input:l.contract.symbol + '.ask',variable:l.contract.ask},{input:l.contract.symbol + '.openInterest',variable:l.contract.openInterest}]),
      // Si faltan piernas, utiliza volumen monetario de la acción en una escala logarítmica.
      } : result('liquidity', [['averageDollarVolume20', m.averageDollarVolume20]], () => (Math.log10(Math.max(1, m.averageDollarVolume20.value!)) - 5) / 4,
        // Identifica ese resultado como liquidez accionaria, no del contrato.
        'Solo liquidez accionaria; faltan opciones para evaluar sus spreads.'),
      // Combina drawdown y volatilidad bajista y limita además por capital restante tras la pérdida máxima
      // determinada.
      risk: result('risk', [['maxDrawdown', m.maxDrawdown], ['downsideVolatility', m.downsideVolatility]], () => Math.min(1 - tuning.riskDrawdownWeight * m.maxDrawdown.value! - (1-tuning.riskDrawdownWeight) * Math.min(1, m.downsideVolatility.value!), overrides.capital && analysis.maxLoss !== null ? clamp(1-analysis.maxLoss/overrides.capital) : 1),
        // Informa pesos de riesgo y conserva desconocimiento cuando la pérdida máxima no está determinada.
        `Riesgo: pesos drawdown/bajista ${tuning.riskDrawdownWeight}/${1-tuning.riskDrawdownWeight}; limitado también por capital restante tras pérdida máxima determinada. Un máximo desconocido no significa riesgo cero.`),
    // Cierra el bloque, objeto o llamada definido anteriormente.
    };
    // Completa los criterios cuantitativos seleccionados.
    const coreResults = selected.map((core): ObservedCoreResult => {
      // Reutiliza un aporte de mercado cuando ya se calculó.
      if (marketCores[core]) return marketCores[core];
      // Para criterios de opciones exige estructura disponible y, en probabilidad, una medida publicada.
      if (analysis.status !== 'available' || core === 'probability' && analysis.probability === null) return {
        // Marca como ausente el criterio contractual que no se puede calcular.
        core, status: 'unavailable', score: null,
        // Explica entradas faltantes y distingue observado de estimado.
        reason: `${analysis.missing.length ? `Faltan entradas de la estrategia: ${analysis.missing.join('; ')}.` : analysis.probabilityMethod} ${overrides.modelMode==='estimated'?'Modo estimado: requiere contratos verificables y supuestos explícitos; revisa los faltantes indicados.':'No se usa HV como IV ni q=0 implícito.'}`,
        // Adjunta evidencia de la estructura incluso al motivo de ausencia.
        evidence: strategyEvidence,
      // Cierra el bloque, objeto o llamada definido anteriormente.
      };
      // Escala la diferencia de valoración por magnitudes positivas de entrada y capital.
      const scale = Math.max(1, Math.abs(analysis.entryDebit!), analysis.capitalRequired!);
      // Detecta cotizaciones reconstruidas o IV calibrada con esas mismas cotizaciones para evitar una
      // coincidencia circular presentada como oportunidad.
      const modeledQuotes=analysis.legs.some(l=>l.contract.bid.kind==='assumed'||l.contract.ask.kind==='assumed'||l.contract.impliedVolatility.source.startsWith('IV calculada de bid/ask'));
      // BSM recibe neutral 0.5 con entradas modeladas; en los demás casos mide cercanía entre valor teórico y
      // coste de entrada.
      const score = core === 'bsm' ? modeledQuotes?.5:1 - Math.abs(analysis.theoreticalDebit! - analysis.entryDebit!) / scale
        // El criterio de griegas favorece gamma escalada para Gamma.
        : core === 'greeks' ? strategy === 'gamma' ? Math.abs(analysis.netGamma!) * snapshot.market.spot.value! / (analysis.deliverableShares! + Math.abs(analysis.netGamma!) * snapshot.market.spot.value!)
          // Para las otras estrategias transforma delta monetaria relativa al capital.
          : 1 / (1 + Math.abs(analysis.netDelta!) * snapshot.market.spot.value! / Math.max(1,analysis.capitalRequired!))
        // El criterio de probabilidad usa la medida publicada por el análisis conjunto.
        : analysis.probability!;
      // Describe el carácter neutral de BSM con primas reconstruidas y el alcance de la comparación de precios.
      const label = core === 'bsm' ? modeledQuotes?'Valor neutral 50/100: primas reconstruidas o IV calibrada a estas cotizaciones; la coincidencia con el modelo no demuestra una oportunidad de mercado.':'Cercanía del valor teórico conjunto al coste bid/ask; no es beneficio esperado.'
        // Describe las sensibilidades como exposición, sin delta objetivo fija de ese criterio.
        : core === 'greeks' ? 'Sensibilidad conjunta: Gamma positiva para cobertura; exposición delta relativa al capital para las otras estrategias. Sin delta objetivo fija.'
        // Identifica PoP neutral al riesgo y el alcance de la put inicial de Wheel.
        : `${analysis.probabilityMethod} Wheel representa una pierna, no el ciclo futuro; excluye comisiones de salida y asignación anticipada.`;
      // Publica puntuación, motivo, advertencias y evidencia del criterio.
      return { core, status: 'available', score: Math.round(clamp(score) * 100), reason: `${label} ${analysis.warnings.join(' ')}`, evidence: strategyEvidence };

    // Cierra el bloque, objeto o llamada definido anteriormente.
    });
    // Obtiene criterios cuantitativos con resultado.
    const available = coreResults.filter(core => core.score !== null);
    // La puntuación cuantitativa anterior exige todos los criterios seleccionados; si falta alguno deja null.
    const score = available.length === selected.length ? Math.round(available.reduce((sum, core) => sum + core.score!*coreWeight(tuning,core.core), 0) / totalWeight) : null;
    // Publica probabilidad como variable estimada solo cuando el análisis dispone de ella.
    const probabilityOfProfit: ResearchVariable = analysis.probability !== null && analysis.status === 'available' ? { value: analysis.probability, source: analysis.probabilityMethod,
      // Conserva corte y advertencias de esa probabilidad modelada.
      observedAt: snapshot.asOf, availableAt: snapshot.asOf, kind: 'estimated', reason: analysis.warnings.join(' ') }
      // En caso contrario construye un faltante explicativo de PoP.
      : missingVariable('BSM europeo · medida neutral al riesgo', `Entradas incompletas: ${analysis.missing.join(', ')}. ${analysis.probabilityMethod}`);
    // Con configuración scanner delega la evaluación a los siete cores funcionales actuales.
    const scannerEvaluation = overrides.scanner ? evaluateScanner(snapshot, strategy, days, overrides.scanner, overrides, analysis) : undefined;
    // Devuelve puntuación y cobertura del escáner si existe; si no, conserva las del ranking cuantitativo.
    return { symbol: snapshot.symbol, score: scannerEvaluation ? scannerEvaluation.score : score, coreResults, availableCoreCount: scannerEvaluation ? scannerEvaluation.available : available.length,
      // Construye el motivo de ausencia del ranking anterior cuando no se completaron sus criterios.
      reason: score === null ? `${analysis.dataMode==='estimated'?'ESTIMADO · ':''}${available.length}/${selected.length} núcleos disponibles; la puntuación total espera todas las entradas seleccionadas. ${analysis.missing.join(', ')}`
        // En otro caso explica la heurística y si solo existe perfil de la acción con estrategia incompleta.
        : `${analysis.status!=='available'?'PERFIL HISTÓRICO DE LA ACCIÓN; estrategia de opciones incompleta. ':''}${analysis.dataMode==='estimated'?'ESTIMADO · ':''}Media ponderada de los núcleos con peso positivo, escala 0–100. Es una heurística de selección, no una probabilidad de éxito. ${coreResults.map(c=>c.core+': '+c.score+' (peso '+coreWeight(tuning,c.core)+')').join('; ')}`,
      // Cuando hay escáner, su motivo y resultado sustituyen la explicación cuantitativa anterior.
      ...(scannerEvaluation ? { reason: scannerEvaluation.reason, scannerEvaluation } : {}),
      // Entrega PoP con etiqueta de alcance, contrato de referencia y análisis de estructura completo.
      probabilityOfProfit, probabilityLabel: strategy === 'wheel' ? 'Probabilidad teórica de una pierna: put inicial; no ciclo Wheel' : analysis.probabilityMethod, contractSymbol: analysis.legs[0]?.contract.symbol ?? contract?.symbol ?? null, strategyAnalysis: analysis };
  // Ordena por puntuación descendente, coloca null al final y desempata por símbolo.
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.symbol.localeCompare(b.symbol));
// Cierra el bloque, objeto o llamada definido anteriormente.
}
