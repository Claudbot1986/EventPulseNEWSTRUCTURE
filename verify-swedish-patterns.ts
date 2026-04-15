/**
 * Swedish Pattern Verification Script
 *
 * Tests Swedish event path patterns on NEEDS_SUBPAGE_DISCOVERY sources
 * to understand exactly where patterns succeed or fail.
 *
 * Run: npx tsx verify-swedish-patterns.ts
 */

import { fetchHtml } from './02-Ingestion/tools/fetchTools.js';
import { evaluateHtmlGate } from './02-Ingestion/C-htmlGate/index.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import https from 'https';
import http from 'http';
import { load } from 'cheerio';

// Swedish patterns from C0-htmlFrontierDiscovery.ts
const SWEDISH_PATTERNS = [
  '/events',
  '/program',
  '/kalender',
  '/schema',
  '/evenemang',
  '/kalendarium',
  '/aktiviteter',
  '/kultur',
  '/fritid',
  '/matcher',
  '/biljetter',
];

// Sources to test — NEEDS_SUBPAGE_DISCOVERY sources from batch-14/15
const SOURCES: { sourceId: string; rootUrl: string }[] = [
  { sourceId: 'bk-hacken', rootUrl: 'https://hacken.se/' },
  { sourceId: 'blekholmen', rootUrl: 'https://blekholmen.se/' },
  { sourceId: 'boplanet', rootUrl: 'https://boplanet.se/' },
  { sourceId: 'borlange-kommun', rootUrl: 'https://borlange.se/' },
  { sourceId: 'botaniska-tradgarden', rootUrl: 'https://botaniska.se/' },
  { sourceId: 'brommapojkarna', rootUrl: 'https://bpxf.se/' },
  { sourceId: 'chalmers', rootUrl: 'https://chalmers.se/' },
  { sourceId: 'cirkus', rootUrl: 'https://cirkus.se/' },
  { sourceId: 'club-mecca', rootUrl: 'https://clubmecca.se/' },
  { sourceId: 'dalarna', rootUrl: 'https://dalarna.se/' },
  { sourceId: 'mittuniversitetet', rootUrl: 'https://miun.se/evenemang' },
  { sourceId: 'kungsbacka', rootUrl: 'https://kungsbacka.se/' },
  { sourceId: 'h-gskolan-i-sk-vde', rootUrl: 'https://his.se/evenemang' },
  { sourceId: 'malm-opera', rootUrl: 'https://malmoopera.se/' },
];

interface HttpResult {
  status: number | null;
  contentType: string | null;
  error?: string;
}

interface DensitySignals {
  dateMentions: number;
  timeTagCount: number;
  eventBlockCount: number;
  ticketCtaCount: number;
  densityScore: number;
}

interface PatternTestResult {
  sourceId: string;
  rootUrl: string;
  root: { http: HttpResult; density: DensitySignals };
  patterns: {
    pattern: string;
    url: string;
    http: HttpResult;
    density: DensitySignals;
    c2Score?: number;
    c2Verdict?: string;
    passedC2?: boolean;
    status: 'hit' | 'miss' | 'error' | 'low_density';
    reason: string;
  }[];
  summary: {
    patternsTested: number;
    hits: number;
    misses: number;
    errors: number;
    c2Hits: number;
    bestPattern?: string;
    bestDensity?: number;
  };
}

async function httpStatus(url: string): Promise<HttpResult> {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { timeout: 8000 }, (res) => {
      resolve({ status: res.statusCode ?? null, contentType: res.headers['content-type'] ?? null });
      res.resume();
    });
    req.on('error', (e) => resolve({ status: null, contentType: null, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: null, contentType: null, error: 'timeout' }); });
  });
}

function computeDensity(html: string): DensitySignals {
  const $ = load(html);

  const isoDateRegex = /\d{4}-\d{2}-\d{2}/g;
  const sweDateRegex = /\d{1,2}\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\s+\d{4}/gi;
  const text = $('body').text();
  const isoDates = (text.match(isoDateRegex) || []).length;
  const sweDates = (text.match(sweDateRegex) || []).length;
  const dateMentions = isoDates + sweDates;

  const timeTagCount = $('time[datetime]').length;

  const eventSelectors = [
    '.event', '.kalender', '.program', '.konsert', '.concert',
    '[class*="event"]', '[class*="kalender"]', '[class*="program"]',
  ];
  let eventBlockCount = 0;
  for (const sel of eventSelectors) {
    eventBlockCount += $(sel).length;
  }

  const ticketSelectors = ['.biljett', '.ticket', '.kopa', '[class*="biljett"]', '[class*="ticket"]'];
  let ticketCtaCount = 0;
  for (const sel of ticketSelectors) {
    ticketCtaCount += $(sel).length;
  }

  const densityScore = dateMentions * 2 + timeTagCount * 3 + eventBlockCount + ticketCtaCount;

  return { dateMentions, timeTagCount, eventBlockCount, ticketCtaCount, densityScore };
}

async function testPattern(sourceId: string, rootUrl: string, pattern: string): Promise<PatternTestResult['patterns'][0]> {
  const url = new URL(pattern, rootUrl).href;

  const http = await httpStatus(url);

  if (http.error || !http.status || http.status >= 400) {
    return {
      pattern, url, http,
      density: { dateMentions: 0, timeTagCount: 0, eventBlockCount: 0, ticketCtaCount: 0, densityScore: 0 },
      status: http.error ? 'error' : 'miss',
      reason: http.error ? `http_error: ${http.error}` : `http_${http.status}`,
    };
  }

  const fetch = await fetchHtml(url, { timeout: 10000 });
  if (!fetch.success || !fetch.html) {
    return {
      pattern, url, http,
      density: { dateMentions: 0, timeTagCount: 0, eventBlockCount: 0, ticketCtaCount: 0, densityScore: 0 },
      status: 'error',
      reason: `fetch_failed: ${fetch.error || 'no html'}`,
    };
  }

  const density = computeDensity(fetch.html);

  if (density.densityScore === 0) {
    return {
      pattern, url, http, density,
      status: 'low_density',
      reason: `density=0 (dates=${density.dateMentions}, timeTags=${density.timeTagCount}, blocks=${density.eventBlockCount})`,
    };
  }

  try {
    const c2 = await evaluateHtmlGate(url, 'no-jsonld', 2);
    const passedC2 = c2.verdict === 'promising' || c2.score >= 12;
    return {
      pattern, url, http, density,
      c2Score: c2.score,
      c2Verdict: c2.verdict,
      passedC2,
      status: passedC2 ? 'hit' : 'miss',
      reason: passedC2
        ? `C2 hit: score=${c2.score}, verdict=${c2.verdict}`
        : `C2 miss: score=${c2.score}, verdict=${c2.verdict} (threshold=12)`,
    };
  } catch (e: any) {
    return {
      pattern, url, http, density,
      status: 'error',
      reason: `c2_error: ${e.message}`,
    };
  }
}

async function testSource(source: { sourceId: string; rootUrl: string }): Promise<PatternTestResult> {
  console.log(`\n[${source.sourceId}] Root: ${source.rootUrl}`);

  const rootHttp = await httpStatus(source.rootUrl);
  let rootDensity: DensitySignals = { dateMentions: 0, timeTagCount: 0, eventBlockCount: 0, ticketCtaCount: 0, densityScore: 0 };
  if (!rootHttp.error && rootHttp.status && rootHttp.status < 400) {
    const rootFetch = await fetchHtml(source.rootUrl, { timeout: 10000 });
    if (rootFetch.success && rootFetch.html) {
      rootDensity = computeDensity(rootFetch.html);
    }
  }
  console.log(`  Root: HTTP=${rootHttp.status ?? rootHttp.error ?? '?'}, density=${rootDensity.densityScore}`);

  const patterns: PatternTestResult['patterns'] = [];
  for (const pattern of SWEDISH_PATTERNS) {
    const result = await testPattern(source.sourceId, source.rootUrl, pattern);
    patterns.push(result);
    const icon = result.status === 'hit' ? '✅' : result.status === 'miss' ? '❌' : result.status === 'low_density' ? '⚠️' : '🚫';
    console.log(`  ${icon} ${pattern}: HTTP=${result.http.status ?? result.http.error ?? '?'}, density=${result.density.densityScore}, C2=${result.c2Score ?? 'N/A'}, reason=${result.reason.substring(0, 80)}`);
  }

  const hits = patterns.filter(p => p.status === 'hit');
  const misses = patterns.filter(p => p.status === 'miss');
  const errors = patterns.filter(p => p.status === 'error');
  const c2Hits = patterns.filter(p => p.passedC2);

  let bestPattern: string | undefined;
  let bestDensity = 0;
  for (const p of patterns) {
    if (p.density.densityScore > bestDensity) {
      bestDensity = p.density.densityScore;
      bestPattern = p.pattern;
    }
  }

  return {
    sourceId: source.sourceId,
    rootUrl: source.rootUrl,
    root: { http: rootHttp, density: rootDensity },
    patterns,
    summary: { patternsTested: patterns.length, hits: hits.length, misses: misses.length, errors: errors.length, c2Hits: c2Hits.length, bestPattern, bestDensity },
  };
}

async function main() {
  console.log('='.repeat(70));
  console.log('SWEDISH PATTERN VERIFICATION — NEEDS_SUBPAGE_DISCOVERY sources');
  console.log('='.repeat(70));
  console.log(`Sources: ${SOURCES.length} | Patterns: ${SWEDISH_PATTERNS.join(', ')}`);

  const results: PatternTestResult[] = [];

  for (const source of SOURCES) {
    const result = await testSource(source);
    results.push(result);
    await new Promise(r => setTimeout(r, 500));
  }

  const outputDir = './02-Ingestion/C-htmlGate/reports/swedish-pattern-verification';
  mkdirSync(outputDir, { recursive: true });

  const fullResultsPath = join(outputDir, 'full-results.jsonl');
  writeFileSync(fullResultsPath, results.map(r => JSON.stringify(r)).join('\n'));

  // Build summary markdown
  const lines: string[] = [
    '# Swedish Pattern Verification — Summary',
    '',
    `**Generated:** ${new Date().toISOString()}`,
    `**Sources tested:** ${SOURCES.length}`,
    '',
    '## Per-Source Summary',
    '',
    '| Source | Root URL | Root Density | Patterns Tested | Hits | C2 Hits | Best Pattern | Best Density |',
    '|--------|----------|-------------|----------------|------|---------|--------------|-------------|',
  ];

  for (const r of results) {
    lines.push(`| ${r.sourceId} | ${r.rootUrl} | ${r.root.density.densityScore} | ${r.summary.patternsTested} | ${r.summary.hits} | ${r.summary.c2Hits} | ${r.summary.bestPattern || 'none'} | ${r.summary.bestDensity} |`);
  }

  lines.push('');
  lines.push('## Pattern Hit Rate');
  lines.push('');
  lines.push('| Pattern | Hits | Tests | Hit Rate |');
  lines.push('|---------|------|-------|----------|');

  const patternHits: Record<string, { hits: number; tests: number }> = {};
  for (const pattern of SWEDISH_PATTERNS) patternHits[pattern] = { hits: 0, tests: 0 };
  for (const r of results) {
    for (const p of r.patterns) {
      patternHits[p.pattern].tests++;
      if (p.status === 'hit') patternHits[p.pattern].hits++;
    }
  }
  for (const [pattern, data] of Object.entries(patternHits)) {
    const rate = data.tests > 0 ? `${(data.hits / data.tests * 100).toFixed(0)}%` : 'N/A';
    lines.push(`| ${pattern} | ${data.hits} | ${data.tests} | ${rate} |`);
  }

  lines.push('');
  lines.push('## Failure Analysis');
  lines.push('');

  lines.push('### All-miss sources (0 hits across all patterns)');
  for (const r of results) {
    if (r.summary.hits === 0) {
      const errorCount = r.patterns.filter(p => p.status === 'error').length;
      const missCount = r.patterns.filter(p => p.status === 'miss').length;
      const lowDensityCount = r.patterns.filter(p => p.status === 'low_density').length;
      lines.push(`- **${r.sourceId}** (${r.rootUrl}): root_density=${r.root.density.densityScore} — ${missCount} misses, ${lowDensityCount} low_density, ${errorCount} errors`);
      const bestMiss = r.patterns.filter(p => p.density.densityScore > 0).sort((a, b) => b.density.densityScore - a.density.densityScore)[0];
      if (bestMiss) {
        lines.push(`  → Best attempt: ${bestMiss.pattern} density=${bestMiss.density.densityScore}, C2=${bestMiss.c2Score ?? 'N/A'}, reason: ${bestMiss.reason.substring(0, 100)}`);
      }
    }
  }

  lines.push('');
  lines.push('### C2 hit sources (potential successes if extraction is run)');
  for (const r of results) {
    if (r.summary.c2Hits > 0) {
      const best = r.patterns.filter(p => p.passedC2).sort((a, b) => (b.c2Score ?? 0) - (a.c2Score ?? 0))[0];
      lines.push(`- **${r.sourceId}**: ✅ ${best.pattern} → HTTP=${best.http.status}, density=${best.density.densityScore}, C2 score=${best.c2Score}, verdict=${best.c2Verdict}`);
    }
  }

  lines.push('');
  lines.push('## Root URL Analysis — Already event-specific URLs?');
  for (const r of results) {
    const hasEventPath = r.rootUrl.match(/\/(evenemang|events|kalender|program)\//);
    const icon = hasEventPath ? '🔗' : '🏠';
    lines.push(`${icon} **${r.sourceId}**: ${r.rootUrl} (root_density=${r.root.density.densityScore}, ${hasEventPath ? 'HAS event path' : 'root URL'})`);
  }

  lines.push('');
  lines.push('## C2 Failure Breakdown — density > 0 but C2 rejected');
  for (const r of results) {
    const lowC2 = r.patterns.filter(p => p.status === 'miss' && p.density.densityScore > 0);
    if (lowC2.length > 0) {
      const worst = lowC2.sort((a, b) => b.density.densityScore - a.density.densityScore)[0];
      lines.push(`- **${r.sourceId}**: best pattern=${worst.pattern} density=${worst.density.densityScore}, C2 score=${worst.c2Score ?? 'N/A'} (threshold=12) → ${worst.reason.substring(0, 80)}`);
    }
  }

  lines.push('');
  lines.push(`*Full results: ${fullResultsPath}*`);

  const summaryPath = join(outputDir, 'summary.md');
  writeFileSync(summaryPath, lines.join('\n'));

  console.log(`\n${'='.repeat(70)}`);
  console.log('DONE');
  console.log(`Summary: ${summaryPath}`);
  console.log(`Full results: ${fullResultsPath}`);

  console.log('\n--- CONSOLE SUMMARY ---');
  for (const r of results) {
    const s = r.summary;
    console.log(`${r.sourceId}: hits=${s.hits}, misses=${s.misses}, errors=${s.errors}, c2Hits=${s.c2Hits} — best: ${s.bestPattern || 'none'} (d=${s.bestDensity})`);
  }
}

main().catch(console.error);
