// Predicados compartidos de elegibilidad y diagnósticos de descartes. Los mismos filtros que seleccionan
// contratos explican por qué se rechazan.

// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { equityTerms, valuationExpiry } from '../../features/research/contract-terms.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { knownBy, type CompanyResearch } from '../compartido/research-model.ts';
// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { AnalysisPolicy } from './strategy-analysis.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { evaluationTuning } from './evaluation-policy.ts';

// Define códigos estables de descarte y etiquetas legibles para la interfaz.
export const rejectionLabels = {
  // Distingue subyacente incorrecto, vencimiento/strike inválidos y términos contractuales sin verificar.
  underlying: 'Otro subyacente', expiry: 'Vencimiento o strike inválido', terms: 'Multiplicador o entregables sin verificar',
  // Distingue falta de IV y falta de bid, ask o prima utilizables.
  iv: 'IV ausente, inválida o posterior al corte', quote: 'Bid/ask o prima ausentes o inválidos',
  // Distingue antigüedad de cotización y desfase temporal entre acción y opción.
  stale: 'Cotización fuera del límite de antigüedad', synchronization: 'Acción y opción fuera del desfase permitido',
  // Incluye spread superior al porcentaje máximo configurado.
  spread: 'Spread superior al máximo configurado',
// Conserva los códigos como valores literales para derivar un tipo seguro.
} as const;
// Deriva el tipo de código a partir de las claves del catálogo de descartes.
export type ContractRejection = keyof typeof rejectionLabels;
// Define diagnósticos de calidad y posibles bloqueos estructurales o de presupuesto.
export type SelectionDiagnostics = {
  // Registra total recibido y cantidad que supera todos los controles.
  totalContracts: number; eligibleContracts: number;
  // Guarda cada motivo con número de contratos y etiqueta; un contrato puede fallar en varios motivos.
  rejected: { code: ContractRejection; count: number; label: string }[];
  // Permite identificar si el bloqueo procede de ausencia, calidad, spread, capital o geometría.
  blocker: 'contracts'|'quality'|'spread'|'capital'|'structure'|null;
  // Reserva un ejemplo de capital requerido; no afirma que sea un mínimo global.
  exampleCapitalRequired: number|null;
// Cierra el bloque, objeto o llamada definido anteriormente.
};

// Selecciona contratos y calcula diagnósticos con los mismos predicados para evitar explicaciones
// incoherentes.
export function inspectContracts(s: CompanyResearch, policy: AnalysisPolicy = {}) {
  // Valida límites de calidad y convierte el corte a milisegundos.
  const tuning=evaluationTuning(policy.tuning),cutoff=Date.parse(s.asOf);
  // Inicializa un contador independiente por cada código de rechazo.
  const counts = Object.fromEntries(Object.keys(rejectionLabels).map(key=>[key,0])) as Record<ContractRejection,number>;
  // Evalúa los requisitos de cada contrato recibido.
  const eligible=s.options.contracts.filter(c=>{
    // Empieza la lista de motivos de descarte para este contrato.
    const rejected:ContractRejection[]=[];
    // Exige que el contrato pertenezca al símbolo de la instantánea.
    if(c.underlyingSymbol!==s.symbol)rejected.push('underlying');
    // Exige strike conocido y positivo y horizonte de vencimiento posterior al corte.
    if(!knownBy(c.strike,s.asOf)||c.strike.value!<=0||!(valuationExpiry(c,s.asOf).time>cutoff))rejected.push('expiry');
    // Exige multiplicador y entregable simple de acciones verificables.
    if(!equityTerms(c,s.asOf))rejected.push('terms');
    // Exige IV positiva y conocida al corte.
    if(!knownBy(c.impliedVolatility,s.asOf)||c.impliedVolatility.value!<=0)rejected.push('iv');
    // Comprueba bid, ask y prima conocidos; bid no negativo, ask positivo y ask mayor o igual a bid.
    const quoted=[c.bid,c.ask,c.premium].every(v=>knownBy(v,s.asOf))&&c.bid.value!>=0&&c.ask.value!>0&&c.ask.value!>=c.bid.value!;
    // Registra cotización inválida si no cumple esa coherencia.
    if(!quoted)rejected.push('quote');
    // Rechaza una cotización coherente que exceda la antigüedad máxima autorizada.
    if(quoted&&cutoff-Date.parse(c.premium.observedAt!)>tuning.quoteMaxAgeMinutes*60000)rejected.push('stale');
    // Comienza la comprobación de sincronización entre tiempos de la acción y de la opción.
    if(quoted&&(!knownBy(s.market.spot,s.asOf)||Math.abs(Date.parse(c.premium.observedAt!)-Date.parse(s.market.spot.observedAt!))>
      // Usa desfase en minutos para spot de cotización y en días para cierre diario.
      (s.market.spotBasis==='quote'?tuning.spotOptionSkewMinutes*60000:tuning.spotOptionGapDays*86400000)))rejected.push('synchronization');
    // Filtra spread = (ask − bid)/máximo(0.01, prima) expresado en porcentaje.
    if(quoted&&policy.maxSpreadPercent!==undefined&&(c.ask.value!-c.bid.value!)/Math.max(.01,c.premium.value!)*100>policy.maxSpreadPercent)rejected.push('spread');
    // Incrementa cada contador aplicable; las cantidades pueden superponerse.
    rejected.forEach(code=>counts[code]++);
    // Admite el contrato solo cuando su lista de rechazos quedó vacía.
    return !rejected.length;
  // Cierra el bloque, objeto o llamada definido anteriormente.
  });
  // Devuelve elegibles y conteos globales en la misma operación.
  return {eligible,diagnostics:{totalContracts:s.options.contracts.length,eligibleContracts:eligible.length,
    // Incluye solo motivos que tuvieron al menos un contrato rechazado.
    rejected:Object.entries(counts).filter(([,count])=>count>0).map(([code,count])=>({code:code as ContractRejection,count,label:rejectionLabels[code as ContractRejection]})),
    // Deja bloqueo estructural y capital de ejemplo sin determinar; los completa el análisis de estrategia si
    // corresponde.
    blocker:null,exampleCapitalRequired:null} as SelectionDiagnostics};
// Cierra el bloque, objeto o llamada definido anteriormente.
}
