export type LevelLabel = { id: string; y: number; priority: number };

/** Keep a bounded set of labels on a separate rail. Every level line remains available. */
export function layoutPriceLevelLabels(labels: readonly LevelLabel[], top: number, bottom: number, gap = 24) {
  const placed = new Map<string, number>();
  if (![top, bottom, gap].every(Number.isFinite) || gap <= 0 || bottom < top) return placed;
  const capacity = Math.max(0, Math.floor((bottom - top) / gap) + 1);
  const selected = labels.filter(label => Number.isFinite(label.y) && Number.isFinite(label.priority))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).slice(0, capacity).sort((a, b) => a.y - b.y);
  let previous = top - gap;
  selected.forEach((label, index) => {
    const y = Math.min(bottom - (selected.length - index - 1) * gap, Math.max(top, label.y, previous + gap));
    placed.set(label.id, y); previous = y;
  });
  return placed;
}
