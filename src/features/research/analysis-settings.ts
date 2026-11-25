import { z } from 'zod';
import { evaluationTuningSchema } from '../../cores/evaluacion/evaluation-policy.ts';
import type { AnalysisPolicy } from '../../cores/evaluacion/strategy-analysis.ts';
import type { CompanyResearch } from '../../cores/compartido/research-model.ts';
import { scannerSettingsSchema } from '../../cores/evaluacion/scanner-settings.ts';
import { finvizDatasetSchema } from '../../cores/04-analisis-fundamental/finviz-data.ts';

export const analysisSettingsSchema = z.object({capital:z.number().finite().positive().max(1e7),feePerContract:z.number().finite().min(0).max(100),maxSpreadPercent:z.number().finite().min(0).max(200),longDays:z.number().int().min(1).max(3650),dividendPercentBySymbol:z.record(z.string().regex(/^[A-Z][A-Z0-9.-]{0,15}$/),z.number().finite().min(0).max(100)).refine(v=>Object.keys(v).length<=14),tuning:evaluationTuningSchema.optional(),
  modelMode:z.enum(['observed','estimated']).optional(),riskFreePercent:z.number().finite().min(-20).max(100).optional(),defaultDividendPercent:z.number().finite().min(0).max(100).optional(),
  dividendModel:z.enum(['continuous','declared-cash']).optional(),
  financingRatePercent:z.number().finite().min(0).max(100).optional(),pmccCapitalMode:z.enum(['assignment-reserve','debit-only']).optional(),pmccMinLongDelta:z.number().finite().min(0).max(1).optional(),ivShockPercent:z.number().finite().min(0).max(90).optional(),
  estimatedSpreadPercent:z.number().finite().min(0).max(100).optional(),estimatedSpreadFloor:z.number().finite().min(.001).max(100).optional(),
  estimatedCandidateLimit:z.number().int().min(10).max(500).optional(),
  scanner: scannerSettingsSchema.optional(),
  finviz: finvizDatasetSchema.optional(),
}).strict();
export type AnalysisSettings = z.infer<typeof analysisSettingsSchema>;
export const defaultAnalysisSettings: AnalysisSettings = { capital: 20000, feePerContract: .65, maxSpreadPercent: 30, longDays: 365, dividendPercentBySymbol: {},pmccMinLongDelta:.81 };
export function analysisPolicy(settings: AnalysisSettings, snapshot: CompanyResearch): AnalysisPolicy {
  const percent = settings.dividendPercentBySymbol[snapshot.symbol] ?? (settings.modelMode==='estimated'?settings.defaultDividendPercent:undefined);
  return { scanner: settings.scanner, capital: settings.capital, feePerContract: settings.feePerContract, maxSpreadPercent: settings.maxSpreadPercent, longDays: settings.longDays,tuning:settings.tuning,
    modelMode:settings.modelMode,dividendModel:settings.dividendModel,financingRate:(settings.financingRatePercent??0)/100,pmccCapitalMode:settings.pmccCapitalMode,pmccMinLongDelta:settings.pmccMinLongDelta??.81,ivShock:(settings.ivShockPercent??20)/100,estimatedSpreadPercent:settings.estimatedSpreadPercent,estimatedSpreadFloor:settings.estimatedSpreadFloor,estimatedCandidateLimit:settings.estimatedCandidateLimit,
    ...(settings.riskFreePercent===undefined?{}:{riskFreeRate:{value:settings.riskFreePercent/100,kind:'assumed' as const,source:'Usuario: tasa anual continua supuesta; no es FRED',observedAt:snapshot.asOf,availableAt:snapshot.asOf,reason:'Supuesto explícito del escenario; no acredita una tasa histórica observada.'}}),
    ...(percent === undefined ? {} : { dividendYield: { value: percent / 100, kind: 'assumed' as const,
      source: `Usuario: escenario explícito para ${snapshot.symbol}; no es dividendo publicado`, observedAt: snapshot.asOf, availableAt: snapshot.asOf,
      reason: 'Supuesto del escenario aplicado a esta instantánea. No acredita que el dato se conociera históricamente.' } }) };
}
