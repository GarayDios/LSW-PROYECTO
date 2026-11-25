import { analyzeHistory } from '../05-indicadores-y-senales/signals.ts';
import { deriveObservedMarket } from '../01-analisis-tecnico/market-analysis.ts';
import { newsSentiment } from '../03-noticias-financieras/sentiment.ts';
import { knownBy, type CompanyResearch } from '../compartido/research-model.ts';
import type { StrategyId } from '../compartido/types.ts';
import { simulateMonteCarlo } from '../nucleo-cuantitativo/monte-carlo.ts';
import { strategyMonteCarloScenario } from './monte-carlo-scenario.ts';
import { analyzeStrategy, type AnalysisPolicy, type StrategyAnalysis } from './strategy-analysis.ts';
import { activeScannerCores, scannerSettingsSchema, type ScannerCoreId, type ScannerSettings } from './scanner-settings.ts';
import { equityTerms, modelDividendYield, valuationExpiry } from '../../features/research/contract-terms.ts';
import { blackScholes } from '../nucleo-cuantitativo/bsm.ts';
import { withFinviz, finvizInstitutional } from '../04-analisis-fundamental/finviz-data.ts';

export type ScannerCoreResult = { core: ScannerCoreId; score: number | null; weight: number; reason: string; direction?: number };
export type ScannerProjection = { spot: number; target: number; baseline: number; lower: number; upper: number; days: number; newsImpact: number; pnl: number | null; baselinePnl: number | null; pnlMethod: 'payoff' | 'diagonal' };
export type ScannerEvaluation = { score: number | null; results: ScannerCoreResult[]; available: number; missing: number; active: number; availableWeight: number; reason: string; sentiment: ReturnType<typeof newsSentiment>; projection: ScannerProjection | null; monteCarloPop: number | null };
const clamp = (n: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, n));

/** Only evaluable enabled cores enter the denominator. Missing is never zero. */
export function evaluateScanner(snapshot: CompanyResearch, strategy: StrategyId, days: number, config: ScannerSettings, policy: AnalysisPolicy = {}, existingAnalysis?: StrategyAnalysis): ScannerEvaluation {
  snapshot = withFinviz(snapshot, policy.finviz);
  const settings = scannerSettingsSchema.parse(config), selected = activeScannerCores(settings);
  const analysis = existingAnalysis ?? analyzeStrategy(snapshot, strategy, days, policy);
  const market = deriveObservedMarket(snapshot.symbol, snapshot.market.bars, snapshot.asOf);
  const history = analyzeHistory(market.bars, { rule: settings.rule });
  const point = history.indicators.at(-1), latest = history.latest;
  const sentiment = newsSentiment(snapshot.news, snapshot.asOf);
  let monteCarloPop: number | null = null;
  const results = selected.map((core): ScannerCoreResult => {
    const weight = settings.cores[core].weight;
    const missing = (reason: string): ScannerCoreResult => ({ core, weight, score: null, reason });
    const result = (score: number, reason: string, direction?: number): ScannerCoreResult => ({ core, weight, score: Math.round(clamp(score, 0, 100) * 100) / 100, reason, direction });
    if (core === 'news') return sentiment.score === null ? snapshot.news.complete && snapshot.news.status.status === 'ready'
      ? result(50, 'Consulta completa: no hay titulares recientes. Aporte neutral, sin inventar noticias.', 0)
      : missing(`No se pudo verificar la cobertura de noticias. ${snapshot.news.status.message}`)
      : result(strategy === 'gamma' ? 50 + Math.abs(sentiment.score) * 50 : 50 + sentiment.score * 50,
        `${sentiment.articles.length} titulares; ${sentiment.matched} con términos reconocidos; ${sentiment.earningsCount} de resultados. Semivida: 7 días. ${sentiment.complete ? 'Cobertura declarada completa.' : 'Cobertura parcial.'} Sentimiento por reglas, no probabilidad.`, sentiment.score);
    if (core === 'institutional') {
      const flow = snapshot.institutionalFlow;
      if (flow && knownBy(flow, snapshot.asOf) && flow.kind === 'observed' && Math.abs(flow.value!) <= 1
        && Date.parse(snapshot.asOf) - Date.parse(flow.observedAt!) <= 7 * 86400000
      ) return result(50 + flow.value! * 50, `Flujo neto normalizado de −1 a 1. Fuente: ${flow.source}.`, flow.value!);
      const transaction=finvizInstitutional(snapshot);
      if(transaction){
        const direction=Math.tanh(transaction.value!/.1);
        return result(50+direction*50,`Proxy Finviz: Inst Trans ${(transaction.value!*100).toFixed(2)}%, variación de participación institucional. Captura manual del usuario; no es flujo intradía ni PoP. Normalización heurística tanh(variación/10%).`,direction);
      }
      return missing(`Falta flujo neto observado o una captura reciente de Finviz «Inst Trans». «Inst Own» por sí solo no mide cambios. ${snapshot.finviz?.status.message??'En Finviz gratuito puedes copiar Inst Trans y cargarlo en el panel Finviz.'}`);
    }
    if (core === 'fundamental') {
      const f = snapshot.fundamentals;
      const fv=snapshot.finviz?.metrics, fvMargin=fv?.profitMargin;
      const margin=fvMargin&&knownBy(fvMargin,snapshot.asOf)?fvMargin:f.netMargin;
      const roe=fv?.roe, liquidity=fv?.currentRatio, debt=fv?.debtEquity;
      const components = [knownBy(margin, snapshot.asOf) ? clamp((margin.value! + .2) / .4, 0, 1) : null,
        knownBy(f.liabilitiesToAssets, snapshot.asOf) ? clamp(1 - f.liabilitiesToAssets.value!, 0, 1) : debt&&knownBy(debt,snapshot.asOf)&&debt.value!>=0?1/(1+debt.value!):null,
        roe&&knownBy(roe,snapshot.asOf)?clamp((roe.value!+.2)/.6,0,1):null,
        liquidity&&knownBy(liquidity,snapshot.asOf)&&liquidity.value!>=0?clamp(liquidity.value!/2,0,1):null].filter((n): n is number => n !== null);
      return components.length ? result(100 * components.reduce((sum, n) => sum + n, 0) / components.length, `Cobertura ${components.length}/4: margen [−20%,20%], solvencia, ROE [−20%,40%] y razón corriente [0,2], cuando existen. No se equiparan TTM y ejercicio fiscal. Fuentes: ${margin.source}; ${f.liabilitiesToAssets.source}${snapshot.finviz?'; Finviz manual declarado':''}.`)
        : missing(`Faltan métricas fundamentales publicadas. ${f.status.message}`);
    }
    if (core === 'monteCarlo') {
      const scenario = strategyMonteCarloScenario(snapshot, strategy, days, policy);
      if (!scenario.scenario) return missing(`${scenario.error} Monte Carlo necesita spot reciente, piernas compatibles y sus strikes/vencimientos, bid/ask e IV conocidos, multiplicador/entregable, tasa y dividendo. Si faltan cotizaciones, el modo estimado es una elección explícita; no rellena datos observados.`);
      try {
        const simulation = simulateMonteCarlo({ ...scenario.scenario.basis, paths: 2000, steps: 16, seed: 20261124, mode: 'terminal', hedgeFeePerShare: 0, hedgeSpreadBps: 0, stockBorrowRate: 0 });
        monteCarloPop = simulation.pnl.probabilityOfProfit;
        return result(monteCarloPop * 100, `PoP simulada neutral al riesgo: 2,000 trayectorias, semilla 20261124, comisiones de entrada incluidas. ${strategy === 'pmcc' ? 'Al vencer la call corta, la LEAPS conserva su valor temporal con IV constante. ' : strategy === 'gamma' ? 'Straddle sin cobertura dinámica. ' : ''}No es probabilidad real calibrada ni se ajusta con titulares.`);
      } catch (error) { return missing(`No se pudo simular: ${error instanceof RangeError ? error.message : 'entradas numéricas no compatibles con el modelo'}.`); }
    }
    if (market.stale) return missing('Histórico diario desactualizado respecto al corte.');
    if (core === 'own') return latest ? result(latest.action === 'buy' ? 80 : latest.action === 'sell' ? 20 : 50,
      `Regla ${settings.rule}: ${latest.reason}`, latest.action === 'buy' ? .6 : latest.action === 'sell' ? -.6 : 0) : missing('Se requieren al menos 50 velas diarias cerradas para la regla propia.');
    if (core === 'structure') {
      const support = history.structure.points.at(-1)?.support, resistance = history.structure.points.at(-1)?.resistance, spot = market.spot.value;
      if (spot === null || market.bars.length < 21) return missing('Se requieren 21 velas cerradas para analizar estructura. Se cargan antecedentes automáticamente cuando existen.');
      const prior = market.bars.slice(-21, -1), floor = support?.price ?? Math.min(...prior.map(b => b.low)), ceiling = resistance?.price ?? Math.max(...prior.map(b => b.high));
      if (ceiling <= floor) return result(50, 'Rango plano: estructura neutral, sin niveles de rebote confirmados.', 0);
      const direction = clamp(1 - 2 * (spot - floor) / (ceiling - floor));
      return result(50 + direction * 50, `${support ? 'Soporte confirmado' : 'Mínimo de las 20 sesiones previas (provisional)'} ${floor.toFixed(2)} / ${resistance ? 'resistencia confirmada' : 'máximo de las 20 sesiones previas (provisional)'} ${ceiling.toFixed(2)}. Los extremos provisionales no acreditan dos contactos.`, direction);
    }
    if (!point || point.smaFast === null || point.smaSlow === null || point.rsi === null || point.macdHistogram === null) return missing('Faltan velas cerradas para SMA20/50, RSI14 y MACD.');
    const direction = clamp((Math.sign(point.smaFast - point.smaSlow) + Math.sign(point.macdHistogram) + clamp((50 - point.rsi) / 50)) / 3);
    return result(strategy === 'gamma' ? 50 + Math.abs(direction) * 50 : 50 + direction * 50, `Media de sesgo SMA20/50, signo MACD y RSI14 (${point.rsi.toFixed(1)}).`, direction);
  });
  const available = results.filter(r => r.score !== null), availableWeight = available.reduce((sum, r) => sum + r.weight, 0);
  const score = availableWeight ? Math.round(available.reduce((sum, r) => sum + r.score! * r.weight, 0) / availableWeight * 100) / 100 : null;
  let projection: ScannerProjection | null = null;
  if (availableWeight && knownBy(snapshot.market.spot, snapshot.asOf) && knownBy(market.historicalVolatility, snapshot.asOf) && !market.stale && days > 0 && days <= 3650) {
    const horizon = analysis.status === 'available' ? analysis.horizonDays ?? days : days;
    const spot = snapshot.market.spot.value!, sigma = market.historicalVolatility.value! * Math.sqrt(horizon / 365);
    // A bounded, explicit sensitivity scenario. Historical candles stay untouched.
    const directional = available.reduce((sum, r) => sum + (r.direction ?? 0) * r.weight, 0) / availableWeight;
    const news = available.find(r => r.core === 'news');
    const newsDirection = (news?.direction ?? 0) * (news?.weight ?? 0) / availableWeight;
    const target = spot * Math.exp(clamp(directional * Math.min(sigma, 1) * .5, -.5, .5));
    const baseline = spot * Math.exp(clamp((directional - newsDirection) * Math.min(sigma, 1) * .5, -.5, .5));
    const pnlAt = (price: number) => {
      if (analysis.status !== 'available' || !analysis.scenarios.length) return null;
      if (strategy !== 'pmcc') {
        const payoff = analysis.legs.reduce((sum, leg) => {
          const terms = equityTerms(leg.contract, snapshot.asOf)!;
          return sum + leg.quantity * terms.shares * Math.max(0, leg.contract.type === 'call' ? price - terms.effectiveStrike : terms.effectiveStrike - price);
        }, 0);
        return payoff - analysis.entryDebit! - analysis.financingCost;
      }
      const rate = policy.riskFreeRate ?? snapshot.macro.riskFreeRate, q = modelDividendYield(snapshot, policy);
      if (!knownBy(rate, snapshot.asOf) || !knownBy(q, snapshot.asOf)) return null;
      const marked = analysis.legs.reduce((sum, leg) => {
        const terms = equityTerms(leg.contract, snapshot.asOf)!;
        const remaining = Math.max(0, (valuationExpiry(leg.contract, snapshot.asOf).time - Date.parse(snapshot.asOf)) / 86400000 - horizon);
        return sum + leg.quantity * terms.shares * blackScholes({ spot: price, strike: terms.effectiveStrike, days: remaining, volatility: leg.contract.impliedVolatility.value!, rate: rate.value!, dividendYield: q.value!, type: leg.contract.type }).price;
      }, 0);
      return marked - analysis.entryDebit! - analysis.financingCost;
    };
    projection = { spot, target, baseline, lower: target * Math.exp(-Math.min(1.645 * sigma, 3)), upper: target * Math.exp(Math.min(1.645 * sigma, 3)), days: Math.round(horizon * 10) / 10,
      newsImpact: target - baseline, pnl: pnlAt(target), baselinePnl: pnlAt(baseline), pnlMethod: strategy === 'pmcc' ? 'diagonal' : 'payoff' };
  }
  const reason = score === null ? 'No evaluable: ningún core activo dispone de datos suficientes.'
    : `Confluencia ${score}/100 · ${available.length}/${selected.length} cores evaluables. Media ponderada de los cores disponibles; no es probabilidad de éxito. ` + results.map(r => `${r.core}: ${r.score === null ? 'sin datos' : r.score + '/100'} (peso ${r.weight})`).join('; ');
  return { score, results, available: available.length, missing: selected.length - available.length, active: selected.length, availableWeight, reason, sentiment, projection, monteCarloPop };
}
