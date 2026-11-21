import test from 'node:test';
import assert from 'node:assert/strict';
import { groupChartNews, newsSessionDate, type ChartNewsArticle } from '../../src/features/market/chart-news.ts';
import { generateHistory } from '../../src/features/market/chart-history.ts';

const article = (id: string, publishedAt: string, patch: Partial<ChartNewsArticle> = {}): ChartNewsArticle => ({ id, publishedAt, availableAt: publishedAt, headline: `Headline ${id}`, source: 'TEST', url: 'https://example.org', ...patch });
const options = { interval: '1d', startDate: '2026-11-02', endDate: '2026-11-13', asOf: '2026-11-14T04:59:59Z', left: 10, right: 710 };
const history = generateHistory('XYZ', 100, options.startDate, options.endDate, '1d');

test('daily news uses New York calendar dates rather than the UTC date or the candle open timestamp', () => {
  assert.equal(newsSessionDate(Date.parse('2026-11-04T01:00:00Z')), '2026-11-03');
  const groups = groupChartNews({ ...options, history, articles: [article('evening', '2026-11-04T01:00:00Z'), article('morning', '2026-11-03T12:00:00Z')] });
  assert.equal(groups.length, 1); assert.equal(groups[0].articles.length, 2);
  assert.equal(groups[0].x, 10 + (1 + .5) * 70);
});

test('weekend stories remain between sessions and preserve their actual publication dates', () => {
  const groups = groupChartNews({ ...options, right: 1410, history, articles: [article('friday', '2026-11-06T17:00:00Z'), article('saturday', '2026-11-07T17:00:00Z'), article('monday', '2026-11-09T17:00:00Z')] });
  const weekend = groups.find(group => group.articles.some(a => a.id === 'saturday'))!;
  assert.ok(weekend.outsideSession);
  assert.ok(weekend.x > groups.find(g => g.articles.some(a => a.id === 'friday'))!.x);
  assert.ok(weekend.x < groups.find(g => g.articles.some(a => a.id === 'monday'))!.x);
  assert.equal(weekend.articles[0].publishedAt, '2026-11-07T17:00:00Z');
});

test('future revisions, out-of-range headlines, invalid timestamps and duplicate ids cannot make extra marks', () => {
  const items = [article('one', '2026-11-04T17:00:00Z'), article('one', '2026-11-04T17:00:00Z'),
    article('future', '2026-11-15T17:00:00Z'), article('revision', '2026-11-04T17:00:00Z', { availableAt: '2026-11-15T17:00:00Z' }),
    article('before', '2026-10-31T17:00:00Z'), article('invalid', 'bad'), article('reversed', '2026-11-04T17:00:00Z', { availableAt: '2026-11-03T17:00:00Z' })];
  assert.deepEqual(groupChartNews({ ...options, history, articles: items }).flatMap(g => g.articles.map(a => a.id)), ['one']);
  assert.equal(groupChartNews({ ...options, history: [], articles: items }).length, 0);
});

test('nearby markers group all articles without overlapping or mutating their dates on aggregated charts', () => {
  const bars = generateHistory('XYZ', 100, '2025-01-01', '2026-11-13', '1d');
  const articles = bars.map((bar, i) => article(String(i), new Date(bar.time + 3600000).toISOString()));
  const before = structuredClone(articles);
  const groups = groupChartNews({ ...options, startDate: '2025-01-01', history: bars, articles });
  assert.equal(groups.reduce((n, g) => n + g.articles.length, 0), articles.length);
  assert.ok(groups.length < articles.length);
  for (let i = 1; i < groups.length; i++) assert.ok(groups[i].x - groups[i - 1].x >= 32);
  assert.deepEqual(articles, before);
  assert.deepEqual(groupChartNews({ ...options, startDate: '2025-01-01', history: bars, articles }), groups);
});

test('intraday timestamps move forward within bars and put overnight news at the session boundary', () => {
  const bars = generateHistory('XYZ', 100, '2026-11-12', '2026-11-13', '1h');
  const items = [article('open', '2026-11-12T14:30:00Z'), article('later', '2026-11-12T15:15:00Z'),
    article('after', '2026-11-12T21:05:00Z'), article('next', '2026-11-13T14:30:00Z')];
  const groups = groupChartNews({ ...options, interval: '1h', startDate: '2026-11-12', history: bars, articles: items });
  assert.ok(groups[1].x > groups[0].x);
  const after = groups.find(g => g.articles.some(a => a.id === 'after'))!;
  assert.equal(after.outsideSession, true);
  assert.ok(after.articles.some(a => a.id === 'next'));
});

test('visible-window dates include the selected first weekend but omit stories outside a narrowed view', () => {
  const bars = generateHistory('XYZ', 100, '2026-11-07', '2026-11-13', '1d');
  const items = [article('first-weekend', '2026-11-07T17:00:00Z'), article('last', '2026-11-13T22:00:00Z')];
  const all = groupChartNews({ ...options, startDate: '2026-11-07', history: bars, articles: items });
  assert.equal(all[0].outsideSession, true);
  assert.equal(all.reduce((n, g) => n + g.articles.length, 0), 2);
  const narrow = groupChartNews({ ...options, startDate: '2026-11-09', history: bars, articles: items });
  assert.deepEqual(narrow.flatMap(g => g.articles.map(a => a.id)), ['last']);
});
