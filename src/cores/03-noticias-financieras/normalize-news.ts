import type { ResearchNews } from '../compartido/research-model.ts';
import { record, timestamp } from '../compartido/data-values.ts';

/** Keep only news and revisions already published at the decision cutoff. */
export function normalizeFinancialNews(input: readonly unknown[], asOf: string): ResearchNews['articles'] {
  const articles: ResearchNews['articles'] = [];
  for (const raw of input) {
    const item = record(raw);
    const publishedAt = timestamp(item.created_at);
    const updatedAt = timestamp(item.updated_at);
    // Headline can change on update: both dates must predate the decision.
    if (!publishedAt || !updatedAt || Date.parse(publishedAt) > Date.parse(asOf) || Date.parse(updatedAt) > Date.parse(asOf) || typeof item.headline !== 'string') continue;
    let url: string | null = null;
    try { const parsed = new URL(String(item.url)); if (parsed.protocol === 'https:') url = parsed.toString(); } catch { /* no unsafe links */ }
    articles.push({ id: String(item.id), headline: item.headline.slice(0, 500), url, source: typeof item.source === 'string' ? item.source : 'Alpaca', publishedAt, availableAt: updatedAt });
  }
  return articles;
}
