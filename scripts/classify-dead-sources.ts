/**
 * Step 1 — classify-dead-sources.ts
 *
 * Read-only diagnostic. Läser runtime/audit-dead-sources-summary.json och
 * runtime/sources_status.jsonl, joinar på sourceId, och emitterar
 * runtime/source-discovery-classification.csv med klassificering i 4 buckets.
 *
 * Buckets (per plan §Step 1):
 *   A_no-jsonld-reachable   — NO_CANDIDATES / C2_UNCLEAR / C1_NO_MAIN (upptäckbar)
 *   B_redirect-loop-killed  — redirect-kedjor / Redirect loop detected (fetcher-budget)
 *   C_infrastructure        — DNS / SSL / cert / timeout / ECONNREFUSED (ut-of-scope)
 *   D_untouched             — aldrig körda (separat bucket, handlar i Step 4)
 *
 * Användning:
 *   npx tsx scripts/classify-dead-sources.ts
 *   EVENTPULSE_SANDBOX_ROOT=/tmp/x npx tsx scripts/classify-dead-sources.ts
 *
 * Output: runtime/source-discovery-classification.csv (read-only artefakt).
 *
 * Generalization Protection: Inga IGNORE_PATTERNS / scoring-ändringar, ingen
 * auto-action. Detta är mätning, inte kodförändring.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../');
const DATA_ROOT = process.env.EVENTPULSE_SANDBOX_ROOT
  ? path.resolve(process.env.EVENTPULSE_SANDBOX_ROOT)
  : PROJECT_ROOT;
const RUNTIME_DIR = path.resolve(DATA_ROOT, 'runtime');

const AUDIT_FILE = path.resolve(RUNTIME_DIR, 'audit-dead-sources-summary.json');
const STATUS_FILE = path.resolve(RUNTIME_DIR, 'sources_status.jsonl');
const OUTPUT_FILE = path.resolve(RUNTIME_DIR, 'source-discovery-classification.csv');

type Bucket = 'A_no-jsonld-reachable' | 'B_redirect-loop-killed' | 'C_infrastructure' | 'D_untouched';

interface DeadEntry {
  sourceId: string;
  name: string;
  url: string;
  preferredPath: string;
  status: string;
  consecutiveFailures: number;
  lastRoutingReason: string;
  last_trace_exitReason: string;
  last_trace_exitReasonDetail: string;
  last_trace_batch: string | null;
  trace_count: number;
  eventsFound_max: number;
  c3EventsFound_max: number;
}

interface UntouchedEntry {
  sourceId: string;
  name: string;
  url: string;
  preferredPath?: string;
}

/**
 * Klassificerar en död källa till en bucket baserat på fält från audit.
 * Deterministisk: samma input → samma output varje gång.
 */
function classifyDead(d: DeadEntry): { bucket: Bucket; suggestedNextStep: string; evidence: string } {
  const exit = d.last_trace_exitReason ?? '';
  const reason = d.lastRoutingReason ?? '';

  // Bucket C: transport-fel som INTE är redirect-kedjor
  if (exit === 'FETCH_ERROR') {
    // Avgör om det är redirect-relaterat eller annat transport-fel
    if (reason.includes('redirect') || reason.includes('Redirect')) {
      return {
        bucket: 'B_redirect-loop-killed',
        suggestedNextStep: 'audit-redirect-chains.ts (Step 3)',
        evidence: `${reason}`,
      };
    }
    return {
      bucket: 'C_infrastructure',
      suggestedNextStep: 'ut-of-scope (DNS/SSL/cert/timeout) — vänta på infra-fix eller retire',
      evidence: `${exit} | ${reason.slice(0, 80)}`,
    };
  }

  // Bucket A: discovery-gap (ren Swedish patterns / C1 / C2 / extraction)
  if (
    exit === 'NO_CANDIDATES_SWEDISH_PATTERNS_EXHAUSTED' ||
    exit === 'C2_UNCLEAR' ||
    exit === 'C1_NO_MAIN_ARTICLE' ||
    exit === 'EXTRACTION_ZERO_C3_AI_ZERO'
  ) {
    const step =
      exit === 'NO_CANDIDATES_SWEDISH_PATTERNS_EXHAUSTED'
        ? 'sitemap + robots.txt-discover (Step 2) för att hitta rätt kandidat-sida'
        : exit === 'C2_UNCLEAR'
          ? 'C2 gate-tuning (oprioriterat, INTE General-förändring)'
          : exit === 'C1_NO_MAIN_ARTICLE'
            ? 'C1 main-content-detektor (oprioriterat)'
            : 'C3 AI-extraktion (oprioriterat)';
    return {
      bucket: 'A_no-jsonld-reachable',
      suggestedNextStep: step,
      evidence: `${exit} | routingReason="${reason.slice(0, 60)}"`,
    };
  }

  // JS-render → D-renderGate (egentligen Step 2, men separat sub-spår)
  if (exit === 'C1_STRONG_JS_RENDER_D_SIGNAL') {
    return {
      bucket: 'A_no-jsonld-reachable',
      suggestedNextStep: 'D-renderGate (separat spår) — JS-render kräver ScB-render',
      evidence: `${exit} | routingReason="${reason.slice(0, 60)}"`,
    };
  }

  // Oklassificerat (framtidssäkring)
  return {
    bucket: 'A_no-jsonld-reachable',
    suggestedNextStep: 'manuell granskning — oklassificerat exit-reason',
    evidence: `${exit || 'UNKNOWN'} | routingReason="${reason.slice(0, 60)}"`,
  };
}

function csvEscape(s: string): string {
  if (s == null) return '';
  // Quote if contains comma, quote, or newline
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function main(): void {
  if (!existsSync(AUDIT_FILE)) {
    console.error(`error: ${AUDIT_FILE} not found`);
    process.exit(1);
  }
  if (!existsSync(STATUS_FILE)) {
    console.error(`warning: ${STATUS_FILE} not found — skipping status enrichment`);
  }

  const audit = JSON.parse(readFileSync(AUDIT_FILE, 'utf8')) as {
    stockholm_total: number;
    confirmed_dead_count: number;
    confirmed_working_count: number;
    partial_count: number;
    untouched_count: number;
    confirmed_dead: DeadEntry[];
    untouched: UntouchedEntry[];
  };

  // Validera att vi har 81 döda
  if (audit.confirmed_dead.length !== audit.confirmed_dead_count) {
    console.warn(
      `warning: confirmed_dead.length (${audit.confirmed_dead.length}) != confirmed_dead_count (${audit.confirmed_dead_count})`,
    );
  }

  // Status enrichment (valfri) — läs sources_status.jsonl och join på sourceId
  const statusById = new Map<string, { lastRun: string | null; attempts: number }>();
  if (existsSync(STATUS_FILE)) {
    const lines = readFileSync(STATUS_FILE, 'utf8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const s = JSON.parse(line) as { sourceId: string; lastRun: string | null; attempts: number };
        statusById.set(s.sourceId, { lastRun: s.lastRun, attempts: s.attempts });
      } catch { /* skippa korrupta rader */ }
    }
  }

  // Klassificera
  const rows: Array<{ sourceId: string; name: string; bucket: Bucket; evidence: string; nextStep: string; consecutiveFailures: number; lastRun: string; url: string }> = [];

  for (const d of audit.confirmed_dead) {
    const cls = classifyDead(d);
    const status = statusById.get(d.sourceId);
    rows.push({
      sourceId: d.sourceId,
      name: d.name,
      bucket: cls.bucket,
      evidence: cls.evidence,
      nextStep: cls.suggestedNextStep,
      consecutiveFailures: d.consecutiveFailures ?? 0,
      lastRun: status?.lastRun ?? '',
      url: d.url,
    });
  }

  for (const u of audit.untouched) {
    rows.push({
      sourceId: u.sourceId,
      name: u.name,
      bucket: 'D_untouched',
      evidence: `untouched — aldrig kör genom pipeline (preferredPath=${u.preferredPath ?? 'unknown'})`,
      nextStep: 'generera RawSources .md + kör importRawSources (Step 4)',
      consecutiveFailures: 0,
      lastRun: '',
      url: u.url,
    });
  }

  // Räkna per bucket
  const counts: Record<Bucket, number> = {
    'A_no-jsonld-reachable': 0,
    'B_redirect-loop-killed': 0,
    'C_infrastructure': 0,
    'D_untouched': 0,
  };
  for (const r of rows) counts[r.bucket]++;

  // Sortera: Bucket A först (högsta prioritet), sedan B, C, D
  const order: Record<Bucket, number> = {
    'A_no-jsonld-reachable': 0,
    'B_redirect-loop-killed': 1,
    'C_infrastructure': 2,
    'D_untouched': 3,
  };
  rows.sort((a, b) => {
    const oa = order[a.bucket];
    const ob = order[b.bucket];
    if (oa !== ob) return oa - ob;
    return a.sourceId.localeCompare(b.sourceId);
  });

  // Skriv CSV
  const header = ['sourceId', 'name', 'bucket', 'consecutiveFailures', 'lastRun', 'url', 'evidence', 'suggestedNextStep'];
  const csvLines = [header.join(',')];
  for (const r of rows) {
    csvLines.push([
      csvEscape(r.sourceId),
      csvEscape(r.name),
      r.bucket,
      r.consecutiveFailures,
      r.lastRun,
      csvEscape(r.url),
      csvEscape(r.evidence),
      csvEscape(r.nextStep),
    ].join(','));
  }
  writeFileSync(OUTPUT_FILE, csvLines.join('\n') + '\n', 'utf8');

  // Logga summary
  console.log(`Step 1: classification complete`);
  console.log(`  source: ${AUDIT_FILE}`);
  console.log(`  output: ${OUTPUT_FILE}`);
  console.log(`  total rows: ${rows.length} (${audit.confirmed_dead_count} dead + ${audit.untouched.length} untouched)`);
  console.log(`  bucket counts:`);
  for (const b of Object.keys(counts) as Bucket[]) {
    console.log(`    ${b.padEnd(28)} ${counts[b]}`);
  }
  console.log(`  dead-by-exit-reason (audit):`);
  const exits: Record<string, number> = {};
  for (const d of audit.confirmed_dead) {
    const e = d.last_trace_exitReason || 'UNKNOWN';
    exits[e] = (exits[e] ?? 0) + 1;
  }
  for (const [k, v] of Object.entries(exits).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(50)} ${v}`);
  }
}

main();
