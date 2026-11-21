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
    if (!publishedAt || !updatedAt || Date.parse(updatedAt) < Date.parse(publishedAt)
      || Date.parse(publishedAt) > Date.parse(asOf) || Date.parse(updatedAt) > Date.parse(asOf)
      || typeof item.headline !== 'string' || !item.headline.trim()
      || !['string', 'number'].includes(typeof item.id) || !String(item.id).trim() || String(item.id).length > 128) continue;
    let url: string | null = null;
    try { const parsed = new URL(String(item.url)); if (parsed.protocol === 'https:') url = parsed.toString(); } catch { /* no unsafe links */ }
    articles.push({ id: String(item.id), headline: item.headline.trim().slice(0, 500), url, source: typeof item.source === 'string' && item.source.trim() ? item.source.trim().slice(0, 200) : 'Alpaca', publishedAt, availableAt: updatedAt });
  }
  return articles;
}
