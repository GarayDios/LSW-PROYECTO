// Integración de cores con media ponderada de aportes evaluables. Una ausencia es null y no pesa como cero.
// La confluencia es compatibilidad heurística, separada de PoP y escenarios.

// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { analyzeHistory } from '../05-indicadores-y-senales/signals.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { deriveObservedMarket } from '../01-analisis-tecnico/market-analysis.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { newsSentiment } from '../03-noticias-financieras/sentiment.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { knownBy, type CompanyResearch } from '../compartido/research-model.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { StrategyId } from '../compartido/types.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { simulateMonteCarlo } from '../nucleo-cuantitativo/monte-carlo.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { strategyMonteCarloScenario } from './monte-carlo-scenario.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { analyzeStrategy, type AnalysisPolicy, type StrategyAnalysis } from './strategy-analysis.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { activeScannerCores, scannerSettingsSchema, type ScannerCoreId, type ScannerSettings } from './scanner-settings.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { equityTerms, modelDividendYield, valuationExpiry } from '../../features/research/contract-terms.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { blackScholes } from '../nucleo-cuantitativo/bsm.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { withFinviz, finvizInstitutional } from '../04-analisis-fundamental/finviz-data.ts';

// Describe el aporte de un core: identificador, puntuación o null, peso, explicación y dirección opcional;
// registra si hubo estimación.
export type ScannerCoreResult = { core: ScannerCoreId; score: number | null; weight: number; reason: string; direction?: number;dataMode?:'observed'|'estimated';automaticEstimation?:boolean };
// Describe el escenario visual de precio y P/L: objetivo, base sin noticias, límites y método de valoración;
// no es una predicción calibrada.
export type ScannerProjection = { spot: number; target: number; baseline: number; lower: number; upper: number; days: number; newsImpact: number; pnl: number | null; baselinePnl: number | null; pnlMethod: 'payoff' | 'diagonal' };
// Agrupa confluencia, resultados individuales, cobertura, sentimiento, proyección y PoP de Monte Carlo.
export type ScannerEvaluation = { score: number | null; results: ScannerCoreResult[]; available: number; missing: number; active: number; availableWeight: number; reason: string; sentiment: ReturnType<typeof newsSentiment>; projection: ScannerProjection | null; monteCarloPop: number | null };
// Limita un número a un intervalo; por defecto dirección entre −1 y 1, o puntuación entre 0 y 100 cuando se
// indica.
const clamp = (n: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, n));

// Evalúa una empresa para una estrategia y plazo usando únicamente los cores activos; puede reutilizar un
// análisis de contratos ya calculado.
export function evaluateScanner(snapshot: CompanyResearch, strategy: StrategyId, days: number, config: ScannerSettings, policy: AnalysisPolicy = {}, existingAnalysis?: StrategyAnalysis): ScannerEvaluation {
  // Añade la captura Finviz aplicable, conservando su fecha y condición de dato manual.
  snapshot = withFinviz(snapshot, policy.finviz);
  // Valida configuración y selecciona cores habilitados con peso positivo.
  const settings = scannerSettingsSchema.parse(config), selected = activeScannerCores(settings);
  // Reutiliza el análisis recibido o calcula estructura, capital, costes y escenarios de la estrategia.
  const analysis = existingAnalysis ?? analyzeStrategy(snapshot, strategy, days, policy);
  // Reconstruye el estado del mercado con las velas diarias que estaban disponibles al corte.
  const market = deriveObservedMarket(snapshot.symbol, snapshot.market.bars, snapshot.asOf);
  // Calcula indicadores, niveles y señales de la regla propia sobre esas velas.
  const history = analyzeHistory(market.bars, { rule: settings.rule });
  // Obtiene los últimos indicadores y la última señal calculable.
  const point = history.indicators.at(-1), latest = history.latest;
  // Clasifica titulares disponibles y aplica antigüedad, duplicados y semivida de siete días.
  const sentiment = newsSentiment(snapshot.news, snapshot.asOf);
  // Reserva la PoP simulada; queda null si el core Monte Carlo no puede calcularse o está desactivado.
  let monteCarloPop: number | null = null;
  // Evalúa cada core activo por separado para conservar tanto su contribución como sus motivos.
  const results = selected.map((core): ScannerCoreResult => {
    // Lee el peso relativo del core actual, que se usará en el promedio final.
    const weight = settings.cores[core].weight;
    // Construye un aporte faltante: score null conserva el motivo y excluye su peso del denominador.
    const missing = (reason: string): ScannerCoreResult => ({ core, weight, score: null, reason });
    // Construye un aporte válido entre 0 y 100, redondeado a dos decimales, con explicación y dirección
    // opcional.
    const result = (score: number, reason: string, direction?: number): ScannerCoreResult => ({ core, weight, score: Math.round(clamp(score, 0, 100) * 100) / 100, reason, direction });
    // Distingue noticias sin sentimiento calculable según la cobertura: una consulta completa vacía puede ser
    // neutral.
    if (core === 'news') return sentiment.score === null ? snapshot.news.complete && snapshot.news.status.status === 'ready'
      // Asigna 50 y dirección cero si se confirmó que no hay titulares recientes.
      ? result(50, 'Consulta completa: no hay titulares recientes. Aporte neutral, sin inventar noticias.', 0)
      // Una consulta fallida o incompleta sin titulares queda sin datos; no se sustituye por neutralidad.
      : missing(`No se pudo verificar la cobertura de noticias. ${snapshot.news.status.message}`)
      // Convierte sentimiento en puntuación; Gamma usa su magnitud y las otras estrategias conservan el signo.
      : result(strategy === 'gamma' ? 50 + Math.abs(sentiment.score) * 50 : 50 + sentiment.score * 50,
        // Explica recuento, coincidencias, earnings, antigüedad y cobertura, manteniendo la dirección del
        // sentimiento por separado.
        `${sentiment.articles.length} titulares; ${sentiment.matched} con términos reconocidos; ${sentiment.earningsCount} de resultados. Semivida: 7 días. ${sentiment.complete ? 'Cobertura declarada completa.' : 'Cobertura parcial.'} Sentimiento por reglas, no probabilidad.`, sentiment.score);
    // Comienza el aporte institucional con prioridades de evidencia explícitas.
    if (core === 'institutional') {
      // Lee un flujo neto que el proveedor podría haber entregado como observación directa.
      const flow = snapshot.institutionalFlow;
      // Exige flujo conocido al corte, observado y normalizado entre −1 y 1.
      if (flow && knownBy(flow, snapshot.asOf) && flow.kind === 'observed' && Math.abs(flow.value!) <= 1
        // Limita esa observación directa a siete días de antigüedad.
        && Date.parse(snapshot.asOf) - Date.parse(flow.observedAt!) <= 7 * 86400000
      // Transforma el flujo válido en 50 + 50 × dirección e identifica su procedencia.
      ) return result(50 + flow.value! * 50, `Flujo neto normalizado de −1 a 1. Fuente: ${flow.source}.`, flow.value!);
      // Si falta flujo directo, consulta el cambio trimestral de tenencias SEC 13F.
      const institutional=snapshot.institutional;
      // Exige gestores comparables, dirección conocida y normalizada y período observado de no más de 200 días.
      if(institutional&&knownBy(institutional.direction,snapshot.asOf)&&institutional.comparable>0&&Math.abs(institutional.direction.value!)<=1&&Date.parse(snapshot.asOf)-Date.parse(institutional.direction.observedAt!)<=200*86400000){
        // Extrae la dirección de la muestra institucional verificada.
        const direction=institutional.direction.value!;
        // La convierte a puntuación y detalla gestores, trimestres y cambios ajustados por splits; no la presenta
        // como flujo intradía.
        return result(50+direction*50,`Participación SEC 13F: ${institutional.comparable}/${institutional.configured} gestores de la muestra. Media de variaciones simétricas de acciones, ajustadas por splits; no es flujo intradía. ${institutional.managers.filter(m=>m.direction!==undefined).map(m=>`${m.name}: ${m.previous!.period} → ${m.current!.period}, variación ${m.change===undefined?'sin base porcentual':(m.change*100).toFixed(2)+'%'}`).join('; ')}.`,direction);
      // Cierra el bloque, objeto o llamada definido anteriormente.
      }
      // Como alternativa manual, obtiene Inst Trans de una captura Finviz vigente.
      const transaction=finvizInstitutional(snapshot);
      // Solo usa la alternativa si la captura superó sus comprobaciones de disponibilidad.
      if(transaction){
        // Normaliza el cambio manual con tanh(variación/0.1); 10% es una escala heurística, no una calibración de
        // mercado.
        const direction=Math.tanh(transaction.value!/.1);
        // Publica el proxy manual con su fuente, manteniendo la diferencia respecto a compras observadas o PoP.
        return result(50+direction*50,`Proxy Finviz: Inst Trans ${(transaction.value!*100).toFixed(2)}%, variación de participación institucional. Captura manual del usuario; no es flujo intradía ni PoP. Normalización heurística tanh(variación/10%).`,direction);
      // Cierra el bloque, objeto o llamada definido anteriormente.
      }
      // Si no hay evidencia utilizable, devuelve faltante y explica que Inst Own no demuestra una variación.
      return missing(`Sin flujo observado, comparación SEC 13F evaluable o captura reciente de Finviz «Inst Trans». ${institutional?.status.message??''} ${institutional?.managers.map(m=>`${m.name}: ${m.message}`).join(' ')??''} «Inst Own» por sí solo no mide cambios.`);
    // Cierra el bloque, objeto o llamada definido anteriormente.
    }
    // Comienza el aporte fundamental, que puede usar métricas de varias fuentes con su procedencia.
    if (core === 'fundamental') {
      // Obtiene los hechos y ratios SEC de la instantánea.
      const f = snapshot.fundamentals;
      // Obtiene capturas Finviz y métricas automáticas Finnhub si existen.
      const fv=snapshot.finviz?.metrics, automatic=snapshot.companyDetails?.metrics;
      // Elige la primera variable de una lista cuya disponibilidad sea válida al corte.
      const current=(values:(typeof f.netMargin|undefined)[])=>values.find(v=>v&&knownBy(v,snapshot.asOf));
      // Prefiere margen TTM automático, luego anual automático, captura manual y finalmente margen SEC.
      const margin=current([automatic?.netProfitMarginTTM,automatic?.netProfitMarginAnnual,fv?.profitMargin,f.netMargin])??f.netMargin;
      // Selecciona ROE y razón corriente por prioridad de fuente; lee deuda/patrimonio manual como alternativa de
      // solvencia.
      const roe=current([automatic?.roeTTM,automatic?.roeRfy,fv?.roe]), liquidity=current([automatic?.currentRatioQuarterly,automatic?.currentRatioAnnual,fv?.currentRatio]), debt=fv?.debtEquity;
      // Normaliza margen desde −20% hasta 20% al intervalo [0,1], o deja ese componente sin dato.
      const components = [knownBy(margin, snapshot.asOf) ? clamp((margin.value! + .2) / .4, 0, 1) : null,
        // Para solvencia usa 1 − pasivos/activos; si falta, puede usar 1/(1 + deuda/patrimonio manual no negativo).
        knownBy(f.liabilitiesToAssets, snapshot.asOf) ? clamp(1 - f.liabilitiesToAssets.value!, 0, 1) : debt&&knownBy(debt,snapshot.asOf)&&debt.value!>=0?1/(1+debt.value!):null,
        // Normaliza ROE desde −20% hasta 40%, solo cuando existe y era conocido.
        roe&&knownBy(roe,snapshot.asOf)?clamp((roe.value!+.2)/.6,0,1):null,
        // Normaliza razón corriente sobre una escala de 0 a 2 y elimina componentes faltantes antes de promediar.
        liquidity&&knownBy(liquidity,snapshot.asOf)&&liquidity.value!>=0?clamp(liquidity.value!/2,0,1):null].filter((n): n is number => n !== null);
      // Recoge las fuentes disponibles que explican de dónde proviene el aporte fundamental.
      const sources=[knownBy(margin,snapshot.asOf)?margin.source:null,knownBy(f.liabilitiesToAssets,snapshot.asOf)?f.liabilitiesToAssets.source:debt&&knownBy(debt,snapshot.asOf)&&debt.value!>=0?debt.source:null,roe?.source,liquidity&&liquidity.value!>=0?liquidity.source:null].filter(Boolean);
      // Promedia los componentes existentes, convierte a 0–100 y muestra cobertura de hasta cuatro; son umbrales
      // heurísticos.
      return components.length ? result(100 * components.reduce((sum, n) => sum + n, 0) / components.length, `Cobertura ${components.length}/4: margen [−20%,20%], solvencia, ROE [−20%,40%] y razón corriente [0,2], cuando existen. No se equiparan TTM y ejercicio fiscal. Fuentes: ${sources.join('; ')}.`)
        // Si no existe componente fundamental, devuelve faltante con los mensajes de los proveedores.
        : missing(`Faltan métricas fundamentales publicadas. ${f.status.message} ${snapshot.companyDetails?.status.message??''}`);
    // Cierra el bloque, objeto o llamada definido anteriormente.
    }
    // Comienza el core Monte Carlo de la estrategia completa seleccionada.
    if (core === 'monteCarlo') {
      // Prepara contratos, cantidades, horizonte, volatilidad, tasa y dividendos con la configuración del escáner.
      const scenario = strategyMonteCarloScenario(snapshot, strategy, days, {...policy,scanner:settings});
      // Interrumpe solo este aporte cuando falta un escenario y conserva su explicación.
      if (!scenario.scenario) return missing(scenario.error);
      // Protege la valoración numérica para convertir un fallo en un motivo explícito de cálculo no disponible.
      try {
        // Obtiene cantidad de trayectorias y semilla reproducible de la configuración.
        const {paths,seed}=settings.monteCarlo;
        // Simula en modo terminal con 16 pasos, comisiones del escenario y sin coberturas dinámicas de acciones.
        const simulation = simulateMonteCarlo({ ...scenario.scenario.basis, paths, steps: 16, seed, mode: 'terminal', hedgeFeePerShare: 0, hedgeSpreadBps: 0, stockBorrowRate: 0 });
        // Extrae la fracción de trayectorias con P/L positivo bajo el modelo.
        monteCarloPop = simulation.pnl.probabilityOfProfit;
        // Convierte PoP a 0–100 e identifica datos del proveedor o reconstruidos; no la convierte en probabilidad
        // real calibrada.
        return {...result(monteCarloPop * 100, `PoP simulada neutral al riesgo: ${paths.toLocaleString('en-US')} trayectorias, semilla ${seed}, comisiones de entrada incluidas. ${scenario.scenario.dataMode==='estimated'?`${scenario.scenario.automaticEstimation?'Estimación automática':'Entradas estimadas'}: HV y primas teóricas pueden sustituir datos faltantes sobre contratos existentes. `:'Entradas del proveedor conocidas al corte. '}${strategy === 'pmcc' ? 'Al vencer la call corta, la LEAPS conserva su valor temporal con IV constante. ' : strategy === 'gamma' ? 'Straddle sin cobertura dinámica. ' : ''}No es probabilidad real calibrada ni se ajusta con titulares.`),dataMode:scenario.scenario.dataMode,automaticEstimation:scenario.scenario.automaticEstimation};
      // Si el motor falla, conserva el core sin datos e informa errores numéricos permitidos.
      } catch (error) { return missing(`No se pudo simular: ${error instanceof RangeError ? error.message : 'entradas numéricas no compatibles con el modelo'}.`); }
    // Cierra el bloque, objeto o llamada definido anteriormente.
    }
    // Los aportes técnicos restantes requieren un histórico reciente; los aportes anteriores conservan sus
    // propios controles.
    if (market.stale) return missing('Histórico diario desactualizado respecto al corte.');
    // La regla propia transforma buy en 80, sell en 20 y hold en 50; son valores heurísticos fijos.
    if (core === 'own') return latest ? result(latest.action === 'buy' ? 80 : latest.action === 'sell' ? 20 : 50,
      // Adjunta el motivo de la regla y una dirección ±0.6 o cero; sin 50 velas suficientes deja el aporte
      // ausente.
      `Regla ${settings.rule}: ${latest.reason}`, latest.action === 'buy' ? .6 : latest.action === 'sell' ? -.6 : 0) : missing('Se requieren al menos 50 velas diarias cerradas para la regla propia.');
    // Comienza el aporte de estructura de precio.
    if (core === 'structure') {
      // Lee soporte, resistencia y último cierre del estado técnico causal.
      const support = history.structure.points.at(-1)?.support, resistance = history.structure.points.at(-1)?.resistance, spot = market.spot.value;
      // Exige un precio y al menos 21 velas cerradas antes de construir estructura.
      if (spot === null || market.bars.length < 21) return missing('Se requieren 21 velas cerradas para analizar estructura. Se cargan antecedentes automáticamente cuando existen.');
      // Prefiere niveles confirmados; si faltan usa extremos provisionales de las 20 sesiones anteriores,
      // excluyendo la última.
      const prior = market.bars.slice(-21, -1), floor = support?.price ?? Math.min(...prior.map(b => b.low)), ceiling = resistance?.price ?? Math.max(...prior.map(b => b.high));
      // Un rango plano se presenta como neutral, sin atribuir contactos confirmados a los extremos.
      if (ceiling <= floor) return result(50, 'Rango plano: estructura neutral, sin niveles de rebote confirmados.', 0);
      // Normaliza la posición del cierre entre suelo y techo: el extremo inferior aporta dirección positiva y el
      // superior negativa.
      const direction = clamp(1 - 2 * (spot - floor) / (ceiling - floor));
      // Publica la puntuación e indica expresamente si cada extremo era confirmado o provisional.
      return result(50 + direction * 50, `${support ? 'Soporte confirmado' : 'Mínimo de las 20 sesiones previas (provisional)'} ${floor.toFixed(2)} / ${resistance ? 'resistencia confirmada' : 'máximo de las 20 sesiones previas (provisional)'} ${ceiling.toFixed(2)}. Los extremos provisionales no acreditan dos contactos.`, direction);
    // Cierra el bloque, objeto o llamada definido anteriormente.
    }
    // Para indicadores técnicos exige SMA20, SMA50, RSI y MACD completos; un faltante impide calcular este
    // aporte.
    if (!point || point.smaFast === null || point.smaSlow === null || point.rsi === null || point.macdHistogram === null) return missing('Faltan velas cerradas para SMA20/50, RSI14 y MACD.');
    // Promedia signo de tendencia de medias, signo del histograma MACD y componente RSI (50 − RSI)/50.
    const direction = clamp((Math.sign(point.smaFast - point.smaSlow) + Math.sign(point.macdHistogram) + clamp((50 - point.rsi) / 50)) / 3);
    // Convierte esa dirección a 0–100; Gamma usa la magnitud de movimiento, y las demás estrategias el signo.
    return result(strategy === 'gamma' ? 50 + Math.abs(direction) * 50 : 50 + direction * 50, `Media de sesgo SMA20/50, signo MACD y RSI14 (${point.rsi.toFixed(1)}).`, direction);
  // Cierra el bloque, objeto o llamada definido anteriormente.
  });
  // Selecciona solo cores con puntuación y suma exclusivamente sus pesos; null no se interpreta como cero.
  const available = results.filter(r => r.score !== null), availableWeight = available.reduce((sum, r) => sum + r.weight, 0);
  // Confluencia = suma de puntuación × peso / suma de pesos disponibles; sin peso evaluable devuelve null.
  const score = availableWeight ? Math.round(available.reduce((sum, r) => sum + r.score! * r.weight, 0) / availableWeight * 100) / 100 : null;
  // Reserva la proyección ilustrativa; no siempre habrá precio e historia para construirla.
  let projection: ScannerProjection | null = null;
  // Exige peso evaluable, precio y HV conocidos, histórico reciente y plazo entre 1 y 3650 días.
  if (availableWeight && knownBy(snapshot.market.spot, snapshot.asOf) && knownBy(market.historicalVolatility, snapshot.asOf) && !market.stale && days > 0 && days <= 3650) {
    // Usa el primer vencimiento de la estructura si está disponible; en caso contrario conserva el plazo
    // solicitado.
    const horizon = analysis.status === 'available' ? analysis.horizonDays ?? days : days;
    // Escala HV anual al horizonte mediante raíz de días/365 para construir un escenario de sensibilidad.
    const spot = snapshot.market.spot.value!, sigma = market.historicalVolatility.value! * Math.sqrt(horizon / 365);
    // Promedia direcciones por peso, usando cero únicamente para cores sin componente direccional.
    const directional = available.reduce((sum, r) => sum + (r.direction ?? 0) * r.weight, 0) / availableWeight;
    // Localiza el aporte de noticias dentro de los cores evaluables.
    const news = available.find(r => r.core === 'news');
    // Obtiene la parte de la dirección agregada que corresponde a noticias.
    const newsDirection = (news?.direction ?? 0) * (news?.weight ?? 0) / availableWeight;
    // Construye un precio objetivo ilustrativo con una perturbación exponencial acotada; no es un pronóstico
    // entrenado.
    const target = spot * Math.exp(clamp(directional * Math.min(sigma, 1) * .5, -.5, .5));
    // Construye una base sin el componente direccional de noticias para mostrar su contribución al escenario.
    const baseline = spot * Math.exp(clamp((directional - newsDirection) * Math.min(sigma, 1) * .5, -.5, .5));
    // Define cómo valorar el P/L de la estructura en un precio de escenario dado.
    const pnlAt = (price: number) => {
      // Devuelve P/L ausente si no existe una estructura analizable con escenarios.
      if (analysis.status !== 'available' || !analysis.scenarios.length) return null;
      // Para vencimiento común utiliza el valor intrínseco conjunto al vencimiento.
      if (strategy !== 'pmcc') {
        // Acumula el payoff respetando signos, cantidades y acciones entregables de cada pierna.
        const payoff = analysis.legs.reduce((sum, leg) => {
          // Lee entregables y strike efectivo verificados para la pierna.
          const terms = equityTerms(leg.contract, snapshot.asOf)!;
          // Calcula el intrínseco positivo de call o put y lo multiplica por cantidad firmada y acciones.
          return sum + leg.quantity * terms.shares * Math.max(0, leg.contract.type === 'call' ? price - terms.effectiveStrike : terms.effectiveStrike - price);
        // Termina la suma de payoffs de las piernas comenzando desde cero.
        }, 0);
        // Resta débito inicial firmado y coste de financiación para obtener P/L del escenario.
        return payoff - analysis.entryDebit! - analysis.financingCost;
      // Cierra el bloque, objeto o llamada definido anteriormente.
      }
      // Para PMCC obtiene tasa y dividendo, necesarios para valorar la call larga superviviente.
      const rate = policy.riskFreeRate ?? snapshot.macro.riskFreeRate, q = modelDividendYield(snapshot, policy);
      // Sin entradas conocidas al corte no publica el valor de la diagonal.
      if (!knownBy(rate, snapshot.asOf) || !knownBy(q, snapshot.asOf)) return null;
      // Valora y suma cada pierna de la diagonal al horizonte corto.
      const marked = analysis.legs.reduce((sum, leg) => {
        // Obtiene el strike efectivo y número de acciones de esa pierna.
        const terms = equityTerms(leg.contract, snapshot.asOf)!;
        // Conserva el tiempo restante después de descontar el horizonte; no convierte la LEAPS en un contrato ya
        // vencido.
        const remaining = Math.max(0, (valuationExpiry(leg.contract, snapshot.asOf).time - Date.parse(snapshot.asOf)) / 86400000 - horizon);
        // Valora por BSM con IV de cada contrato, cantidad firmada y acciones entregables.
        return sum + leg.quantity * terms.shares * blackScholes({ spot: price, strike: terms.effectiveStrike, days: remaining, volatility: leg.contract.impliedVolatility.value!, rate: rate.value!, dividendYield: q.value!, type: leg.contract.type }).price;
      // Termina la suma de marcas teóricas de la diagonal comenzando desde cero.
      }, 0);
      // Resta entrada y financiación al valor remanente conjunto.
      return marked - analysis.entryDebit! - analysis.financingCost;
    // Cierra el bloque, objeto o llamada definido anteriormente.
    };
    // Construye bandas ilustrativas alrededor del objetivo con la escala 1.645 × sigma y límites numéricos
    // explícitos.
    projection = { spot, target, baseline, lower: target * Math.exp(-Math.min(1.645 * sigma, 3)), upper: target * Math.exp(Math.min(1.645 * sigma, 3)), days: Math.round(horizon * 10) / 10,
      // Incluye diferencia atribuida al escenario de noticias y los P/L con y sin ese componente.
      newsImpact: target - baseline, pnl: pnlAt(target), baselinePnl: pnlAt(baseline), pnlMethod: strategy === 'pmcc' ? 'diagonal' : 'payoff' };
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Si ningún core aporta datos, explica que la empresa no es evaluable.
  const reason = score === null ? 'No evaluable: ningún core activo dispone de datos suficientes.'
    // En otro caso detalla puntuaciones, pesos, cobertura y estimaciones, indicando que la confluencia no es una
    // probabilidad.
    : `Confluencia ${score}/100 · ${available.length}/${selected.length} cores evaluables. Media ponderada de los cores disponibles; no es probabilidad de éxito. ` + results.map(r => `${r.core}: ${r.score === null ? 'sin datos' : r.score + '/100'}${r.dataMode==='estimated'?r.automaticEstimation?' · estimación automática':' · estimado':''} (peso ${r.weight})`).join('; ');
  // Entrega el resultado completo para la gráfica, el ranking y las combinaciones del recomendador.
  return { score, results, available: available.length, missing: selected.length - available.length, active: selected.length, availableWeight, reason, sentiment, projection, monteCarloPop };
// Cierra el bloque, objeto o llamada definido anteriormente.
}
