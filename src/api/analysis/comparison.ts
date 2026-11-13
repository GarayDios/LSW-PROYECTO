import { z } from 'zod';
import { readBrokerConfig, BrokerConfigError } from '../brokers/config.ts';
import { fetchAlpacaHistory, MarketDataError, newYorkDate, symbolSchema } from '../market/alpaca-history.ts';
import { compareStockRules, periodStart, type ComparisonResult } from '../../features/analysis/comparison.ts';
import { ApiError, privateJson, sameOrigin, smallJson } from '../http.ts';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(value + 'T12:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
});
const inputSchema = z.object({
  symbols: z.array(symbolSchema).min(1).max(6), years: z.array(z.union([z.literal(1), z.literal(3), z.literal(5)])).min(1).max(3),
  end: date, feeBps: z.number().finite().min(0).max(1000), slippageBps: z.number().finite().min(0).max(1000),
}).strict();

export function createComparisonHandler(dependencies: {
  environment(): Record<string, string | undefined>; owner(): Promise<{ userId: string } | null>;
  history?: typeof fetchAlpacaHistory; fetcher?: typeof fetch; now?: () => number;
}) {
  return async (request: Request): Promise<Response> => {
    try {
      sameOrigin(request);
      const owner = await dependencies.owner();
      if (!owner) throw new ApiError('auth_required', 'Inicia sesión para comparar históricos.', 401);
      const config = readBrokerConfig(dependencies.environment());
      if (!config) throw new ApiError('broker_not_configured', 'Configura Alpaca para comparar datos reales.', 503);
      if (owner.userId !== config.ownerUserId) throw new ApiError('broker_owner_required', 'Esta fuente pertenece a otro usuario.', 403);
      const parsed = inputSchema.safeParse(await smallJson(request));
      if (!parsed.success) throw new ApiError('invalid_comparison', 'Revisa hasta seis empresas, los periodos y los costes.');
      const input = parsed.data, now = dependencies.now?.() ?? Date.now(), today = newYorkDate(now);
      if (input.end > today) throw new ApiError('future_comparison', 'El corte no puede ser una fecha futura.');
      const symbols = [...new Set(input.symbols)], years = [...new Set(input.years)].sort((a, b) => a - b);
      const result: ComparisonResult = { rows: [], excluded: [], cutoff: input.end, generatedAt: new Date(now).toISOString(),
        source: `alpaca:${config.dataFeed}`, feeBps: input.feeBps, slippageBps: input.slippageBps,
        warnings: ['Comparación de reglas de acciones; no es un backtest de opciones F5 ni una probabilidad futura.',
          'Los periodos de uno, tres y cinco años se solapan. No son muestras independientes ni se selecciona un ganador automáticamente.',
          'Validación inicial 70/30 y estabilidad por ventanas de 63 sesiones, con costes por ejecución. El benchmark se valora al cierre y no simula su venta final.',
          'Las series ajustadas por splits no incluyen dividendos: los retornos representan precio, no retorno total.'],
      };
      const bySymbol = new Map<string, Pick<ComparisonResult, 'rows' | 'excluded' | 'warnings'>>();
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(2, symbols.length) }, async () => {
        while (cursor < symbols.length) {
          const symbol = symbols[cursor++];
          const output: Pick<ComparisonResult, 'rows' | 'excluded' | 'warnings'> = { rows: [], excluded: [], warnings: [] };
          bySymbol.set(symbol, output);
          try {
            const history = await (dependencies.history ?? fetchAlpacaHistory)(config, { symbol, start: periodStart(input.end, Math.max(...years)), end: input.end, interval: '1d' }, dependencies.fetcher ?? fetch, now);
            output.warnings.push(...history.warnings);
            const bars = history.bars.filter(bar => newYorkDate(bar.time) <= input.end && newYorkDate(bar.time) < today);
            for (const period of years) {
              const start = periodStart(input.end, period), sample = bars.filter(bar => newYorkDate(bar.time) >= start);
              if (sample.length < 100 || sample[0].time > Date.parse(start + 'T00:00:00Z') + 14 * 86400000 || sample.at(-1)!.time < Date.parse(input.end + 'T00:00:00Z') - 7 * 86400000) {
                output.excluded.push({ symbol, years: period, reason: 'Histórico insuficiente o incompleto para cubrir el periodo solicitado.' });
                continue;
              }
              output.rows.push(...compareStockRules(symbol, sample, period, { asOf: Math.min(now, Date.parse(input.end + 'T23:59:59.999-05:00')), feeBps: input.feeBps, slippageBps: input.slippageBps }));
            }
          } catch {
            output.rows = []; output.excluded = years.map(period => ({ symbol, years: period, reason: 'No se pudo verificar el histórico real de esta empresa.' }));
          }
        }
      }));
      for (const symbol of symbols) {
        const output = bySymbol.get(symbol)!;
        result.rows.push(...output.rows); result.excluded.push(...output.excluded); result.warnings.push(...output.warnings);
      }
      result.warnings = [...new Set(result.warnings)];
      return privateJson(result);
    } catch (error) {
      if (error instanceof ApiError || error instanceof BrokerConfigError || error instanceof MarketDataError) return privateJson({ error: { code: error.code, message: error.message } }, error.status);
      return privateJson({ error: { code: 'comparison_unavailable', message: 'No se pudo completar la comparación.' } }, 503);
    }
  };
}
