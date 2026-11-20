import { knownBy, type CompanyResearch, type ResearchVariable } from '../../cores/compartido/research-model.ts';
import type { AnalysisPolicy } from '../../cores/evaluacion/strategy-analysis.ts';

/** The external observation remains visible when an explicit scenario overrides it. */
export function modelMacroContext(snapshot: CompanyResearch, policy: AnalysisPolicy = {}) {
  const rate: ResearchVariable = policy.riskFreeRate ?? snapshot.macro.riskFreeRate;
  return {
    externalRate: snapshot.macro.riskFreeRate,
    rate,
    rateAvailable: knownBy(rate, snapshot.asOf),
    manualRate: policy.riskFreeRate !== undefined,
    explanation: 'La tasa anual continua entra en BSM, CRR y la valoración de estrategias. DGS3MO se usa como aproximación común de tres meses; no es una curva ajustada al vencimiento. Inflación y PIB son contexto y no modifican automáticamente los pesos ni la recomendación.',
  };
}
