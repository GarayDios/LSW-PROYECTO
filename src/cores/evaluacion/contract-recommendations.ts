// Recomendador acotado de combinaciones de opciones existentes. Comparte selección, calidad, capital y
// evaluación de cores; produce propuestas para revisión manual.

// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type {CompanyResearch,ObservedOptionContract} from '../compartido/research-model.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type {StrategyId} from '../compartido/types.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import {analysisPolicy,type AnalysisSettings} from '../../features/research/analysis-settings.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import {equityTerms,valuationExpiry} from '../../features/research/contract-terms.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import {strategyOutlook} from './strategy-outlook.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import {estimatedSnapshot} from './estimated-snapshot.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import {analyzeStrategy} from './strategy-analysis.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import {inspectContracts,type SelectionDiagnostics} from './strategy-eligibility.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import {evaluateScanner} from './scanner.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import {defaultScannerSettings} from './scanner-settings.ts';

// Define la solicitud: instantánea de empresa, estrategia, días, ajustes, cantidad máxima de propuestas y
// criterio de orden.
export type ContractRecommendationRequest={research:CompanyResearch;strategy:StrategyId;days:number;settings:AnalysisSettings;limit?:number;order?:'analysis'|'pnl'|'capital'};
// Define una combinación candidata con identidad estable, análisis y evaluación de cores.
export type ContractCandidate={
  // Conserva análisis de contratos y puntuación de cores para la misma combinación.
  id:string;analysis:ReturnType<typeof analyzeStrategy>;evaluation:ReturnType<typeof evaluateScanner>;
  // Añade rentabilidad condicional, horizonte de comparación y etiqueta de calidad para revisión de ejecución.
  profitability:ReturnType<typeof strategyOutlook>['profitability'];horizonSessions:number|null;executionReady:boolean;
// Cierra el bloque, objeto o llamada definido anteriormente.
};
// Describe propuestas, conteos, búsqueda acotada, faltantes y diagnósticos de contratos descartados.
export type ContractRecommendations={symbol:string;strategy:StrategyId;asOf:string;dataMode:'observed'|'estimated';candidates:ContractCandidate[];checked:number;totalContracts:number;eligibleContracts:number;poolSize:number;bounded:boolean;missing:string[];diagnostics?:SelectionDiagnostics};

// Busca combinaciones alternativas de contratos existentes, sin generar ni enviar órdenes al bróker.
export function recommendContracts(input:ContractRecommendationRequest):ContractRecommendations{
  // Extrae los datos y restricciones de la solicitud.
  const {research,strategy,days,settings}=input;
  // Intenta formar una estrategia inicial y determina si las entradas son del proveedor o estimadas.
  const initial=strategyOutlook(research,strategy,days,settings),mode=initial.resolved.scenario?.dataMode??'observed';
  // Inicializa una respuesta vacía con todos los conteos y la procedencia temporal.
  const output:ContractRecommendations={symbol:research.symbol,strategy,asOf:research.asOf,dataMode:mode,candidates:[],checked:0,totalContracts:research.options.contracts.length,eligibleContracts:0,poolSize:0,bounded:false,missing:[]};
  // Inspecciona la calidad contractual original para poder explicar incluso una búsqueda que no llega a
  // empezar.
  output.diagnostics=inspectContracts(research,analysisPolicy(settings,research)).diagnostics;
  // Publica cuántos contratos originales pasan los controles de calidad.
  output.eligibleContracts=output.diagnostics.eligibleContracts;
  // Si faltan escenario o análisis iniciales, reúne motivos distintos antes de devolver la respuesta vacía.
  if(!initial.resolved.scenario||!initial.resolved.analysis){output.missing=[...new Set([
    // Incluye el motivo del proveedor si no llegó ningún contrato.
    ...(!research.options.contracts.length?[research.options.status.message]:[]),
    // Incluye faltantes concretos del análisis estructural cuando están disponibles.
    ...(initial.resolved.analysis?.missing??[]),
    // Añade el error principal o una explicación general de incompatibilidad.
    initial.resolved.error??'No hay contratos compatibles con los datos y el capital configurados.',
  // Elimina duplicados de motivos mediante Set y termina la búsqueda sin inventar propuestas.
  ])];return output;}
  // Construye la política efectiva, incluyendo modo, plazo de reconstrucción y estrategia.
  const policy={...analysisPolicy(settings,research),modelMode:mode,estimateDays:days,estimateStrategy:strategy};
  // Prepara una copia estimada cuando corresponde y vuelve a obtener los contratos elegibles de esa copia.
  const snapshot=estimatedSnapshot(research,policy),inspection=inspectContracts(snapshot,policy),eligible=inspection.eligible;
  // Conserva los diagnósticos de los datos que realmente alimentarán esta búsqueda.
  output.diagnostics=inspection.diagnostics;
  // Actualiza el conteo de elegibles para ese modo de cálculo.
  output.eligibleContracts=eligible.length;
  // Precálcula plazo restante, spread relativo y strike efectivo para ordenar sin repetir cálculos.
  const descriptors=new Map(eligible.map(c=>[c,{days:(valuationExpiry(c,research.asOf).time-Date.parse(research.asOf))/86400000,spread:(c.ask.value!-c.bid.value!)/Math.max(.01,c.premium.value!),strike:equityTerms(c,research.asOf)!.effectiveStrike}]));
  // Define un orden por cercanía al plazo solicitado dentro de un conjunto de contratos.
  const near=(tenor:number,items=eligible)=>[...items].sort((a,b)=>{
    // La distancia suma diferencia relativa de plazo y spread; una menor distancia tiene prioridad.
    const distance=(c:ObservedOptionContract)=>Math.abs(descriptors.get(c)!.days-tenor)/Math.max(1,tenor)+descriptors.get(c)!.spread;
    // Resuelve empates por cercanía del strike al spot y después por símbolo, haciendo reproducible la
    // selección.
    return distance(a)-distance(b)||Math.abs(descriptors.get(a)!.strike-research.market.spot.value!)-Math.abs(descriptors.get(b)!.strike-research.market.spot.value!)||a.symbol.localeCompare(b.symbol);
  // Cierra el bloque, objeto o llamada definido anteriormente.
  });
  // Obtiene los símbolos de las piernas de la estructura inicial válida.
  const initialSymbols=new Set(initial.resolved.analysis.legs.map(leg=>leg.contract.symbol));
  // Inicia el conjunto de búsqueda con esas piernas para no perder la primera solución.
  const pool=new Set(eligible.filter(c=>initialSymbols.has(c.symbol)));
  // Ordena candidatos próximos al plazo corto.
  const short=near(days);
  // Para PMCC reserva hasta 32 calls largas ITM compatibles con el horizonte largo.
  if(strategy==='pmcc')for(const c of near(settings.longDays,eligible.filter(c=>c.type==='call'&&descriptors.get(c)!.days>days&&descriptors.get(c)!.strike<research.market.spot.value!)).slice(0,32))pool.add(c);
  // Completa el conjunto con contratos cercanos hasta un máximo de 128.
  for(const c of short){if(pool.size>=128)break;pool.add(c);}
  // Publica el tamaño de búsqueda e informa si quedaron elegibles fuera del conjunto.
  const contracts=[...pool];output.poolSize=contracts.length;output.bounded=contracts.length<eligible.length;
  // Crea una cola de exclusiones y conjuntos para evitar repetir búsquedas o estructuras.
  const queue:Set<string>[]=[new Set()],visited=new Set<string>(),structures=new Set<string>();
  // Usa la configuración del escáner elegida o sus valores predeterminados.
  const scanner=settings.scanner??defaultScannerSettings;
  // Prepara los candidatos válidos que se compararán al final.
  const candidates:ContractCandidate[]=[];
  // Acota el trabajo a 40 búsquedas y 24 combinaciones candidatas, sin explorar todo el producto cartesiano.
  while(queue.length&&output.checked<40&&candidates.length<24){
    // Extrae una exclusión, genera su clave y omite búsquedas ya visitadas antes de contar un intento.
    const excluded=queue.shift()!,key=[...excluded].sort().join('|');if(visited.has(key))continue;visited.add(key);output.checked++;
    // Construye una instantánea que excluye los contratos marcados en esa rama.
    const subset={...snapshot,options:{...snapshot.options,contracts:contracts.filter(c=>!excluded.has(c.symbol))}};
    // Vuelve a formar la estrategia con el selector común y sus controles de capital y calidad.
    const analysis=analyzeStrategy(subset,strategy,days,policy);
    // Descarta ramas en las que no se puede formar una estructura válida.
    if(analysis.status!=='available')continue;
    // Genera ramas quitando cada contrato elegido completo; el selector conserva las proporciones de la
    // estrategia.
    for(const leg of analysis.legs)queue.push(new Set([...excluded,leg.contract.symbol]));
    // Identifica la estructura por cantidades firmadas y símbolos; elimina propuestas duplicadas.
    const id=analysis.legs.map(leg=>`${leg.quantity}:${leg.contract.symbol}`).sort().join('|');if(structures.has(id))continue;structures.add(id);
    // Limita la siguiente evaluación a los contratos de esa combinación concreta.
    const selected={...snapshot,options:{...snapshot.options,contracts:analysis.legs.map(leg=>leg.contract)}};
    // Calcula su perspectiva y puede reutilizar el pronóstico de la empresa para evitar trabajo repetido.
    const outlook=strategyOutlook(selected,strategy,days,{...settings,modelMode:mode},initial.forecast);
    // Descarta una combinación que no permite construir su escenario de valoración.
    if(!outlook.resolved.scenario)continue;
    // Evalúa los cores y Monte Carlo para la combinación seleccionada.
    const evaluation=evaluateScanner(selected,strategy,days,scanner,policy,analysis);
    // Guarda contratos, confluencia, rentabilidad condicional, horizonte y etiqueta de revisión.
    candidates.push({id,analysis,evaluation,profitability:outlook.profitability,horizonSessions:outlook.horizonSessions,executionReady:outlook.executionReady});
  // Cierra el bloque, objeto o llamada definido anteriormente.
  }
  // Marca la búsqueda como acotada si quedó trabajo pendiente al alcanzar los límites.
  output.bounded ||= queue.length>0;
  // Define comparación descendente de números, colocando los valores ausentes al final.
  const numberOrder=(a:number|null,b:number|null)=>a===null?b===null?0:1:b===null?-1:b-a;
  // Ordena todas las combinaciones válidas según la preferencia del usuario.
  candidates.sort((a,b)=>{
    // Calcula comparaciones de confluencia y retorno sobre capital, sin rellenar rentabilidades ausentes.
    const score=numberOrder(a.evaluation.score,b.evaluation.score),profit=numberOrder(a.profitability.returnOnCapital,b.profitability.returnOnCapital);
    // Invierte la comparación para que menor capital requerido aparezca primero.
    const capital=numberOrder(b.analysis.capitalRequired,a.analysis.capitalRequired);
    // Aplica prioridad por retorno, capital o confluencia y resuelve empates con la otra medida disponible.
    const primary=input.order==='pnl'?profit||score:input.order==='capital'?capital||score:score||profit;
    // Desempata por menor coste de spread y después por identidad estable de la estructura.
    return primary||(a.analysis.spreadCost??Infinity)-(b.analysis.spreadCost??Infinity)||a.id.localeCompare(b.id);
  // Cierra el bloque, objeto o llamada definido anteriormente.
  });
  // Conserva únicamente candidatos con cores evaluables que alcancen la confluencia mínima configurada.
  const filtered=candidates.filter(c=>c.evaluation.score!==null&&c.evaluation.score>=scanner.scan.minConfluence);
  // Valida un límite de 1 a 10 propuestas; utiliza cinco si no se suministró un límite válido.
  const limit=Number.isInteger(input.limit)&&input.limit!>=1&&input.limit!<=10?input.limit!:5;
  // Entrega las primeras combinaciones después de ordenar y filtrar.
  output.candidates=filtered.slice(0,limit);
  // Si no hay propuestas, distingue falta de confluencia de imposibilidad de valorar combinaciones.
  if(!output.candidates.length)output.missing=[candidates.length?`Ninguna combinación alcanza la confluencia mínima de ${scanner.scan.minConfluence}% con cores evaluables.`:'No se pudieron valorar combinaciones alternativas compatibles.'];
  // Devuelve propuestas y diagnósticos; la búsqueda acotada no garantiza el óptimo global.
  return output;
// Cierra el bloque, objeto o llamada definido anteriormente.
}
