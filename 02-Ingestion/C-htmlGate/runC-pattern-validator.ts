/**
 * runC-pattern-validator.ts — Validates AI-discovered URL patterns via dry-run
 *
 * Reads patterns from reports/ai-discovery/*.json (runC-ai-deep-discovery output).
 * For each pattern that appears on ≥2 distinct source domains:
 *   1. Run a C0 dry-run on 5 test sources from postB-preC (BASELINE)
 *   2. Run C0 with the candidate pattern added (CANDIDATE)
 *   3. Compare event yield: if ≥20% improvement on ≥2 domains → CONFIRMED
 *   4. If <2 domains improve → REJECTED (site-specific)
 *
 * Output: reports/pattern-validation/validation-{timestamp}.json
 *
 * Usage:
 *   npx tsx 02-Ingestion/C-htmlGate/runC-pattern-validator.ts
 *   npx tsx 02-Ingestion/C-htmlGate/runC-pattern-validator.ts --min-sources 3
 *   npx tsx 02-Ingestion/C-htmlGate/runC-pattern-validator.ts --test-sources 10
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchHtml } from '../../tools/fetchTools';
import { load } from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..', '..');
const RUNTIME_DIR = join(PROJECT_ROOT, 'runtime');
const REPORTS_DIR = join(__dirname, 'reports', 'pattern-validation');
const AI_DISCOVERY_DIR = join(__dirname, 'reports', 'ai-discovery');
const C0_PATH = join(__dirname, 'C0-htmlFrontierDiscovery', 'C0-htmlFrontierDiscovery.ts');

// CLI args
const args = process.argv.slice(2);
const minSourcesIdx = args.indexOf('--min-sources');
const MIN_SOURCES = minSourcesIdx >= 0 ? parseInt(args[minSourcesIdx + 1] ?? '2', 10) : 2;
const testSourcesIdx = args.indexOf('--test-sources');
const TEST_SOURCES_N = testSourcesIdx >= 0 ? parseInt(args[testSourcesIdx + 1] ?? '5', 10) : 5;

// ── Types ──────────────────────────────────────────────────────────────────────

interface AiDiscoveryReport {
  runId: string;
  timestamp: string;
  sources: SourceDiscoveryResult[];
  newPatternsFound: string[];
}

interface SourceDiscoveryResult {
  sourceId: string;
  sourceUrl: string;
  outcome: string;
  eventsFound: number;
  bestUrl: string | null;
  patternsDiscovered: string[];
}

interface PatternCandidate {
  pattern: string;
  hitSources: string[];
  totalHits: number;
  avgEventsPerHit: number;
  domains: string[];
}

interface ValidationResult {
  pattern: string;
  baseline: DomainResult[];
  candidate: DomainResult[];
  improvement: number;
  improvedDomains: number;
  status: 'confirmed' | 'rejected' | 'insufficient-data';
  reason: string;
}

interface DomainResult {
  sourceId: string;
  domain: string;
  eventsFound: number;
  winnerUrl: string | null;
}

interface ValidationReport {
  runId: string;
  timestamp: string;
  minSources: number;
  testSources: string[];
  candidates: PatternCandidate[];
  validations: ValidationResult[];
  summary: {
    confirmed: number;
    rejected: number;
    pending: number;
    confirmedPatterns: string[];
    rejectedPatterns: string[];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function loadAiReports(): AiDiscoveryReport[] {
  mkdirSync(AI_DISCOVERY_DIR, { recursive: true });
  const files = readdirSync(AI_DISCOVERY_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) return [];

  return files.map(f => {
    try {
      return JSON.parse(readFileSync(join(AI_DISCOVERY_DIR, f), 'utf8')) as AiDiscoveryReport;
    } catch {
      return null;
    }
  }).filter(Boolean) as AiDiscoveryReport[];
}

function extractCandidates(reports: AiDiscoveryReport[], minSources: number): PatternCandidate[] {
  const patternMap = new Map<string, {
    hitSources: Set<string>;
    domains: Set<string>;
    eventsBySource: Map<string, number>;
  }>();

  for (const report of reports) {
    for (const src of report.sources) {
      if (src.outcome !== 'success' || src.eventsFound === 0) continue;

      for (const pattern of src.patternsDiscovered) {
        if (!patternMap.has(pattern)) {
          patternMap.set(pattern, {
            hitSources: new Set(),
            domains: new Set(),
            eventsBySource: new Map(),
          });
        }
        const entry = patternMap.get(pattern)!;
        entry.hitSources.add(src.sourceId);
        entry.domains.add(getDomain(src.sourceUrl));
        if (!entry.eventsBySource.has(src.sourceId) || entry.eventsBySource.get(src.sourceId)! < src.eventsFound) {
          entry.eventsBySource.set(src.sourceId, src.eventsFound);
        }
      }
    }
  }

  const candidates: PatternCandidate[] = [];
  for (const [pattern, entry] of patternMap) {
    if (entry.hitSources.size < minSources) continue;
    const events = Array.from(entry.eventsBySource.values());
    const avgEvents = events.reduce((a, b) => a + b, 0) / events.length;
    candidates.push({
      pattern,
      hitSources: Array.from(entry.hitSources),
      totalHits: entry.hitSources.size,
      avgEventsPerHit: parseFloat(avgEvents.toFixed(2)),
      domains: Array.from(entry.domains),
    });
  }

  candidates.sort((a, b) => b.totalHits - a.totalHits);
  return candidates;
}

function loadTestSources(n: number): Array<{ sourceId: string; url: string }> {
  const prec = join(RUNTIME_DIR, 'postB-preC-queue.jsonl');
  try {
    const content = readFileSync(prec, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    return lines.slice(0, n).map(line => {
      try {
        const e = JSON.parse(line);
        return { sourceId: e.sourceId ?? e.url, url: e.url };
      } catch { return null; }
    }).filter(Boolean) as Array<{ sourceId: string; url: string }>;
  } catch {
    return [];
  }
}

async function measureEventDensityDirect(url: string): Promise<{
  dateMentions: number; timeTagCount: number;
  eventBlockCount: number; ticketCtaCount: number; linkCount: number;
}> {
  const result = await fetchHtml(url, { timeout: 10000 });
  if (!result.success || !result.html) {
    return { dateMentions: 0, timeTagCount: 0, eventBlockCount: 0, ticketCtaCount: 0, linkCount: 0 };
  }

  const $ = load(result.html);
  const isoDateRegex = /\d{4}-\d{2}-\d{2}/g;
  const sweDateRegex = /\d{1,2}\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\s+\d{4}/gi;
  const scopeText = $('body').text();
  const isoDates = (scopeText.match(isoDateRegex) || []).length;
  const sweDates = (scopeText.match(sweDateRegex) || []).length;

  return {
    dateMentions: isoDates + sweDates,
    timeTagCount: $('time[datetime]').length,
    eventBlockCount: $('[class*="event"], [class*="kalender"], [class*="program"]').length,
    ticketCtaCount: $('[class*="biljett"], [class*="ticket"]').length,
    linkCount: $('main a[href], article a[href]').length,
  };
}

async function runC0DryRun(
  sourceUrl: string,
  sourceId: string,
  extraPattern: string | null
): Promise<DomainResult> {
  // Baseline: run C0 as-is to get current event density
  const { discoverEventCandidates } = await import('../C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.ts');

  let winnerUrl: string | null = null;
  let eventsFound = 0;

  try {
    const result = await discoverEventCandidates(sourceUrl, undefined, sourceId);
    if (result.winner) {
      winnerUrl = result.winner.url;
      eventsFound = result.winner.eventDensityScore;
    }
  } catch {
    // fallback to direct measurement
  }

  // Additionally test the candidate pattern URL directly
  if (extraPattern) {
    try {
      const candidateUrl = new URL(extraPattern, sourceUrl).href;
      const metrics = await measureEventDensityDirect(candidateUrl);
      const score =
        metrics.dateMentions * 2 +
        metrics.timeTagCount * 3 +
        metrics.eventBlockCount +
        metrics.ticketCtaCount +
        Math.min(metrics.linkCount, 10);

      if (score > eventsFound) {
        eventsFound = score;
        winnerUrl = candidateUrl;
      }
    } catch {
      // ignore
    }
  }

  return {
    sourceId,
    domain: getDomain(sourceUrl),
    eventsFound,
    winnerUrl,
  };
}

function computeImprovement(baseline: DomainResult[], candidate: DomainResult[]): {
  improvement: number;
  improvedDomains: number;
} {
  let totalBaseline = 0;
  let totalCandidate = 0;
  let improvedDomains = 0;

  const baselineMap = new Map(baseline.map(b => [b.sourceId, b]));
  for (const c of candidate) {
    const b = baselineMap.get(c.sourceId);
    const bEvents = b?.eventsFound ?? 0;
    totalBaseline += bEvents;
    totalCandidate += c.eventsFound;
    if (c.eventsFound > bEvents) improvedDomains++;
  }

  const improvement = totalBaseline === 0
    ? (totalCandidate > 0 ? 100 : 0)
    : Math.round(((totalCandidate - totalBaseline) / totalBaseline) * 100);

  return { improvement, improvedDomains };
}

function getBuiltInSwedishPatterns(): string[] {
  try {
    const content = readFileSync(C0_PATH, 'utf8');
    const match = content.match(/SWEDISH_EVENT_PATTERNS\s*=\s*\[([\s\S]*?)\];?/);
    if (!match) return [];
    const inner = match[1];
    const patterns = inner.match(/'([^']+)'/g) ?? [];
    return patterns.map(p => '/' + p.replace(/'/g, ''));
  } catch {
    return [];
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('============================================================');
  console.log('PATTERN VALIDATOR — AI-discovered pattern dry-run validation');
  console.log('============================================================');
  console.log(`Min source hits: ${MIN_SOURCES}`);
  console.log(`Test sources: ${TEST_SOURCES_N}`);

  mkdirSync(REPORTS_DIR, { recursive: true });

  const reports = loadAiReports();
  console.log(`\nLoaded ${reports.length} AI discovery reports`);

  if (reports.length === 0) {
    console.log('No AI discovery reports found. Run runC-ai-deep-discovery.ts first.');
    process.exit(0);
  }

  const candidates = extractCandidates(reports, MIN_SOURCES);
  console.log(`Found ${candidates.length} candidate patterns (≥${MIN_SOURCES} source hits)`);

  if (candidates.length === 0) {
    console.log('No patterns meet the minimum source hit threshold.');
    process.exit(0);
  }

  for (const c of candidates) {
    console.log(`  ${c.pattern} — ${c.totalHits} sources, ${c.domains.length} domains, avg ${c.avgEventsPerHit} events`);
  }

  const testSources = loadTestSources(TEST_SOURCES_N);
  console.log(`\nLoaded ${testSources.length} test sources from postB-preC`);

  if (testSources.length === 0) {
    console.error('No test sources found in postB-preC queue.');
    process.exit(1);
  }

  const builtIn = getBuiltInSwedishPatterns();
  const validations: ValidationResult[] = [];

  for (const candidate of candidates) {
    console.log(`\n── Validating: ${candidate.pattern} ──`);

    if (builtIn.includes(candidate.pattern)) {
      console.log(`  [SKIP] ${candidate.pattern} is already in C0 SWEDISH_EVENT_PATTERNS`);
      continue;
    }

    const baselineResults: DomainResult[] = [];
    const candidateResults: DomainResult[] = [];

    for (const src of testSources) {
      const base = await runC0DryRun(src.url, src.sourceId, null);
      baselineResults.push(base);

      const cand = await runC0DryRun(src.url, src.sourceId, candidate.pattern);
      candidateResults.push(cand);

      const diff = cand.eventsFound - base.eventsFound;
      console.log(`  ${src.sourceId}: baseline=${base.eventsFound} cand=${cand.eventsFound} diff=${diff >= 0 ? '+' : ''}${diff}`);
    }

    if (candidateResults.length < 2) {
      validations.push({
        pattern: candidate.pattern,
        baseline: baselineResults,
        candidate: candidateResults,
        improvement: 0,
        improvedDomains: 0,
        status: 'insufficient-data',
        reason: `Only ${candidateResults.length} test sources ran (need ≥2)`,
      });
      continue;
    }

    const { improvement, improvedDomains } = computeImprovement(baselineResults, candidateResults);

    const status: ValidationResult['status'] =
      improvement >= 20 && improvedDomains >= 2 ? 'confirmed' : 'rejected';

    const reason = status === 'confirmed'
      ? `+${improvement}% events on ${improvedDomains}/${candidateResults.length} domains — generalizes across multiple sites`
      : `Only +${improvement}% on ${improvedDomains} domains — site-specific or insufficient lift`;

    validations.push({
      pattern: candidate.pattern,
      baseline: baselineResults,
      candidate: candidateResults,
      improvement,
      improvedDomains,
      status,
      reason,
    });

    console.log(`  → ${status.toUpperCase()}: ${reason}`);
  }

  const confirmedPatterns = validations.filter(v => v.status === 'confirmed').map(v => v.pattern);
  const rejectedPatterns = validations.filter(v => v.status === 'rejected').map(v => v.pattern);

  const report: ValidationReport = {
    runId: new Date().toISOString().replace(/[:.]/g, '-'),
    timestamp: new Date().toISOString(),
    minSources: MIN_SOURCES,
    testSources: testSources.map(s => s.sourceId),
    candidates,
    validations,
    summary: {
      confirmed: confirmedPatterns.length,
      rejected: rejectedPatterns.length,
      pending: validations.filter(v => v.status === 'insufficient-data').length,
      confirmedPatterns,
      rejectedPatterns,
    },
  };

  const reportPath = join(REPORTS_DIR, `validation-${report.runId}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nValidation report: ${reportPath}`);

  console.log('\n============================================================');
  console.log('VALIDATION SUMMARY');
  console.log('============================================================');
  console.log(`  Confirmed (→ promote): ${confirmedPatterns.length}`);
  for (const p of confirmedPatterns) console.log(`    ✓ ${p}`);
  console.log(`  Rejected (site-specific): ${rejectedPatterns.length}`);
  for (const p of rejectedPatterns) console.log(`    ✗ ${p}`);
  const pending = validations.filter(v => v.status === 'insufficient-data');
  if (pending.length > 0) {
    console.log(`  Insufficient data: ${pending.length}`);
    for (const p of pending) console.log(`    ? ${p.pattern}: ${p.reason}`);
  }

  if (confirmedPatterns.length > 0) {
    console.log(`\n→ Run runC-pattern-promoter.ts to permanently implement ${confirmedPatterns.length} pattern(s)`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
