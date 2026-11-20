import { z } from 'zod';
import { CORE_IDS, type CoreId } from '../compartido/types.ts';

// Defaults are modeling choices, not calibrated investment parameters. Runtime
// bounds limit numerical cost and prevent weakening the provider's freshness cap.
const nonnegative = z.number().finite().min(0);
export const coreWeightsSchema = z.object({
  bsm: nonnegative.max(100).optional(), greeks: nonnegative.max(100).optional(),
  probability: nonnegative.max(100).optional(), volatility: nonnegative.max(100).optional(),
  trend: nonnegative.max(100).optional(), liquidity: nonnegative.max(100).optional(), risk: nonnegative.max(100).optional(),
}).strict();
export const evaluationTuningSchema = z.object({
  quoteMaxAgeMinutes: z.number().finite().min(1).max(60).default(60),
  legQuoteSkewMinutes: nonnegative.max(60).default(15),
  spotOptionGapDays: nonnegative.max(7).default(4),
  spotOptionSkewMinutes:nonnegative.max(60).default(15),
  binomialSteps: z.number().int().min(20).max(500).default(100),
  scenarioChanges: z.array(z.number().finite().gt(-1).max(3)).min(1).max(11)
    .refine(v=>new Set(v).size===v.length,'No repitas escenarios.').default([-.3,-.15,0,.15,.3]),
  trendBase: nonnegative.max(1).default(.5),
  trend20Coefficient: nonnegative.max(10).default(1.5),
  trend60Coefficient: nonnegative.max(10).default(.75),
  riskDrawdownWeight: nonnegative.max(1).default(.6),
  tenorWeight: nonnegative.max(10).default(1),
  spreadWeight: nonnegative.max(10).default(1),
  strikeDistanceWeight: nonnegative.max(10).default(3),
  coreWeights: coreWeightsSchema.default({}),
}).strict().refine(v=>v.tenorWeight+v.spreadWeight>0,'Plazo y spread no pueden tener ambos peso cero.');
export type EvaluationTuning = z.infer<typeof evaluationTuningSchema>;
export type EvaluationTuningInput = z.input<typeof evaluationTuningSchema>;
export const defaultEvaluationTuning = evaluationTuningSchema.parse({});
export function evaluationTuning(input?: EvaluationTuningInput): EvaluationTuning { return evaluationTuningSchema.parse(input ?? {}); }
export function coreWeight(tuning: EvaluationTuning, core: CoreId): number { return tuning.coreWeights[core] ?? 1; }
export function activeCoreWeight(tuning: EvaluationTuning, selected: readonly CoreId[]): number {
  return CORE_IDS.filter(c=>selected.includes(c)).reduce((sum,c)=>sum+coreWeight(tuning,c),0);
}
