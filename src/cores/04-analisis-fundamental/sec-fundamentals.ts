import { missingVariable, type ResearchFundamentals, type ResearchVariable } from '../compartido/research-model.ts';
import { numeric, record, timestamp } from '../compartido/data-values.ts';
import { emptyFundamentalAnalysis, fundamentalCoverage } from './fundamental-metrics.ts';

const SOURCE = 'SEC EDGAR Company Facts';
const DAY = 86_400_000;

export function missingFundamentals(message = 'Configura SEC_USER_AGENT con nombre de aplicación y contacto en el servidor.'): ResearchFundamentals {
  const missing = (label: string) => missingVariable(`${SOURCE} · ${label}`, message);
  return {
    cik: null, companyName: null, annualRevenue: missing('ingresos anuales'), annualNetIncome: missing('resultado neto anual'),
    assets: missing('activos'), liabilities: missing('pasivos'), cash: missing('efectivo'), sharesOutstanding: missing('acciones'),
    netMargin: missing('margen neto'), liabilitiesToAssets: missing('pasivos/activos'),
    analysis: emptyFundamentalAnalysis(message),
    dividendYield: missingVariable('Dividendo futuro continuo q', 'Los pagos pasados no determinan el dividendo futuro continuo; se requiere una fuente prospectiva o un supuesto manual explícito.'),
    status: { source: SOURCE, status: 'missing_config', message }, warnings: [],
  };
}

type SecFact = { variable: ResearchVariable; start: string | null; end: string; filed: string };

/** Filing-day fallback: next day 05:00 UTC is after the full EDGAR Eastern calendar day. */
function conservativeFiledAt(filed: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(filed) && Number.isFinite(Date.parse(filed))
    ? new Date(Date.parse(filed) + DAY + 5 * 3_600_000).toISOString() : null;
}

export function deriveSecFundamentals(companyFacts: unknown, submissions: unknown, asOf: string, cik: string): ResearchFundamentals {
  const result = missingFundamentals('No se encontró un hecho comparable publicado antes del corte.');
  const body = record(companyFacts);
  const filing = record(submissions);
  const gaap = record(record(body.facts)['us-gaap']);
  const dei = record(record(body.facts).dei);
  const recent = record(record(filing.filings).recent);
  const acceptance = new Map<string, string>();
  if (Array.isArray(recent.accessionNumber) && Array.isArray(recent.acceptanceDateTime)) {
    for (let i = 0; i < recent.accessionNumber.length; i++) {
      const date = timestamp(recent.acceptanceDateTime[i]);
      if (date && typeof recent.accessionNumber[i] === 'string') acceptance.set(recent.accessionNumber[i], date);
    }
  }
  const choose = (tags: string[], unit: string, annual = false, taxonomy: Record<string, unknown> = gaap, maxEnd?: string): SecFact | null => {
    const candidates: (SecFact & { priority: number })[] = [];
    tags.forEach((tag, priority) => {
      const values = record(record(taxonomy[tag]).units)[unit];
      if (!Array.isArray(values)) return;
      for (const raw of values) {
        const fact = record(raw);
        const value = numeric(fact.val);
        const end = timestamp(fact.end);
        const start = timestamp(fact.start);
        const filed = typeof fact.filed === 'string' ? fact.filed : '';
        const accession = typeof fact.accn === 'string' ? fact.accn : '';
        const availableAt = acceptance.get(accession) ?? conservativeFiledAt(filed);
        if (value === null || !end || !availableAt || Date.parse(availableAt) > Date.parse(asOf) || Date.parse(end) > Date.parse(asOf)) continue;
        if (maxEnd && end > maxEnd) continue;
        if (!['10-K', '10-Q', '20-F', '40-F', '10-K/A', '10-Q/A', '20-F/A'].includes(String(fact.form))) continue;
        if (annual && (!start || Date.parse(end) - Date.parse(start) < 300 * DAY || Date.parse(end) - Date.parse(start) > 400 * DAY)) continue;
        candidates.push({ priority, start, end, filed,
          variable: { value, source: `${SOURCE} · ${tag} · ${accession}`, observedAt: end, availableAt, kind: 'observed' } });
      }
    });
    candidates.sort((a, b) => b.end.localeCompare(a.end) || a.priority - b.priority || b.filed.localeCompare(a.filed));
    return candidates[0] ?? null;
  };
  const revenue = choose(['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'], 'USD', true);
  const netIncome = choose(['NetIncomeLoss', 'ProfitLoss'], 'USD', true);
  const assets = choose(['Assets'], 'USD');
  const liabilities = choose(['Liabilities'], 'USD');
  const cash = choose(['CashAndCashEquivalentsAtCarryingValue'], 'USD');
  const shares = choose(['EntityCommonStockSharesOutstanding'], 'shares', false, dei) ?? choose(['CommonStockSharesOutstanding'], 'shares');
  const combine = (left: SecFact | null, right: SecFact | null, label: string): ResearchVariable => {
    if (!left || !right || right.variable.value === null || right.variable.value <= 0 || left.start !== right.start || left.end !== right.end) {
      return missingVariable(SOURCE, `${label}: faltan hechos de idéntico período y unidad comparable.`);
    }
    return { value: left.variable.value! / right.variable.value, source: `${SOURCE} · ${label}`, observedAt: left.end,
      availableAt: left.variable.availableAt! > right.variable.availableAt! ? left.variable.availableAt : right.variable.availableAt, kind: 'estimated' };
  };
  result.cik = cik;
  result.companyName = typeof filing.name === 'string' ? filing.name : typeof body.entityName === 'string' ? body.entityName : null;
  if (revenue) result.annualRevenue = revenue.variable;
  if (netIncome) result.annualNetIncome = netIncome.variable;
  if (assets) result.assets = assets.variable;
  if (liabilities) result.liabilities = liabilities.variable;
  if (cash) result.cash = cash.variable;
  if (shares) result.sharesOutstanding = shares.variable;
  result.netMargin = combine(netIncome, revenue, 'resultado neto / ingresos anuales');
  result.liabilitiesToAssets = combine(liabilities, assets, 'pasivos / activos');
  const analysis = result.analysis!;
  const metrics = analysis.metrics;
  const equityTags = ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'];
  const equity = choose(equityTags, 'USD');
  const currentAssets = choose(['AssetsCurrent'], 'USD'), currentLiabilities = choose(['LiabilitiesCurrent'], 'USD');
  const inventory = choose(['InventoryNet'], 'USD');
  const grossProfit = choose(['GrossProfit'], 'USD', true), operatingIncome = choose(['OperatingIncomeLoss'], 'USD', true);
  const cfo = choose(['NetCashProvidedByUsedInOperatingActivities'], 'USD', true);
  const capex = choose(['PaymentsToAcquirePropertyPlantAndEquipment'], 'USD', true);
  const eps = choose(['EarningsPerShareDiluted', 'EarningsPerShareBasic'], 'USD/shares', true);
  for (const [key, fact] of [['equity', equity], ['currentAssets', currentAssets], ['currentLiabilities', currentLiabilities],
    ['inventory', inventory], ['grossProfit', grossProfit], ['operatingIncome', operatingIncome], ['operatingCashFlow', cfo], ['capex', capex], ['annualEps', eps]] as const) {
    if (fact) metrics[key] = fact.variable;
  }
  const computed = (value: number, inputs: SecFact[], label: string): ResearchVariable => ({ value,
    source: `${SOURCE} · ${label} · ${inputs.map(fact => fact.variable.source).join(' | ')}`,
    observedAt: inputs.at(-1)!.end, availableAt: inputs.map(fact => fact.variable.availableAt!).sort().at(-1)!,
    kind: 'estimated', reason: `Fórmula: ${label}. Solo usa hechos publicados en el corte y períodos comparables.` });
  if (cfo && capex && cfo.start === capex.start && cfo.end === capex.end && capex.variable.value! >= 0) {
    metrics.freeCashFlow = computed(cfo.variable.value! - capex.variable.value!, [cfo, capex], 'flujo operativo − inversión en propiedad y equipo');
  }
  metrics.grossMargin = combine(grossProfit, revenue, 'utilidad bruta / ingresos anuales');
  metrics.operatingMargin = combine(operatingIncome, revenue, 'resultado operativo / ingresos anuales');
  metrics.cashConversion = combine(cfo, netIncome, 'flujo operativo / utilidad neta anual positiva');
  metrics.currentRatio = combine(currentAssets, currentLiabilities, 'activos corrientes / pasivos corrientes');
  metrics.liabilitiesToEquity = combine(liabilities, equity, 'pasivos totales / patrimonio positivo');
  if (currentAssets && inventory && currentLiabilities && currentAssets.end === inventory.end && inventory.end === currentLiabilities.end
    && currentLiabilities.variable.value! > 0 && inventory.variable.value! >= 0 && currentAssets.variable.value! >= inventory.variable.value!) {
    metrics.quickRatio = computed((currentAssets.variable.value! - inventory.variable.value!) / currentLiabilities.variable.value!,
      [currentAssets, inventory, currentLiabilities], '(activos corrientes − inventarios) / pasivos corrientes');
  }
  const growth = (current: SecFact | null, tags: string[], label: string): ResearchVariable => {
    if (!current?.start) return missingVariable(SOURCE, `${label}: falta un año fiscal completo.`);
    const priorEnd = new Date(Date.parse(current.start) - DAY).toISOString();
    const previous = choose(tags, 'USD', true, gaap, priorEnd);
    const separation = previous ? (Date.parse(current.end) - Date.parse(previous.end)) / DAY : 0;
    if (!previous || previous.variable.value! <= 0 || separation < 300 || separation > 400) return missingVariable(SOURCE, `${label}: falta el año anterior comparable con base positiva.`);
    return computed(current.variable.value! / previous.variable.value! - 1, [previous, current], label);
  };
  metrics.revenueGrowth = growth(revenue, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'], 'crecimiento de ingresos anuales');
  metrics.incomeGrowth = growth(netIncome, ['NetIncomeLoss', 'ProfitLoss'], 'crecimiento de utilidad neta anual');
  const returnOnAverageBalance = (tags: string[], label: string): ResearchVariable => {
    if (!netIncome?.start) return missingVariable(SOURCE, `${label}: falta utilidad anual comparable.`);
    const openingDate = new Date(Date.parse(netIncome.start) - DAY).toISOString();
    const opening = choose(tags, 'USD', false, gaap, openingDate), closing = choose(tags, 'USD', false, gaap, netIncome.end);
    if (!opening || !closing || opening.end !== openingDate || closing.end !== netIncome.end || opening.variable.value! <= 0 || closing.variable.value! <= 0) {
      return missingVariable(SOURCE, `${label}: faltan balances positivos al inicio y al final del mismo ejercicio.`);
    }
    return computed(netIncome.variable.value! / ((opening.variable.value! + closing.variable.value!) / 2), [opening, closing, netIncome], label);
  };
  metrics.returnOnAssets = returnOnAverageBalance(['Assets'], 'utilidad anual / activos medios del ejercicio');
  metrics.returnOnEquity = returnOnAverageBalance(equityTags, 'utilidad anual / patrimonio medio del ejercicio');
  result.analysis = fundamentalCoverage(analysis);
  const available = [revenue, netIncome, assets, liabilities, cash, shares].filter(Boolean).length;
  result.status = { source: SOURCE, status: available === 6 ? 'ready' : 'partial', message: `${available}/6 conceptos contables disponibles antes del corte; no todos los emisores usan las mismas etiquetas XBRL.` };
  result.warnings = ['Fundamentales según fecha de aceptación SEC, o cierre conservador del día de presentación cuando no hay hora. El período contable no es la fecha de publicación.',
    'Nombre y correspondencia ticker/CIK son metadatos actuales; no forman parte de una predicción histórica.',
    'Los estados contables aportan contexto; sus ratios no se convierten en una probabilidad de éxito.'];
  return result;
}
