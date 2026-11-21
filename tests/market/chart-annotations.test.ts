import test from 'node:test';
import assert from 'node:assert/strict';
import { placeChartLabels, type ChartLabelCandidate } from '../../src/features/market/chart-annotations.ts';

const bounds = { left: 10, right: 710, top: 20, bottom: 340 };
const candidate = (id: string, patch: Partial<ChartLabelCandidate> = {}): ChartLabelCandidate => ({
  id, x: 350, y: 160, text: 'MACD ↑', direction: 'up', ...patch,
});

test('labels prioritize caller order and retain separate ids for coincident events without overlap', () => {
  const items = Array.from({ length: 12 }, (_, i) => candidate(`event-${i}`));
  const result = placeChartLabels(items, bounds);
  assert.equal(result.get('event-0')?.y, 178);
  assert.ok(result.size > 1 && result.size < items.length);
  assert.deepEqual([...result.keys()], items.slice(0, result.size).map(item => item.id));
  const boxes = [...result.values()].map(value => ({ left: value.x - value.width / 2,
    right: value.x + value.width / 2, top: value.y - 12, bottom: value.y + 3 }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(a.right + 4 <= b.left || b.right + 4 <= a.left || a.bottom + 4 <= b.top || b.bottom + 4 <= a.top);
  }
});

test('labels clamp horizontal edges and use the alternate side at vertical edges', () => {
  const items = [candidate('left', { x: -100, y: 338 }), candidate('right', { x: 900, y: 22, direction: 'down' })];
  const result = placeChartLabels(items, bounds);
  assert.equal(result.size, 2);
  for (const placement of result.values()) {
    assert.ok(placement.x - placement.width / 2 >= bounds.left);
    assert.ok(placement.x + placement.width / 2 <= bounds.right);
    assert.ok(placement.y - 12 >= bounds.top);
    assert.ok(placement.y + 3 <= bounds.bottom);
  }
  assert.ok(result.get('left')!.y < 338);
  assert.ok(result.get('right')!.y > 22);
});

test('narrow plots omit labels that cannot fit, while short labels remain available', () => {
  const result = placeChartLabels([candidate('wide'), candidate('short', { text: 'S' })], { ...bounds, right: 35 });
  assert.equal(result.has('wide'), false);
  assert.equal(result.get('short')?.width, 17);
  assert.equal(placeChartLabels([candidate('invalid')], { ...bounds, right: NaN }).size, 0);
});

test('layout is deterministic and never mutates source event coordinates or text', () => {
  const item = Object.freeze(candidate('event', { x: 0 }));
  const items = Object.freeze([item]);
  assert.deepEqual(placeChartLabels(items, bounds), placeChartLabels(items, bounds));
  assert.equal(item.x, 0);
  assert.equal(placeChartLabels([candidate('bad', { y: Infinity }), item], bounds).size, 1);
});
