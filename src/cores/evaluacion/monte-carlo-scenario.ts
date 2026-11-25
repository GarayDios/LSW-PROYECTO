// Adaptador entre la estrategia contractual y el motor Monte Carlo. Prepara datos, fechas, cantidades,
// fuentes y límites; el motor numérico está en ../nucleo-cuantitativo/monte-carlo.ts.

// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { analyzeStrategy, type AnalysisPolicy, type StrategyAnalysis } from './strategy-analysis.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { equityTerms, modelDividendYield, valuationExpiry } from '../../features/research/contract-terms.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { knownBy, type CompanyResearch } from '../compartido/research-model.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { StrategyId } from '../compartido/types.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { MonteCarloRequest } from '../nucleo-cuantitativo/monte-carlo.ts';

// Selecciona del motor Monte Carlo las entradas financieras del escenario, sin incluir todavía semilla ni
// número de trayectorias.
export type MonteCarloBasis = Pick<MonteCarloRequest, 'spot' | 'days' | 'volatility' | 'rate' | 'dividendYield' | 'legs' | 'feePerContract'>;
// Agrupa entradas, etiqueta, fuentes y advertencias; registra modo observado/estimado y reconstrucción
// automática.
export type MonteCarloScenario = { basis: MonteCarloBasis; label: string; sources: string[]; warnings: string[];dataMode?:'observed'|'estimated';automaticEstimation?:boolean };
// Representa éxito con escenario o fallo con motivo, conservando opcionalmente el análisis estructural.
export type StrategyMonteCarloScenario = ({ scenario: MonteCarloScenario; error?: never } | { scenario: null; error: string }) & {analysis?:StrategyAnalysis};

// Prepara una estrategia para simular; no genera trayectorias aquí, esa tarea corresponde al motor
// cuantitativo.
export function strategyMonteCarloScenario(snapshot: CompanyResearch, strategy: StrategyId, days: number, policy: AnalysisPolicy = {}): StrategyMonteCarloScenario {
  // Lee la preferencia de datos del core: automático si no se indicó otra.
  const mode=policy.scanner?.monteCarlo.dataMode??'auto';
  // En modo observado intenta únicamente datos del proveedor y conserva faltantes.
  if(mode==='observed')return buildScenario(snapshot,strategy,days,{...policy,modelMode:'observed'});
  // En modo estimado explícito permite reconstrucciones identificadas sobre contratos existentes.
  if(mode==='estimated'||policy.modelMode==='estimated')return buildScenario(snapshot,strategy,days,{...policy,modelMode:'estimated'});
  // En automático comienza por la alternativa del proveedor.
  const observed=buildScenario(snapshot,strategy,days,{...policy,modelMode:'observed'});
  // Si esa alternativa forma un escenario válido, la utiliza sin reconstrucción.
  if(observed.scenario)return observed;
  // No cambia silenciosamente un modelo de dividendos discretos por el continuo que requiere esta simulación.
  if(policy.dividendModel==='declared-cash')return observed;
  // Recoge prerrequisitos que no se pueden inventar para completar un escenario automático.
  const missing:string[]=[];
  // Necesita contratos verificables ya existentes en la instantánea.
  if(!snapshot.options.contracts.length)missing.push('contratos verificables de la estrategia');
  // Necesita precio positivo conocido y estado del subyacente reciente.
  if(snapshot.market.stale||!knownBy(snapshot.market.spot,snapshot.asOf)||snapshot.market.spot.value!<=0)missing.push('precio del subyacente vigente al corte');
  // Necesita alguna IV positiva conocida o HV positiva calculable con historia válida.
  if((!knownBy(snapshot.market.historicalVolatility,snapshot.asOf)||snapshot.market.historicalVolatility.value!<=0)&&!snapshot.options.contracts.some(c=>knownBy(c.impliedVolatility,snapshot.asOf)&&c.impliedVolatility.value!>0))missing.push('IV conocida o volatilidad histórica calculable con velas cerradas');
  // Necesita una tasa conocida al corte o un supuesto explícito suministrado por la política.
  if(!knownBy(policy.riskFreeRate??snapshot.macro.riskFreeRate,snapshot.asOf))missing.push('tasa conocida al corte');
  // Necesita dividendo continuo conocido o declarado de forma explícita.
  if(!knownBy(modelDividendYield(snapshot,policy),snapshot.asOf))missing.push('dividendo conocido al corte');
  // Si falta un prerrequisito, devuelve un error detallado sin asumir tasas o dividendos cero.
  if(missing.length)return {scenario:null,error:`Monte Carlo automático necesita ${missing.join(', ')}. No se inventan contratos, tasas ni dividendos para completar la simulación.`};
  // Intenta reconstruir primas o volatilidad cuando sí existen los prerrequisitos.
  const estimated=buildScenario(snapshot,strategy,days,{...policy,modelMode:'estimated'});
  // Si tampoco se puede construir esa estructura estimada, comunica el motivo del segundo intento.
  if(!estimated.scenario)return {scenario:null,error:`Monte Carlo intentó datos del proveedor y una reconstrucción automática. ${estimated.error}`};
  // Marca la reconstrucción como automática y conserva su análisis y advertencias.
  return {analysis:estimated.analysis,scenario:{...estimated.scenario,automaticEstimation:true,label:estimated.scenario.label+' · estimación automática',warnings:[
    // Explica que primas e IV reconstruidas son supuestos identificados y no cotizaciones ejecutables.
    'Estimación automática: las entradas del proveedor no completan una estrategia vigente. Se reconstruyen únicamente primas/volatilidad necesarias sobre contratos existentes, con fuentes y supuestos identificados. No son cotizaciones ejecutables.',
    // Añade los límites específicos del escenario de la estrategia.
    ...estimated.scenario.warnings,
  // Cierra la lista de entradas o resultados del bloque anterior.
  ]}};
// Cierra el bloque, objeto o llamada definido anteriormente.
}

// Construye las entradas numéricas concretas a partir del análisis contractual.
function buildScenario(snapshot:CompanyResearch,strategy:StrategyId,days:number,policy:AnalysisPolicy):StrategyMonteCarloScenario{
  // Rechaza dividendos discretos porque el motor usa un rendimiento continuo de dividendos.
  if (policy.dividendModel === 'declared-cash') return { scenario: null, error: 'Monte Carlo usa dividendos continuos. Cambia explícitamente ese supuesto para simular; no se sustituyen los pagos discretos.' };
  // Selecciona y valora la estrategia con la política recibida.
  const analysis = analyzeStrategy(snapshot, strategy, days, policy);
  // Si no hay estructura válida, conserva los motivos de ausencia.
  if (analysis.status !== 'available') {
    // En estimado explica que siguen vigentes los controles de capital, geometría y calidad.
    if(policy.modelMode==='estimated')return {scenario:null,error:`La estrategia estimada no está disponible: ${analysis.missing.join(', ')}. La reconstrucción conserva los filtros de capital, geometría y calidad.`};
    // Busca el motivo de falta de prima que haya reportado el proveedor.
    const quoteReason=snapshot.options.contracts.find(c=>c.premium.kind==='missing'&&c.premium.reason)?.premium.reason;
    // En observado combina faltantes estructurales, descartes y estado de la cadena para explicar el bloqueo.
    return { scenario: null, error: `Faltan entradas de la estrategia: ${analysis.missing.join(', ')}. ${analysis.diagnostics ? `${analysis.diagnostics.eligibleContracts}/${analysis.diagnostics.totalContracts} contratos pasan los filtros. ${analysis.diagnostics.rejected.map(d=>`${d.label}: ${d.count}`).join('; ')}.` : ''} ${snapshot.options.status.message} ${quoteReason??''}` };
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Obtiene los instantes de vencimiento verificables de todas las piernas.
  const expiries = analysis.legs.map(leg => valuationExpiry(leg.contract, snapshot.asOf).time);
  // Exige fechas finitas y vencimiento común salvo en PMCC, que admite la diagonal.
  if (expiries.some(time => !Number.isFinite(time)) || strategy !== 'pmcc' && new Set(expiries).size !== 1) return { scenario: null, error: 'Los vencimientos no son compatibles con la estructura seleccionada.' };
  // Define el horizonte como el primer vencimiento de la estructura.
  const horizon = Math.min(...expiries);
  // Obtiene dividendo y tasa desde la política o las fuentes de la instantánea.
  const q = modelDividendYield(snapshot, policy), rate = policy.riskFreeRate ?? snapshot.macro.riskFreeRate;
  // Verifica de nuevo que ambas entradas eran conocidas en la fecha de decisión.
  if (!knownBy(q, snapshot.asOf) || !knownBy(rate, snapshot.asOf)) return { scenario: null, error: 'Faltan tasa o dividendos conocidos en la fecha de corte.' };
  // Extrae los contratos efectivamente seleccionados.
  const contracts = analysis.legs.map(leg => leg.contract);
  // El GBM del subyacente utiliza una única volatilidad constante: la IV de la primera pierna, explícitamente
  // informada.
  const volatility = contracts[0].impliedVolatility.value!;
  // Construye una etiqueta que diferencia put inicial de Wheel, diagonal PMCC, straddle y Backspread.
  const label = strategy === 'wheel' ? 'Wheel · put inicial, sin el ciclo posterior' : strategy === 'pmcc' ? 'PMCC · call corta al vencimiento / LEAPS a valor teórico remanente' : strategy === 'gamma' ? 'Gamma · straddle y cobertura delta opcional' : 'Backspread · −1 call inferior / +2 calls superiores';
  // Devuelve el análisis y la preparación del escenario.
  return { analysis, scenario: {
    // Conserva el modo de procedencia del análisis.
    dataMode:analysis.dataMode,
    // Identifica símbolo, sandbox si corresponde, estrategia, modo y corte en la etiqueta visible.
    label: `${snapshot.symbol} · ${snapshot.dataMode==='sandbox'?'WEBULL SANDBOX · ':''}${label} · ${analysis.dataMode === 'estimated' ? 'entradas estimadas' : 'entradas del proveedor'} · corte ${snapshot.asOf}`,
    // Abre la base de entradas para simulateMonteCarlo().
    basis: {
      // Usa el spot del corte y convierte el tiempo hasta el primer vencimiento de milisegundos a días.
      spot: snapshot.market.spot.value!, days: (horizon - Date.parse(snapshot.asOf)) / 86400000,
      // Añade volatilidad, tasa, dividendo continuo y comisión por contrato.
      volatility, rate: rate.value!, dividendYield: q.value!, feePerContract: policy.feePerContract ?? 0,
      // Transforma cada pierna conservando sus cantidades firmadas y términos contractuales.
      legs: analysis.legs.map(leg => {
        // Obtiene las acciones entregables y el strike efectivo verificados.
        const terms = equityTerms(leg.contract, snapshot.asOf)!;
        // Convierte la prima cotizada a prima por acción entregable y conserva compra positiva/venta negativa.
        return { type: leg.contract.type, strike: terms.effectiveStrike, quantity: leg.quantity, units: terms.shares, premium: leg.entry * terms.multiplier / terms.shares,
          // Para PMCC conserva por pierna su propio vencimiento y su IV para marcar la LEAPS remanente.
          ...(strategy === 'pmcc' ? { daysToExpiry: (valuationExpiry(leg.contract, snapshot.asOf).time - Date.parse(snapshot.asOf)) / 86400000, volatility: leg.contract.impliedVolatility.value! } : {}) };
      // Cierra el bloque, objeto o llamada definido anteriormente.
      }),
    // Cierra el bloque, objeto o llamada definido anteriormente.
    },
    // Lista fuentes del spot, tasa, dividendos, contratos, IV y cotizaciones para poder auditar la simulación.
    sources: [snapshot.market.spot.source, rate.source, q.source, ...contracts.flatMap(c => [c.symbol, c.impliedVolatility.source, c.bid.source, c.ask.source])],
    // Abre las advertencias, incluyendo las del análisis estructural.
    warnings: [...analysis.warnings,
      // Informa la única sigma del subyacente; no modela una sonrisa o superficie de volatilidad.
      `Una sola volatilidad constante de ${(volatility * 100).toFixed(2)}% para el subyacente, tomada de ${contracts[0].symbol}. No representa la sonrisa de volatilidad.`,
      // Explica que PMCC se valora al vencimiento corto y la LEAPS conserva tiempo, sin simular renovaciones.
      ...(strategy === 'pmcc' ? ['Horizonte: vencimiento de la call corta. La LEAPS conserva su vencimiento y se valora por BSM con su IV inicial constante. No se liquida a valor intrínseco ni se simulan renovaciones o asignación anticipada.'] : []),
      // Distingue marca teórica de la LEAPS y liquidación europea por efectivo de una ejecución real del bróker.
      strategy === 'pmcc' ? 'La posición se marca al primer vencimiento; el precio teórico de la LEAPS no es una cotización ejecutable. No se modela asignación anticipada.' : 'Aproximación europea con liquidación por efectivo al vencimiento; no reproduce asignación ni ejercicio anticipado de contratos americanos.',
      // Advierte cuando existen contratos americanos o de estilo desconocido cuya prima de ejercicio anticipado no
      // reproduce Monte Carlo.
      ...(contracts.some(c => c.style !== 'european') ? ['Los contratos incluyen estilo americano o sin verificar; Monte Carlo no reproduce su prima de ejercicio anticipado.'] : []),
    // Cierra la lista de entradas o resultados del bloque anterior.
    ],
  // Cierra el bloque, objeto o llamada definido anteriormente.
  } };
// Cierra el bloque, objeto o llamada definido anteriormente.
}
