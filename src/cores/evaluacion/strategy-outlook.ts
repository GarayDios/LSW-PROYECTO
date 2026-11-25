// Perspectiva condicional de cada estrategia: prepara escenario, comparte pronóstico y calcula P/L de
// comparables. Distingue exploración, revisión y ausencia de evidencia.

// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { CompanyResearch } from '../compartido/research-model.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { StrategyId } from '../compartido/types.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { forecastMarket, type MarketForecast } from '../02-inteligencia-artificial/forecast.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { strategyMonteCarloScenario, type MonteCarloBasis } from './monte-carlo-scenario.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { analysisPolicy, type AnalysisSettings } from '../../features/research/analysis-settings.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { blackScholes } from '../nucleo-cuantitativo/bsm.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type {ScannerEvaluation} from './scanner.ts';

// Calcula P/L condicional de una posición en un spot y tiempo elegidos; incluye entrada financiada y
// comisiones de entrada y salida.
export function strategyPnlAtSpot(basis:MonteCarloBasis,spot:number,elapsedDays:number):number {
  // Exige spot positivo y tiempo transcurrido entre cero y el horizonte del escenario.
  if(!Number.isFinite(spot)||spot<=0||!Number.isFinite(elapsedDays)||elapsedDays<0||elapsedDays>basis.days)throw new RangeError('Horizonte o precio del escenario inválido.');
  // Suma primas firmadas por acciones y comisiones de entrada por cantidad absoluta de contratos.
  const debit=basis.legs.reduce((sum,leg)=>sum+leg.quantity*leg.units*leg.premium+Math.abs(leg.quantity)*basis.feePerContract,0);
  // Valora por BSM las piernas conservando tiempo remanente e IV propia cuando corresponden a una diagonal.
  const mark=basis.legs.reduce((sum,leg)=>sum+leg.quantity*leg.units*blackScholes({spot,strike:leg.strike,days:Math.max(0,(leg.daysToExpiry??basis.days)-elapsedDays),volatility:leg.volatility??basis.volatility,rate:basis.rate,dividendYield:basis.dividendYield,type:leg.type}).price,0);
  // Calcula las comisiones de salida de todas las piernas.
  const exitFees=basis.legs.reduce((sum,leg)=>sum+Math.abs(leg.quantity)*basis.feePerContract,0);
  // Resta del valor de mercado teórico la entrada capitalizada a la tasa y las comisiones de salida.
  const result=mark-debit*Math.exp(basis.rate*elapsedDays/365)-exitFees;
  // Rechaza resultados no finitos en lugar de mostrarlos como rentabilidad válida.
  if(!Number.isFinite(result))throw new RangeError('Resultado fuera del rango numérico.');
  // Devuelve el P/L condicional; no constituye un precio histórico de ejecución.
  return result;
// Cierra el bloque, objeto o llamada definido anteriormente.
}

// Crea caché por objeto de instantánea y horizonte, liberable al quedar sin referencias gracias a WeakMap.
const forecasts=new WeakMap<CompanyResearch,Map<number,MarketForecast>>();
// Obtiene un pronóstico de 5, 20 o 60 sesiones, compartido entre estrategias de la misma instantánea.
function forecastFor(snapshot:CompanyResearch,horizon:5|20|60){
  // Busca o crea la caché de horizontes para esa instantánea.
  let cache=forecasts.get(snapshot);if(!cache){cache=new Map();forecasts.set(snapshot,cache);}
  // Busca si ya existe un pronóstico para el horizonte elegido.
  let forecast=cache.get(horizon);
  // Si falta, calcula el pronóstico con velas y corte de la empresa y lo guarda en caché.
  if(!forecast){forecast=forecastMarket({symbol:snapshot.symbol,bars:snapshot.market.bars,asOf:snapshot.asOf,source:snapshot.market.historicalVolatility.source,horizonSessions:horizon,demo:snapshot.dataMode==='demo'});cache.set(horizon,forecast);}
  // Devuelve el pronóstico reutilizado o recién construido.
  return forecast;
// Cierra el bloque, objeto o llamada definido anteriormente.
}

// Une escenario contractual, pronóstico comparable y condiciones de revisión en una perspectiva de
// estrategia.
export function strategyOutlook(snapshot:CompanyResearch,strategy:StrategyId,days:number,settings:AnalysisSettings,referenceForecast?:MarketForecast|null){
  // Construye el escenario utilizando la política del usuario y su procedencia de datos.
  const resolved=strategyMonteCarloScenario(snapshot,strategy,days,analysisPolicy(settings,snapshot));
  // Obtiene la base de valoración solo si existe un escenario válido.
  const basis=resolved.scenario?.basis;
  // Elige el mayor horizonte 60/20/5 sesiones que cabe en el plazo y en el primer vencimiento, usando 365/252
  // para convertir a días.
  const horizon=([60,20,5] as const).find(h=>h*365/252<=Math.min(days,basis?.days??days));
  // Reutiliza un pronóstico de referencia solo si coinciden símbolo, corte, horizonte y último cierre con su
  // fecha.
  const shared=referenceForecast&&referenceForecast.symbol===snapshot.symbol&&referenceForecast.asOf===snapshot.asOf&&referenceForecast.horizonSessions===horizon&&referenceForecast.lastClose===snapshot.market.bars.at(-1)?.close&&referenceForecast.lastCloseAt===new Date(snapshot.market.bars.at(-1)?.time??NaN).toISOString()?referenceForecast:null;
  // Obtiene el pronóstico compatible o lo deja ausente si ningún horizonte cabe.
  const forecast=horizon?shared??forecastFor(snapshot,horizon):null;
  // Prepara una rentabilidad no disponible con motivo y sin rellenar métricas con cero.
  const unavailable={status:'unavailable' as const,reason:resolved.error??forecast?.reason??'El vencimiento es demasiado cercano para los horizontes de 5, 20 o 60 sesiones.',expectedPnl:null,returnOnCapital:null,p10:null,p90:null,positiveFraction:null};
  // Permite rentabilidad experimental o validada con media, retorno sobre capital y percentiles, manteniendo
  // también el estado ausente.
  let profitability:typeof unavailable|{status:'experimental'|'validated';reason:string;expectedPnl:number;returnOnCapital:number|null;p10:number;p90:number;positiveFraction:number}=unavailable;
  // Calcula comparables solo con escenario, pronóstico válido y muestras; excluye Gamma gestionada de este
  // cálculo estático.
  if(basis&&forecast?.status==='available'&&forecast.comparables?.length&&horizon&&strategy!=='gamma'){
    // Convierte el horizonte de sesiones a días para valorar la posición.
    const elapsed=horizon*365/252;
    // Aplica cada retorno comparable al cierre de referencia y calcula su P/L, ordenándolo de menor a mayor.
    const outcomes=forecast.comparables.map(row=>({...row,pnl:strategyPnlAtSpot(basis,forecast.lastClose!*(1+row.return),elapsed)})).sort((a,b)=>a.pnl-b.pnl);
    // Obtiene percentiles acumulando los pesos de los comparables, no contando todas las muestras igual.
    const percentile=(q:number)=>{let total=0;for(const row of outcomes){total+=row.weight;if(total>=q)return row.pnl;}return outcomes.at(-1)!.pnl;};
    // Calcula media ponderada de P/L y obtiene el capital requerido de la estructura.
    const expectedPnl=outcomes.reduce((sum,row)=>sum+row.weight*row.pnl,0),capital=resolved.analysis?.capitalRequired;
    // Publica P10, P90, fracción positiva y retorno sobre capital; validated refleja la validación del
    // pronóstico de precio, no una validación completa de opciones.
    profitability={status:forecast.validation.passed?'validated':'experimental',reason:forecast.reason,expectedPnl,returnOnCapital:capital&&capital>0?expectedPnl/capital:null,p10:percentile(.1),p90:percentile(.9),positiveFraction:outcomes.reduce((sum,row)=>sum+(row.pnl>0?row.weight:0),0)};
  // Para Gamma informa que un straddle estático no acredita rentabilidad de las coberturas dinámicas.
  }else if(strategy==='gamma')profitability={...unavailable,reason:'Gamma Scalping necesita una trayectoria de coberturas y sus costes. La rentabilidad del straddle estático no acredita el resultado de esa gestión.'};
  // Etiqueta revisión con entradas observadas sin supuestos y feed OPRA, excluyendo demo y sandbox; el bróker
  // aún debe verificar la ejecución.
  const executionReady=!!basis&&resolved.scenario?.dataMode==='observed'&&resolved.analysis?.legs.every(leg=>leg.contract.bid.kind!=='assumed'&&leg.contract.ask.kind!=='assumed'&&leg.contract.premium.kind!=='assumed')===true&&snapshot.options.feed==='opra'&&snapshot.dataMode!=='demo'&&snapshot.dataMode!=='sandbox';
  // Devuelve estrategia, escenario, pronóstico, horizonte, métricas condicionales y etiqueta de calidad de
  // entradas.
  return {strategy,resolved,forecast,horizonSessions:horizon??null,profitability,executionReady};
// Cierra el bloque, objeto o llamada definido anteriormente.
}
// Deriva el tipo de perspectiva directamente de la función para evitar duplicar su estructura.
export type StrategyOutlook=ReturnType<typeof strategyOutlook>;

// Construye una prioridad heurística de revisión a partir de la perspectiva y confluencia; no envía órdenes.
export function strategyRecommendation(outlook:StrategyOutlook,evaluation:ScannerEvaluation|null,minimumScore=60){
  // Inicializa los motivos que justifican esperar, explorar o revisar.
  const reasons:string[]=[];
  // Rechaza un umbral de confluencia fuera de 0–100.
  if(!Number.isFinite(minimumScore)||minimumScore<0||minimumScore>100)return {action:'wait' as const,reasons:['El umbral de confluencia debe estar entre 0 y 100.']};
  // Acumula un motivo de espera si no pudo formarse el escenario.
  if(!outlook.resolved.scenario)reasons.push(outlook.resolved.error??'No se pudo formar la estrategia.');
  // Acumula falta de evidencia si el escáner no tiene cores evaluables.
  if(evaluation?.score===null||!evaluation)reasons.push('No hay cores evaluables para respaldar la revisión.');
  // Acumula confluencia insuficiente cuando la puntuación no alcanza el mínimo elegido.
  else if(evaluation.score<minimumScore)reasons.push(`Confluencia ${evaluation.score.toFixed(1)}% inferior al umbral elegido de ${minimumScore}%.`);
  // Acumula un motivo si la media condicional de comparables es cero o negativa.
  if(outlook.profitability.expectedPnl!==null&&outlook.profitability.expectedPnl<=0)reasons.push('El P/L medio de los comparables es negativo o nulo con los costes configurados.');
  // Devuelve wait si aparece cualquier motivo de bloqueo de esta prioridad.
  if(reasons.length)return {action:'wait' as const,reasons};
  // Si no hay bloqueo, registra que la estructura cumple la confluencia pedida.
  reasons.push(`La estructura de ${outlook.strategy} alcanza la confluencia requerida con los cores disponibles.`);
  // Conserva el motivo del estado experimental o no validado de rentabilidad.
  if(outlook.profitability.status!=='validated')reasons.push(outlook.profitability.reason);
  // Informa si las entradas todavía requieren cotizaciones ejecutables para revisar una orden.
  if(!outlook.executionReady)reasons.push('Las entradas son exploratorias: se necesitan cotizaciones ejecutables para revisar una orden.');
  // Devuelve review solo con calidad de entradas y estado validated; los demás casos aptos quedan como
  // explore.
  return {action:outlook.executionReady&&outlook.profitability.status==='validated'?'review' as const:'explore' as const,reasons};
// Cierra el bloque, objeto o llamada definido anteriormente.
}
