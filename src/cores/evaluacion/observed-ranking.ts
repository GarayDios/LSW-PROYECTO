import { analyzeStrategy, selectStrategyLegs, type AnalysisPolicy, type StrategyAnalysis } from './strategy-analysis.ts';
import { CORE_IDS, effectiveCores, type CoreId, type OptionInputs, type StrategyId } from '../compartido/types.ts';
import { knownBy, missingVariable, type CompanyResearch, type CoreEvidence, type ObservedCoreResult, type ObservedOptionContract, type ResearchVariable } from '../compartido/research-model.ts';
import { equityTerms, valuationExpiry,modelDividendYield,cashDividendPv } from '../../features/research/contract-terms.ts';
import { activeCoreWeight, coreWeight, evaluationTuning } from './evaluation-policy.ts';

export type ObservedInputOverrides = { dividendYield?: ResearchVariable; riskFreeRate?: ResearchVariable; contractSymbol?: string } & AnalysisPolicy;
export type ObservedRankedCompany = {
  symbol: string;
  score: number | null;
  reason: string;
  coreResults: ObservedCoreResult[];
  availableCoreCount: number;
  probabilityOfProfit: ResearchVariable;
  probabilityLabel: string;
  contractSymbol: string | null;
  strategyAnalysis: StrategyAnalysis;
};
const DAY = 86_400_000;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const settings = {
  wheel: { type: 'put' as const, side: 'sell' as const },
  pmcc: { type: 'call' as const, side: 'buy' as const },
  backspread: { type: 'call' as const, side: 'buy' as const },
  gamma: { type: 'call' as const, side: 'buy' as const },
};

/** Selects an existing contract. Neither strike nor premium is invented. */
export function selectObservedOption(snapshot: CompanyResearch, strategy: StrategyId, days: number, overrides: ObservedInputOverrides = {}): ObservedOptionContract | null {
  if (!(strategy in settings) || !Number.isFinite(days) || days <= 0) return null;
  let tuning;try {tuning=evaluationTuning(overrides.tuning);}catch{return null;}
  const structural = !overrides.contractSymbol ? selectStrategyLegs(snapshot,strategy,days,overrides)[0]?.contract : null;
  if (structural) return structural;
  const config = settings[strategy];
  const spot = snapshot.market.spot;
  if (!knownBy(spot, snapshot.asOf) || spot.value! <= 0) return null;
  const eligible = snapshot.options.contracts.filter(contract => contract.underlyingSymbol === snapshot.symbol && contract.type === config.type && knownBy(contract.strike, snapshot.asOf)
    && contract.strike.value! > 0 && Number.isFinite(Date.parse(contract.expiration))
    && valuationExpiry(contract,snapshot.asOf).time > Date.parse(snapshot.asOf)
    && (!overrides.contractSymbol || contract.symbol === overrides.contractSymbol));
  return eligible.sort((a, b) => {
    const quoted = (contract: ObservedOptionContract) => [contract.impliedVolatility, contract.premium, contract.bid, contract.ask].every(value => knownBy(value, snapshot.asOf));
    const distance = (contract: ObservedOptionContract) => tuning.tenorWeight*Math.abs((valuationExpiry(contract,snapshot.asOf).time - Date.parse(snapshot.asOf)) / DAY - days) / Math.max(days, 1)
      + Math.abs((equityTerms(contract,snapshot.asOf)?.effectiveStrike??contract.strike.value!) / spot.value! - 1) * tuning.strikeDistanceWeight;
    return Number(quoted(b)) - Number(quoted(a)) || distance(a) - distance(b) || a.symbol.localeCompare(b.symbol);
  })[0] ?? null;
}

export function observedOptionInputs(snapshot: CompanyResearch, contract: ObservedOptionContract | null, overrides: ObservedInputOverrides = {}): {
  input: OptionInputs | null; premium: number | null; missing: string[]; evidence: CoreEvidence[]; warnings: string[];
} {
  const missing: string[] = [];
  const warnings: string[] = [];
  const tuning=evaluationTuning(overrides.tuning);
  const terms=contract?equityTerms(contract,snapshot.asOf):null;
  const evidence: CoreEvidence[] = [
    { input: 'spot', variable: snapshot.market.spot },
    { input: 'strike', variable: contract?.strike ?? missingVariable('Alpaca contrato', 'No hay contrato observado seleccionado.') },
    { input: 'impliedVolatility', variable: contract?.impliedVolatility ?? missingVariable('Alpaca IV', 'No hay IV observada de un contrato.') },
    { input: 'riskFreeRate', variable: overrides.riskFreeRate ?? snapshot.macro.riskFreeRate },
    { input: 'dividendYield', variable: modelDividendYield(snapshot,overrides) },
    { input: 'premium', variable: contract?.premium ?? missingVariable('Alpaca prima media', 'No hay prima de contrato observada.') },
    { input: 'bid', variable: contract?.bid ?? missingVariable('Alpaca bid', 'No hay bid observado.') },
    { input: 'ask', variable: contract?.ask ?? missingVariable('Alpaca ask', 'No hay ask observado.') },
  ];
  for (const { input, variable } of evidence) if (!knownBy(variable, snapshot.asOf)) missing.push(input);
  if (!contract) missing.push('contract');
  if(!terms)missing.push('multiplicador y entregable de acciones verificados');
  if (contract && contract.underlyingSymbol !== snapshot.symbol) missing.push('contrato del subyacente correcto');
  if(contract?.premium.observedAt && Date.parse(snapshot.asOf)-Date.parse(contract.premium.observedAt)>tuning.quoteMaxAgeMinutes*60000)
    missing.push(`cotización de hasta ${tuning.quoteMaxAgeMinutes} minutos`);
  const values = Object.fromEntries(evidence.map(item => [item.input, item.variable.value])) as Record<string, number | null>;
  if (values.spot !== null && values.spot <= 0) missing.push('spot positivo');
  if (values.strike !== null && values.strike <= 0) missing.push('strike positivo');
  if (values.impliedVolatility !== null && values.impliedVolatility <= 0) missing.push('IV positiva');
  if (values.premium !== null && values.premium < 0) missing.push('prima no negativa');
  if (values.dividendYield !== null && values.dividendYield < 0) missing.push('q no negativo');
  if (values.bid !== null && values.ask !== null && (values.bid < 0 || values.ask <= 0 || values.bid > values.ask)) missing.push('spread válido');
  const remainingDays = contract ? (valuationExpiry(contract,snapshot.asOf).time - Date.parse(snapshot.asOf)) / DAY : NaN;
  if (!Number.isFinite(remainingDays) || remainingDays <= 0) missing.push('vencimiento futuro');
  if (snapshot.market.stale) missing.push('cierre reciente');
  // Daily close is not a live underlying quote; do not mix it with a later option session.
  if (contract?.premium.observedAt && snapshot.market.spot.observedAt
    && Math.abs(Date.parse(contract.premium.observedAt) - Date.parse(snapshot.market.spot.observedAt)) > (snapshot.market.spotBasis==='quote'?tuning.spotOptionSkewMinutes*60000:tuning.spotOptionGapDays * DAY)) missing.push('spot y opción dentro del desfase permitido');
  if (snapshot.options.feed === 'indicative') warnings.push('El feed indicative utiliza cotizaciones modificadas y retrasadas; es una estimación educativa.');
  if (contract?.style !== 'european') warnings.push('BSM europeo es una aproximación para este contrato americano o de estilo desconocido; no modela ejercicio anticipado.');
  if(contract)warnings.push(valuationExpiry(contract,snapshot.asOf).source);
  if(terms&&terms.multiplier!==terms.shares)warnings.push('Strike efectivo y prima por acción entregable ajustados con multiplicador/acciones. No son el strike ni la prima unitaria cotizados.');
  warnings.push(`${snapshot.market.spotBasis==='quote'?'Spot de punto medio de la acción':'Spot de cierre diario'}, prima media bid/ask y horizonte estimado; no son instrucciones de ejecución.`);
  return {
    input: missing.length ? null : { spot: Math.max(1e-8,values.spot!-(overrides.dividendModel==='declared-cash'?cashDividendPv(snapshot,valuationExpiry(contract!,snapshot.asOf).time,values.riskFreeRate!):0)), strike: terms!.effectiveStrike, days: remainingDays, volatility: values.impliedVolatility!,
      rate: values.riskFreeRate!, dividendYield: values.dividendYield!, type: contract!.type },
    premium: missing.length ? null : values.premium!*terms!.multiplier/terms!.shares, missing: [...new Set(missing)], evidence, warnings,
  };
}

/** Weighted screening heuristics (0..100), never a forecast of investing success. */
export function rankObservedCompanies(snapshots: readonly CompanyResearch[], selectedCores: readonly CoreId[], strategy: StrategyId, days: number, overrides: ObservedInputOverrides = {}): ObservedRankedCompany[] {
  const requested = [...new Set(selectedCores)];
  if (!requested.length || requested.some(id => !CORE_IDS.includes(id))) throw new RangeError('Selecciona al menos un núcleo válido.');
  const tuning=evaluationTuning(overrides.tuning);
  const selected=requested.filter(id=>coreWeight(tuning,id)>0);
  const totalWeight=activeCoreWeight(tuning,selected);
  if(!totalWeight)throw new RangeError('Asigna peso positivo a por lo menos un core seleccionado.');
  if (!(strategy in settings) || !Number.isFinite(days) || days <= 0 || days > 3650) throw new RangeError('Selecciona una estrategia y un plazo válidos.');
  return snapshots.map(snapshot => {
    const analysis = analyzeStrategy(snapshot, strategy, days, overrides);
    const contract = analysis.legs[0]?.contract ?? selectObservedOption(snapshot, strategy, days, overrides);
    const observed = observedOptionInputs(snapshot, contract, overrides);
    const strategyEvidence = [...observed.evidence.filter(e=>['spot','riskFreeRate','dividendYield'].includes(e.input)), ...analysis.legs.flatMap(l=>['strike','impliedVolatility','bid','ask','openInterest','multiplier','deliverableShares'].map(key=>({input:l.contract.symbol+'.'+key,variable:l.contract[key as 'strike'|'impliedVolatility'|'bid'|'ask'|'openInterest'|'multiplier'|'deliverableShares']!})))];
    const result = (core: CoreId, needed: [string, ResearchVariable][], calculate: () => number, reason: string): ObservedCoreResult => {
      const absent = needed.filter(([, value]) => !knownBy(value, snapshot.asOf)).map(([name]) => name);
      if (snapshot.market.stale) absent.push('histórico reciente');
      return absent.length ? { core, status: 'unavailable', score: null, reason: `Faltan datos verificables: ${absent.join(', ')}.`, evidence: needed.map(([input, variable]) => ({ input, variable })) }
        : { core, status: 'available', score: Math.round(clamp(calculate()) * 100), reason, evidence: needed.map(([input, variable]) => ({ input, variable })) };
    };
    const m = snapshot.market;
    const marketCores: Record<string, ObservedCoreResult> = {
      volatility: result('volatility', [['historicalVolatility', m.historicalVolatility]], () => {
        const hv = m.historicalVolatility.value!;
        const iv = analysis.legs[0]?.contract.impliedVolatility.value;
        if (iv && hv > 0) return strategy === 'wheel' || strategy === 'pmcc' ? iv / (iv + hv) : hv / (iv + hv);
        return strategy === 'wheel' || strategy === 'pmcc' ? 1 / (1 + hv) : hv / (1 + hv);
      }, 'Relación IV/HV cuando hay contrato: favorece prima relativa para venta y movimiento histórico relativo para compra. Sin IV solo describe HV; no estima ventaja futura.'),
      trend: result('trend', [['momentum20', m.momentum20], ['momentum60', m.momentum60]], () => strategy === 'gamma' ? clamp(tuning.trend20Coefficient*Math.abs(m.momentum20.value!) + tuning.trend60Coefficient*Math.abs(m.momentum60.value!)) : tuning.trendBase + tuning.trend20Coefficient * m.momentum20.value! + tuning.trend60Coefficient * m.momentum60.value!,
        `Tendencia retrospectiva: base ${tuning.trendBase}, coeficientes20/60 ${tuning.trend20Coefficient}/${tuning.trend60Coefficient}. Gamma usa magnitudes sin base. No anticipa movimientos.`),
      liquidity: analysis.legs.length ? {
        core: 'liquidity', status: 'available', score: Math.round(100 * Math.min(...analysis.legs.map(l => clamp(1 - (l.contract.ask.value! - l.contract.bid.value!) / Math.max(.01,l.contract.premium.value!))))),
        reason: 'Peor spread relativo entre todas las piernas. Consulta también OI; no garantiza ejecución.',
        evidence: analysis.legs.flatMap(l => [{input: l.contract.symbol + '.bid',variable:l.contract.bid},{input:l.contract.symbol + '.ask',variable:l.contract.ask},{input:l.contract.symbol + '.openInterest',variable:l.contract.openInterest}]),
      } : result('liquidity', [['averageDollarVolume20', m.averageDollarVolume20]], () => (Math.log10(Math.max(1, m.averageDollarVolume20.value!)) - 5) / 4,
        'Solo liquidez accionaria; faltan opciones para evaluar sus spreads.'),
      risk: result('risk', [['maxDrawdown', m.maxDrawdown], ['downsideVolatility', m.downsideVolatility]], () => Math.min(1 - tuning.riskDrawdownWeight * m.maxDrawdown.value! - (1-tuning.riskDrawdownWeight) * Math.min(1, m.downsideVolatility.value!), overrides.capital && analysis.maxLoss !== null ? clamp(1-analysis.maxLoss/overrides.capital) : 1),
        `Riesgo: pesos drawdown/bajista ${tuning.riskDrawdownWeight}/${1-tuning.riskDrawdownWeight}; limitado también por capital restante tras pérdida máxima determinada. Un máximo desconocido no significa riesgo cero.`),
    };
    const coreResults = selected.map((core): ObservedCoreResult => {
      if (marketCores[core]) return marketCores[core];
      if (analysis.status !== 'available' || core === 'probability' && analysis.probability === null) return {
        core, status: 'unavailable', score: null,
        reason: `${analysis.missing.length ? `Faltan entradas de la estrategia: ${analysis.missing.join('; ')}.` : analysis.probabilityMethod} ${overrides.modelMode==='estimated'?'Modo estimado: requiere contratos verificables y supuestos explícitos; revisa los faltantes indicados.':'No se usa HV como IV ni q=0 implícito.'}`,
        evidence: strategyEvidence,
      };
      const scale = Math.max(1, Math.abs(analysis.entryDebit!), analysis.capitalRequired!);
      const modeledQuotes=analysis.legs.some(l=>l.contract.bid.kind==='assumed'||l.contract.ask.kind==='assumed'||l.contract.impliedVolatility.source.startsWith('IV calculada de bid/ask'));
      const score = core === 'bsm' ? modeledQuotes?.5:1 - Math.abs(analysis.theoreticalDebit! - analysis.entryDebit!) / scale
        : core === 'greeks' ? strategy === 'gamma' ? Math.abs(analysis.netGamma!) * snapshot.market.spot.value! / (analysis.deliverableShares! + Math.abs(analysis.netGamma!) * snapshot.market.spot.value!)
          : 1 / (1 + Math.abs(analysis.netDelta!) * snapshot.market.spot.value! / Math.max(1,analysis.capitalRequired!))
        : analysis.probability!;
      const label = core === 'bsm' ? modeledQuotes?'Valor neutral 50/100: primas reconstruidas o IV calibrada a estas cotizaciones; la coincidencia con el modelo no demuestra una oportunidad de mercado.':'Cercanía del valor teórico conjunto al coste bid/ask; no es beneficio esperado.'
        : core === 'greeks' ? 'Sensibilidad conjunta: Gamma positiva para cobertura; exposición delta relativa al capital para las otras estrategias. Sin delta objetivo fija.'
        : `${analysis.probabilityMethod} Wheel representa una pierna, no el ciclo futuro; excluye comisiones de salida y asignación anticipada.`;
      return { core, status: 'available', score: Math.round(clamp(score) * 100), reason: `${label} ${analysis.warnings.join(' ')}`, evidence: strategyEvidence };

    });
    const available = coreResults.filter(core => core.score !== null);
    const score = available.length === selected.length ? Math.round(available.reduce((sum, core) => sum + core.score!*coreWeight(tuning,core.core), 0) / totalWeight) : null;
    const probabilityOfProfit: ResearchVariable = analysis.probability !== null && analysis.status === 'available' ? { value: analysis.probability, source: analysis.probabilityMethod,
      observedAt: snapshot.asOf, availableAt: snapshot.asOf, kind: 'estimated', reason: analysis.warnings.join(' ') }
      : missingVariable('BSM europeo · medida neutral al riesgo', `Entradas incompletas: ${analysis.missing.join(', ')}. ${analysis.probabilityMethod}`);
    return { symbol: snapshot.symbol, score, coreResults, availableCoreCount: available.length,
      reason: score === null ? `${analysis.dataMode==='estimated'?'ESTIMADO · ':''}${available.length}/${selected.length} núcleos disponibles; la puntuación total espera todas las entradas seleccionadas. ${analysis.missing.join(', ')}`
        : `${analysis.status!=='available'?'PERFIL HISTÓRICO DE LA ACCIÓN; estrategia de opciones incompleta. ':''}${analysis.dataMode==='estimated'?'ESTIMADO · ':''}Media ponderada de los núcleos con peso positivo, escala 0–100. Es una heurística de selección, no una probabilidad de éxito. ${coreResults.map(c=>c.core+': '+c.score+' (peso '+coreWeight(tuning,c.core)+')').join('; ')}`,
      probabilityOfProfit, probabilityLabel: strategy === 'wheel' ? 'Probabilidad teórica de una pierna: put inicial; no ciclo Wheel' : analysis.probabilityMethod, contractSymbol: analysis.legs[0]?.contract.symbol ?? contract?.symbol ?? null, strategyAnalysis: analysis };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.symbol.localeCompare(b.symbol));
}
