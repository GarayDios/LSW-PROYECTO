// Reproducción de coberturas delta con acciones enteras sobre una trayectoria suministrada. Las opciones se
// valoran por modelo; no se envían órdenes.

// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { z } from 'zod';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { blackScholes } from '../nucleo-cuantitativo/bsm.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { analyzeStrategy,type AnalysisPolicy } from './strategy-analysis.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { valuationExpiry,equityTerms } from '../../features/research/contract-terms.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { CompanyResearch } from '../compartido/research-model.ts';

// Valida procedencia y clase de trayectoria y abre el esquema de puntos.
export const gammaPathSchema=z.object({source:z.string().min(1).max(500),kind:z.enum(['observed','scenario']),points:z.array(z.object({
  // Cada punto necesita hora ISO con zona, spot positivo y bid/ask positivos.
  at:z.string().datetime({offset:true}),spot:z.number().finite().positive().max(1e7),bid:z.number().finite().positive(),ask:z.number().finite().positive(),
  // Admite volatilidad por punto opcional, positiva y no superior a cinco.
  volatility:z.number().finite().positive().max(5).optional(),
// Exige que el spot quede entre bid y ask y una trayectoria de 2 a 2000 puntos.
}).strict().refine(p=>p.bid<=p.spot&&p.ask>=p.spot,'El spot debe estar entre bid y ask.')).min(2).max(2000)}).strict();
// Deriva el tipo de trayectoria del esquema de validación.
export type GammaPath=z.infer<typeof gammaPathSchema>;
// Configura tolerancia de delta y máximo de acciones para los rebalanceos.
export const gammaConfigSchema=z.object({deltaTolerance:z.number().finite().min(0).max(1e5).default(10),maxShares:z.number().int().min(1).max(1e5).default(1000),
  // Configura intervalo mínimo entre coberturas y comisión por acción.
  minimumMinutes:z.number().finite().min(0).max(1440).default(0),feePerShare:z.number().finite().min(0).max(10).default(.005),
  // Configura coste de préstamo y permiso explícito de venta corta de acciones, desactivado por defecto.
  stockBorrowRate:z.number().finite().min(0).max(1).default(.05),allowShortStock:z.boolean().default(false)}).strict();
// Deriva el tipo de entrada de configuración, admitiendo campos con valores predeterminados.
export type GammaConfig=z.input<typeof gammaConfigSchema>;
// Describe P/L con y sin cobertura, operaciones, costes y drawdown del recorrido.
export type GammaPathResult={kind:'observed'|'scenario';source:string;pnl:number;unhedgedPnl:number;hedgeTrades:number;stockFees:number;spreadCost:number;borrowCost:number;maxDrawdown:number;
  // Registra cada rebalanceo y bloqueo con fecha, exposición, patrimonio y motivo.
  events:{at:string;spot:number;shares:number;deltaBefore:number;deltaAfter:number;trade:number;equity:number;reason:string}[];warnings:string[]};

// Reproduce coberturas delta sobre una trayectoria suministrada; las opciones se marcan teóricamente y no se
// envían órdenes.
export function simulateGammaPath(snapshot:CompanyResearch,days:number,policy:AnalysisPolicy,pathInput:unknown,configInput:GammaConfig={}):GammaPathResult {
  // Rechaza dividendos discretos porque este replay no dispone del modelo de caja adicional que requieren.
  if(policy.dividendModel==='declared-cash')throw new RangeError('La cobertura Gamma requiere un modelo de caja de dividendos discretos adicional; usa el modelo continuo explícito para este replay.');
  // Valida trayectoria y configuración antes de abrir el escenario.
  const path=gammaPathSchema.parse(pathInput),config=gammaConfigSchema.parse(configInput);
  // Selecciona el straddle inicial Gamma usando el análisis compartido.
  const opening=analyzeStrategy(snapshot,'gamma',days,policy);
  // Exige apertura válida y débito conocido para poder reproducir la cobertura.
  if(opening.status!=='available'||opening.entryDebit===null)throw new RangeError(`Faltan entradas Gamma: ${opening.missing.join(', ')}`);
  // Usa capital explícito o tres veces el débito como presupuesto educativo predeterminado.
  const capital=policy.capital??opening.entryDebit*3;
  // Exige capital suficiente para pagar la apertura del straddle.
  if(capital<opening.entryDebit)throw new RangeError('Capital insuficiente para abrir el straddle.');
  // Obtiene vencimiento del straddle e instante inicial de decisión.
  const expiry=valuationExpiry(opening.legs[0].contract,snapshot.asOf).time,start=Date.parse(snapshot.asOf);
  // Inicializa el tiempo previo para verificar que la trayectoria avance.
  let previous=start;
  // Exige puntos crecientes, no anteriores al corte ni posteriores al vencimiento; solo el primer punto puede
  // coincidir con el inicio.
  for(const p of path.points){const t=Date.parse(p.at);if(t<start||t<previous||t>expiry||t===previous&&p!==path.points[0])throw new RangeError('La trayectoria debe avanzar, quedar después del corte y no superar el vencimiento.');previous=t;}
  // Lee tasa y dividendo del escenario desde política o fuentes de la instantánea.
  const q=policy.dividendYield??snapshot.fundamentals.dividendYield,r=policy.riskFreeRate??snapshot.macro.riskFreeRate;
  // Define la marca teórica de precio y delta conjuntos del straddle en cada punto.
  const mark=(p:GammaPath['points'][number])=>{
    // Inicializa sumas de valor y delta de opciones.
    let value=0,delta=0;
    // Recorre las piernas y obtiene sus entregables verificados.
    for(const leg of opening.legs){const terms=equityTerms(leg.contract,snapshot.asOf)!;
      // Valora BSM con el spot del punto, tiempo restante y volatilidad del punto o IV inicial de la pierna.
      const model=blackScholes({spot:p.spot,strike:terms.effectiveStrike,days:Math.max(0,(expiry-Date.parse(p.at))/86400000),volatility:p.volatility??leg.contract.impliedVolatility.value!,rate:r.value!,dividendYield:q.value!,type:leg.contract.type});
      // Agrega precio y delta escalados por cantidad firmada y acciones entregables.
      value+=leg.quantity*model.price*terms.shares;delta+=leg.quantity*model.delta*terms.shares;
    // Cierra la suma por pierna y devuelve la marca conjunta.
    }return {value,delta};
  // Cierra el bloque, objeto o llamada definido anteriormente.
  };
  // Inicializa resultados y costes junto con las advertencias del replay.
  const result:GammaPathResult={kind:path.kind,source:path.source,pnl:0,unhedgedPnl:0,hedgeTrades:0,stockFees:0,spreadCost:0,borrowCost:0,maxDrawdown:0,events:[],warnings:[
    // Identifica la cobertura como simulación con acciones enteras, sin envío de órdenes.
    'Simulación de cobertura con acciones enteras; no se envían órdenes ni se demuestra rentabilidad futura.',
    // Identifica los precios de opciones como marcas BSM, aunque el subyacente de la trayectoria sea observado.
    'Las opciones se marcan con BSM europeo e IV suministrada o constante. No son precios históricos de salida de opciones.',
    // Aclara que la reserva de cortos es conservadora y no equivale al margen del bróker ni al modelo de
    // dividendos discretos.
    'La garantía para acciones cortas es una reserva conservadora de nominal completo; no es margen oficial. Los dividendos discretos de acciones cortas no se infieren del rendimiento continuo q.',
  // Cierra la lista de entradas o resultados del bloque anterior.
  ]};
  // Resta el débito inicial del capital y comienza sin acciones, con reloj y máximo de patrimonio iniciales.
  let cash=capital-opening.entryDebit,shares=0,lastTime=start,lastHedge=-Infinity,peak=capital;
  // Recorre cada punto de la trayectoria para actualizar préstamo, delta y cobertura.
  for(let i=0;i<path.points.length;i++){
    // Calcula el intervalo anual desde el punto previo.
    const point=path.points[i],time=Date.parse(point.at),dt=(time-lastTime)/(365*86400000);
    // Devenga préstamo solamente si existe una posición corta de acciones.
    const borrow=Math.max(0,-shares)*point.spot*config.stockBorrowRate*dt;
    // Descuenta el préstamo del efectivo y lo acumula como coste.
    cash-=borrow;result.borrowCost+=borrow;
    // Valora opciones y suma su delta a las acciones mantenidas.
    const option=mark(point),before=shares+option.delta;
    // Empieza sin negociación y con un motivo que explica la ausencia de rebalanceo.
    let trade=0,reason='Dentro de tolerancia o intervalo mínimo de cobertura.';
    // Rebalancea antes del último punto solo si se supera tolerancia y se cumple el intervalo mínimo.
    if(i<path.points.length-1 && Math.abs(before)>config.deltaTolerance && time-lastHedge>=config.minimumMinutes*60000){
      // Redondea la cobertura a acciones enteras y usa ask para comprar o bid para vender.
      const desired=Math.round(-option.delta),change=desired-shares,price=change>0?point.ask:point.bid;
      // Simula efectivo posterior incluyendo comisión por acción negociada.
      const afterCash=cash-change*price-Math.abs(change)*config.feePerShare;
      // Calcula patrimonio que quedaría tras la cobertura propuesta.
      const equity=afterCash+desired*point.spot+option.value;
      // Bloquea una cobertura que exceda el máximo de acciones.
      if(Math.abs(desired)>config.maxShares)reason='Cobertura bloqueada por límite de acciones.';
      // Bloquea ventas cortas si no se autorizaron en la configuración del escenario.
      else if(desired<0&&!config.allowShortStock)reason='Cobertura bloqueada: ventas cortas no autorizadas en este escenario.';
      // Comprueba efectivo para posiciones largas y reserva nominal completa para cortos.
      else if(desired>=0&&afterCash<0 || desired<0&&equity<Math.abs(desired)*point.spot)reason='Cobertura bloqueada por capital insuficiente.';
      // Si cumple los controles, actualiza acciones, efectivo, reloj y comisiones de la cobertura.
      else{trade=change;cash=afterCash;shares=desired;lastHedge=time;result.hedgeTrades++;result.stockFees+=Math.abs(change)*config.feePerShare;
        // Acumula el coste de cruzar el spread y explica el rebalanceo realizado.
        result.spreadCost+=Math.abs(change)*Math.abs(price-point.spot);reason='Delta ajustada con acciones enteras, bid/ask y comisión.';}
    // Cierra el bloque, objeto o llamada definido anteriormente.
    }
    // En el último punto liquida la cobertura y marca el cierre de la posición.
    if(i===path.points.length-1){
      // Vende acciones largas al bid o recompra acciones cortas al ask.
      const exit=shares>0?point.bid:point.ask;
      // Lleva al efectivo el cierre de acciones, descontando su comisión.
      cash+=shares*exit-Math.abs(shares)*config.feePerShare;
      // Acumula spread y comisiones de esa liquidación.
      result.spreadCost+=Math.abs(shares)*Math.abs(exit-point.spot);result.stockFees+=Math.abs(shares)*config.feePerShare;
      // Deja acciones en cero y registra la negociación de salida.
      trade=-shares;shares=0;reason='Cierre de cobertura y opciones al final de la trayectoria.';
      // Cuenta contratos de opciones para sus comisiones de salida.
      const contractCount=opening.legs.reduce((n,l)=>n+Math.abs(l.quantity),0);
      // Estima medio spread de salida a partir de las cotizaciones iniciales; no es una cotización histórica de
      // cierre.
      const optionExitSpread=opening.legs.reduce((n,l)=>n+Math.abs(l.quantity)*(l.contract.ask.value!-l.contract.bid.value!)*opening.contractMultiplier!/2,0);
      // Calcula un importe auxiliar de salida; esta variable no se utiliza después en el estado actual del código.
      const exitCost=time===expiry?0:optionExitSpread+(policy.feePerContract??0)*contractCount;
      // Añade valor de opciones menos fricciones modeladas; al vencimiento no cobra spread ni comisión de salida
      // de opciones.
      cash+=Math.max(0,option.value-optionExitSpread*(time===expiry?0:1))-(time===expiry?0:(policy.feePerContract??0)*contractCount);
      // Calcula P/L total y referencia sin coberturas con el mismo cierre teórico.
      result.pnl=cash-capital;result.unhedgedPnl=Math.max(0,option.value-optionExitSpread*(time===expiry?0:1))-(time===expiry?0:(policy.feePerContract??0)*contractCount)-opening.entryDebit;
    // Cierra el bloque, objeto o llamada definido anteriormente.
    }
    // Entre puntos valora efectivo, acciones y opciones; al final usa el efectivo liquidado.
    const equity=i===path.points.length-1?cash:cash+shares*point.spot+option.value;
    // Actualiza máximo de patrimonio y caída relativa máxima.
    peak=Math.max(peak,equity);result.maxDrawdown=Math.max(result.maxDrawdown,1-equity/peak);
    // Registra exposición antes/después, negociación, patrimonio y motivo para auditar el recorrido.
    result.events.push({at:point.at,spot:point.spot,shares,deltaBefore:before,deltaAfter:i===path.points.length-1?0:shares+option.delta,trade,equity,reason});
    // Actualiza el reloj antes del siguiente punto.
    lastTime=time;
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Devuelve replay, desglose de costes y eventos; su resultado depende de la trayectoria y de las marcas
  // modeladas.
  return result;
// Cierra el bloque, objeto o llamada definido anteriormente.
}
