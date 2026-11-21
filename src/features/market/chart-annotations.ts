export type ChartLabelCandidate = {
  id: string;
  x: number;
  y: number;
  text: string;
  direction: 'up' | 'down';
};

export type ChartLabelPlacement = { x: number; y: number; width: number };
export type ChartLabelBounds = { left: number; right: number; top: number; bottom: number };

/** Positions refer to centered text with a 12px font and a baseline at y.
 * Items retain caller priority; a hidden label never removes its event marker.
 */
export function placeChartLabels(
  items: readonly ChartLabelCandidate[],
  bounds: ChartLabelBounds,
): Map<string, ChartLabelPlacement> {
  const placements = new Map<string, ChartLabelPlacement>();
  if (!Object.values(bounds).every(Number.isFinite)
    || bounds.right <= bounds.left || bounds.bottom - bounds.top < 15) return placements;

  const occupied: { left: number; right: number; top: number; bottom: number }[] = [];
  const spacing = 4;
  for (const item of items) {
    if (placements.has(item.id) || !item.text || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
    const width = Array.from(item.text).length * 7 + 10;
    // Do not claim an oversized label fits by shrinking its estimated box.
    if (width > bounds.right - bounds.left) continue;
    const x = Math.max(bounds.left + width / 2, Math.min(bounds.right - width / 2, item.x));
    const offsets = item.direction === 'up' ? [18, 34, 50, -12, -28, -44] : [-18, -34, -50, 12, 28, 44];
    for (const offset of offsets) {
      const y = item.y + offset;
      const box = { left: x - width / 2, right: x + width / 2, top: y - 12, bottom: y + 3 };
      if (box.top < bounds.top || box.bottom > bounds.bottom) continue;
      if (occupied.some(other => box.left < other.right + spacing && box.right + spacing > other.left
        && box.top < other.bottom + spacing && box.bottom + spacing > other.top)) continue;
      placements.set(item.id, { x, y, width });
      occupied.push(box);
      break;
    }
  }
  return placements;
}
