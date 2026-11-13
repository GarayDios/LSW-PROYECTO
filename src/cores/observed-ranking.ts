import { blackScholes } from './bsm.ts';
import { profitMetrics } from './probability.ts';
import { CORE_IDS, type CoreId, type OptionInputs, type StrategyId } from './types.ts';
import { knownBy, missingVariable, type CompanyResearch, type CoreEvidence, type ObservedCoreResult, type ObservedOptionContract, type ResearchVariable } from '../features/research/model.ts';

export type ObservedInputOverrides = { dividendYield?: ResearchVariable; riskFreeRate?: ResearchVariable; contractSymbol?: string };
export type ObservedRankedCompany = {
  symbol: string;
  score: number | null;
  reason: string;
  coreResults: ObservedCoreResult[];
  availableCoreCount: number;
  probabilityOfProfit: ResearchVariable;
  probabilityLabel: string;
  contractSymbol: string | null;
};
const DAY = 86_400_000;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const settings = {
  wheel: { strike: .94, type: 'put' as const, side: 'sell' as const, delta: .28, hv: .28 },
  pmcc: { strike: .85, type: 'call' as const, side: 'buy' as const, delta: .8, hv: .27 },
  backspread: { strike: 1.05, type: 'call' as const, side: 'buy' as const, delta: .4, hv: .5 },
  gamma: { strike: 1, type: 'call' as const, side: 'buy' as const, delta: .52, hv: .43 },
};

/** Selects an existing contract. Neither strike nor premium is invented. */
export function selectObservedOption(snapshot: CompanyResearch, strategy: StrategyId, days: number, overrides: ObservedInputOverrides = {}): ObservedOptionContract | null {
  if (!(strategy in settings) || !Number.isFinite(days) || days <= 0) return null;
  const config = settings[strategy];
  const spot = snapshot.market.spot;
  if (!knownBy(spot, snapshot.asOf) || spot.value! <= 0) return null;
  const eligible = snapshot.options.contracts.filter(contract => contract.underlyingSymbol === snapshot.symbol && contract.type === config.type && knownBy(contract.strike, snapshot.asOf)
    && contract.strike.value! > 0 && Number.isFinite(Date.parse(contract.expiration))
    && Date.parse(`${contract.expiration}T21:00:00Z`) > Date.parse(snapshot.asOf)
    && (!overrides.contractSymbol || contract.symbol === overrides.contractSymbol));
  return eligible.sort((a, b) => {
    const quoted = (contract: ObservedOptionContract) => [contract.impliedVolatility, contract.premium, contract.bid, contract.ask].every(value => knownBy(value, snapshot.asOf));
    const distance = (contract: ObservedOptionContract) => Math.abs((Date.parse(`${contract.expiration}T21:00:00Z`) - Date.parse(snapshot.asOf)) / DAY - days) / Math.max(days, 1)
      + Math.abs(contract.strike.value! / spot.value! - config.strike) * 3;
    return Number(quoted(b)) - Number(quoted(a)) || distance(a) - distance(b) || a.symbol.localeCompare(b.symbol);
  })[0] ?? null;
}

export function observedOptionInputs(snapshot: CompanyResearch, contract: ObservedOptionContract | null, overrides: ObservedInputOverrides = {}): {
  input: OptionInputs | null; premium: number | null; missing: string[]; evidence: CoreEvidence[]; warnings: string[];
} {
  const missing: string[] = [];
  const warnings: string[] = [];
  const evidence: CoreEvidence[] = [
    { input: 'spot', variable: snapshot.market.spot },
    { input: 'strike', variable: contract?.strike ?? missingVariable('Alpaca contrato', 'No hay contrato observado seleccionado.') },
    { input: 'impliedVolatility', variable: contract?.impliedVolatility ?? missingVariable('Alpaca IV', 'No hay IV observada de un contrato.') },
    { input: 'riskFreeRate', variable: overrides.riskFreeRate ?? snapshot.macro.riskFreeRate },
    { input: 'dividendYield', variable: overrides.dividendYield ?? snapshot.fundamentals.dividendYield },
    { input: 'premium', variable: contract?.premium ?? missingVariable('Alpaca prima media', 'No hay prima de contrato observada.') },
    { input: 'bid', variable: contract?.bid ?? missingVariable('Alpaca bid', 'No hay bid observado.') },
    { input: 'ask', variable: contract?.ask ?? missingVariable('Alpaca ask', 'No hay ask observado.') },
  ];
  for (const { input, variable } of evidence) if (!knownBy(variable, snapshot.asOf)) missing.push(input);
  if (!contract) missing.push('contract');
  if (contract && contract.underlyingSymbol !== snapshot.symbol) missing.push('contrato del subyacente correcto');
  const values = Object.fromEntries(evidence.map(item => [item.input, item.variable.value])) as Record<string, number | null>;
  if (values.spot !== null && values.spot <= 0) missing.push('spot positivo');
  if (values.strike !== null && values.strike <= 0) missing.push('strike positivo');
  if (values.impliedVolatility !== null && values.impliedVolatility <= 0) missing.push('IV positiva');
  if (values.premium !== null && values.premium < 0) missing.push('prima no negativa');
  if (values.dividendYield !== null && values.dividendYield < 0) missing.push('q no negativo');
  if (values.bid !== null && values.ask !== null && (values.bid < 0 || values.ask <= 0 || values.bid > values.ask)) missing.push('spread válido');
  const remainingDays = contract ? (Date.parse(`${contract.expiration}T21:00:00Z`) - Date.parse(snapshot.asOf)) / DAY : NaN;
  if (!Number.isFinite(remainingDays) || remainingDays <= 0) missing.push('vencimiento futuro');
  if (snapshot.market.stale) missing.push('cierre reciente');
  // Daily close is not a live underlying quote; do not mix it with a later option session.
  if (contract?.premium.observedAt && snapshot.market.spot.observedAt
    && Date.parse(contract.premium.observedAt) - Date.parse(snapshot.market.spot.observedAt) > 4 * DAY) missing.push('spot y opción de sesiones próximas');
  if (snapshot.options.feed === 'indicative') warnings.push('El feed indicative utiliza cotizaciones modificadas y retrasadas; es una estimación educativa.');
  if (contract?.style !== 'european') warnings.push('BSM europeo es una aproximación para este contrato americano o de estilo desconocido; no modela ejercicio anticipado.');
  warnings.push('Spot de cierre diario, prima media bid/ask y vencimiento a las 21:00 UTC aproximado; no son instrucciones de ejecución.');
  return {
    input: missing.length ? null : { spot: values.spot!, strike: values.strike!, days: remainingDays, volatility: values.impliedVolatility!,
      rate: values.riskFreeRate!, dividendYield: values.dividendYield!, type: contract!.type },
    premium: missing.length ? null : values.premium, missing: [...new Set(missing)], evidence, warnings,
  };
}

/** Equal-weight screening heuristics (0..100), never a forecast/probability of investing success. */
export function rankObservedCompanies(snapshots: readonly CompanyResearch[], selectedCores: readonly CoreId[], strategy: StrategyId, days: number, overrides: ObservedInputOverrides = {}): ObservedRankedCompany[] {
  const selected = [...new Set(selectedCores)];
  if (!selected.length || selected.some(id => !CORE_IDS.includes(id))) throw new RangeError('Selecciona al menos un núcleo válido.');
  if (!(strategy in settings) || !Number.isFinite(days) || days <= 0 || days > 3650) throw new RangeError('Selecciona una estrategia y un plazo válidos.');
  const config = settings[strategy];
  return snapshots.map(snapshot => {
    const contract = selectObservedOption(snapshot, strategy, days, overrides);
    const observed = observedOptionInputs(snapshot, contract, overrides);
    const terminal = observed.input && observed.premium !== null ? profitMetrics({ ...observed.input, premium: observed.premium, side: config.side }) : null;
    const optionValue = observed.input ? blackScholes(observed.input) : null;
    const result = (core: CoreId, needed: [string, ResearchVariable][], calculate: () => number, reason: string): ObservedCoreResult => {
      const absent = needed.filter(([, value]) => !knownBy(value, snapshot.asOf)).map(([name]) => name);
      if (snapshot.market.stale) absent.push('histórico reciente');
      return absent.length ? { core, status: 'unavailable', score: null, reason: `Faltan datos verificables: ${absent.join(', ')}.`, evidence: needed.map(([input, variable]) => ({ input, variable })) }
        : { core, status: 'available', score: Math.round(clamp(calculate()) * 100), reason, evidence: needed.map(([input, variable]) => ({ input, variable })) };
    };
    const m = snapshot.market;
    const marketCores: Record<string, ObservedCoreResult> = {
      volatility: result('volatility', [['historicalVolatility', m.historicalVolatility]], () => 1 - Math.abs(m.historicalVolatility.value! - config.hv) / .5,
        `Afinidad HV objetivo ${(config.hv * 100).toFixed(0)}%: 1 − |HV − objetivo| / 0.50. HV histórica no es IV.`),
      trend: result('trend', [['momentum20', m.momentum20], ['momentum60', m.momentum60]], () => .5 + 1.5 * m.momentum20.value! + .75 * m.momentum60.value!,
        'Tendencia = 0.5 + 1.5 × retorno20 + 0.75 × retorno60; acotada entre 0 y 1. Es retrospectiva.'),
      liquidity: result('liquidity', [['averageDollarVolume20', m.averageDollarVolume20]], () => (Math.log10(Math.max(1, m.averageDollarVolume20.value!)) - 5) / 4,
        'Liquidez accionaria = (log10(volumen USD medio20) − 5) / 4; acotada entre 0 y 1. No estima liquidez de opciones ni todo el mercado si el feed es IEX.'),
      risk: result('risk', [['maxDrawdown', m.maxDrawdown], ['downsideVolatility', m.downsideVolatility]], () => 1 - .6 * m.maxDrawdown.value! - .4 * Math.min(1, m.downsideVolatility.value!),
        'Riesgo retrospectivo = 1 − 0.6 × drawdown − 0.4 × min(1, volatilidad bajista); acotado entre 0 y 1.'),
    };
    const coreResults = selected.map((core): ObservedCoreResult => {
      if (marketCores[core]) return marketCores[core];
      if (!observed.input || observed.premium === null || !optionValue || !terminal) return {
        core, status: 'unavailable', score: null, reason: `Faltan entradas de un contrato observado: ${observed.missing.join(', ')}. No se usa HV como IV ni q=0 implícito.`, evidence: observed.evidence,
      };
      const score = core === 'bsm' ? 1 - Math.abs(optionValue.price - observed.premium) / Math.max(snapshot.market.spot.value! * .1, observed.premium)
        : core === 'greeks' ? 1 - Math.abs(Math.abs(optionValue.delta) - config.delta)
          : terminal.probabilityOfProfit;
      const label = core === 'bsm' ? 'Afinidad entre prima BSM europea y prima media observada; no indica beneficio esperado.'
        : core === 'greeks' ? `Afinidad de |delta BSM| al objetivo ${config.delta}; no equivale a probabilidad de éxito.`
          : 'Probabilidad terminal teórica neutral al riesgo de una sola pierna; excluye comisiones, ejercicio anticipado y conjunto de la estrategia.';
      return { core, status: 'available', score: Math.round(clamp(score) * 100), reason: `${label} ${observed.warnings.join(' ')}`, evidence: observed.evidence };
    });
    const available = coreResults.filter(core => core.score !== null);
    const score = available.length === selected.length ? Math.round(available.reduce((sum, core) => sum + core.score!, 0) / selected.length) : null;
    const probabilityOfProfit: ResearchVariable = terminal ? { value: terminal.probabilityOfProfit, source: 'BSM europeo · medida neutral al riesgo · una pierna',
      observedAt: snapshot.asOf, availableAt: snapshot.asOf, kind: 'estimated', reason: observed.warnings.join(' ') }
      : missingVariable('BSM europeo · medida neutral al riesgo', `Entradas incompletas: ${observed.missing.join(', ')}.`);
    return { symbol: snapshot.symbol, score, coreResults, availableCoreCount: available.length,
      reason: score === null ? `${available.length}/${selected.length} núcleos disponibles; la puntuación total espera todas las entradas seleccionadas.`
        : 'Media aritmética de los núcleos seleccionados, escala 0–100. Es una heurística de selección, no una probabilidad de éxito.',
      probabilityOfProfit, probabilityLabel: 'Probabilidad teórica neutral al riesgo de una pierna (no predicción de rentabilidad)', contractSymbol: contract?.symbol ?? null };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.symbol.localeCompare(b.symbol));
}
