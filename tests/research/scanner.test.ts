import test from 'node:test';
import assert from 'node:assert/strict';
import { headlineSentiment, newsSentiment } from '../../src/cores/03-noticias-financieras/sentiment.ts';
import { evaluateScanner } from '../../src/cores/evaluacion/scanner.ts';
import { SCANNER_CORE_IDS, defaultScannerSettings, scannerSettingsSchema, type ScannerCoreId } from '../../src/cores/evaluacion/scanner-settings.ts';
import { demoResearch } from '../../src/features/research/demo-research.ts';
import { companies } from '../../src/features/market/data.ts';
import { analysisPolicy, defaultAnalysisSettings } from '../../src/features/research/analysis-settings.ts';
import { rankObservedCompanies } from '../../src/cores/evaluacion/observed-ranking.ts';
import { watchlistSchema } from '../../src/db/state.ts';
import { optionValidationExample } from '../../src/features/research/validation-example.ts';
import { validateOptionRanking } from '../../src/cores/evaluacion/option-validation.ts';
import { missingVariable } from '../../src/cores/compartido/research-model.ts';
import { researchHistoryStart } from '../../src/features/research/research-history.ts';

const config = (weights: Partial<Record<ScannerCoreId, number>>) => ({ ...defaultScannerSettings,
  cores: Object.fromEntries(SCANNER_CORE_IDS.map(id => [id, { enabled: id in weights, weight: weights[id] ?? 1 }])) as typeof defaultScannerSettings.cores });
const snapshot = () => demoResearch(companies.find(c => c.symbol === 'NVDA')!, '2026-05-01', '2026-11-24', 30, .04);
const article = (headline: string, id = '1', publishedAt = '2026-11-23T16:00:00Z', availableAt = publishedAt) => ({ id, headline, publishedAt, availableAt, source: 'Test source', url: null });

test('headline rules distinguish sentiment, negation, neutral and earnings without turning them into probabilities', () => {
  assert.ok(headlineSentiment('Company beats earnings estimates and raises guidance').score > 0);
  assert.ok(headlineSentiment('Company misses earnings estimates and cuts guidance').score < 0);
  assert.ok(headlineSentiment('Company does not beat estimates').score < 0);
  assert.ok(headlineSentiment('No bankruptcy risk announced').score > 0);
  assert.ok(headlineSentiment('La empresa supera expectativas de resultados trimestrales').score > 0);
  assert.equal(headlineSentiment('Board meets on Tuesday').label, 'neutral');
  assert.equal(headlineSentiment('Quarterly results announced').earnings, true);
});

test('news excludes future revisions, stale stories and duplicates across sources and decays by publication time', () => {
  const s = snapshot();
  s.news.articles = [article('Company beats earnings estimates'), article('Company beats earnings estimates', 'copy'),
    article('Company misses estimates', 'negative', '2026-11-09T16:00:00Z'),
    article('Company bankruptcy', 'future', '2026-11-25T16:00:00Z'),
    article('Company fraud', 'revision', '2026-11-22T16:00:00Z', '2026-11-25T16:00:00Z'),
    article('Company losses', 'old', '2026-10-01T16:00:00Z')];
  const sentiment = newsSentiment(s.news, s.asOf);
  assert.equal(sentiment.articles.length, 2);
  assert.ok(sentiment.score! > 0, 'recent positive story outweighs old negative story');
  assert.equal(newsSentiment(s.news, 'invalid').score, null);
});

test('disabled and unavailable cores do not dilute participation; all unavailable means no score', () => {
  const s = snapshot(); s.news.articles = [article('Company beats earnings estimates')];
  s.fundamentals.netMargin = missingVariable('SEC', 'No source');
  s.fundamentals.liabilitiesToAssets = missingVariable('SEC', 'No source');
  const onlyNews = evaluateScanner(s, 'wheel', 30, config({ news: 1 }));
  const missingAdded = evaluateScanner(s, 'wheel', 30, config({ news: 1, institutional: 100, fundamental: 100 }));
  assert.equal(missingAdded.score, onlyNews.score);
  assert.equal(missingAdded.availableWeight, 1);
  assert.equal(missingAdded.available, 1);
  assert.equal(missingAdded.missing, 2);
  assert.equal(evaluateScanner(s, 'wheel', 30, config({ institutional: 1 })).score, null);
  assert.equal(evaluateScanner(s, 'wheel', 30, config({ news: 0 })).score, null, 'zero weight excludes a selected core');
  assert.equal(evaluateScanner(s, 'wheel', 30, config({})).results.length, 0);
});

test('headline sentiment affects confluence, projected price and actual put payoff; disabled news has no effect', () => {
  const positive = snapshot();
  positive.options.contracts = positive.options.contracts.filter(c => c.type === 'put' && Math.abs(c.strike.value! - positive.market.spot.value!) < .01);
  const negative = structuredClone(positive);
  positive.news.articles = [article('Company beats earnings estimates and raises guidance')];
  negative.news.articles = [article('Company misses earnings estimates and cuts guidance')];
  const settings = { ...defaultAnalysisSettings, scanner: config({ technical: 1, news: 4 }) };
  const a = evaluateScanner(positive, 'wheel', 30, settings.scanner, analysisPolicy(settings, positive));
  const b = evaluateScanner(negative, 'wheel', 30, settings.scanner, analysisPolicy(settings, negative));
  assert.ok(a.score! > b.score!);
  assert.ok(a.projection!.target > b.projection!.target);
  assert.ok(a.projection!.newsImpact > 0);
  assert.ok(b.projection!.newsImpact < 0);
  assert.ok(a.projection!.pnl! > b.projection!.pnl!, 'sentiment changes the put payoff, not a decorative label');
  assert.deepEqual(positive.market.bars, negative.market.bars, 'sentiment never rewrites observed candles');
  const off = config({ technical: 1 });
  assert.equal(evaluateScanner(positive, 'wheel', 30, off).projection!.target, evaluateScanner(negative, 'wheel', 30, off).projection!.target);
  assert.equal(evaluateScanner(positive, 'wheel', 30, off).projection!.newsImpact, 0);
  const weighted = evaluateScanner(positive, 'wheel', 30, config({ technical: 1, news: 1 }));
  assert.notEqual(weighted.score, a.score, 'relative weights influence confluence');
  assert.notEqual(weighted.projection!.target, a.projection!.target);
});

test('institutional core requires observed, recent, normalized and temporally available flow', () => {
  const s = snapshot(), settings = config({ institutional: 1 });
  s.institutionalFlow = { value: .6, kind: 'observed', source: 'Verified institutional feed', observedAt: s.asOf, availableAt: s.asOf };
  assert.equal(evaluateScanner(s, 'wheel', 30, settings).score, 80);
  s.institutionalFlow.kind = 'assumed';
  assert.equal(evaluateScanner(s, 'wheel', 30, settings).score, null);
  s.institutionalFlow.kind = 'observed'; s.institutionalFlow.availableAt = '2026-11-25T16:00:00Z';
  assert.equal(evaluateScanner(s, 'wheel', 30, settings).score, null);
  s.institutionalFlow.availableAt = s.asOf; s.institutionalFlow.value = 1.5;
  assert.equal(evaluateScanner(s, 'wheel', 30, settings).score, null);
});

test('Monte Carlo uses the strategy legs and a reproducible seed, including two PMCC maturities', () => {
  const s = snapshot(), settings = config({ monteCarlo: 1 });
  const policy = analysisPolicy(defaultAnalysisSettings, s);
  const first = evaluateScanner(s, 'wheel', 30, settings, policy);
  const second = evaluateScanner(s, 'wheel', 30, settings, policy);
  assert.ok(first.monteCarloPop !== null && first.monteCarloPop >= 0 && first.monteCarloPop <= 1);
  assert.equal(first.monteCarloPop, second.monteCarloPop);
  const diagonal = evaluateScanner(s, 'pmcc', 30, settings, { ...policy, capital: 100000 });
  assert.ok(diagonal.score !== null);
  assert.ok(diagonal.projection?.pnl !== null);
  assert.equal(diagonal.projection?.pnlMethod, 'diagonal');
});

test('ranking and saved-list settings use the same seven-core evaluation while old rankings remain supported', () => {
  const s = snapshot(); s.news.articles = [article('Company beats earnings estimates')];
  const settings = { ...defaultAnalysisSettings, scanner: config({ news: 3, institutional: 1 }) };
  const ranked = rankObservedCompanies([s], ['bsm'], 'wheel', 30, analysisPolicy(settings, s))[0];
  assert.equal(ranked.score, 75);
  assert.equal(ranked.availableCoreCount, 1);
  assert.ok(ranked.reason.includes('institutional: sin datos'));
  const saved = watchlistSchema.parse({ id: 'scanner-test', name: 'Scanner test', symbols: ['NVDA'], strategy: 'wheel', scores: { NVDA: { score: ranked.score!, reason: ranked.reason } },
    config: { cores: ['bsm'], operationStart: '2026-11-24', operationEnd: '2026-12-24', startTime: '09:30', endTime: '16:00', historyStart: '2026-05-01', historyEnd: '2026-11-24', interval: '1d', rate: .04, analysis: settings } });
  assert.deepEqual(saved.config!.analysis!.scanner, scannerSettingsSchema.parse(settings.scanner));
  assert.ok(rankObservedCompanies([s], ['trend'], 'wheel', 30)[0].score !== null);
  assert.equal(scannerSettingsSchema.safeParse({ ...settings.scanner, cores: { ...settings.scanner.cores, news: { enabled: true, weight: -1 } } }).success, false);
});

test('short demo windows load preparation candles and provide tagged fundamental/news examples', () => {
  const s = demoResearch(companies[0], '2026-11-23', '2026-11-24', 30, .04);
  const result = evaluateScanner(s, 'wheel', 30, config({ own: 1, technical: 1, fundamental: 1, news: 1, structure: 1 }));
  assert.ok(s.market.bars.length >= 200);
  assert.equal(result.available, 5);
  assert.ok(s.news.articles.every(a => a.headline.startsWith('DEMO:')));
  assert.equal(s.fundamentals.netMargin.kind, 'assumed');
  assert.equal(researchHistoryStart('2023-01-01','2026-11-24'), '2023-01-01');
});

test('a verified empty news response is neutral, while failed coverage remains missing', () => {
  const s = snapshot(); s.news.articles = [];
  assert.equal(evaluateScanner(s, 'wheel', 30, config({ news: 1 })).score, 50);
  s.news.complete = false; s.news.status.status = 'error';
  assert.equal(evaluateScanner(s, 'wheel', 30, config({ news: 1 })).score, null);
});

test('legacy quantitative validation remains isolated from scanner evidence missing in its historical import format', () => {
  const example = optionValidationExample();
  const original = validateOptionRanking(example, ['probability'], 'wheel', 30, { capital: 20000 });
  const withScanner = validateOptionRanking(example, ['probability'], 'wheel', 30, { capital: 20000, scanner: defaultScannerSettings });
  assert.deepEqual(withScanner, original);
});
