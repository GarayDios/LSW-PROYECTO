// Esquemas de límites numéricos y ajustes del análisis. Los valores predeterminados son elecciones de
// modelado, no pesos óptimos ni parámetros calibrados.

// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { z } from 'zod';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { CORE_IDS, type CoreId } from '../compartido/types.ts';

// Define un número finito no negativo como base de los esquemas de pesos y tolerancias.
const nonnegative = z.number().finite().min(0);
// Abre un esquema de pesos opcionales para los criterios cuantitativos anteriores.
export const coreWeightsSchema = z.object({
  // Permite pesos de BSM y griegas entre 0 y 100.
  bsm: nonnegative.max(100).optional(), greeks: nonnegative.max(100).optional(),
  // Permite pesos de probabilidad y volatilidad entre 0 y 100.
  probability: nonnegative.max(100).optional(), volatility: nonnegative.max(100).optional(),
  // Permite pesos de tendencia, liquidez y riesgo entre 0 y 100.
  trend: nonnegative.max(100).optional(), liquidity: nonnegative.max(100).optional(), risk: nonnegative.max(100).optional(),
// Cierra el objeto y rechaza nombres de criterios desconocidos.
}).strict();
// Abre el esquema de límites temporales, coste numérico y preferencias de selección.
export const evaluationTuningSchema = z.object({
  // Antigüedad de la opción de 1 a 60 minutos, por defecto 60; no autoriza ignorar límites del proveedor.
  quoteMaxAgeMinutes: z.number().finite().min(1).max(60).default(60),
  // Desfase máximo entre piernas de 0 a 60 minutos, por defecto 15.
  legQuoteSkewMinutes: nonnegative.max(60).default(15),
  // Desfase entre cierre diario y opción de hasta siete días, por defecto cuatro.
  spotOptionGapDays: nonnegative.max(7).default(4),
  // Desfase entre cotización de acción y opción de hasta 60 minutos, por defecto 15.
  spotOptionSkewMinutes:nonnegative.max(60).default(15),
  // Número de pasos CRR entre 20 y 500, por defecto 100, para acotar coste de valoración americana.
  binomialSteps: z.number().int().min(20).max(500).default(100),
  // Admite de 1 a 11 cambios de precio finitos, superiores a −100% y de hasta +300%.
  scenarioChanges: z.array(z.number().finite().gt(-1).max(3)).min(1).max(11)
    // Rechaza escenarios repetidos y ofrece cambios de −30%, −15%, 0, +15% y +30%.
    .refine(v=>new Set(v).size===v.length,'No repitas escenarios.').default([-.3,-.15,0,.15,.3]),
  // Base heurística de tendencia en [0,1], por defecto 0.5.
  trendBase: nonnegative.max(1).default(.5),
  // Coeficiente de momentum20 hasta 10, por defecto 1.5.
  trend20Coefficient: nonnegative.max(10).default(1.5),
  // Coeficiente de momentum60 hasta 10, por defecto 0.75.
  trend60Coefficient: nonnegative.max(10).default(.75),
  // Peso del drawdown frente a desviación bajista en [0,1], por defecto 0.6.
  riskDrawdownWeight: nonnegative.max(1).default(.6),
  // Peso no negativo de distancia al plazo, hasta 10 y por defecto 1.
  tenorWeight: nonnegative.max(10).default(1),
  // Peso no negativo del spread, hasta 10 y por defecto 1.
  spreadWeight: nonnegative.max(10).default(1),
  // Peso de distancia de strike al spot, hasta 10 y por defecto 3.
  strikeDistanceWeight: nonnegative.max(10).default(3),
  // Incluye pesos individuales; ausencia conserva los predeterminados del ayudante.
  coreWeights: coreWeightsSchema.default({}),
// Rechaza claves desconocidas y exige que plazo y spread no tengan ambos peso cero.
}).strict().refine(v=>v.tenorWeight+v.spreadWeight>0,'Plazo y spread no pueden tener ambos peso cero.');
// Deriva el tipo de configuración completa una vez aplicados sus valores predeterminados.
export type EvaluationTuning = z.infer<typeof evaluationTuningSchema>;
// Deriva el tipo de entrada, que puede omitir los campos con valor predeterminado.
export type EvaluationTuningInput = z.input<typeof evaluationTuningSchema>;
// Materializa los valores predeterminados validando un objeto vacío.
export const defaultEvaluationTuning = evaluationTuningSchema.parse({});
// Valida una configuración opcional y completa los campos omitidos con sus valores predeterminados.
export function evaluationTuning(input?: EvaluationTuningInput): EvaluationTuning { return evaluationTuningSchema.parse(input ?? {}); }
// Devuelve peso configurado del criterio o 1 si no fue especificado; un peso cero explícito se conserva.
export function coreWeight(tuning: EvaluationTuning, core: CoreId): number { return tuning.coreWeights[core] ?? 1; }
// Suma pesos de criterios presentes en la selección utilizando identificadores únicos del catálogo.
export function activeCoreWeight(tuning: EvaluationTuning, selected: readonly CoreId[]): number {
  // Filtra el catálogo por selección y acumula sus pesos sin duplicar criterios repetidos.
  return CORE_IDS.filter(c=>selected.includes(c)).reduce((sum,c)=>sum+coreWeight(tuning,c),0);
// Cierra el bloque, objeto o llamada definido anteriormente.
}
