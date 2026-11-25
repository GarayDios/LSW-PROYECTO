// Ranking determinista anterior sobre empresas de demostración y contratos teóricos. Los objetivos y pesos
// son ilustrativos; no representan operaciones observadas ni rentabilidad pronosticada.

// Importa tipos compartidos para verificar las estructuras de datos; no ejecuta cálculos en tiempo de
// ejecución.
import type { Company } from '../../features/market/data.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { blackScholes } from '../nucleo-cuantitativo/bsm.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { bsmCore, greeksCore, probabilityCore } from './quantitative-criteria.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { liquidityCore } from '../01-analisis-tecnico/liquidity.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { clamp, proximity } from '../nucleo-cuantitativo/math.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { profitMetrics } from '../nucleo-cuantitativo/probability.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { riskCore } from '../06-gestion-de-riesgos/scoring.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { trendCore } from '../01-analisis-tecnico/trend.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { CORE_IDS, effectiveCores, type CoreContext, type CoreId, type OptionInputs, type RankedCompany, type ScreeningCore, type StrategyId } from '../compartido/types.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { volatilityCore } from '../01-analisis-tecnico/volatility.ts';

// Relaciona identificadores del ranking anterior con sus funciones de puntuación y explicación.
const screeningCores: Record<CoreId, ScreeningCore> = {
  // Asocia el criterio BSM con su implementación ilustrativa.
  bsm: bsmCore,
  // Asocia griegas con su criterio ilustrativo.
  greeks: greeksCore,
  // Asocia probabilidad con su criterio ilustrativo.
  probability: probabilityCore,
  // Asocia volatilidad con su criterio de demostración.
  volatility: volatilityCore,
  // Asocia tendencia con el proxy del cambio de muestra.
  trend: trendCore,
  // Asocia liquidez con volumen y datos de muestra.
  liquidity: liquidityCore,
  // Asocia riesgo con el criterio heurístico correspondiente.
  risk: riskCore,
// Cierra el bloque, objeto o llamada definido anteriormente.
};

// Ordena el universo de demostración con criterios de igual peso y contratos teóricos; no utiliza una cadena
// observada.
export function rankCompanies(universe: readonly Company[], selectedCores: readonly CoreId[], strategy: StrategyId, days: number, rate = .045): RankedCompany[] {
  // Deduplica los criterios solicitados.
  const chosen = [...new Set(selectedCores)];
  // Exige selección no vacía e identificadores del catálogo anterior.
  if (!chosen.length || chosen.some(core => !CORE_IDS.includes(core))) throw new RangeError('Selecciona al menos un núcleo F0 válido.');
  // Valida estrategia y plazo de 1 a 3650 días.
  if (!['wheel', 'pmcc', 'backspread', 'gamma'].includes(strategy) || !Number.isFinite(days) || days <= 0 || days > 3650) throw new RangeError('Selecciona una estrategia y un plazo de 1 a 3650 días.');
  // Exige tasa finita, sin fijar aquí una tasa real de mercado.
  if (!Number.isFinite(rate)) throw new RangeError('La tasa libre de riesgo debe ser finita.');
  // Elige objetivos ilustrativos de strike, IV, plazo, delta y prima por estrategia.
  const settings = {
    // Wheel usa put vendida con strike 94% del spot y objetivos de muestra; esos valores no se han optimizado
    // automáticamente.
    wheel: { strike: .94, targetIv: .31, targetDays: 35, targetDelta: .28, targetYield: .017, type: 'put' as const, side: 'sell' as const },
    // PMCC usa una call teórica de referencia; no reproduce por sí sola la diagonal de dos contratos.
    pmcc: { strike: .85, targetIv: .27, targetDays: 60, targetDelta: .80, targetYield: .18, type: 'call' as const, side: 'buy' as const },
    // Backspread usa una call de referencia para los criterios de muestra, no el P/L conjunto −1/+2.
    backspread: { strike: 1.05, targetIv: .50, targetDays: 60, targetDelta: .40, targetYield: .035, type: 'call' as const, side: 'buy' as const },
    // Gamma usa una call de referencia de demostración, distinta de un straddle gestionado con coberturas.
    gamma: { strike: 1, targetIv: .43, targetDays: 14, targetDelta: .52, targetYield: .045, type: 'call' as const, side: 'buy' as const },
  // Selecciona los objetivos correspondientes a la estrategia solicitada.
  }[strategy];
  // Calcula componentes de demostración para cada empresa recibida.
  return universe.map(company => {
    // Construye strike y entradas teóricas desde el precio y datos ilustrativos de la empresa.
    const input: OptionInputs = { spot: company.price, strike: company.price * settings.strike, days, volatility: company.iv, rate, dividendYield: company.dividendYield, type: settings.type };
    // Valora la opción teórica con BSM.
    const value = blackScholes(input);
    // Calcula beneficio/probabilidad de esa pierna usando su prima teórica.
    const terminal = profitMetrics({ ...input, premium: value.price, side: settings.side });
    // Construye el contexto común para los criterios de muestra.
    const context: CoreContext = {
      // Incluye empresa, estrategia, horizonte, objetivos y valoración BSM.
      company, strategy, days, settings, value,
      // Conserva PoP neutral al riesgo de la pierna individual.
      probabilityOfProfit: terminal.probabilityOfProfit,
      // Mide cercanía del plazo al objetivo ilustrativo.
      tenor: proximity(days, settings.targetDays, settings.targetDays * 1.5),
      // Normaliza la liquidez de muestra de 0–100 a [0,1].
      liquidity: clamp(company.liquidity / 100),
      // Mide cercanía de IV al objetivo con tolerancia 0.20.
      ivFit: proximity(company.iv, settings.targetIv, .20),
    // Cierra el bloque, objeto o llamada definido anteriormente.
    };
    // Evalúa los criterios del catálogo con el mismo contexto teórico.
    const components = Object.fromEntries(CORE_IDS.map(core => [core, screeningCores[core].score(context)])) as Record<CoreId, number>;
    // Promedia solo los criterios elegidos, todos con igual peso, y redondea a la escala 0–100.
    const score = Math.round(clamp(chosen.reduce((sum, core) => sum + components[core], 0) / chosen.length) * 100);
    // Une los motivos de esos criterios en una explicación visible.
    const reason = CORE_IDS.filter(core => chosen.includes(core)).map(core => screeningCores[core].reason(context)).join(' · ');
    // Devuelve la empresa junto a su puntuación y razón.
    return { ...company, score, reason };
  // Ordena por puntuación, después liquidez y símbolo para resolver empates de manera estable.
  }).sort((a, b) => b.score - a.score || b.liquidity - a.liquidity || a.symbol.localeCompare(b.symbol));
// Cierra el bloque, objeto o llamada definido anteriormente.
}
