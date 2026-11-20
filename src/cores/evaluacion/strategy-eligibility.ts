import { equityTerms, valuationExpiry } from '../../features/research/contract-terms.ts';
import { knownBy, type CompanyResearch } from '../compartido/research-model.ts';
import type { AnalysisPolicy } from './strategy-analysis.ts';
import { evaluationTuning } from './evaluation-policy.ts';

export const rejectionLabels = {
  underlying: 'Otro subyacente', expiry: 'Vencimiento o strike inválido', terms: 'Multiplicador o entregables sin verificar',
  iv: 'IV ausente, inválida o posterior al corte', quote: 'Bid/ask o prima ausentes o inválidos',
  stale: 'Cotización fuera del límite de antigüedad', synchronization: 'Acción y opción fuera del desfase permitido',
  spread: 'Spread superior al máximo configurado',
} as const;
export type ContractRejection = keyof typeof rejectionLabels;
export type SelectionDiagnostics = {
  totalContracts: number; eligibleContracts: number;
  rejected: { code: ContractRejection; count: number; label: string }[];
  blocker: 'contracts'|'quality'|'spread'|'capital'|'structure'|null;
  exampleCapitalRequired: number|null;
};

/** Selection and diagnostics use the same predicates. Counts can overlap. */
export function inspectContracts(s: CompanyResearch, policy: AnalysisPolicy = {}) {
  const tuning=evaluationTuning(policy.tuning),cutoff=Date.parse(s.asOf);
  const counts = Object.fromEntries(Object.keys(rejectionLabels).map(key=>[key,0])) as Record<ContractRejection,number>;
  const eligible=s.options.contracts.filter(c=>{
    const rejected:ContractRejection[]=[];
    if(c.underlyingSymbol!==s.symbol)rejected.push('underlying');
    if(!knownBy(c.strike,s.asOf)||c.strike.value!<=0||!(valuationExpiry(c,s.asOf).time>cutoff))rejected.push('expiry');
    if(!equityTerms(c,s.asOf))rejected.push('terms');
    if(!knownBy(c.impliedVolatility,s.asOf)||c.impliedVolatility.value!<=0)rejected.push('iv');
    const quoted=[c.bid,c.ask,c.premium].every(v=>knownBy(v,s.asOf))&&c.bid.value!>=0&&c.ask.value!>0&&c.ask.value!>=c.bid.value!;
    if(!quoted)rejected.push('quote');
    if(quoted&&cutoff-Date.parse(c.premium.observedAt!)>tuning.quoteMaxAgeMinutes*60000)rejected.push('stale');
    if(quoted&&(!knownBy(s.market.spot,s.asOf)||Math.abs(Date.parse(c.premium.observedAt!)-Date.parse(s.market.spot.observedAt!))>
      (s.market.spotBasis==='quote'?tuning.spotOptionSkewMinutes*60000:tuning.spotOptionGapDays*86400000)))rejected.push('synchronization');
    if(quoted&&policy.maxSpreadPercent!==undefined&&(c.ask.value!-c.bid.value!)/Math.max(.01,c.premium.value!)*100>policy.maxSpreadPercent)rejected.push('spread');
    rejected.forEach(code=>counts[code]++);
    return !rejected.length;
  });
  return {eligible,diagnostics:{totalContracts:s.options.contracts.length,eligibleContracts:eligible.length,
    rejected:Object.entries(counts).filter(([,count])=>count>0).map(([code,count])=>({code:code as ContractRejection,count,label:rejectionLabels[code as ContractRejection]})),
    blocker:null,exampleCapitalRequired:null} as SelectionDiagnostics};
}
