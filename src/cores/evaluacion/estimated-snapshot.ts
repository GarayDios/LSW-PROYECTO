// Reconstrucción educativa y explícita de primas, IV o sensibilidades sobre contratos existentes. Trabaja en
// copias; no inventa contratos ni convierte supuestos en cotizaciones ejecutables.

// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { blackScholes } from '../nucleo-cuantitativo/bsm.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { binomialPrice } from '../nucleo-cuantitativo/binomial.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { evaluationTuning } from './evaluation-policy.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { equityTerms, valuationExpiry,modelDividendYield,cashDividendPv } from '../../features/research/contract-terms.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { knownBy, type CompanyResearch, type ResearchVariable } from '../compartido/research-model.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { AnalysisPolicy } from './strategy-analysis.ts';

// Reconstruye entradas ausentes solo cuando se pidió modo estimado; conserva el original como evidencia.
export function estimatedSnapshot(original:CompanyResearch,policy:AnalysisPolicy):CompanyResearch {
  // Fuera del modo estimado devuelve exactamente la instantánea recibida.
  if(policy.modelMode!=='estimated')return original;
  // Prepara fecha de decisión de la instantánea.
  const asOf=original.asOf;
  // Acota la reconstrucción entre 10 y 500 candidatos; el valor predeterminado es 128.
  const limit=Number.isInteger(policy.estimatedCandidateLimit)&&policy.estimatedCandidateLimit!>=10&&policy.estimatedCandidateLimit!<=500?policy.estimatedCandidateLimit!:128;
  // Obtiene corte y spot para ordenar candidatos; el valor interno alternativo no autoriza una valoración sin
  // spot real.
  const cutoff=Date.parse(asOf),spot=original.market.spot.value??1;
  // Conserva únicamente contratos con términos verificables y vencimiento futuro, precalculando plazo y strike
  // efectivo.
  const descriptors=new Map(original.options.contracts.flatMap(c=>{const terms=equityTerms(c,asOf);if(!terms)return [];const time=valuationExpiry(c,asOf).time;return time>cutoff?[[c,{days:(time-cutoff)/86400000,strike:terms.effectiveStrike}] as const]:[];}));
  // Obtiene los contratos existentes que pueden participar en la reconstrucción.
  const candidates=[...descriptors.keys()];
  // Define un orden por proximidad de plazo y strike al subyacente.
  const near=(tenor:number)=>[...candidates].sort((a,b)=>{
    // La distancia suma diferencia relativa de tenor y de strike respecto al spot.
    const distance=(c:typeof a)=>Math.abs(descriptors.get(c)!.days-tenor)/Math.max(1,tenor)+Math.abs(descriptors.get(c)!.strike/spot-1);
    // Desempata por símbolo para mantener resultados reproducibles.
    return distance(a)-distance(b)||a.symbol.localeCompare(b.symbol);
  // Cierra el bloque, objeto o llamada definido anteriormente.
  });
  // Ordena por horizonte corto y largo; usa 30 y 365 días si no se configuraron.
  const short=near(policy.estimateDays??30),long=near(policy.longDays??365);
  // Calcula la delta que permite reservar calls largas compatibles con PMCC.
  const longDelta=(c:typeof candidates[number])=>{
    // Prepara tasa de interés usada por el modelo.
    const r=policy.riskFreeRate??original.macro.riskFreeRate,q=modelDividendYield(original,policy);
    // Prefiere IV válida del contrato y, si falta, usa HV solo como volatilidad del escenario estimado.
    const sigma=knownBy(c.impliedVolatility,asOf)&&c.impliedVolatility.value!>0?c.impliedVolatility:original.market.historicalVolatility;
    // Sin tasa, dividendo, sigma o spot conocidos excluye al candidato de esa selección de calls largas.
    if(!knownBy(r,asOf)||!knownBy(q,asOf)||!knownBy(sigma,asOf)||!knownBy(original.market.spot,asOf))return -Infinity;
    // Calcula delta BSM; un error numérico también deja la candidata fuera.
    try{return blackScholes({spot:original.market.spot.value!,strike:descriptors.get(c)!.strike,days:descriptors.get(c)!.days,volatility:sigma.value!,rate:r.value!,dividendYield:q.value!,type:'call'}).delta;}catch{return -Infinity;}
  // Cierra el bloque, objeto o llamada definido anteriormente.
  };
  // Para PMCC separa calls cortas y calls largas ITM con delta mínima; para otras estrategias reparte
  // candidatos cortos y largos.
  const groups=policy.estimateStrategy==='pmcc'?[short.filter(c=>c.type==='call'),long.filter(c=>c.type==='call'&&descriptors.get(c)!.strike<(original.market.spot.value??0)&&longDelta(c)>=(policy.pmccMinLongDelta??.81))]:[short,long];
  // Crea un conjunto para no gastar el límite en contratos repetidos.
  const pool=new Set<typeof candidates[number]>();
  // Intercala candidatos de los grupos para que los contratos cortos no agoten el presupuesto antes de probar
  // LEAPS.
  for(let i=0;pool.size<limit&&groups.some(group=>i<group.length);i++)for(const group of groups)if(group[i]&&pool.size<limit)pool.add(group[i]);
  // Completa el presupuesto sobrante con candidatos del plazo corto.
  for(const c of short){if(pool.size>=limit)break;pool.add(c);}
  // Copia instantánea, opciones y advertencias; clona solo los contratos que se podrán modificar.
  const s={...original,options:{...original.options,contracts:original.options.contracts.map(c=>pool.has(c)?{...c}:c)},warnings:[...original.warnings]};
  // Prepara rendimiento de dividendo usado por el modelo.
  const q=modelDividendYield(s,policy),r=policy.riskFreeRate??s.macro.riskFreeRate;
  // Sin precio, tasa y dividendo conocidos devuelve la copia sin inventar esos datos.
  if(!knownBy(s.market.spot,asOf)||!knownBy(q,asOf)||!knownBy(r,asOf))return s;
  // Crea variables assumed con fecha del escenario y una explicación que impide presentarlas como
  // observaciones.
  const assumed=(value:number,label:string):ResearchVariable=>({value,kind:'assumed',source:`Escenario estimado: ${label}`,observedAt:asOf,availableAt:asOf,reason:'Reconstrucción educativa; no es una observación ni una cotización ejecutable.'});
  // Valida ajustes de calidad; si fallan no procede con reconstrucciones.
  let tuning;try{tuning=evaluationTuning(policy.tuning);}catch{return s;}
  // Recorre los contratos de la copia, conservando su posición respecto al original.
  for(const [index,c] of s.options.contracts.entries()){
    // No modifica contratos fuera del conjunto acotado.
    if(!pool.has(original.options.contracts[index]))continue;
    // Obtiene términos y días restantes del candidato.
    const terms=equityTerms(c,asOf),days=(valuationExpiry(c,asOf).time-Date.parse(asOf))/86400000;
    // Omite contratos sin términos o ya vencidos.
    if(!terms||days<=0)continue;
    // Permite reemplazar una IV ausente o inválida únicamente si existe HV positiva conocida.
    if((!knownBy(c.impliedVolatility,asOf)||c.impliedVolatility.value!<=0) && knownBy(s.market.historicalVolatility,asOf) && s.market.historicalVolatility.value!>0)
      // Marca esa sustitución como HV supuesta, sin llamarla IV observada.
      c.impliedVolatility=assumed(s.market.historicalVolatility.value!,'HV como volatilidad supuesta, no IV observada');
    // Sin volatilidad utilizable deja el contrato incompleto.
    if(!knownBy(c.impliedVolatility,asOf)||c.impliedVolatility.value!<=0)continue;
    // Conserva bid, ask y prima del proveedor si son conocidos y coherentes.
    if([c.bid,c.ask,c.premium].every(v=>knownBy(v,asOf)) && c.bid.value!>=0 && c.ask.value!>0 && c.bid.value!<=c.ask.value!
      // También exige antigüedad admisible para evitar reconstruir una cotización que ya es reciente.
      && Date.parse(asOf)-Date.parse(c.premium.observedAt!)<=tuning.quoteMaxAgeMinutes*60000)continue;
    // Protege la valoración numérica para convertir un fallo en un motivo explícito de cálculo no disponible.
    try{
      // Prepara precio ajustado por dividendos discretos cuando se eligieron, strike efectivo, horizonte y
      // entradas financieras.
      const input={spot:Math.max(1e-8,s.market.spot.value!-(policy.dividendModel==='declared-cash'?cashDividendPv(s,valuationExpiry(c,asOf).time,r.value!):0)),strike:terms.effectiveStrike,days,volatility:c.impliedVolatility.value!,rate:r.value!,dividendYield:q.value!,type:c.type};
      // Valora americanas con CRR y las demás con BSM, convirtiendo el valor por acción a prima por unidad
      // cotizada.
      const price=(c.style==='american'?binomialPrice(input,'american',tuning.binomialSteps):blackScholes(input).price)*terms.shares/terms.multiplier;
      // Supone un spread no nulo: el mayor entre el suelo monetario y el porcentaje de precio configurado.
      const half=Math.max((policy.estimatedSpreadFloor??.02)/2,price*(policy.estimatedSpreadPercent??5)/200);
      // Reconstruye un bid teórico no negativo y conserva su etiqueta de supuesto.
      c.bid=assumed(Math.max(0,price-half),`bid teórico; spread supuesto ${policy.estimatedSpreadPercent??5}% o mínimo USD ${policy.estimatedSpreadFloor??.02}`);
      // Reconstruye un ask teórico por encima del valor central.
      c.ask=assumed(price+half,`ask teórico; spread supuesto ${policy.estimatedSpreadPercent??5}% o mínimo USD ${policy.estimatedSpreadFloor??.02}`);
      // Define la prima como promedio de los bid/ask reconstruidos.
      c.premium=assumed((c.bid.value!+c.ask.value!)/2,'punto medio teórico');
      // Prepara sensibilidades BSM que después se agregan por cantidades.
      const greeks=blackScholes(input);
      // Añade delta BSM identificada como supuesto europeo.
      c.delta=assumed(greeks.delta,'delta europea BSM de las entradas estimadas');
      // Añade gamma BSM identificada como supuesto europeo.
      c.gamma=assumed(greeks.gamma,'gamma europea BSM de las entradas estimadas');
      // Añade theta BSM identificada como supuesto europeo.
      c.theta=assumed(greeks.theta,'theta europea BSM de las entradas estimadas');
      // Añade vega BSM identificada como supuesto europeo.
      c.vega=assumed(greeks.vega,'vega europea BSM de las entradas estimadas');
    // Si el modelo es inviable, conserva los faltantes en lugar de fabricar un resultado.
    }catch{/* Un modelo inviable conserva faltantes; no fabrica resultados. */}
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Explica que el modo estimado no valida históricos ni prepara por sí mismo órdenes Paper.
  s.warnings.push('Modo estimado autorizado: puede usar HV y precios teóricos; no valida datos históricos ni prepara órdenes Paper.');
  // Si no se reconstruyó toda la cadena, marca cobertura parcial y detalla el límite de búsqueda.
  if(pool.size<candidates.length){s.options.complete=false;s.warnings.push(`Reconstrucción limitada a ${pool.size} candidatos de ${candidates.length}, próximos al plazo solicitado y al plazo largo${policy.estimateStrategy==='pmcc'?'; se reservan calls largas ITM con delta compatible para PMCC':''}. No es una búsqueda exhaustiva.`);}
  // Devuelve la copia estimada con procedencia explícita.
  return s;
// Cierra el bloque, objeto o llamada definido anteriormente.
}
