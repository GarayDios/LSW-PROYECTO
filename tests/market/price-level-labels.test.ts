import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutPriceLevelLabels } from '../../src/features/market/price-level-labels.ts';

test('densely packed support and resistance labels stay separated, bounded and in price order', () => {
  const labels = Array.from({ length: 40 }, (_, i) => ({ id: `level-${i}`, y: 180 + i * .1, priority: i }));
  const result = layoutPriceLevelLabels(labels, 60, 460);
  const positions = [...result.values()];
  assert.equal(result.size, 17);
  assert.ok(positions[0] >= 60 && positions.at(-1)! <= 460);
  assert.ok(positions.every((y, index) => index === 0 || y - positions[index - 1] >= 24));
  assert.deepEqual([...result.keys()], labels.slice(0, 17).map(label => label.id));
});

test('highlighted levels get rail space without deleting any of the source level data', () => {
  const labels = [{ id: 'S1', y: 90, priority: 10 }, { id: 'S2', y: 91, priority: 20 }, { id: 'R1', y: 92, priority: -1 }];
  const before = structuredClone(labels);
  const result = layoutPriceLevelLabels(labels, 60, 84);
  assert.equal(result.size, 2); assert.ok(result.has('R1')); assert.ok(result.has('S1')); assert.ok(!result.has('S2'));
  assert.deepEqual(labels, before);
  assert.equal(layoutPriceLevelLabels(labels, 100, 60).size, 0);
  assert.equal(layoutPriceLevelLabels(labels, 60, 460, 0).size, 0);
});
