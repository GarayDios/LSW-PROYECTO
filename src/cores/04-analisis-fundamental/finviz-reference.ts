/** External reference only; opening Finviz does not import or authenticate data. */
export function finvizCompanyUrl(symbol: string): string {
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw new RangeError('El símbolo no es válido.');
  const url = new URL('https://finviz.com/stock');
  url.searchParams.set('t', symbol);
  return url.toString();
}
