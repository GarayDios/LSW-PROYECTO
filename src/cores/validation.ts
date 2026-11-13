import type { OptionInputs } from './types.ts';

export function validateOptionInputs(input: OptionInputs) {
  const values = [input.spot, input.strike, input.days, input.volatility, input.rate, input.dividendYield ?? 0];
  if (!values.every(Number.isFinite) || input.spot <= 0 || input.strike <= 0 || input.days < 0 || input.volatility < 0 || !['call', 'put'].includes(input.type)) {
    throw new RangeError('Revisa precio, strike, días, volatilidad y tasa: deben ser valores finitos y válidos.');
  }
}
