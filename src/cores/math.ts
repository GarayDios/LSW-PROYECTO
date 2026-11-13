export const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
export const density = (x: number) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
export const proximity = (value: number, target: number, tolerance: number) => Math.exp(-Math.abs(value - target) / tolerance);

/** Standard normal CDF; absolute approximation error below 8e-8. */
export function normalCdf(x: number): number {
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const tail = density(x) * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return clamp(x >= 0 ? 1 - tail : tail);
}
