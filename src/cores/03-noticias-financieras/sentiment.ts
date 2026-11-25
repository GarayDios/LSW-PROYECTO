import type { ResearchNews } from '../compartido/research-model.ts';

export type HeadlineSentiment = { score: number; label: 'positivo' | 'negativo' | 'neutral'; matches: string[]; earnings: boolean };
// Explicit, inspectable bilingual rules. These scores are scenario inputs, not
// calibrated probabilities or proof that a headline caused a price movement.
const positive = ['beat', 'beats', 'surge', 'surges', 'upgrade', 'upgraded', 'record profit', 'record revenue', 'raises guidance', 'growth', 'approval', 'approved', 'rally', 'supera expectativas', 'beneficio record', 'crecimiento', 'sube', 'alza', 'aprobacion'];
const negative = ['misses', 'missed', 'plunge', 'plunges', 'downgrade', 'downgraded', 'cuts guidance', 'loss', 'losses', 'lawsuit', 'fraud', 'bankruptcy', 'recall', 'decline', 'falls', 'cae', 'caida', 'perdida', 'recorta', 'demanda', 'quiebra'];
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function headlineSentiment(headline: string): HeadlineSentiment {
  const text = normalize(headline), matches: string[] = [];
  let total = 0;
  for (const [words, sign] of [[positive, 1], [negative, -1]] as const) {
    for (const word of words) {
      const match = new RegExp(`\\b${word}\\b`).exec(text);
      if (!match) continue;
      const prefix = text.slice(Math.max(0, match.index - 35), match.index);
      const negated = /\b(no|not|never|without|sin)\s+(?:\w+\s+){0,2}$/.test(prefix);
      total += negated ? -sign : sign;
      matches.push(`${negated ? 'negación: ' : ''}${word}`);
    }
  }
  const score = total / (1 + Math.abs(total));
  return { score, label: score > 0 ? 'positivo' : score < 0 ? 'negativo' : 'neutral', matches,
    earnings: /\b(earnings|eps|quarterly results|resultados trimestrales|reporte de resultados)\b/.test(text) };
}

export function newsSentiment(news: ResearchNews, asOf: string) {
  const cutoff = Date.parse(asOf), seen = new Set<string>(), ids = new Set<string>();
  const articles = [...news.articles].sort((a,b) => Date.parse(b.availableAt) - Date.parse(a.availableAt)).filter(article => {
    const published = Date.parse(article.publishedAt), available = Date.parse(article.availableAt);
    const key = normalize(article.headline).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!Number.isFinite(cutoff) || !key || !Number.isFinite(published) || !Number.isFinite(available) || available < published || available > cutoff || published > cutoff
      || cutoff - published > 30 * 86400000 || seen.has(key) || ids.has(article.id)) return false;
    seen.add(key); ids.add(article.id); return true;
  }).map(article => ({ ...article, ...headlineSentiment(article.headline), weight: Math.exp(-Math.LN2 * (cutoff - Date.parse(article.publishedAt)) / (7 * 86400000)) }));
  const weight = articles.reduce((sum, a) => sum + a.weight, 0);
  return { score: weight ? articles.reduce((sum, a) => sum + a.score * a.weight, 0) / weight : null,
    articles, complete: news.complete, matched: articles.filter(a => a.matches.length).length, earningsCount: articles.filter(a => a.earnings).length };
}
