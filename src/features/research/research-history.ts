/** Preparation candles do not alter the requested chart window or decision cutoff. */
export function researchHistoryStart(start: string, end: string): string {
  const time = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(time)) return start;
  const preparation = new Date(time - 400 * 86400000).toISOString().slice(0, 10);
  return start < preparation ? start : preparation;
}
