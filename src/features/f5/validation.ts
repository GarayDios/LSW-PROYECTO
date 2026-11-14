import { z } from 'zod';
import { BrokerError } from '../../api/brokers/alpaca/client.ts';
import type { StrategyId } from '../../cores/types.ts';
import type { F5Contract, F5Leg, F5OpenRequest, F5Request } from './types.ts';

export const f5EquitySymbol = /^[A-Z][A-Z0-9.-]{0,14}$/;
export const f5OptionSymbol = /^[A-Z][A-Z0-9.]{0,5}\d{6}[CP]\d{8}$/;
const money = z.number().finite().min(-1_000_000).max(1_000_000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7);
const capital = z.number().finite().positive().max(10_000_000);
const quantity = z.number().int().min(1).max(1000);
const operationId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const open = z.object({ action: z.literal('open'), strategy: z.enum(['wheel', 'pmcc', 'backspread', 'gamma']),
  underlying: z.string().regex(f5EquitySymbol), quantity, contracts: z.array(z.string().regex(f5OptionSymbol)).min(1).max(2),
  wheelPhase: z.enum(['put', 'call']).optional(), limitPrice: money, maxCapitalUsd: capital,
}).strict();
const requestSchema = z.discriminatedUnion('action', [open,
  z.object({ action: z.literal('close'), operationId, limitPrice: money, maxCapitalUsd: capital }).strict(),
  z.object({ action: z.literal('hedge'), operationId, side: z.enum(['buy', 'sell']), quantity: z.number().int().min(1).max(1_000_000), limitPrice: money.refine(value => value > 0), maxCapitalUsd: capital }).strict(),
]);
const invalid = (message: string) => new BrokerError('f5_request_invalid', 400, message, false);

/** Parse public input without reflecting submitted data in an error. */
export function parseF5Request(value: unknown): F5Request {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw invalid('Revisa la estrategia, contratos, cantidades, límite y capital de la operación F5.');
  const request = parsed.data;
  if (request.action === 'open') {
    const expected = request.strategy === 'wheel' ? 1 : 2;
    if (request.contracts.length !== expected || new Set(request.contracts).size !== expected) throw invalid('Selecciona los contratos distintos requeridos por la estrategia.');
    if (request.strategy === 'wheel' ? !request.wheelPhase : request.wheelPhase !== undefined) throw invalid('La fase put o call corresponde únicamente a Wheel.');
    if (request.strategy !== 'backspread' && request.limitPrice <= 0) throw invalid('Wheel, PMCC y Gamma requieren un precio límite positivo; el crédito de Wheel se expresa por su lado de venta.');
  }
  return request;
}

export function requiredOptionsLevel(strategy: StrategyId): number { return strategy === 'wheel' ? 1 : 3; }

/** Contract roles are explicit. A missing or unsuitable contract never becomes a synthetic leg. */
export function openingLegs(request: F5OpenRequest, contracts: F5Contract[], today: string): F5Leg[] {
  parseF5Request(request);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(Date.parse(today + 'T12:00:00Z')) || new Date(today + 'T12:00:00Z').toISOString().slice(0, 10) !== today) throw invalid('No se pudo verificar la fecha de los contratos.');
  const selected = request.contracts.map(symbol => {
    const matches = contracts.filter(contract => contract.symbol === symbol);
    if (matches.length !== 1) throw invalid('No se pudo verificar la identidad de todos los contratos seleccionados.');
    const contract = matches[0];
    if (!f5OptionSymbol.test(contract.symbol) || contract.underlying !== request.underlying || !contract.tradable || contract.style !== 'american' || contract.size !== 100 || !Number.isFinite(contract.strike) || contract.strike <= 0
      || !/^\d{4}-\d{2}-\d{2}$/.test(contract.expiry) || !Number.isFinite(Date.parse(contract.expiry + 'T12:00:00Z')) || new Date(contract.expiry + 'T12:00:00Z').toISOString().slice(0, 10) !== contract.expiry || contract.expiry < today
      || contract.symbol.slice(0, -15) !== request.underlying) throw invalid('Se requieren contratos americanos negociables, estándar de 100 acciones, del subyacente y vigentes.');
    // Independently cross-check the OCC encoding against broker metadata.
    const occ = contract.symbol.match(/(\d{6})([CP])(\d{8})$/)!;
    if (`20${occ[1].slice(0, 2)}-${occ[1].slice(2, 4)}-${occ[1].slice(4, 6)}` !== contract.expiry || (occ[2] === 'C' ? 'call' : 'put') !== contract.type || Number(occ[3]) / 1000 !== contract.strike) throw invalid('El símbolo OCC no corresponde a los datos del contrato.');
    return contract;
  });
  const leg = (index: number, side: 'buy' | 'sell', ratio = 1): F5Leg => ({ symbol: selected[index].symbol, side, ratio, intent: side === 'buy' ? 'buy_to_open' : 'sell_to_open' });
  const [first, second] = selected;
  switch (request.strategy) {
    case 'wheel':
      if (first.type !== (request.wheelPhase === 'call' ? 'call' : 'put')) throw invalid('Wheel requiere el contrato put o call de la fase elegida.');
      return [leg(0, 'sell')];
    case 'pmcc':
      if (first.type !== 'call' || second.type !== 'call' || first.expiry <= second.expiry || first.strike > second.strike) throw invalid('PMCC requiere primero la call larga, con vencimiento posterior y strike menor o igual a la call corta.');
      return [leg(0, 'buy'), leg(1, 'sell')];
    case 'backspread':
      if (first.type !== 'call' || second.type !== 'call' || first.expiry !== second.expiry || first.strike >= second.strike) throw invalid('Backspread requiere una call corta inferior y dos calls largas superiores, con el mismo vencimiento.');
      return [leg(0, 'sell'), leg(1, 'buy', 2)];
    case 'gamma':
      if (first.type !== 'call' || second.type !== 'put' || first.expiry !== second.expiry || first.strike !== second.strike) throw invalid('Gamma requiere una call y una put largas con igual strike y vencimiento.');
      return [leg(0, 'buy'), leg(1, 'buy')];
  }
}
