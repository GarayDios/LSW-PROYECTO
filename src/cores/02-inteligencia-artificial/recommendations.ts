import { analyzeStrategy } from '../evaluacion/strategy-analysis.ts';
import type { StrategyId } from '../compartido/types.ts';
import { strategies } from '../../features/strategies/catalog.ts';
import { analysisPolicy, type AnalysisSettings } from '../../features/research/analysis-settings.ts';
import type { CompanyResearch } from '../compartido/research-model.ts';
import type { MarketForecast } from './forecast.ts';
import { investorPreferencesSchema, type InvestorPreferences } from './preferences.ts';

export type PersonalizedAlternative = {
  strategy: StrategyId; title: string; eligible: boolean; score: number | null;
  capitalRequired: number | null; maxLoss: number | null;
  reasons: string[];
};
export type PersonalizedRecommendation = {
  action: 'review' | 'wait'; title: string; reason: string;
  best: PersonalizedAlternative | null; alternatives: PersonalizedAlternative[];
  capitalLimit: number; lossLimit: number;
};

/** Suitability optimization over one quoted structure per strategy, not predicted option P&L.
 * Hard constraints cannot be compensated by a higher score. "Wait" is always available.
 */
export function recommendForPreferences(input: {
  preferences: InvestorPreferences; forecast: MarketForecast; research: CompanyResearch | null;
  settings: AnalysisSettings;
}): PersonalizedRecommendation {
  const parsed = investorPreferencesSchema.safeParse(input.preferences);
  const waiting = (reason: string, alternatives: PersonalizedAlternative[] = [], capitalLimit = 0, lossLimit = 0): PersonalizedRecommendation =>
    ({ action: 'wait', title: 'Esperar antes de abrir una operación', reason, best: null, alternatives, capitalLimit, lossLimit });
  if (!parsed.success) return waiting('Revisa el capital y los límites de tus preferencias.');
  const p = parsed.data;
  const capitalLimit = p.capital * p.maxAllocationPercent / 100;
  const lossLimit = p.capital * p.maxLossPercent / 100;
  const { research, forecast } = input;
  if (!research || forecast.status !== 'available') return waiting(forecast.reason || 'Faltan datos observados para evaluar alternativas.', [], capitalLimit, lossLimit);
  const lastBar = research.market.bars.at(-1);
  const lastTime = lastBar?.time;
  if (forecast.symbol !== research.symbol || forecast.asOf !== research.asOf || forecast.horizonSessions !== p.horizonSessions
    || lastTime === undefined || !Number.isFinite(new Date(lastTime).getTime())
    || forecast.lastCloseAt !== new Date(lastTime).toISOString() || forecast.lastClose !== lastBar?.close) {
    return waiting('El pronóstico y la empresa deben compartir corte, horizonte y último cierre.', [], capitalLimit, lossLimit);
  }
  const desiredDays = p.horizonSessions * 365 / 252;
  const policy = { ...analysisPolicy(input.settings, research), capital: capitalLimit };
  const objectiveFit: Record<InvestorPreferences['objective'], Record<StrategyId, number>> = {
    preservation: { wheel: .65, pmcc: .35, backspread: .25, gamma: .1 },
    income: { wheel: 1, pmcc: .85, backspread: .1, gamma: 0 },
    growth: { wheel: .35, pmcc: .75, backspread: 1, gamma: .6 },
  };
  const riskWeight = { low: .6, medium: .4, high: .2 }[p.riskTolerance];
  const alternatives = strategies.map(strategy => {
    const analysis = analyzeStrategy(research, strategy.id, desiredDays, policy);
    const reasons: string[] = [];
    if (!p.allowedStrategies.includes(strategy.id)) reasons.push('Desactivada en tus preferencias.');
    if (p.experience === 'learning') reasons.push('El perfil de aprendizaje requiere comprender asignaciones y estructuras antes de abrir opciones.');
    if (strategy.id === 'gamma') reasons.push('Gamma requiere un modelo de coberturas y costes por trayectoria; el pronóstico de cierres no lo sustituye.');
    if (strategy.id === 'pmcc' && p.experience !== 'advanced') reasons.push('La diagonal PMCC requiere experiencia avanzada.');
    if (strategy.id === 'pmcc' && p.monitoring !== 'daily') reasons.push('PMCC requiere seguimiento diario en este perfil.');
    if (analysis.status !== 'available') reasons.push(...analysis.missing);
    if (analysis.dataMode !== 'observed') reasons.push('Las primas reconstruidas con supuestos no habilitan una recomendación.');
    if (research.options.feed !== 'opra') reasons.push('Se requieren cotizaciones OPRA; el feed indicative conserva uso exploratorio.');
    if (analysis.capitalRequired === null || analysis.capitalRequired > capitalLimit) reasons.push('El capital requerido supera la asignación permitida o no se pudo verificar.');
    if (analysis.maxLoss === null) reasons.push('No se pudo acotar la pérdida máxima de esta estructura.');
    else if (analysis.maxLoss > lossLimit) reasons.push('La pérdida máxima supera el límite que elegiste.');
    if (analysis.horizonDays === null || Math.abs(analysis.horizonDays - desiredDays) > Math.max(7, desiredDays * .25)) reasons.push('No hay una estructura con plazo cercano a tu horizonte.');
    // A price forecast is directional context only, never a strategy profit probability.
    const projectedSpot = forecast.expectedReturn !== null && forecast.lastClose !== null
      ? forecast.lastClose * (1 + forecast.expectedReturn) : NaN;
    if (!Number.isFinite(projectedSpot) || research.market.spot.value === null || projectedSpot <= research.market.spot.value) {
      reasons.push('El precio proyectado desde el último cierre no supera el precio observado; no respalda una nueva estructura alcista.');
    }
    const eligible = reasons.length === 0;
    const remainingRisk = analysis.maxLoss === null || lossLimit <= 0 ? 0 : Math.max(0, 1 - analysis.maxLoss / lossLimit);
    const remainingCapital = analysis.capitalRequired === null || capitalLimit <= 0 ? 0 : Math.max(0, 1 - analysis.capitalRequired / capitalLimit);
    const score = eligible ? Math.round(100 * (riskWeight * remainingRisk
      + (1 - riskWeight) * (.8 * objectiveFit[p.objective][strategy.id] + .2 * remainingCapital))) : null;
    return { strategy: strategy.id, title: strategy.title, eligible, score,
      capitalRequired: analysis.capitalRequired, maxLoss: analysis.maxLoss,
      reasons: eligible ? [`Encaja con tu objetivo de ${p.objective === 'income' ? 'ingresos' : p.objective === 'growth' ? 'crecimiento' : 'preservación'}.`,
        'Una estructura respeta tus límites de capital y pérdida máxima del modelo.'] : [...new Set(reasons)] };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.strategy.localeCompare(b.strategy));
  if (!forecast.validation.passed) return waiting('El modelo todavía no demuestra mejora frente a las referencias históricas. Puedes revisar compatibilidad, pero no se propone abrir una operación.', alternatives, capitalLimit, lossLimit);
  const best = alternatives.find(alternative => alternative.eligible) ?? null;
  if (!best) return waiting('Ninguna alternativa evaluada respeta todas tus preferencias y requisitos de datos.', alternatives, capitalLimit, lossLimit);
  return { action: 'review', title: `Revisar ${best.title}`, best, alternatives, capitalLimit, lossLimit,
    reason: 'Es el mejor ajuste a tus preferencias entre las estructuras evaluadas. El puntaje no representa rentabilidad esperada ni probabilidad de éxito; revisa contratos y riesgos antes de confirmar.' };
}
