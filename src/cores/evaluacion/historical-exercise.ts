// Estado técnico causal y ejercicios teóricos de posiciones históricas. Separa información al corte de
// cierres posteriores revelados para valorar resultados.

// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { deriveObservedMarket } from '../01-analisis-tecnico/market-analysis.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { analyzeHistory,type StockRule } from '../05-indicadores-y-senales/signals.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import {calculateTechnicalIndicators} from '../01-analisis-tecnico/indicators.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import {analyzeSupportResistance} from '../01-analisis-tecnico/support-resistance.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { blackScholes } from '../nucleo-cuantitativo/bsm.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { strategyPnlAtSpot } from './strategy-outlook.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { MonteCarloBasis } from './monte-carlo-scenario.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { StrategyId } from '../compartido/types.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { Candle } from '../../features/market/chart-history.ts';

// Reconstruye el estado técnico de una empresa usando únicamente velas disponibles en el corte histórico.
export function historicalState(symbol:string,bars:readonly Candle[],asOf:string,rule:StockRule='sma-rsi'){
  // Filtra y normaliza el mercado diario conocido en esa fecha.
  const market=deriveObservedMarket(symbol,bars,asOf);
  // Ejecuta las reglas históricas si hay 50 velas; con menos datos deja ese análisis ausente.
  const analysis=market.bars.length>=50?analyzeHistory(market.bars,{rule}):null;
  // Aun con historia corta calcula los indicadores que puedan estar disponibles.
  const indicators=analysis?.indicators??calculateTechnicalIndicators(market.bars);
  // Reutiliza la estructura del análisis o calcula niveles con las velas admitidas.
  const structure=analysis?.structure??analyzeSupportResistance(market.bars);
  // Identifica última vela y anterior sin suponer que existan.
  const bar=market.bars.at(-1)??null,previous=market.bars.at(-2)??null;
  // Entrega estado, último indicador, niveles y eventos de la última vela; no incorpora velas futuras.
  return {market,analysis,indicators,bar,previous,indicator:indicators.at(-1)??null,structure:structure.points.at(-1)??null,events:analysis?.technicalEvents.filter(event=>event.time===bar?.time)??[]};
// Cierra el bloque, objeto o llamada definido anteriormente.
}

// La disponibilidad conservadora de un cierre es a las 06:00 UTC del día siguiente, igual que en
// investigación.
export const historicalCloseAvailableAt=(time:number)=>Date.parse(new Date(time).toISOString().slice(0,10))+86400000+6*3600000;

// Valora teóricamente una posición fijada al inicio en un spot posterior y un tiempo transcurrido.
export function historicalPositionMark(basis:MonteCarloBasis,spot:number,elapsedDays:number){
  // Calcula el P/L financiado con el mismo ayudante usado por las perspectivas de estrategia.
  const pnl=strategyPnlAtSpot(basis,spot,elapsedDays);
  // Desglosa cada pierna sin cambiar cantidades, strikes ni vencimientos originales.
  const legs=basis.legs.map(leg=>{
    // Conserva el vencimiento de cada pierna, incluida la LEAPS remanente en PMCC.
    const remainingDays=Math.max(0,(leg.daysToExpiry??basis.days)-elapsedDays);
    // Calcula precio y griegas BSM con la IV fijada para la pierna.
    const model=blackScholes({spot,strike:leg.strike,days:remainingDays,volatility:leg.volatility??basis.volatility,rate:basis.rate,dividendYield:basis.dividendYield,type:leg.type});
    // Convierte contratos firmados a acciones equivalentes y calcula comisión por cantidad absoluta.
    const signedUnits=leg.quantity*leg.units,fee=Math.abs(leg.quantity)*basis.feePerContract;
    // Publica valor y P/L por pierna, descontando entrada financiada y comisiones de entrada y salida.
    return {...leg,remainingDays,mark:model.price,value:signedUnits*model.price,pnl:signedUnits*model.price-(signedUnits*leg.premium+fee)*Math.exp(basis.rate*elapsedDays/365)-fee,
      // Escala delta, gamma, theta y vega por las unidades firmadas de esa pierna.
      delta:signedUnits*model.delta,gamma:signedUnits*model.gamma,theta:signedUnits*model.theta,vega:signedUnits*model.vega};
  // Cierra el bloque, objeto o llamada definido anteriormente.
  });
  // Devuelve el valor total y los días del horizonte que todavía quedan.
  return {spot,elapsedDays,pnl,daysRemaining:Math.max(0,basis.days-elapsedDays),value:legs.reduce((sum,l)=>sum+l.value,0),legs,
    // Agrega las sensibilidades de todas las piernas respetando signos.
    delta:legs.reduce((sum,l)=>sum+l.delta,0),gamma:legs.reduce((sum,l)=>sum+l.gamma,0),theta:legs.reduce((sum,l)=>sum+l.theta,0),vega:legs.reduce((sum,l)=>sum+l.vega,0)};
// Cierra el bloque, objeto o llamada definido anteriormente.
}

// Construye un ejercicio educativo con contratos teóricos definidos por el usuario; no afirma que fueran
// contratos listados.
export function historicalExercise(input:{strategy:StrategyId;spot:number;volatility:number;rate:number;dividendYield:number;days:number;longDays:number;shortStrike:number;longStrike:number;feePerContract:number;capital:number;asOf:string;futureBars:readonly Candle[];contracts?:number}){
  // Extrae parámetros del escenario inicial y conserva aparte los cierres futuros que se revelarán.
  const {spot,volatility,rate,dividendYield,days,longDays,shortStrike,longStrike,feePerContract,capital}=input;
  // Valida entradas finitas y límites de precio, volatilidad, plazo, tasa, dividendos, costes y capital.
  if(![spot,volatility,rate,dividendYield,days,longDays,shortStrike,longStrike,feePerContract,capital].every(Number.isFinite)||spot<=0||volatility<=0||volatility>3||days<=0||days>3650||longDays<=0||longDays>3650||shortStrike<=0||longStrike<=0||feePerContract<0||capital<=0||rate<-.2||rate>1||dividendYield<0||dividendYield>1)throw new RangeError('Revisa las entradas del ejercicio.');
  // Para PMCC exige call larga de strike inferior y vencimiento posterior a la call corta.
  if(input.strategy==='pmcc'&&(longDays<=days||longStrike>=shortStrike))throw new RangeError('PMCC requiere una call larga con menor strike y mayor vencimiento.');
  // Para Backspread exige strike comprado superior al vendido.
  if(input.strategy==='backspread'&&longStrike<=shortStrike)throw new RangeError('Backspread requiere que el strike largo sea superior al corto.');
  // Usa una unidad de estrategia cuando no se especificó cantidad.
  const contracts=input.contracts??1;
  // Limita el ejercicio a entre 1 y 100 unidades enteras.
  if(!Number.isInteger(contracts)||contracts<1||contracts>100)throw new RangeError('Usa entre 1 y 100 unidades de la estrategia.');
  // Rechaza estrategias ajenas a las cuatro implementadas.
  if(!['wheel','pmcc','backspread','gamma'].includes(input.strategy))throw new RangeError('Estrategia no reconocida.');
  // Construye una pierna teórica de 100 acciones con prima BSM y cantidad multiplicada por unidades del
  // ejercicio.
  const leg=(type:'call'|'put',strike:number,quantity:number,maturity=days)=>({type,strike,quantity:quantity*contracts,units:100,premium:blackScholes({spot,strike,days:maturity,volatility,rate,dividendYield,type}).price,daysToExpiry:maturity,volatility});
  // Forma put vendida, diagonal, Backspread −1/+2 o straddle +1/+1 según la estrategia.
  const legs=input.strategy==='wheel'?[leg('put',shortStrike,-1)]:input.strategy==='pmcc'?[leg('call',longStrike,1,longDays),leg('call',shortStrike,-1)]:input.strategy==='backspread'?[leg('call',shortStrike,-1),leg('call',longStrike,2)]:[leg('call',shortStrike,1),leg('put',shortStrike,1)];
  // Suma débito o crédito firmado y comisiones de apertura.
  const debit=legs.reduce((sum,l)=>sum+l.quantity*l.units*l.premium+Math.abs(l.quantity)*feePerContract,0);
  // Calcula reserva por estructura: nominal Wheel, débito más reserva PMCC, riesgo del valle Backspread o
  // débito del straddle.
  const required=input.strategy==='wheel'?(shortStrike*100+feePerContract)*contracts:input.strategy==='pmcc'?Math.max(0,debit)+shortStrike*100*contracts:input.strategy==='backspread'?Math.max(0,(longStrike-shortStrike)*100*contracts+debit):Math.max(0,debit);
  // Rechaza ejercicios que superen el capital declarado.
  if(required>capital)throw new RangeError(`El ejercicio requiere USD ${required.toFixed(2)}; capital disponible USD ${capital.toFixed(2)}.`);
  // Congela las entradas y piernas que se utilizarán para valorar la evolución del ejercicio.
  const basis:MonteCarloBasis={spot,volatility,rate,dividendYield,days,feePerContract,legs};
  // Convierte la fecha del ejercicio a un instante de decisión.
  const cutoff=Date.parse(input.asOf);
  // Rechaza un corte que no se pueda interpretar.
  if(!Number.isFinite(cutoff))throw new RangeError('Corte histórico inválido.');
  // Ordena por fecha los cierres posteriores, manteniéndolos separados del estado inicial.
  const points=[...input.futureBars].sort((a,b)=>a.time-b.time).flatMap(bar=>{
    // Calcula cuándo se considera conocido cada cierre posterior.
    const available=historicalCloseAvailableAt(bar.time);
    // Mide el tiempo transcurrido desde el corte usando esa disponibilidad.
    const elapsed=(available-cutoff)/86400000;
    // Solo valora cierres positivos conocidos después del corte y dentro del horizonte; el P/L sigue siendo
    // teórico.
    return elapsed>0&&elapsed<=days&&bar.close>0&&Number.isFinite(bar.close)?[{time:bar.time,days:elapsed,spot:bar.close,pnl:strategyPnlAtSpot(basis,bar.close,elapsed)}]:[];
  // Cierra el bloque, objeto o llamada definido anteriormente.
  });
  // Entrega base, capital, entrada y trayectoria; complete usa una tolerancia final inferior a cuatro días, no
  // confirma ejecución real.
  return {basis,required,debit,points,complete:points.length>0&&days-points.at(-1)!.days<4};
// Cierra el bloque, objeto o llamada definido anteriormente.
}
