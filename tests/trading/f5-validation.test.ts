import test from 'node:test';
import assert from 'node:assert/strict';
import { openingLegs, parseF5Request, requiredOptionsLevel } from '../../src/features/f5/validation.ts';
import { BrokerError } from '../../src/api/brokers/alpaca/client.ts';
import type { F5Contract, F5OpenRequest } from '../../src/features/f5/types.ts';

const contract = (symbol: string, overrides: Partial<F5Contract> = {}): F5Contract => {
  const occ = symbol.match(/(\d{6})([CP])(\d{8})$/)!;
  return { symbol, underlying: 'AAPL', expiry: `20${occ[1].slice(0, 2)}-${occ[1].slice(2, 4)}-${occ[1].slice(4, 6)}`, type: occ[2] === 'C' ? 'call' : 'put', strike: Number(occ[3]) / 1000,
    size: 100, tradable: true, style: 'american', bid: 1, ask: 1.1, quoteTime: '2026-11-16T15:00:00Z', delta: .5, ...overrides };
};
const request = (strategy: F5OpenRequest['strategy'], contracts: string[], extra: Partial<F5OpenRequest> = {}): F5OpenRequest => ({ action: 'open', strategy, underlying: 'AAPL', contracts, quantity: 1, limitPrice: 1, maxCapitalUsd: 10000, ...extra });
const invalid = (error: unknown) => error instanceof BrokerError && error.code === 'f5_request_invalid';

test('F5 request parsing accepts signed complex prices and rejects extraneous live or synthetic fields', () => {
  const spread = request('backspread', ['AAPL261218C00150000', 'AAPL261218C00160000'], { limitPrice: -.25 });
  assert.deepEqual(parseF5Request(spread), spread);
  assert.equal((parseF5Request({ ...spread, limitPrice: 0 }) as F5OpenRequest).limitPrice, 0);
  for (const bad of [{ ...spread, quantity: .5 }, { ...spread, maxCapitalUsd: 0 }, { ...spread, limitPrice: .001 }, { ...spread, baseUrl: 'https://api.alpaca.markets' }, { ...spread, contracts: ['fake', 'fake'] }, { ...spread, underlying: '../account' }, { ...spread, contracts: [spread.contracts[0], spread.contracts[0]] }, { ...spread, wheelPhase: 'put' }]) assert.throws(() => parseF5Request(bad), invalid);
  assert.throws(() => parseF5Request(request('wheel', ['AAPL261218P00150000'])), invalid);
  assert.throws(() => parseF5Request(request('pmcc', spread.contracts, { limitPrice: -1 })), invalid);
  assert.throws(() => parseF5Request({ action: 'hedge', operationId: 'owned-id', side: 'sell', quantity: 1, limitPrice: -1, maxCapitalUsd: 100 }), invalid);
});

test('Wheel selects short put or covered-call role without inventing shares or assignment', () => {
  for (const phase of ['put', 'call'] as const) {
    const selected = contract(phase === 'put' ? 'AAPL261218P00150000' : 'AAPL261218C00160000');
    const value = request('wheel', [selected.symbol], { wheelPhase: phase });
    assert.deepEqual(openingLegs(value, [selected], '2026-11-16'), [{ symbol: selected.symbol, side: 'sell', ratio: 1, intent: 'sell_to_open' }]);
    assert.throws(() => openingLegs({ ...value, wheelPhase: phase === 'put' ? 'call' : 'put' }, [selected], '2026-11-16'), invalid);
  }
  assert.equal(requiredOptionsLevel('wheel'), 1); assert.equal(requiredOptionsLevel('gamma'), 3);
});

test('PMCC requires ordered long-later and short-earlier calls with covered strike ordering', () => {
  const long = contract('AAPL270618C00100000'), short = contract('AAPL261218C00160000');
  const value = request('pmcc', [long.symbol, short.symbol]);
  assert.deepEqual(openingLegs(value, [short, long], '2026-11-16').map(leg => [leg.side, leg.ratio]), [['buy', 1], ['sell', 1]]);
  assert.throws(() => openingLegs({ ...value, contracts: [short.symbol, long.symbol] }, [long, short], '2026-11-16'), invalid);
  const wrongStrike = contract('AAPL270618C00170000');
  assert.throws(() => openingLegs({ ...value, contracts: [wrongStrike.symbol, short.symbol] }, [wrongStrike, short], '2026-11-16'), invalid);
});

test('backspread encodes one lower short versus two higher long calls and Gamma same-strike straddle', () => {
  const lower = contract('AAPL261218C00150000'), upper = contract('AAPL261218C00160000'), put = contract('AAPL261218P00150000');
  assert.deepEqual(openingLegs(request('backspread', [lower.symbol, upper.symbol]), [lower, upper], '2026-11-16').map(leg => [leg.side, leg.ratio]), [['sell', 1], ['buy', 2]]);
  assert.throws(() => openingLegs(request('backspread', [upper.symbol, lower.symbol]), [lower, upper], '2026-11-16'), invalid);
  assert.deepEqual(openingLegs(request('gamma', [lower.symbol, put.symbol]), [lower, put], '2026-11-16').map(leg => leg.side), ['buy', 'buy']);
  assert.throws(() => openingLegs(request('gamma', [upper.symbol, put.symbol]), [upper, put], '2026-11-16'), invalid);
});

test('missing, duplicate, expired, nonstandard and mismatched metadata cannot open F5', () => {
  const selected = contract('AAPL261218P00150000'), value = request('wheel', [selected.symbol], { wheelPhase: 'put' });
  for (const entries of [[], [selected, selected], [{ ...selected, underlying: 'MSFT' }], [{ ...selected, tradable: false }], [{ ...selected, style: 'european' }], [{ ...selected, size: 10 }], [{ ...selected, strike: 155 }], [{ ...selected, expiry: '2026-12-19' }]]) assert.throws(() => openingLegs(value, entries, '2026-11-16'), invalid);
  assert.throws(() => openingLegs(value, [selected], '2027-01-01'), invalid);
  assert.throws(() => openingLegs(value, [selected], '2026-99-00'), invalid);
});
