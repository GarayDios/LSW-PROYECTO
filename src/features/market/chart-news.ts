import type { ResearchNews } from '../../cores/compartido/research-model.ts';
import type { Candle } from './chart-history.ts';
import { easternTime } from '../research/contract-terms.ts';

export type ChartNewsArticle = ResearchNews['articles'][number];
export type ChartNewsGroup = { id: string; x: number; articles: ChartNewsArticle[]; outsideSession: boolean };
const sessionDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export function newsSessionDate(time: number): string {
  const parts = sessionDate.formatToParts(new Date(time));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

/** Use the chart's original sessions and aggregation, never the price scale.
 * Daily headlines map to their NY calendar session; weekend/holiday stories go
 * between sessions. Intraday headlines map within their original bar or into a
 * gap between sessions. Exact publication times remain visible in the details.
 * Nearby marks share one group; its anchor stays on the earliest story.
 */
export function groupChartNews({ articles, history, interval, asOf, startDate, endDate, left, right }: {
  articles: readonly ChartNewsArticle[]; history: readonly Candle[]; interval: string;
  asOf: string; startDate: string; endDate: string; left: number; right: number;
}): ChartNewsGroup[] {
  if (!history.length || !Number.isFinite(Date.parse(asOf)) || !Number.isFinite(left) || !Number.isFinite(right) || right - left < 30) return [];
  const bucketSize = history.length <= 180 ? 1 : Math.ceil(history.length / 180);
  const bucketCount = Math.ceil(history.length / bucketSize), width = (right - left) / bucketCount;
  const daily = interval === '1d', duration = ({ '5m': 300000, '15m': 900000, '1h': 3600000 } as Record<string, number>)[interval];
  if (!daily && !duration) return [];
  const dates = history.map(bar => newsSessionDate(bar.time));
  const barEnds = daily ? [] : history.map((bar, i) => Math.min(bar.time + duration, Date.parse(easternTime(dates[i], '16:00:00')!)));
  const rows = [...new Map(articles.map(article => [article.id, article])).values()].filter(article => {
    const time = Date.parse(article.publishedAt), available = Date.parse(article.availableAt);
    if (!Number.isFinite(time) || !Number.isFinite(available) || available < time || available > Date.parse(asOf) || time > Date.parse(asOf)) return false;
    const day = newsSessionDate(time);
    if (day < startDate || day > endDate) return false;
    return true;
  }).sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || a.id.localeCompare(b.id));
  const groups: ChartNewsGroup[] = [];
  for (const article of rows) {
    const time = Date.parse(article.publishedAt), day = newsSessionDate(time);
    let lo = 0, hi = history.length;
    while (lo < hi) { const middle = (lo + hi) >>> 1; if (daily ? dates[middle] < day : history[middle].time <= time) lo = middle + 1; else hi = middle; }
    let position: number, outsideSession = false;
    if (daily && lo < history.length && dates[lo] === day) {
      position = Math.floor(lo / bucketSize) + .5;
    } else if (!daily && lo > 0 && time < barEnds[lo - 1]) {
      position = (lo - 1 + Math.min(.999, (time - history[lo - 1].time) / Math.max(1, barEnds[lo - 1] - history[lo - 1].time))) / bucketSize;
    } else {
      outsideSession = true;
      if (lo === 0) position = 0;
      else if (lo >= history.length) position = bucketCount;
      else if (!daily) position = lo / bucketSize;
      else {
        const before = Date.parse(dates[lo - 1] + 'T00:00:00Z');
        const after = Date.parse(dates[lo] + 'T00:00:00Z');
        const stamp = Date.parse(day + 'T00:00:00Z');
        const fraction = Math.max(0, Math.min(1, (stamp - before) / Math.max(1, after - before)));
        position = (lo - .5 + fraction) / bucketSize;
      }
    }
    const x = Math.max(left + 13, Math.min(right - 13, left + position * width));
    const previous = groups.at(-1);
    if (previous && x - previous.x < 32) { previous.articles.push(article); previous.outsideSession ||= outsideSession; }
    else groups.push({ id: article.id, x, articles: [article], outsideSession });
  }
  return groups;
}
