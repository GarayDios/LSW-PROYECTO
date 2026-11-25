// Selección y valoración de estructuras Wheel, PMCC, Backspread y straddle Gamma. Conserva cantidades
// firmadas, bid/ask, términos verificados, reservas y faltantes.

// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { blackScholes } from '../nucleo-cuantitativo/bsm.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { binomialPrice } from '../nucleo-cuantitativo/binomial.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { normalCdf } from '../nucleo-cuantitativo/math.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { knownBy, type CompanyResearch, type ObservedOptionContract, type ResearchVariable } from '../compartido/research-model.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { StrategyId, OptionInputs } from '../compartido/types.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { equityTerms, valuationExpiry,modelDividendYield,cashDividendPv } from '../../features/research/contract-terms.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { evaluationTuning, type EvaluationTuningInput } from './evaluation-policy.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { estimatedSnapshot } from './estimated-snapshot.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { inspectContracts, type SelectionDiagnostics } from './strategy-eligibility.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { ScannerSettings } from './scanner-settings.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { FinvizDataset } from '../04-analisis-fundamental/finviz-data.ts';

// Define la política opcional de análisis; estas restricciones de simulación no sustituyen el margen oficial
// ni los límites del bróker.
export type AnalysisPolicy = {
  // Admite una captura manual Finviz con fecha y procedencia.
  finviz?: FinvizDataset;
  // Admite configuración del escáner de cores funcionales.
  scanner?: ScannerSettings;
  // Configura presupuesto, comisión por contrato y spread máximo relativo.
  capital?: number; feePerContract?: number; maxSpreadPercent?: number;
  // Permite dividendo y tasa explícitos, horizonte largo y ajustes de calidad y selección.
  dividendYield?: ResearchVariable; riskFreeRate?: ResearchVariable; longDays?: number; tuning?: EvaluationTuningInput;
  // Configura reconstrucciones, financiación y reservas PMCC, delta mínima, shocks de IV y spread teórico.
  modelMode?:'observed'|'estimated';financingRate?:number;pmccCapitalMode?:'assignment-reserve'|'debit-only';pmccMinLongDelta?:number;ivShock?:number;estimatedSpreadPercent?:number;estimatedSpreadFloor?:number;
  // Distingue modelo de dividendo continuo y aproximación de pagos discretos declarados.
  dividendModel?:'continuous'|'declared-cash';
  // Acota candidatos reconstruidos y señala para qué plazo y estrategia se preparan.
  estimatedCandidateLimit?:number;estimateDays?:number;estimateStrategy?:StrategyId;
// Cierra el bloque, objeto o llamada definido anteriormente.
};
// Representa una pierna con contrato existente, cantidad firmada y prima de entrada: positivo compra,
// negativo venta.
export type StrategyLeg = { contract: ObservedOptionContract; quantity: number; entry: number };
// Define la salida común de todas las estrategias con resultados y motivos de ausencia.
export type StrategyAnalysis = {
  // Registra estrategia, disponibilidad y listas separadas de faltantes y advertencias.
  strategy: StrategyId; status: 'available' | 'unavailable'; missing: string[]; warnings: string[];
  // Conserva piernas, capital requerido y débito/crédito neto.
  legs: StrategyLeg[]; capitalRequired: number | null; entryDebit: number | null;
  // Guarda pérdida/ganancia máximas del modelo y puntos de equilibrio; null no significa riesgo cero.
  maxLoss: number | null; maxGain: number | null; breakevens: number[];
  // Guarda fricción por spread y exposiciones delta, gamma y theta agregadas.
  spreadCost: number | null; netDelta: number | null; netGamma: number | null; netTheta: number | null;
  // Distingue valor teórico inicial de probabilidad neutral al riesgo y su explicación.
  theoreticalDebit: number | null; probability: number | null; probabilityMethod: string;
  // Guarda cambios del subyacente con P/L y una medida de liquidez de las opciones.
  scenarios: { change: number; spot: number; pnl: number }[]; optionLiquidity: number | null;
  // Identifica modelo de valoración y horizonte efectivo hasta el primer vencimiento.
  model: string; horizonDays: number | null;
  // Conserva multiplicador y entregables verificados; no presupone que todo contrato represente 100 acciones.
  contractMultiplier: number | null; deliverableShares: number | null;
  // Conserva modo observado/estimado, coste de financiación y reserva ante asignación.
  dataMode:'observed'|'estimated';financingCost:number;assignmentReserve:number|null;
  // Añade sensibilidad conjunta a cambios del precio y shocks de IV para PMCC.
  ivScenarios:{change:number;ivChange:number;pnl:number}[];
  // Permite diagnósticos estructurales y de calidad cuando no hay piernas válidas.
  diagnostics?:SelectionDiagnostics;
// Cierra el bloque, objeto o llamada definido anteriormente.
};
// Define un día en milisegundos.
const DAY = 86400000;
// Limita puntuaciones o probabilidades al intervalo [0,1].
const clamp = (x: number) => Math.max(0, Math.min(1, x));
// Obtiene el horizonte contractual de valoración con su fecha de disponibilidad.
const expiry = (s: CompanyResearch,c: ObservedOptionContract) => valuationExpiry(c,s.asOf).time;
// Convierte el vencimiento restante a días desde el corte.
const remaining = (s: CompanyResearch, c: ObservedOptionContract) => (expiry(s,c) - Date.parse(s.asOf)) / DAY;
// Calcula spread relativo al punto medio, con suelo 0.01 para evitar división por una prima casi nula.
const spread = (c: ObservedOptionContract) => (c.ask.value! - c.bid.value!) / Math.max(.01, c.premium.value!);

// Selecciona la primera estructura compatible por plazo y spread, con desempates reproducibles; no busca un
// óptimo global de rentabilidad.
export function selectStrategyLegs(s: CompanyResearch, strategy: StrategyId, days: number, policy: AnalysisPolicy = {}): StrategyLeg[] {
  // Si la política lo permite, prepara antes una copia de entradas estimadas sobre contratos existentes.
  s=estimatedSnapshot(s,{...policy,estimateDays:days,estimateStrategy:strategy});
  // Sin plazo válido y spot conocido devuelve una selección vacía.
  if (!Number.isFinite(days) || days <= 0 || !knownBy(s.market.spot, s.asOf)) return [];
  // Valida ajustes; si son inválidos no selecciona piernas.
  let tuning;try {tuning=evaluationTuning(policy.tuning);}catch{return [];}
  // Prepara precio del subyacente.
  const spot = s.market.spot.value!;
  // Prepara caché de términos, días, vencimiento y spread por contrato para no repetir cálculos.
  const descriptors=new Map<ObservedOptionContract,{terms:NonNullable<ReturnType<typeof equityTerms>>;days:number;expiry:number;spread:number}>();
  // Calcula el descriptor la primera vez y después lo reutiliza dentro de esta selección.
  const descriptor=(c:ObservedOptionContract)=>{let value=descriptors.get(c);if(!value){const time=expiry(s,c);value={terms:equityTerms(c,s.asOf)!,days:(time-Date.parse(s.asOf))/DAY,expiry:time,spread:spread(c)};descriptors.set(c,value);}return value;};
  // Expone los términos contractuales del descriptor.
  const terms=(c:ObservedOptionContract)=>descriptor(c).terms;
  // Expone los días restantes del contrato.
  const maturity=(c:ObservedOptionContract)=>descriptor(c).days;
  // Expone el instante de vencimiento del contrato.
  const expiration=(c:ObservedOptionContract)=>descriptor(c).expiry;
  // Usa strike efectivo, ajustado a entregables cuando corresponde.
  const strike=(c:ObservedOptionContract)=>terms(c).effectiveStrike;
  // Exige que dos piernas tengan el mismo multiplicador y cantidad de acciones entregables.
  const compatible=(a:ObservedOptionContract,b:ObservedOptionContract)=>terms(a).multiplier===terms(b).multiplier && terms(a).shares===terms(b).shares
    // Además exige que sus primas estén sincronizadas dentro del desfase entre piernas configurado.
    && Math.abs(Date.parse(a.premium.observedAt!)-Date.parse(b.premium.observedAt!))<=tuning.legQuoteSkewMinutes*60000;
  // Filtra los contratos con las comprobaciones compartidas de calidad, antigüedad y spread.
  const contracts = inspectContracts(s,policy).eligible;
  // Combina distancia relativa al plazo y spread con sus pesos configurables.
  const distance = (c: ObservedOptionContract, tenor = days) => tuning.tenorWeight*Math.abs(maturity(c) - tenor) / tenor + tuning.spreadWeight*descriptor(c).spread;
  // Ordena primero por distancia, luego por cercanía de strike al spot y por símbolo.
  const ordered = (items: ObservedOptionContract[], tenor = days) => [...items].sort((a,b) => distance(a,tenor) - distance(b,tenor) || Math.abs(strike(a) - spot) - Math.abs(strike(b) - spot) || a.symbol.localeCompare(b.symbol));
  // Al comprar utiliza ask; al vender utiliza bid. quantity conserva el signo de la exposición.
  const leg = (contract: ObservedOptionContract, quantity: number): StrategyLeg => ({ contract, quantity, entry: quantity > 0 ? contract.ask.value! : contract.bid.value! });
  // Wheel comienza evaluando una put vendida con efectivo reservado, no el ciclo completo posterior.
  if (strategy === 'wheel') {
    // Busca puts con strike efectivo no superior al spot y bid positivo.
    const put = ordered(contracts.filter(c => c.type === 'put' && strike(c) <= spot && c.bid.value! > 0
      // Exige nominal contractual más comisión dentro del presupuesto si se suministró capital.
      && (policy.capital === undefined || c.strike.value! * terms(c).multiplier + (policy.feePerContract ?? 0) <= policy.capital)))[0];
    // Devuelve una put vendida o ninguna pierna si no encontró una candidata.
    return put ? [leg(put,-1)] : [];
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Para las estrategias restantes separa las calls elegibles.
  const calls = contracts.filter(c => c.type === 'call');
  // PMCC combina una call larga ITM y una call corta con menor vencimiento.
  if (strategy === 'pmcc') {
    // Define la delta que se usará para filtrar la call larga.
    const delta=(c:ObservedOptionContract)=>{
      // Prefiere delta del contrato cuando está disponible al corte.
      if(knownBy(c.delta,s.asOf))return c.delta.value!;
      // Si falta delta, obtiene tasa y dividendo para calcularla por BSM.
      const r=policy.riskFreeRate??s.macro.riskFreeRate,q=modelDividendYield(s,policy);
      // Sin esas entradas deja el contrato fuera del filtro de delta.
      if(!knownBy(r,s.asOf)||!knownBy(q,s.asOf))return -Infinity;
      // Calcula delta europea con términos efectivos; un fallo numérico excluye la candidata.
      try{return blackScholes({spot,strike:strike(c),days:maturity(c),volatility:c.impliedVolatility.value!,rate:r.value!,dividendYield:q.value!,type:'call'}).delta;}catch{return -Infinity;}
    // Cierra el bloque, objeto o llamada definido anteriormente.
    };
    // Ordena calls largas ITM, posteriores al plazo corto y con delta mínima configurada; usa horizonte largo o
    // 365 días como referencia.
    const longs = ordered(calls.filter(c => strike(c) < spot && maturity(c) > days && (!(policy.pmccMinLongDelta??0)||delta(c)>=(policy.pmccMinLongDelta??0))), policy.longDays ?? Math.max(365,days*4));
    // Prueba calls largas en ese orden hasta encontrar una diagonal compatible.
    for (const long of longs) {
      // Busca call corta compatible, de strike superior, vencimiento anterior y bid positivo.
      const short = ordered(calls.filter(c => compatible(c,long) && strike(c) > strike(long) && expiration(c) < expiration(long) && c.bid.value! > 0
        // Exige débito positivo de la diagonal e incluye dos comisiones en el presupuesto.
        && long.ask.value! > c.bid.value! && (policy.capital === undefined || (long.ask.value! - c.bid.value!)*terms(c).multiplier + 2*(policy.feePerContract ?? 0)
          // Añade reserva nominal de la corta salvo que el usuario eligiera explícitamente capital solo débito.
          + (policy.pmccCapitalMode==='debit-only'?0:c.strike.value!*terms(c).multiplier) <= policy.capital)))[0];
      // Devuelve ambas piernas juntas, larga +1 y corta −1.
      if (short) return [leg(long,1),leg(short,-1)];
    // Cierra el bloque, objeto o llamada definido anteriormente.
    }
    // Sin diagonal compatible devuelve selección vacía.
    return [];
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Gamma se abre aquí como un straddle comprado; las futuras coberturas se simulan por separado.
  if (strategy === 'gamma') {
    // Prueba calls según el orden común de plazo y spread.
    for (const call of ordered(calls)) {
      // Busca put compatible del mismo vencimiento y strike para completar el straddle.
      const put = contracts.find(c => c.type === 'put' && compatible(c,call) && expiration(c) === expiration(call) && strike(c) === strike(call));
      // Exige presupuesto para ambos ask y dos comisiones, y devuelve compra +1 de cada opción.
      if (put && (policy.capital === undefined || (call.ask.value! + put.ask.value!)*terms(call).multiplier + 2*(policy.feePerContract ?? 0) <= policy.capital)) return [leg(call,1),leg(put,1)];
    // Cierra el bloque, objeto o llamada definido anteriormente.
    }
    // Sin pareja financiable devuelve selección vacía.
    return [];
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Para Backspread prueba calls vendidas con bid positivo.
  for (const short of ordered(calls.filter(c => c.bid.value! > 0))) {
    // Busca call comprada compatible del mismo vencimiento y strike superior.
    const long = ordered(calls.filter(c => compatible(c,short) && expiration(c) === expiration(short) && strike(c) > strike(short)
      // Exige presupuesto para el valle de pérdida de la estructura −1/+2 y tres comisiones.
      && (policy.capital === undefined || Math.max(0,(c.strike.value!-short.strike.value!+2*c.ask.value!-short.bid.value!)*terms(c).multiplier)+3*(policy.feePerContract ?? 0)<=policy.capital)))[0];
    // Devuelve una call vendida y dos compradas preservando la proporción.
    if (long) return [leg(short,-1),leg(long,2)];
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Si ninguna estrategia encuentra piernas, devuelve lista vacía.
  return [];
// Cierra el bloque, objeto o llamada definido anteriormente.
}

// Calcula flujos, reservas, sensibilidades y escenarios de la estructura seleccionada, manteniendo faltantes
// explícitos.
export function analyzeStrategy(s: CompanyResearch, strategy: StrategyId, days: number, policy: AnalysisPolicy = {}): StrategyAnalysis {
  // Reconstruye entradas solo si lo permite el modo estimado de la política.
  s=estimatedSnapshot(s,{...policy,estimateDays:days,estimateStrategy:strategy});
  // Inicializa el resultado como no disponible, con piernas vacías y capital/entrada desconocidos.
  const a: StrategyAnalysis = { strategy, status:'unavailable', missing:[], warnings:[], legs:[], capitalRequired:null, entryDebit:null,
    // Inicializa riesgos, equilibrios, spreads y exposiciones como faltantes hasta calcularlos.
    maxLoss:null,maxGain:null,breakevens:[],spreadCost:null,netDelta:null,netGamma:null,netTheta:null,theoreticalDebit:null,
    // Inicializa probabilidad, escenarios, modelo y términos contractuales sin inventar resultados.
    probability:null,probabilityMethod:'No disponible',scenarios:[],optionLiquidity:null,model:'BSM europeo; CRR americano cuando el estilo está verificado',horizonDays:null,contractMultiplier:null,deliverableShares:null,
    // Registra modo de cálculo y prepara costes de financiación y escenarios de IV.
    dataMode:policy.modelMode??'observed',financingCost:0,assignmentReserve:null,ivScenarios:[] };
  // Valida los ajustes avanzados y devuelve un faltante si la configuración es inválida.
  let tuning;try {tuning=evaluationTuning(policy.tuning);}catch {a.missing.push('Parámetros avanzados válidos');return a;}
  // Exige plazo positivo y no superior a 3650 días.
  if (!Number.isFinite(days) || days <= 0 || days > 3650) { a.missing.push('Plazo válido'); return a; }
  // Comienza la validación del presupuesto opcional, que debe ser positivo y finito.
  if (policy.capital !== undefined && (!Number.isFinite(policy.capital) || policy.capital <= 0)
    // Exige comisión finita y no negativa cuando está configurada.
    || policy.feePerContract !== undefined && (!Number.isFinite(policy.feePerContract) || policy.feePerContract < 0)
    // Exige un máximo de spread no negativo y finito.
    || policy.maxSpreadPercent !== undefined && (!Number.isFinite(policy.maxSpreadPercent) || policy.maxSpreadPercent < 0)
    // Limita la tasa de financiación al intervalo [0,1].
    || policy.financingRate!==undefined&&(!Number.isFinite(policy.financingRate)||policy.financingRate<0||policy.financingRate>1)
    // Limita el shock relativo de IV al intervalo [0,0.9].
    || policy.ivShock!==undefined&&(!Number.isFinite(policy.ivShock)||policy.ivShock<0||policy.ivShock>.9)
    // Para PMCC exige horizonte largo superior al corto y no mayor a 3650 días.
    || strategy === 'pmcc' && policy.longDays !== undefined && (!Number.isFinite(policy.longDays) || policy.longDays <= days || policy.longDays > 3650)) {
    // Ante cualquier política inválida explica el problema y devuelve el análisis incompleto.
    a.missing.push('Política de capital, costes, spread o plazo largo inválida'); return a;
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Resuelve el dividendo según el modelo elegido.
  const q = modelDividendYield(s,policy);
  // Prefiere tasa explícita de la política y después la tasa de la instantánea.
  const rate=policy.riskFreeRate ?? s.macro.riskFreeRate;
  // Revisa disponibilidad temporal de spot, tasa y dividendo.
  for (const [name,v] of [['Precio',s.market.spot],['Tasa',rate],['Dividendo futuro',q]] as const)
    // Agrega como faltante cada variable que no era conocida al corte.
    if (!knownBy(v,s.asOf)) a.missing.push(name);
  // Requiere además un estado reciente del mercado.
  if (s.market.stale) a.missing.push('Precio reciente');
  // Selecciona piernas sobre la instantánea ya preparada, sin reconstruir otra vez durante esta selección.
  a.legs = selectStrategyLegs(s,strategy,days,{...policy,modelMode:'observed'});
  // Si no hay estructura, investiga por qué para producir un diagnóstico útil.
  if (!a.legs.length) {
    // Obtiene diagnósticos de calidad del conjunto de contratos recibido.
    const d=inspectContracts(s,policy).diagnostics;
    // Adjunta los diagnósticos al resultado del análisis.
    a.diagnostics=d;
    // Sin contratos identifica que el proveedor no entregó una cadena para el corte.
    if(!d.totalContracts){d.blocker='contracts';a.missing.push('El proveedor no entregó contratos para este corte');}
    // Cuando hay contratos, separa problemas de presupuesto, spread, calidad y geometría.
    else {
      // Prepara una selección diagnóstica quitando solo el límite de capital.
      const unbounded={...policy,modelMode:'observed' as const,capital:undefined};
      // Busca un ejemplo estructural que indique si el presupuesto era el bloqueo.
      const example=selectStrategyLegs(s,strategy,days,unbounded);
      // Si existe una estructura al quitar presupuesto, el problema se clasifica como capital.
      if(example.length){
        // Identifica el bloqueo de capital.
        d.blocker='capital';
        // Obtiene multiplicador y entregables del ejemplo.
        const terms=equityTerms(example[0].contract,s.asOf)!;
        // Calcula todas las comisiones del ejemplo.
        const fee=(policy.feePerContract??0)*example.reduce((n,l)=>n+Math.abs(l.quantity),0);
        // Calcula su débito/crédito firmado con comisiones.
        const debit=example.reduce((n,l)=>n+l.quantity*l.entry*terms.multiplier,0)+fee;
        // Para Wheel calcula el ejemplo de capital como nominal de la put más comisión.
        d.exampleCapitalRequired=strategy==='wheel'?example[0].contract.strike.value!*terms.multiplier+fee:
          // Para PMCC añade débito positivo, reserva de asignación elegida y financiación hasta el horizonte corto.
          strategy==='pmcc'?Math.max(0,debit)+(policy.pmccCapitalMode==='debit-only'?0:example.find(l=>l.quantity<0)!.contract.strike.value!*terms.multiplier)+Math.max(0,debit)*(policy.financingRate??0)*Math.min(...example.map(l=>remaining(s,l.contract)))/365:
          // Para Gamma usa débito y para Backspread el valle de pérdida del ejemplo.
          strategy==='gamma'?debit:Math.max(0,(example.find(l=>l.quantity>0)!.contract.strike.value!-example.find(l=>l.quantity<0)!.contract.strike.value!)*terms.multiplier+debit);
        // Publica capital del ejemplo y presupuesto disponible, aclarando que no es el mínimo de toda la cadena.
        a.missing.push(`Capital insuficiente: una combinación compatible requiere USD ${d.exampleCapitalRequired.toFixed(2)}; disponible USD ${policy.capital?.toFixed(2)}. No es un mínimo global`);
      // Si quitar capital no basta, prueba quitar también el límite de spread para identificar ese bloqueo.
      } else if(selectStrategyLegs(s,strategy,days,{...unbounded,maxSpreadPercent:undefined}).length){
        // Clasifica el rechazo como spread cuando una estructura aparece solo al retirarlo.
        d.blocker='spread';a.missing.push('Los contratos de la estructura superan el spread permitido');
      // Si no hay ningún contrato elegible, el bloqueo está en la calidad de entradas.
      } else if(!d.eligibleContracts){
        // Publica recuentos por rechazo para explicar esa ausencia de calidad.
        d.blocker='quality';a.missing.push(...d.rejected.map(r=>`${r.label}: ${r.count}/${d.totalContracts}`));
      // Cuando la calidad permite contratos pero ninguna combinación encaja, informa geometría incompatible.
      } else {
        // Identifica strikes, vencimientos, delta y sincronización como requisitos estructurales sin resolver.
        d.blocker='structure';a.missing.push('No hay piernas compatibles con strikes, vencimientos, delta y sincronización requeridos por esta estrategia');
      // Cierra el bloque, objeto o llamada definido anteriormente.
      }
    // Cierra el bloque, objeto o llamada definido anteriormente.
    }
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Revisa las fechas de las piernas que sí se seleccionaron.
  for (const {contract:c} of a.legs) {
    // Exige que la diferencia entre tiempos de acción y opción respete el máximo de días del análisis.
    if (c.premium.observedAt && s.market.spot.observedAt && Math.abs(Date.parse(c.premium.observedAt)-Date.parse(s.market.spot.observedAt))>tuning.spotOptionGapDays*DAY) a.missing.push(`Precio y opciones dentro de ${tuning.spotOptionGapDays} días`);
    // Exige primas dentro de la antigüedad máxima en minutos.
    if (c.premium.observedAt && Date.parse(s.asOf)-Date.parse(c.premium.observedAt)>tuning.quoteMaxAgeMinutes*60000) a.missing.push(`Cotización de hasta ${tuning.quoteMaxAgeMinutes} minutos`);
    // Conserva la fuente del horizonte de vencimiento usado por cada pierna.
    a.warnings.push(`${c.symbol}: ${valuationExpiry(c,s.asOf).source}.`);
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Con varias piernas vuelve a comprobar su sincronización.
  if (a.legs.length > 1) {
    // Extrae las horas de observación de las primas.
    const stamps = a.legs.map(l=>Date.parse(l.contract.premium.observedAt!));
    // Compara la prima más reciente y más antigua contra el máximo desfase configurado.
    if (Math.max(...stamps)-Math.min(...stamps)>tuning.legQuoteSkewMinutes*60000) a.missing.push(`Cotizaciones de las piernas dentro de ${tuning.legQuoteSkewMinutes} minutos`);
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Advierte que la selección por plazo y spread no es una optimización validada de rentabilidad.
  a.warnings.push('Selección estructural por plazo y spread; no es una optimización validada de rentabilidad.',
    // Identifica si se utilizó spot de cotización o cierre diario y delimita el tratamiento de ejercicio y
    // liquidación.
    `${s.market.spotBasis==='quote'?'Punto medio de la cotización de la acción':'Precio de cierre diario'} e horizonte de valoración estimado. El modelo no simula decisiones de ejercicio anticipado ni liquidación del bróker.`,
    // Aclara que los entregables son verificados pero la reserva calculada no equivale al margen oficial del
    // bróker.
    'Se usan multiplicador y entregables verificados. No constituye margen confirmado por un bróker.');
  // Identifica el dividendo manual cuando su clase es assumed.
  if (q.kind === 'assumed') a.warnings.push(`Dividendo supuesto explícitamente: ${q.value === null ? 'ausente' : q.value*100}%. Fuente: ${q.source}.`);
  // Identifica la tasa manual sin atribuirla a FRED.
  if(rate.kind==='assumed')a.warnings.push(`Tasa continua supuesta: ${rate.value! * 100}%; no es una tasa FRED observada.`);
  // Identifica IV, primas y probabilidades dependientes de supuestos cuando el modo es estimado.
  if(policy.modelMode==='estimated')a.warnings.push('Modo ESTIMADO: IV, precios y probabilidades pueden depender de supuestos. No constituye evidencia histórica ni cotización ejecutable.');
  // Añade advertencias de reconstrucción acotada si aplican.
  if(policy.modelMode==='estimated')a.warnings.push(...s.warnings.filter(w=>w.startsWith('Reconstrucción limitada')));
  // Identifica cotizaciones estimadas/retrasadas del feed indicative.
  if (s.options.feed === 'indicative') a.warnings.push('Feed indicative: cotizaciones estimadas y retrasadas.');
  // Informa cobertura parcial de la cadena.
  if (!s.options.complete) a.warnings.push('La cadena disponible es parcial; puede haber otras combinaciones.');
  // Limita Wheel a su put inicial, sin cotizar una call futura dependiente de asignación.
  if (strategy === 'wheel') a.warnings.push('Se evalúa la put con efectivo reservado. La siguiente call depende de una posible asignación futura y aún no se cotiza.');
  // Explica remanente de la LEAPS y capital adicional posible por asignación o financiación.
  if (strategy === 'pmcc') a.warnings.push('Escenarios al vencimiento corto: la call larga conserva valor según volatilidad constante. Asignación y financiación pueden exigir capital adicional al débito.');
  // Distingue el straddle estático de la gestión Gamma con rebalanceos y costes.
  if (strategy === 'gamma') a.warnings.push('Se analiza un straddle sin coberturas futuras. Gamma Scalping requiere una trayectoria, rebalanceos y sus costes; su rentabilidad no se infiere de este payoff.');
  // No admite dividendo continuo negativo.
  if (q.value !== null && q.value < 0) a.missing.push('Dividendo no negativo');
  // No admite spot no positivo.
  if (s.market.spot.value !== null && s.market.spot.value <= 0) a.missing.push('Precio positivo');
  // Si quedan faltantes, conserva el análisis incompleto sin calcular cifras finales.
  if (a.missing.length) return a;
  // Obtiene comisión y total absoluto de contratos de todas las piernas.
  const fee = policy.feePerContract ?? 0, count=a.legs.reduce((n,l)=>n+Math.abs(l.quantity),0);
  // Obtiene los términos comunes de la estructura, verificados por compatibilidad.
  const terms=equityTerms(a.legs[0].contract,s.asOf)!;
  // Publica multiplicador y número de acciones entregables de la estrategia.
  a.contractMultiplier=terms.multiplier;a.deliverableShares=terms.shares;
  // Suma primas firmadas × multiplicador y comisiones; un valor negativo representa crédito.
  const debit=a.legs.reduce((n,l)=>n+l.quantity*l.entry*terms.multiplier,0)+fee*count;
  // Publica el débito/crédito de entrada.
  a.entryDebit=debit;
  // Estima fricción de entrada como medio spread por cada contrato de la estructura.
  a.spreadCost=a.legs.reduce((n,l)=>n+Math.abs(l.quantity)*(l.contract.ask.value!-l.contract.bid.value!)*terms.multiplier/2,0);
  // Toma la peor liquidez relativa entre las piernas, limitada al intervalo [0,1].
  a.optionLiquidity=Math.min(...a.legs.map(l=>clamp(1-spread(l.contract))));
  // Usa el primer vencimiento como horizonte común de análisis.
  a.horizonDays=Math.min(...a.legs.map(l=>remaining(s,l.contract)));
  // Devenga financiación simple solo para el débito positivo de PMCC al horizonte corto.
  a.financingCost=strategy==='pmcc'?Math.max(0,debit)*(policy.financingRate??0)*a.horizonDays/365:0;
  // Calcula nominal corto PMCC como reserva ante asignación, independientemente de si el usuario decide
  // incluirlo en capital.
  a.assignmentReserve=strategy==='pmcc'?a.legs.find(l=>l.quantity<0)!.contract.strike.value!*terms.multiplier:0;
  // Prepara entradas por pierna y spot de escenario; conserva tiempo remanente y permite restar valor presente
  // de dividendos declarados.
  const inputs=(l:StrategyLeg, spot=s.market.spot.value!, elapsed=0):OptionInputs=>({spot:Math.max(spot-(policy.dividendModel==='declared-cash'?cashDividendPv(s,expiry(s,l.contract),rate.value!,Date.parse(s.asOf)+elapsed*DAY):0),1e-8),strike:equityTerms(l.contract,s.asOf)!.effectiveStrike,days:Math.max(0,remaining(s,l.contract)-elapsed),volatility:l.contract.impliedVolatility.value!,rate:rate.value!,dividendYield:q.value!,type:l.contract.type});
  // Identifica si todas las piernas comparten un vencimiento.
  const sameExpiry=new Set(a.legs.map(l=>expiry(s,l.contract))).size===1;
  // Valora precio americano con CRR cuando está confirmado; para los demás usa BSM.
  const theoretical=(l:StrategyLeg)=>l.contract.style==='american'?binomialPrice(inputs(l),'american',tuning.binomialSteps):blackScholes(inputs(l)).price;
  // Protege la valoración numérica para convertir un fallo en un motivo explícito de cálculo no disponible.
  try {
    // Suma el valor teórico firmado de las piernas y lo escala por acciones entregables.
    a.theoreticalDebit=a.legs.reduce((n,l)=>n+l.quantity*theoretical(l),0)*terms.shares;
    // Obtiene griegas europeas BSM por pierna, separadas del precio americano inicial.
    const greeks=a.legs.map(l=>({n:l.quantity,v:blackScholes(inputs(l))}));
    // Agrega delta por signos, proporciones y acciones.
    a.netDelta=greeks.reduce((n,l)=>n+l.n*l.v.delta*terms.shares,0);
    // Agrega gamma respetando las proporciones de la estructura.
    a.netGamma=greeks.reduce((n,l)=>n+l.n*l.v.gamma*terms.shares,0);
    // Agrega theta por las mismas unidades firmadas.
    a.netTheta=greeks.reduce((n,l)=>n+l.n*l.v.theta*terms.shares,0);
    // Define P/L al horizonte común; decide si cada pierna vence o conserva tiempo.
    const pnl=(spot:number,ivFactor=1)=>terms.shares*a.legs.reduce((n,l)=>n+l.quantity*(remaining(s,l.contract)<=a.horizonDays!+1e-8
      // Las piernas que vencen se liquidan por su valor intrínseco efectivo.
      ? Math.max(0,l.contract.type==='call'?spot-inputs(l).strike:inputs(l).strike-spot)
      // Una pierna americana superviviente se marca con CRR y el factor de shock de IV.
      : l.contract.style==='american'?binomialPrice({...inputs(l,spot,a.horizonDays!),volatility:inputs(l).volatility*ivFactor},'american',tuning.binomialSteps)
      // Las demás supervivientes se marcan con BSM; al conjunto se restan entrada y financiación.
      : blackScholes({...inputs(l,spot,a.horizonDays!),volatility:inputs(l).volatility*ivFactor}).price),0)-debit-a.financingCost;
    // Calcula P/L en los cambios de precio configurados, ordenados de menor a mayor.
    a.scenarios=[...tuning.scenarioChanges].sort((a,b)=>a-b).map(change=>({change,spot:s.market.spot.value!*(1+change),pnl:pnl(s.market.spot.value!*(1+change))}));
    // Para PMCC repite escenarios con IV menor, base y mayor según el shock elegido.
    if(strategy==='pmcc')a.ivScenarios=a.scenarios.flatMap(row=>[-(policy.ivShock??.2),0,policy.ivShock??.2].map(ivChange=>({change:row.change,ivChange,pnl:pnl(row.spot,1+ivChange)})));
    // Si todas las piernas vencen juntas, analiza el payoff por segmentos.
    if (sameExpiry) {
      // Utiliza cero y strikes efectivos como puntos de cambio de pendiente del payoff.
      const points=[0,...new Set(a.legs.map(l=>inputs(l).strike))].sort((x,y)=>x-y);
      // La suma firmada de calls determina la pendiente de la cola alcista.
      const tailSlope=a.legs.reduce((n,l)=>n+(l.contract.type==='call'?l.quantity:0),0);
      // Valora el payoff en los puntos de cambio.
      const values=points.map(pnl);
      // Calcula pérdida máxima finita cuando la cola no cae sin límite; null representa límite no determinado o
      // ilimitado.
      a.maxLoss=tailSlope<0?null:Math.max(0,-Math.min(...values));
      // Calcula ganancia máxima finita cuando la cola no crece sin límite; con cola alcista positiva deja null.
      a.maxGain=tailSlope>0?null:Math.max(0,...values);
      // Añade un punto superior para representar el último segmento lineal.
      const tail=points.at(-1)!+Math.max(1,s.market.spot.value!);
      // Construye segmentos entre los puntos de cambio y la cola.
      const segments=[...points,tail];
      // Recorre cada segmento para localizar cruces por P/L cero.
      for(let i=1;i<segments.length;i++) {
        // Obtiene valor inicial y pendiente del segmento.
        const left=segments[i-1],right=segments[i],v=pnl(left),slope=(pnl(right)-v)/(right-left);
        // Registra un equilibrio exacto en el extremo izquierdo si no estaba listado.
        if (v===0 && !a.breakevens.includes(left)) a.breakevens.push(left);
        // Solo busca raíces por pendiente si esta no es casi cero.
        if (Math.abs(slope)>1e-10) {
          // Resuelve la raíz lineal del segmento como izquierda − valor/pendiente.
          const root=left-v/slope;
          // Conserva raíces dentro de su segmento o cola y evita duplicados con tolerancia numérica.
          if(root>left && (i===segments.length-1 || root<=right) && !a.breakevens.some(b=>Math.abs(b-root)<1e-8))a.breakevens.push(root);
        // Cierra el bloque, objeto o llamada definido anteriormente.
        }
      // Cierra el bloque, objeto o llamada definido anteriormente.
      }
      // Ordena los puntos de equilibrio por precio.
      a.breakevens.sort((x,y)=>x-y);
      // Convierte horizonte a años y usa IV constante de la primera pierna para la distribución.
      const T=a.horizonDays/365,sigma=a.legs[0].contract.impliedVolatility.value!;
      // Define CDF lognormal terminal bajo tasa menos dividendo, con fronteras cero e infinito.
      const cdf=(x:number)=>x<=0?0:x===Infinity?1:normalCdf((Math.log(x/s.market.spot.value!)-(rate.value!-q.value!-sigma*sigma/2)*T)/(sigma*Math.sqrt(T)));
      // Divide el eje de precios con los equilibrios positivos y las colas.
      const boundaries=[0,...a.breakevens.filter(b=>b>0),Infinity];
      // Inicializa la masa de probabilidad con beneficio.
      a.probability=0;
      // Recorre los intervalos delimitados por equilibrios.
      for(let i=1;i<boundaries.length;i++) {
        // Escoge un punto interior para determinar si ese intervalo del payoff es positivo.
        const lo=boundaries[i-1],hi=boundaries[i],mid=hi===Infinity?Math.max(lo+1,s.market.spot.value!*2):(lo+hi)/2;
        // Suma masa lognormal solamente donde el P/L conjunto resulta positivo.
        if(pnl(mid)>1e-8)a.probability+=cdf(hi)-cdf(lo);
      // Cierra el recorrido de intervalos rentables.
      }
      // Limita la probabilidad al intervalo [0,1] frente a pequeños errores numéricos.
      a.probability=clamp(a.probability);
      // Explica la medida neutral al riesgo, IV constante, bid/ask y costes incluidos; no es rentabilidad
      // predicha.
      a.probabilityMethod='Distribución terminal neutral al riesgo; IV de la primera pierna constante, payoff conjunto, bid/ask y comisiones de entrada. No predice rentabilidad.';
    // Con vencimientos distintos no extrapola la fórmula de payoff lineal común.
    } else {
      // Deja sin determinar pérdida y ganancia máximas de la diagonal.
      a.maxLoss=null; a.maxGain=null;
      // Explica que la probabilidad analítica de PMCC requiere modelar remanente de IV y gestión adicional.
      a.probabilityMethod='No se publica probabilidad para vencimientos distintos: requiere modelar la evolución de IV y la gestión de la diagonal.';
    // Cierra el bloque, objeto o llamada definido anteriormente.
    }
    // Calcula capital según estrategia: nominal Wheel, débito/reserva/financiación PMCC, débito Gamma o pérdida
    // máxima Backspread.
    a.capitalRequired=strategy==='wheel'?a.legs[0].contract.strike.value!*terms.multiplier+fee:strategy==='pmcc'?Math.max(0,debit)+a.financingCost+(policy.pmccCapitalMode==='debit-only'?0:a.assignmentReserve!):strategy==='gamma'?debit:a.maxLoss;
    // Muestra la reserva PMCC y si se excluyó explícitamente al elegir solo débito.
    if(strategy==='pmcc')a.warnings.push(`Reserva ante asignación: ${a.assignmentReserve}; financiación al horizonte: ${a.financingCost.toFixed(2)}. ${policy.pmccCapitalMode==='debit-only'?'Solo débito elegido: no acredita capacidad de afrontar asignación.':'Capital conservador: débito + nominal corto + financiación; no es margen oficial del bróker.'}`);
    // Si el capital calculado supera el presupuesto, registra el faltante y no marca la estructura como
    // disponible.
    if (policy.capital!==undefined && a.capitalRequired!==null && a.capitalRequired>policy.capital) a.missing.push('Capital suficiente');
    // Aclara que sensibilidades y probabilidades usan BSM aunque el precio americano inicial se haya calculado
    // con CRR.
    if (a.legs.some(l=>l.contract.style!=='european')) a.warnings.push(`Las sensibilidades y probabilidades usan BSM europeo; el precio inicial americano usa CRR de ${tuning.binomialSteps} pasos.`);
    // Para Gamma gestionada retira la probabilidad estática: sus coberturas requieren trayectorias y costes.
    if (strategy==='gamma') { a.probability=null; a.probabilityMethod='La probabilidad de Gamma Scalping exige trayectorias de cobertura y costes; se muestran escenarios del straddle sin cobertura.'; }
    // Aplica advertencias y límites específicos del modelo de dividendos discretos.
    if(policy.dividendModel==='declared-cash'){
      // Explica la aproximación de restar valor presente de dividendos al spot.
      a.warnings.push('Dividendos discretos declarados: se resta su valor presente al spot para valorar. Es una aproximación; no incorpora anuncios futuros desconocidos ni modela de forma exacta el ejercicio americano.');
      // Retira PoP lognormal porque los saltos por pagos discretos no siguen esa distribución simple.
      a.probability=null;a.probabilityMethod='Sin probabilidad lognormal publicada al incorporar saltos por dividendos discretos.';
    // Cierra el bloque, objeto o llamada definido anteriormente.
    }
    // Marca disponible solo cuando no quedaron faltantes.
    a.status=a.missing.length?'unavailable':'available';
  // Si el cálculo falla, conserva motivo numérico sin inventar cifras.
  } catch { a.missing.push('Modelo numérico válido para todas las piernas'); }
  // Devuelve estructura, métricas, escenarios, fuentes y motivos.
  return a;
// Cierra el bloque, objeto o llamada definido anteriormente.
}
