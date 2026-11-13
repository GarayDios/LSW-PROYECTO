import { beforeCutoff, missingVariable, type ResearchMacro, type ResearchVariable } from '../../features/research/model.ts';
import { numeric, providerFailure, record, researchJson, type ResearchFetch } from './http.ts';

export type FredResearchConfig = { apiKey: string };
const DAY = 86_400_000;
const SOURCE = 'FRED / ALFRED';

export function missingMacro(message = 'Configura FRED_API_KEY en el servidor para consultar las series macroeconómicas.'): ResearchMacro {
  const missing = (label: string) => missingVariable(`${SOURCE} · ${label}`, message);
  return { treasury3MonthPercent: missing('DGS3MO (%)'), riskFreeRate: missing('tasa continua estimada'), inflationYearOverYear: missing('CPIAUCSL interanual'),
    realGdpGrowth: missing('A191RL1Q225SBEA (%)'), status: { source: SOURCE, status: 'missing_config', message }, warnings: [] };
}

/** ALFRED vintage dates avoid using today's revised GDP/CPI in historical decisions. */
export async function fetchFredMacro(config: FredResearchConfig | undefined, asOf: string, fetcher: ResearchFetch = fetch): Promise<ResearchMacro> {
  if (!Number.isFinite(Date.parse(asOf))) throw new RangeError('La fecha de decisión no es válida.');
  if (!config?.apiKey) return missingMacro();
  // FRED gives dates, not intraday release times. Use a complete preceding US day.
  const vintage = new Date(Date.parse(asOf) - 36 * 3_600_000).toISOString().slice(0, 10);
  const availableAt = new Date(Date.parse(vintage) + DAY + 6 * 3_600_000).toISOString();
  const result = missingMacro('La serie no tiene observaciones verificables para esta fecha de corte.');
  const warnings = ['Se consulta una vintage ALFRED anterior al corte: las revisiones posteriores no se usan. Sin hora oficial se aplica un retraso conservador al día de disponibilidad.'];
  try {
    const load = async (id: string): Promise<{ date: string; value: number }[]> => {
      const url = new URL('https://api.stlouisfed.org/fred/series/observations');
      Object.entries({ series_id: id, api_key: config.apiKey, file_type: 'json', realtime_start: vintage, realtime_end: vintage,
        observation_end: vintage, sort_order: 'desc', limit: '24' }).forEach(([key, value]) => url.searchParams.set(key, value));
      const body = record(await researchJson(url, {}, fetcher));
      if (!Array.isArray(body.observations)) throw new Error('invalid FRED observations');
      return body.observations.map(record).flatMap(item => {
        const value = numeric(item.value);
        return value !== null && typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
          && Date.parse(item.date) <= Date.parse(vintage) ? [{ date: item.date, value }] : [];
      }).sort((a, b) => b.date.localeCompare(a.date));
    };
    const statuses = await Promise.allSettled([load('DGS3MO'), load('CPIAUCSL'), load('A191RL1Q225SBEA')]);
    const treasury = statuses[0].status === 'fulfilled' ? statuses[0].value : [];
    const inflation = statuses[1].status === 'fulfilled' ? statuses[1].value : [];
    const gdp = statuses[2].status === 'fulfilled' ? statuses[2].value : [];
    const variable = (value: number, observation: { date: string }, id: string, kind: 'observed' | 'estimated' = 'observed'): ResearchVariable =>
      beforeCutoff({ value, source: `${SOURCE} · ${id} · vintage ${vintage}`, observedAt: new Date(observation.date).toISOString(), availableAt, kind }, asOf);
    const rate = treasury[0];
    if (rate && Date.parse(asOf) - Date.parse(rate.date) <= 10 * DAY) {
      result.treasury3MonthPercent = variable(rate.value, rate, 'DGS3MO (% anual)');
      if (rate.value > -100) result.riskFreeRate = variable(Math.log1p(rate.value / 100), rate, 'aproximación continua log(1 + DGS3MO/100)', 'estimated');
    } else if (rate) warnings.push('DGS3MO tiene más de diez días; no se utiliza como tasa actual para valorar opciones.');
    const latestCpi = inflation[0];
    const priorDate = latestCpi ? `${Number(latestCpi.date.slice(0, 4)) - 1}${latestCpi.date.slice(4)}` : '';
    const priorCpi = inflation.find(item => item.date === priorDate);
    if (latestCpi && priorCpi && priorCpi.value > 0) result.inflationYearOverYear = variable(latestCpi.value / priorCpi.value - 1, latestCpi, 'CPIAUCSL: índice / índice mismo mes año anterior − 1', 'estimated');
    if (gdp[0]) result.realGdpGrowth = variable(gdp[0].value / 100, gdp[0], 'A191RL1Q225SBEA: crecimiento trimestral real anualizado / 100');
    for (const status of statuses) if (status.status === 'rejected') warnings.push(providerFailure(SOURCE, status.reason).message);
    const count = [result.riskFreeRate, result.inflationYearOverYear, result.realGdpGrowth].filter(item => item.value !== null).length;
    result.status = { source: SOURCE, status: count === 3 ? 'ready' : count ? 'partial' : 'error', message: `${count}/3 variables macro disponibles para el corte.` };
    result.warnings = warnings;
    return result;
  } catch (error) { return { ...result, status: providerFailure(SOURCE, error), warnings }; }
}
