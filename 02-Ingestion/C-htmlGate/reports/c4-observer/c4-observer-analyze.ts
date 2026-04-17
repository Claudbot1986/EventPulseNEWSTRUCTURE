/**
 * C4 Observer — Separat parallell analyskanal för C-htmlGate batch-utfall.
 * 
 * KÖR SÅ HÄR:
 *   npx tsx reports/c4-observer/c4-observer-analyze.ts --batch 107
 * 
 * OBS: Detta är en OBSERVATÖR, inte en runtime-krycka.
 * C4-analysen SKRIVER till reports/c4-observer/batch-N/ men påverkar ALDRIG
 * runtime queues, routing decisions, eller C-runtime beteende.
 * 
 * Syfte:
 * - Identifiera VANLIGA failure patterns över batchen
 * - Hitta lovande sidor som gav 0 events (C2=promising men C3=0)
 * - Ge rekommendationer om generella förbättringar till C0/C1/C2/C3
 * - Sammanfatta failure families per exit reason
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const REPORTS_DIR = join(__dirname);
const BATCH_DIR = (batchNum: number) => join(REPORTS_DIR, `batch-${batchNum}`);

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface PerSourceTrace {
  sourceId: string;
  sourceUrl: string;
  round: number;
  c0Candidates: number;
  c0WinnerUrl: string | null;
  c0WinnerDensity: number;
  c0RuleSource: string;
  c0RulePathsTested: string[];
  c0RuleWinnerPath: string | null;
  effectiveUrl: string;
  effectiveUrlReason: string;
  c1Verdict: string;
  c1LikelyJsRendered: boolean;
  c1TimeTagCount: number;
  c1DateCount: number;
  c1HtmlBytes: number;
  c1Fetchable: boolean;
  c1FetchError?: string;
  c1BestSubpageFound: string | null;
  c1SubpagesTested: string[];
  c2Verdict: string;
  c2Score: number;
  c2Reason: string;
  c2HtmlBytes: number;
  c3EventsFound: number;
  c3MethodsUsed: string[];
  c3MethodBreakdown: Record<string, number>;
  c3AiVerdict?: string;
  c3AiEventsFound?: number;
  c3AiDuration?: number;
  eventsFound: number;
  outcomeType: string;
  routeSuggestion: string;
  exitReason: string;
  exitReasonDetail: string;
  winningStage: string;
  success: boolean;
  derivedRuleApplied: boolean;
  error?: string;
}

interface BatchSummary {
  batchNumber: number;
  totalSources: number;
  extractSuccess: number;
  routeD: number;
  routeA: number;
  routeB: number;
  fail: number;
  exitReasonCounts: Record<string, number>;
  promisingZeroCount: number;
  promisingTotal: number;
  promisingSources: PerSourceTrace[];
  mostInteresting: PerSourceTrace[];
  failurePatterns: FailurePattern[];
  recommendations: string[];
}

interface FailurePattern {
  pattern: string;
  count: number;
  examples: { sourceId: string; url: string; detail: string }[];
  whyC3Failed: { stage: string; reason: string };
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function loadBatchTraces(batchNum: number): PerSourceTrace[] {
  const batchDir = BATCH_DIR(batchNum);
  const tracesPath = join(batchDir, 'batch-traces.jsonl');
  
  try {
    const raw = readFileSync(tracesPath, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    return lines.map(l => JSON.parse(l) as PerSourceTrace);
  } catch {
    // Try alternative location
    const altPath = join(REPORTS_DIR, '..', `batch-${batchNum}`, 'batch-traces.jsonl');
    try {
      const raw = readFileSync(altPath, 'utf8');
      const lines = raw.split('\n').filter(l => l.trim());
      return lines.map(l => JSON.parse(l) as PerSourceTrace);
    } catch {
      console.error(`[C4-Observer] Could not find traces for batch-${batchNum}`);
      return [];
    }
  }
}

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of arr) {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

// ──────────────────────────────────────────────────────────────────────────────
// Core analysis
// ──────────────────────────────────────────────────────────────────────────────

function analyzeBatch(batchNum: number): BatchSummary {
  const traces = loadBatchTraces(batchNum);
  
  if (traces.length === 0) {
    console.log(`[C4-Observer] No traces found for batch-${batchNum}`);
    process.exit(1);
  }

  // ── Basic counts ────────────────────────────────────────────────────────────
  const extractSuccess = traces.filter(t => t.outcomeType === 'extract_success');
  const routeD = traces.filter(t => t.routeSuggestion === 'D' && t.outcomeType === 'route_success');
  const routeA = traces.filter(t => t.routeSuggestion === 'A' && t.outcomeType === 'route_success');
  const routeB = traces.filter(t => t.routeSuggestion === 'B' && t.outcomeType === 'route_success');
  const fail = traces.filter(t => t.outcomeType === 'fail');

  // ── Exit reason breakdown ───────────────────────────────────────────────────
  const exitReasonCounts: Record<string, number> = {};
  for (const t of traces) {
    exitReasonCounts[t.exitReason] = (exitReasonCounts[t.exitReason] || 0) + 1;
  }

  // ── PROMISSING ZERO: C2=promising but C3=0 ────────────────────────────────
  const promisingZero = traces.filter(t =>
    t.c2Verdict === 'promising' &&
    t.c3EventsFound === 0 &&
    t.outcomeType === 'fail'
  );
  const promisingTotal = traces.filter(t => t.c2Verdict === 'promising');

  // ── Most interesting: promising but got 0 ─────────────────────────────────
  const promisingSources = promisingZero.slice(0, 10).map(t => ({
    ...t,
    _whyC3Failed: analyzeWhyC3Failed(t),
  }));

  // ── Most interesting: strong candidates that still failed ──────────────────
  const interestingFails = fail
    .filter(t => t.c1HtmlBytes > 50000 || t.c2Score > 50 || t.c0Candidates > 3)
    .sort((a, b) => (b.c2Score - b.c0Candidates * 10) - (a.c2Score - a.c0Candidates * 10))
    .slice(0, 10);

  const mostInteresting = interestingFails.map(t => ({
    ...t,
    _whyC3Failed: analyzeWhyC3Failed(t),
  }));

  // ── Failure patterns ───────────────────────────────────────────────────────
  const failurePatterns = identifyFailurePatterns(fail);

  // ── Recommendations ────────────────────────────────────────────────────────
  const recommendations = generateRecommendations(traces, promisingZero, failurePatterns);

  return {
    batchNumber: batchNum,
    totalSources: traces.length,
    extractSuccess: extractSuccess.length,
    routeD: routeD.length,
    routeA: routeA.length,
    routeB: routeB.length,
    fail: fail.length,
    exitReasonCounts,
    promisingZeroCount: promisingZero.length,
    promisingTotal: promisingTotal.length,
    promisingSources: promisingSources as PerSourceTrace[],
    mostInteresting: mostInteresting as PerSourceTrace[],
    failurePatterns,
    recommendations,
  };
}

function analyzeWhyC3Failed(t: PerSourceTrace): { stage: string; reason: string } {
  // No HTML at all
  if (t.c1HtmlBytes === 0 && t.c2HtmlBytes === 0) {
    return { stage: 'C1/C2', reason: 'No HTML fetched — fetch failure or empty response' };
  }
  
  // C2 said promising but C3 got 0
  if (t.c2Verdict === 'promising') {
    if (t.c3MethodsUsed.length === 0) {
      return { stage: 'C3', reason: 'C2=promising but no universal methods produced events' };
    }
    if (t.c3AiVerdict) {
      return { stage: 'C3-AI', reason: `C2=promising, universal=0, AI verdict=${t.c3AiVerdict} (AI also failed)` };
    }
    return { stage: 'C3', reason: 'C2=promising but universal extractor returned 0' };
  }
  
  // C2 was unclear/blocked
  if (t.c2Verdict === 'unclear' || t.c2Verdict === 'blocked' || t.c2Verdict === 'low_value') {
    return { stage: 'C2', reason: `C2 verdict=${t.c2Verdict}, score=${t.c2Score} — HTML rejected by gate` };
  }
  
  // C0 failed
  if (t.c0Candidates === 0 && !t.c0WinnerUrl) {
    return { stage: 'C0', reason: 'No event candidates found, no Swedish patterns succeeded' };
  }
  
  // C1 failed
  if (!t.c1Fetchable) {
    return { stage: 'C1', reason: `C1 not fetchable: ${t.c1FetchError || 'unknown error'}` };
  }
  
  return { stage: 'unknown', reason: 'Could not determine failure stage' };
}

function identifyFailurePatterns(fails: PerSourceTrace[]): FailurePattern[] {
  const patterns: Record<string, PerSourceTrace[]> = {};
  
  for (const t of fails) {
    // Pattern key = exitReason
    const key = t.exitReason;
    if (!patterns[key]) patterns[key] = [];
    patterns[key].push(t);
  }
  
  return Object.entries(patterns)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 10)
    .map(([pattern, sources]) => {
      const examples = sources.slice(0, 3).map(s => ({
        sourceId: s.sourceId,
        url: s.effectiveUrl,
        detail: s.exitReasonDetail,
      }));
      
      const whyC3Failed = analyzeWhyC3Failed(sources[0]);
      
      return {
        pattern,
        count: sources.length,
        examples,
        whyC3Failed,
      };
    });
}

function generateRecommendations(
  traces: PerSourceTrace[],
  promisingZero: PerSourceTrace[],
  patterns: FailurePattern[]
): string[] {
  const recs: string[] = [];
  
  // 1. Promising zero extraction
  if (promisingZero.length > 0) {
    recs.push(
      `[C4-REC] ${promisingZero.length} sources had C2=promising but C3=0 events. ` +
      `These are the highest-value targets for C3 improvement. ` +
      `Common issue: HTML scope too narrow, events outside <main>, or date patterns not matched.`
    );
  }
  
  // 2. No-candidates pattern
  const noCandidates = patterns.find(p => p.pattern.includes('NO_CANDIDATES'));
  if (noCandidates && noCandidates.count > traces.length * 0.3) {
    recs.push(
      `[C4-REC] ${noCandidates.count} sources (${Math.round(noCandidates.count / traces.length * 100)}%) failed at C0 with NO_CANDIDATES. ` +
      `Consider: broader Swedish pattern coverage, generic /kalender/ and /event/ path testing, ` +
      `or allowing root URL as fallback when no candidates found.`
    );
  }
  
  // 3. JS render pattern
  const jsRender = patterns.find(p => p.pattern.includes('JS_RENDER'));
  if (jsRender && jsRender.count > 3) {
    recs.push(
      `[C4-REC] ${jsRender.count} sources triggered JS_RENDER routing. ` +
      `If many of these also have low C1 signals (0 dates, 0 timeTags), ` +
      `consider adding more subpage discovery paths before D-routing.`
    );
  }
  
  // 4. Blocked/unclear pattern
  const blocked = patterns.find(p => p.pattern.includes('BLOCKED') || p.pattern.includes('UNCLEAR'));
  if (blocked && blocked.count > 5) {
    recs.push(
      `[C4-REC] ${blocked.count} sources were blocked/unclear at C2. ` +
      `Review C2 density scoring — if many have >50KB HTML but still blocked, ` +
      `the page-density threshold may be too strict.`
    );
  }
  
  // 5. Fetch errors
  const fetchErrors = patterns.find(p => p.pattern.includes('FETCH_ERROR') || p.pattern.includes('NETWORK'));
  if (fetchErrors) {
    recs.push(
      `[C4-REC] ${fetchErrors.count} sources had network/fetch errors. ` +
      `These should be retried or flagged for network inspection, not sent to manual-review.`
    );
  }
  
  if (recs.length === 0) {
    recs.push('[C4-REC] No obvious generic patterns found. Review promisingSources and mostInteresting manually.');
  }
  
  return recs;
}

// ──────────────────────────────────────────────────────────────────────────────
// Report generation
// ──────────────────────────────────────────────────────────────────────────────

function writeReports(batchNum: number, summary: BatchSummary): void {
  const batchDir = BATCH_DIR(batchNum);
  mkdirSync(batchDir, { recursive: true });
  
  // 1. JSON summary
  writeFileSync(
    join(batchDir, 'c4-observer-summary.json'),
    JSON.stringify(summary, null, 2)
  );
  
  // 2. Findings JSONL (one record per source)
  const findingsPath = join(batchDir, 'c4-observer-findings.jsonl');
  const findingsLines = summary.promisingSources.map(s => JSON.stringify({
    sourceId: s.sourceId,
    url: s.effectiveUrl,
    exitReason: s.exitReason,
    c2Verdict: s.c2Verdict,
    c2Score: s.c2Score,
    c3EventsFound: s.c3EventsFound,
    c3MethodsUsed: s.c3MethodsUsed,
    c3AiVerdict: s.c3AiVerdict,
    whyC3Failed: (s as any)._whyC3Failed,
  }));
  writeFileSync(findingsPath, findingsLines.join('\n'));
  
  // 3. Markdown report
  const md = generateMarkdownReport(summary);
  writeFileSync(join(batchDir, 'c4-observer-report.md'), md);
  
  console.log(`[C4-Observer] Reports written to ${batchDir}`);
  console.log(`  - c4-observer-summary.json (${summary.totalSources} sources analyzed)`);
  console.log(`  - c4-observer-findings.jsonl (${summary.promisingSources.length} promising-zero sources)`);
  console.log(`  - c4-observer-report.md`);
}

function generateMarkdownReport(summary: BatchSummary): string {
  const pct = (n: number) => `${Math.round(n / summary.totalSources * 100)}%`;
  
  let md = `# C4 Observer Report — Batch ${summary.batchNumber}

**Generated:** ${new Date().toISOString()}
**Total sources:** ${summary.totalSources}

## Outcome Summary

| Outcome | Count | Pct |
|---------|-------|-----|
| Extract Success | ${summary.extractSuccess} | ${pct(summary.extractSuccess)} |
| Route → D | ${summary.routeD} | ${pct(summary.routeD)} |
| Route → A | ${summary.routeA} | ${pct(summary.routeA)} |
| Route → B | ${summary.routeB} | ${pct(summary.routeB)} |
| Fail | ${summary.fail} | ${pct(summary.fail)} |

## Exit Reason Breakdown

`;
  
  const sortedReasons = Object.entries(summary.exitReasonCounts)
    .sort(([, a], [, b]) => b - a);
  
  for (const [reason, count] of sortedReasons) {
    md += `| \`${reason}\` | ${count} | ${pct(count)} |\n`;
  }
  
  md += `
## Promising → Zero (Highest Priority)

${summary.promisingTotal > 0 
  ? `**${summary.promisingZeroCount}/${summary.promisingTotal}** C2=promising sources returned 0 events.`
  : '**No C2=promising sources with zero extraction.**'
}

`;
  
  if (summary.promisingSources.length > 0) {
    md += `| Source | Effective URL | C2 Score | Why C3 Failed |\n`;
    md += `|--------|--------------|----------|---------------|\n`;
    for (const s of summary.promisingSources.slice(0, 15)) {
      const why = (s as any)._whyC3Failed;
      md += `| \`${s.sourceId}\` | ${s.effectiveUrl.substring(0, 60)} | ${s.c2Score} | ${why?.reason || 'unknown'} |\n`;
    }
  }
  
  md += `
## Failure Patterns

`;
  
  for (const fp of summary.failurePatterns.slice(0, 8)) {
    md += `### ${fp.pattern} (${fp.count} sources)\n`;
    md += `**Why C3 failed:** ${fp.whyC3Failed.stage} — ${fp.whyC3Failed.reason}\n\n`;
    md += `**Examples:**\n`;
    for (const ex of fp.examples) {
      md += `- \`${ex.sourceId}\`: ${ex.url}\n`;
    }
    md += `\n`;
  }
  
  md += `## Recommendations\n\n`;
  for (const rec of summary.recommendations) {
    md += `${rec}\n\n`;
  }
  
  md += `## Most Interesting Failed Sources\n\n`;
  md += `Sources with substantial HTML (>50KB) or strong C0 candidates that still failed:\n\n`;
  
  if (summary.mostInteresting.length > 0) {
    md += `| Source | Effective URL | C2 Score | C0 Candidates | Exit Reason |\n`;
    md += `|--------|--------------|----------|----------------|-------------|\n`;
    for (const s of summary.mostInteresting.slice(0, 10)) {
      md += `| \`${s.sourceId}\` | ${s.effectiveUrl.substring(0, 50)} | ${s.c2Score} | ${s.c0Candidates} | \`${s.exitReason}\` |\n`;
    }
  } else {
    md += `*No highly-interesting failures found.*\n`;
  }
  
  return md;
}

// ──────────────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let batchNum = 107; // default
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch' && args[i + 1]) {
      batchNum = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--batch') {
      batchNum = parseInt(args[i + 1], 10);
    }
  }
  
  console.log(`[C4-Observer] Analyzing batch-${batchNum}...`);
  const summary = analyzeBatch(batchNum);
  writeReports(batchNum, summary);
  
  // Also print summary to stdout
  console.log('\n=== C4 Observer Summary ===');
  console.log(`Total: ${summary.totalSources} | Success: ${summary.extractSuccess} | Fail: ${summary.fail}`);
  console.log(`Promising→Zero: ${summary.promisingZeroCount}/${summary.promisingTotal}`);
  console.log('\nTop exit reasons:');
  for (const [reason, count] of Object.entries(summary.exitReasonCounts).sort(([, a], [, b]) => b - a).slice(0, 5)) {
    console.log(`  ${reason}: ${count}`);
  }
}

main();
