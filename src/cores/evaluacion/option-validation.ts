// Validación cronológica del ranking cuantitativo anterior con cadenas y salidas bid/ask importadas. No
// contiene la evidencia fechada necesaria para validar los siete cores funcionales completos.

// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { z } from 'zod';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { CORE_IDS,type CoreId,type StrategyId } from '../compartido/types.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { rankObservedCompanies } from './observed-ranking.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { evaluationTuning,coreWeight } from './evaluation-policy.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { knownBy,type CompanyResearch } from '../compartido/research-model.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { wilsonInterval } from '../05-indicadores-y-senales/validation.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { AnalysisPolicy } from './strategy-analysis.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { valuationExpiry } from '../../features/research/contract-terms.ts';

// Define fechas ISO obligatoriamente acompañadas de zona horaria.
const time=z.string().datetime({offset:true});
// Valida variables con valor opcional, fuente, fechas y clase; permite metadatos adicionales.
const variable=z.object({value:z.number().finite().nullable(),source:z.string().min(1).max(1000),observedAt:time.nullable(),availableAt:time.nullable(),kind:z.enum(['observed','estimated','missing','assumed'])}).passthrough();
// Valida identificación, subyacente, tipo, vencimiento y estilo de un contrato importado.
const contract=z.object({symbol:z.string().min(1).max(80),underlyingSymbol:z.string().max(16),type:z.enum(['call','put']),expiration:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),style:z.enum(['american','european','unknown']),
  // Exige las variables financieras y griegas para conservar evidencia de cada campo.
  strike:variable,bid:variable,ask:variable,premium:variable,impliedVolatility:variable,openInterest:variable,delta:variable,gamma:variable,theta:variable,vega:variable,
  // Exige multiplicador y entregables e incorpora fecha de valoración opcional.
  multiplier:variable,deliverableShares:variable,deliverableType:z.enum(['single_equity','unsupported','unknown']),valuationExpiry:z.object({at:time,availableAt:time,source:z.string().max(1000)}).optional()}).passthrough();
// Abre el esquema de instantánea con identidad y fechas de decisión y generación.
const snapshot=z.object({symbol:z.string().min(1).max(16),asOf:time,generatedAt:time,
  // Exige estado de mercado y limita la historia importada a 2000 velas.
  market:z.object({spot:variable,historicalVolatility:variable,momentum20:variable,momentum60:variable,averageDollarVolume20:variable,maxDrawdown:variable,downsideVolatility:variable,stale:z.boolean(),bars:z.array(z.object({time:z.number().finite()} ).passthrough()).max(2000)}).passthrough(),
  // Limita la cadena a 1500 contratos y reconoce feeds OPRA o indicative; prepare exigirá OPRA.
  options:z.object({contracts:z.array(contract).max(1500),feed:z.enum(['opra','indicative']).nullable()}).passthrough(),
  // Exige dividendo y tasa con sus fechas y procedencia.
  fundamentals:z.object({dividendYield:variable}).passthrough(),macro:z.object({riskFreeRate:variable}).passthrough(),
// Permite campos adicionales del modelo de instantánea sin perder los requisitos mínimos.
}).passthrough();
// Valida salida bid/ask no negativa, coherente y disponible a partir de la hora de cotización.
const exit=z.object({symbol:z.string().min(1).max(80),at:time,availableAt:time,bid:z.number().finite().nonnegative(),ask:z.number().finite().nonnegative()}).strict().refine(v=>v.ask>=v.bid&&Date.parse(v.availableAt)>=Date.parse(v.at));
// Valida archivo versión 1, fuente, clase observed/fixture y entre 1 y 300 muestras.
export const optionDatasetSchema=z.object({version:z.literal(1),source:z.string().min(1).max(1000),kind:z.enum(['observed','fixture']),samples:z.array(z.object({snapshot,exits:z.array(exit).min(1).max(1500)}).strict()).min(1).max(300)}).strict();
// Deriva el tipo de una muestra individual del esquema de importación.
type Sample=z.infer<typeof optionDatasetSchema>['samples'][number];
// Describe una muestra preparada con fecha de resultado conocido, retorno neto y puntuaciones por criterio.
type Prepared={symbol:string;asOf:number;knownOutcomeAt:number;netReturn:number;cores:Partial<Record<CoreId,number>>};
// Describe ventanas de entrenamiento/prueba, pesos elegidos y retornos de comparación.
export type OptionValidation={source:string;kind:'observed'|'fixture';strategy:StrategyId;folds:{trainBefore:string;testStart:string;testEnd:string;trainSamples:number;testPeriods:number;meanReturn:number|null;equalWeightReturn:number|null;weights:Partial<Record<CoreId,number>>}[];
  // Añade cobertura de prueba, media, aciertos, intervalo Wilson, exclusiones y advertencias.
  testedPeriods:number;meanReturn:number|null;winRate:number|null;winRateInterval95:{low:number;high:number}|null;sufficientSample:boolean;excluded:{symbol:string;asOf:string;reason:string}[];warnings:string[]};

// Prepara una muestra reproducible del ranking cuantitativo anterior, no del escáner funcional de siete
// cores.
function prepare(sample:Sample,cores:readonly CoreId[],strategy:StrategyId,days:number,policy:AnalysisPolicy):Prepared {
  // Obtiene la instantánea importada y su corte temporal.
  const s=sample.snapshot as unknown as CompanyResearch,cutoff=Date.parse(s.asOf);
  // Rechaza indicative y reconstrucciones: la validación exige cotizaciones OPRA observadas.
  if(s.options.feed!=='opra')throw new RangeError('Se requiere cadena OPRA observada, no indicative ni reconstrucción.');
  // Rechaza velas posteriores al corte de la propia muestra.
  if(s.market.bars.some(b=>b.time>cutoff))throw new RangeError('La muestra contiene velas posteriores a su corte.');
  // Desactiva escáner funcional y supuestos actuales de tasa/dividendo para reproducir únicamente criterios
  // cuantitativos con datos de su fecha.
  const ranked=rankObservedCompanies([s],cores,strategy,days,{...policy,scanner:undefined,modelMode:'observed',dividendYield:undefined,riskFreeRate:undefined})[0];
  // Obtiene la estructura que el ranking seleccionó en esa muestra.
  const a=ranked.strategyAnalysis;
  // Exige puntuación, estructura, débito y capital completos.
  if(ranked.score===null||a.status!=='available'||!a.capitalRequired||a.entryDebit===null)throw new RangeError('Cores, contratos o capital incompletos para reproducir la selección.');
  // Rechaza cualquier evidencia marcada como assumed en las entradas seleccionadas.
  if(ranked.coreResults.some(c=>c.evidence.some(e=>e.variable?.kind==='assumed')))throw new RangeError('La muestra usa supuestos como entradas históricas.');
  // Exige tasa y dividendo documentados y disponibles en ese corte.
  if(!knownBy(s.fundamentals.dividendYield,s.asOf)||s.fundamentals.dividendYield.kind==='assumed'||!knownBy(s.macro.riskFreeRate,s.asOf)||s.macro.riskFreeRate.kind==='assumed')throw new RangeError('Tasa y dividendos deben ser datos documentados de la fecha, sin supuestos actuales.');
  // Relaciona cada pierna elegida con su salida posterior importada.
  const selected=a.legs.map(l=>{
    // Busca la cotización de salida del mismo símbolo de contrato.
    const values=sample.exits.filter(e=>e.symbol===l.contract.symbol);
    // Exige una única salida por pierna; no elige una favorable entre múltiples alternativas.
    if(values.length!==1)throw new RangeError('Falta una salida única de cada pierna seleccionada.');
    // Guarda la pareja de pierna y salida verificada.
    return {leg:l,quote:values[0]};
  // Cierra el bloque, objeto o llamada definido anteriormente.
  });
  // Obtiene las horas de todas las salidas y la más tardía.
  const stamps=selected.map(v=>Date.parse(v.quote.at)),latest=Math.max(...stamps);
  // Exige salidas posteriores al corte y sincronizadas entre piernas dentro de un minuto.
  if(Math.min(...stamps)<=cutoff||Math.max(...stamps)-Math.min(...stamps)>60000)throw new RangeError('Las salidas deben ser posteriores al corte y estar sincronizadas dentro de un minuto.');
  // Impide usar cotizaciones de negociación posteriores al primer vencimiento.
  if(latest>Math.min(...a.legs.map(l=>valuationExpiry(l.contract,s.asOf).time)))throw new RangeError('No se aceptan cotizaciones de negociación posteriores al primer vencimiento.');
  // Excluye Gamma gestionada porque este archivo carece del registro de rebalanceos necesario para validar
  // scalping.
  if(strategy==='gamma')throw new RangeError('Gamma necesita un registro de coberturas; la salida estática del straddle no valida scalping.');
  // Calcula comisiones de cierre a partir de cantidades absolutas.
  const fees=(policy.feePerContract??0)*a.legs.reduce((n,l)=>n+Math.abs(l.quantity),0);
  // Liquida compras al bid y ventas al ask, conservando signos, multiplicador y comisiones.
  const close=selected.reduce((n,{leg,quote})=>n+leg.quantity*(leg.quantity>0?quote.bid:quote.ask)*a.contractMultiplier!,0)-fees;
  // Añade financiación del débito positivo de PMCC durante el tiempo efectivamente transcurrido.
  const financing=strategy==='pmcc'?Math.max(0,a.entryDebit)*(policy.financingRate??0)*(latest-cutoff)/(365*86400000):0;
  // Calcula retorno neto sobre capital y conserva cuándo se conoció la última salida, dato necesario para
  // evitar fuga temporal.
  return {symbol:s.symbol,asOf:cutoff,knownOutcomeAt:Math.max(...selected.map(v=>Date.parse(v.quote.availableAt))),netReturn:(close-a.entryDebit-financing)/a.capitalRequired,
    // Conserva puntuaciones por criterio para comparar candidatos de pesos sin alterar sus resultados.
    cores:Object.fromEntries(ranked.coreResults.map(c=>[c.core,c.score!]))};
// Cierra el bloque, objeto o llamada definido anteriormente.
}

// Evalúa candidatos de pesos en ventanas crecientes y prueba posterior con salidas ya conocidas en
// entrenamiento.
export function validateOptionRanking(input:unknown,cores:readonly CoreId[],strategy:StrategyId,days:number,policy:AnalysisPolicy={}):OptionValidation {
  // Valida dataset y ajustes del ranking.
  const dataset=optionDatasetSchema.parse(input),tuning=evaluationTuning(policy.tuning);
  // Deduplica criterios y excluye pesos no positivos.
  const chosen=[...new Set(cores)].filter(c=>coreWeight(tuning,c)>0);
  // Exige algún criterio con participación positiva.
  if(!chosen.length)throw new RangeError('Selecciona cores con peso positivo.');
  // Inicializa el informe con métricas ausentes hasta disponer de pruebas.
  const result:OptionValidation={source:dataset.source,kind:dataset.kind,strategy,folds:[],testedPeriods:0,meanReturn:null,winRate:null,winRateInterval95:null,sufficientSample:false,excluded:[],warnings:[
    // Aclara que las cotizaciones importadas no garantizan fills ni incluyen asignación o slippage adicional.
    'Validación por cotizaciones bid/ask importadas, no ejecuciones garantizadas. No modela asignación anticipada ni slippage adicional.',
    // Aclara que fechas declaradas coherentes no certifican autenticidad de la fuente ni un universo sin sesgos.
    'Se comprueba la causalidad de fechas declaradas, no la autenticidad del proveedor ni la ausencia de sesgos en la construcción del universo.',
    // Aclara que solo se comparan candidatos predefinidos con resultados conocidos en el entrenamiento.
    'Candidatos de pesos predefinidos; cada selección usa solo entrenamiento con salidas ya conocidas. Ningún resultado garantiza rentabilidad futura.',
    // Aclara que Wilson es descriptivo si existen períodos solapados o correlacionados.
    'Los períodos pueden estar correlacionados o superponerse. El intervalo Wilson es descriptivo y no acredita independencia financiera.',
  // Cierra la lista de entradas o resultados del bloque anterior.
  ]};
  // Identifica de forma destacada los datos fixture como prueba de funcionamiento, no evidencia de inversión.
  if(dataset.kind==='fixture')result.warnings.unshift('DATOS DE PRUEBA: este informe prueba el flujo, no valida inversiones reales.');
  // Inicializa muestras válidas y un registro de identidades para impedir duplicados de empresa/corte.
  const values:Prepared[]=[],identities=new Set<string>();
  // Recorre muestras y construye una clave de empresa y fecha.
  for(const sample of dataset.samples){const key=sample.snapshot.symbol+'|'+sample.snapshot.asOf;
    // Prepara cada muestra una sola vez y rechaza duplicados.
    try{if(identities.has(key))throw new RangeError('Empresa y corte duplicados.');identities.add(key);values.push(prepare(sample,chosen,strategy,days,policy));}
    // Registra las exclusiones con empresa, fecha y motivo sin interrumpir todo el archivo.
    catch(error){result.excluded.push({symbol:sample.snapshot.symbol,asOf:sample.snapshot.asOf,reason:error instanceof Error?error.message:'Muestra inválida.'});}}
  // Ordena cortes distintos y reserva aproximadamente el primer 60%, con al menos tres cortes, para contexto
  // inicial.
  const periods=[...new Set(values.map(v=>v.asOf))].sort((a,b)=>a-b),first=Math.max(3,Math.floor(periods.length*.6));
  // Si no queda entrenamiento y prueba suficientes, devuelve el informe con advertencia.
  if(periods.length-first<2){result.warnings.push('Muestra insuficiente: se requieren al menos seis cortes con entrenamiento y prueba.');return result;}
  // Construye pesos iguales como referencia de comparación.
  const equal=Object.fromEntries(chosen.map(c=>[c,1])) as Partial<Record<CoreId,number>>;
  // Compara pesos configurados, pesos iguales y alternativas que triplican riesgo, liquidez o volatilidad
  // cuando esos criterios participan.
  const candidates=[Object.fromEntries(chosen.map(c=>[c,coreWeight(tuning,c)])),equal,...(['risk','liquidity','volatility'] as CoreId[]).filter(c=>chosen.includes(c)).map(favored=>Object.fromEntries(chosen.map(c=>[c,c===favored?3:1])))] as Partial<Record<CoreId,number>>[];
  // Define cómo elegir la primera empresa de un grupo usando unos pesos dados.
  const pick=(group:Prepared[],weights:Partial<Record<CoreId,number>>)=>[...group].sort((a,b)=>{
    // Calcula la media ponderada de criterios para cada muestra del grupo.
    const score=(x:Prepared)=>chosen.reduce((n,c)=>n+x.cores[c]!*(weights[c]??1),0)/chosen.reduce((n,c)=>n+(weights[c]??1),0);
    // Ordena por puntuación descendente y desempata por símbolo para mantener reproducibilidad.
    return score(b)-score(a)||a.symbol.localeCompare(b.symbol);
  // Escoge el primer resultado de ese orden.
  })[0];
  // Define el rendimiento de una configuración sobre los grupos temporales de muestras.
  const performance=(rows:Prepared[],weights:Partial<Record<CoreId,number>>)=>{
    // Agrupa empresas que comparten el mismo instante de decisión.
    const groups=new Map<number,Prepared[]>();for(const row of rows){const group=groups.get(row.asOf)??[];group.push(row);groups.set(row.asOf,group);}
    // Solo compara períodos con al menos dos empresas y toma el retorno de la primera del ranking.
    return [...groups.values()].filter(g=>g.length>=2).map(g=>pick(g,weights).netReturn);
  // Cierra el bloque, objeto o llamada definido anteriormente.
  };
  // Define la media aritmética y conserva null si no existe ninguna observación.
  const mean=(v:number[])=>v.length?v.reduce((n,x)=>n+x,0)/v.length:null;
  // Acumula resultados de prueba y distribuye el resto de períodos en hasta tres pasos de evaluación.
  const allTest:number[]=[],step=Math.max(1,Math.ceil((periods.length-first)/3));
  // Avanza por bloques de prueba cronológicos.
  for(let index=first;index<periods.length;index+=step){
    // Obtiene el primer y último corte de la ventana actual.
    const cutoff=periods[index],end=periods[Math.min(periods.length-1,index+step-1)];
    // Entrena solo con decisiones anteriores cuya salida ya se conocía antes del primer corte de prueba.
    const train=values.filter(v=>v.asOf<cutoff&&v.knownOutcomeAt<cutoff);
    // Omite ventanas sin resultados de entrenamiento disponibles, comunicando la causa.
    if(!train.length){result.warnings.push('Se omitió un bloque: las salidas de entrenamiento aún no eran conocidas.');continue;}
    // Ordena candidatos por media de retorno en entrenamiento y desempata por su posición predefinida.
    const ranked=candidates.map((weights,index)=>({weights,index,value:mean(performance(train,weights))??-Infinity})).sort((a,b)=>b.value-a.value||a.index-b.index);
    // Si ningún candidato tuvo rendimiento evaluable, omite esa ventana.
    if(!Number.isFinite(ranked[0].value))continue;
    // Congela los mejores pesos de entrenamiento y obtiene las decisiones de la ventana de prueba.
    const weights=ranked[0].weights,test=values.filter(v=>v.asOf>=cutoff&&v.asOf<=end);
    // Evalúa selección y pesos iguales sobre la misma prueba y acumula los retornos.
    const returns=performance(test,weights),baseline=performance(test,equal);allTest.push(...returns);
    // Guarda fechas, tamaños de muestra, medias y pesos para auditar cada ventana.
    result.folds.push({trainBefore:new Date(cutoff).toISOString(),testStart:new Date(cutoff).toISOString(),testEnd:new Date(end).toISOString(),trainSamples:train.length,testPeriods:returns.length,meanReturn:mean(returns),equalWeightReturn:mean(baseline),weights});
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Publica cantidad de períodos probados y media de retornos de esas selecciones.
  result.testedPeriods=allTest.length;result.meanReturn=mean(allTest);
  // Cuenta retornos positivos y calcula frecuencia histórica e intervalo Wilson del 95%.
  const wins=allTest.filter(v=>v>0).length;result.winRate=allTest.length?wins/allTest.length:null;result.winRateInterval95=wilsonInterval(wins,allTest.length);
  // Exige datos observed, 30 períodos probados, tres ventanas y tres empresas distintas para marcar muestra
  // suficiente.
  result.sufficientSample=dataset.kind==='observed'&&allTest.length>=30&&result.folds.length>=3&&new Set(values.map(v=>v.symbol)).size>=3;
  // Conserva una advertencia cuando la evidencia no cumple todos esos requisitos descriptivos.
  if(!result.sufficientSample)result.warnings.push('Evidencia insuficiente: hacen falta al menos 30 períodos de prueba, tres bloques, tres empresas y datos observados.');
  // Devuelve resultados y límites; validar el ranking anterior no valida automáticamente el escáner actual.
  return result;
// Cierra el bloque, objeto o llamada definido anteriormente.
}
