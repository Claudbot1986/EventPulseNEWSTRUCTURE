/**
 * C-htmlGate Batchmaker
 *
 * Väljer 10 diversifierade källor från postB-preC för manuell batchkörning.
 *
 * Principer (från C-rebuild-plan.md):
 * - Batchmaker får inte ta bara första 10
 * - Ska försöka skapa en avsiktligt blandad och lärandonyttig batch
 * - Får inte ändra canonical source-sanning
 * - Får inte skriva om sources/
 * - Batchen ska vara "rimligt varierad för lärande"
 *
 * Inputs:
 * - runtime/postB-preC-queue.jsonl — poolen av HTML-kandidater
 * - runtime/sources_status.jsonl — statusdata för enrichment
 * - sources/{sourceId}.jsonl — canonical URL per source
 *
 * Output:
 * - 02-Ingestion/C-htmlGate/batchmaker/current-batch.jsonl
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const RUNTIME_DIR = resolve(__dirname, '../../../runtime');
const POSTB_PREC_PATH = `${RUNTIME_DIR}/postB-preC-queue.jsonl`;
const SOURCES_STATUS_PATH = `${RUNTIME_DIR}/sources_status.jsonl`;
const SOURCES_DIR = resolve(__dirname, '../../../sources');
const OUTPUT_PATH = resolve(__dirname, './current-batch.jsonl');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueEntry {
  sourceId: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason: string;
}

interface SourceStatus {
  sourceId: string;
  status: string;
  lastPathUsed: string | null;
  lastEventsFound: number;
  consecutiveFailures: number;
  triageResult: string | null;
  lastRoutingReason: string;
}

interface BatchEntry {
  sourceId: string;
  url: string;
  selectionReason: string;
  diversifiers: string[];
  queueReason: string;
  enrichedData: {
    lastPathUsed: string | null;
    lastEventsFound: number;
    consecutiveFailures: number;
    triageResult: string | null;
  };
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parseJsonl<T>(path: string): T[] {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => JSON.parse(line) as T);
}

// ---------------------------------------------------------------------------
// Load canonical URL for a single source from sources/{sourceId}.jsonl
// Returns null if not found or malformed.
// ---------------------------------------------------------------------------

function loadSourceUrl(sourceId: string): string | null {
  const filePath = join(SOURCES_DIR, `${sourceId}.jsonl`);
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    if (!content) return null;
    const source = JSON.parse(content);
    return source.url ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Load all canonical URLs from sources/ into a Map for fast lookup
// ---------------------------------------------------------------------------

function loadAllCanonicalUrls(): Map<string, string> {
  const urlMap = new Map<string, string>();
  try {
    const files = readdirSync(SOURCES_DIR).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      try {
        const content = readFileSync(join(SOURCES_DIR, file), 'utf8').trim();
        if (!content) continue;
        const source = JSON.parse(content);
        if (source.id && source.url) {
          urlMap.set(source.id, source.url);
        }
      } catch {
        // skip malformed files
      }
    }
  } catch {
    // sources dir missing
  }
  return urlMap;
}

// ---------------------------------------------------------------------------
// Parse queueReason to extract error signals
// ---------------------------------------------------------------------------

interface QueueSignals {
  errorCount: number;
  has404s: boolean;
  hasNetworkSignal: boolean;
}

function parseQueueSignals(reason: string): QueueSignals {
  // Match patterns like "18 fel", "18 errors", "18 404s"
  const errorMatch = reason.match(/(\d+)\s*(?:fel|errors?|404s?)/i);
  const errorCount = errorMatch ? parseInt(errorMatch[1], 10) : 0;
  const has404s = /\d+\s*404/i.test(reason);
  const hasNetworkSignal = /network|api|endpoint/i.test(reason);
  return { errorCount, has404s, hasNetworkSignal };
}

// ---------------------------------------------------------------------------
// Diversity scoring for a candidate
// ---------------------------------------------------------------------------

interface DiversityState {
  errorBuckets: Set<number>;     // 0, 1-9, 10-17, 18+
  has404sValues: Set<boolean>;
  consecutiveFailures: Set<number>;
  lastEventsFound: Set<number>;   // 0 vs >0
  lastPathUsed: Set<string>;
  triageResult: Set<string>;
}

function scoreCandidate(
  candidate: Candidate,
  state: DiversityState
): number {
  let score = 0;

  // Primary: error bucket diversity (most important)
  const errorBucket = bucketize(candidate.signals.errorCount);
  if (!state.errorBuckets.has(errorBucket)) score += 4;

  // Secondary: 404s presence diversity
  if (!state.has404sValues.has(candidate.signals.has404s)) score += 2;

  // Tertiary: consecutive failures diversity
  if (!state.consecutiveFailures.has(candidate.status?.consecutiveFailures ?? -1)) {
    score += 2;
  }

  // Mix of events found
  const hasEvents = (candidate.status?.lastEventsFound ?? 0) > 0 ? 1 : 0;
  if (!state.lastEventsFound.has(hasEvents)) score += 2;

  // Mix of lastPathUsed
  const path = candidate.status?.lastPathUsed ?? 'none';
  if (!state.lastPathUsed.has(path)) score += 1;

  // Mix of triageResult
  const triage = candidate.status?.triageResult ?? 'none';
  if (!state.triageResult.has(triage)) score += 1;

  // Small random jitter to avoid deterministic picking within buckets
  score += Math.random() * 0.4;

  return score;
}

function bucketize(errorCount: number): number {
  if (errorCount === 0) return 0;
  if (errorCount < 10) return 1;
  if (errorCount < 18) return 2;
  return 3;
}

interface Candidate {
  entry: QueueEntry;
  signals: QueueSignals;
  status: SourceStatus | undefined;
  url: string | null;
}

// ---------------------------------------------------------------------------
// Build diversifier label list for a chosen candidate
// ---------------------------------------------------------------------------

function buildDiversifiers(c: Candidate): string[] {
  const d: string[] = [];
  if (c.signals.has404s) d.push('has_404s');
  if (c.signals.errorCount > 0) d.push(`errors_${c.signals.errorCount}`);
  if (c.status) {
    if (c.status.consecutiveFailures > 0) d.push(`failures_${c.status.consecutiveFailures}`);
    if (c.status.lastEventsFound > 0) d.push(`events_${c.status.lastEventsFound}`);
    if (c.status.triageResult) d.push(`triage_${c.status.triageResult}`);
    if (c.status.lastPathUsed) d.push(`path_${c.status.lastPathUsed}`);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('=== C-htmlGate Batchmaker ===\n');

  // 1. Load pool
  console.log(`Reading: ${POSTB_PREC_PATH}`);
  const queueEntries = parseJsonl<QueueEntry>(POSTB_PREC_PATH);
  console.log(`  ${queueEntries.length} entries in postB-preC pool\n`);

  // 2. Load status enrichment
  console.log(`Reading: ${SOURCES_STATUS_PATH}`);
  const allStatuses = parseJsonl<SourceStatus>(SOURCES_STATUS_PATH);
  const statusMap = new Map<string, SourceStatus>();
  for (const s of allStatuses) statusMap.set(s.sourceId, s);
  console.log(`  ${allStatuses.length} status records loaded\n`);

  // 3. Load canonical URLs
  const canonicalUrls = loadAllCanonicalUrls();
  console.log(`  ${canonicalUrls.size} canonical URLs loaded from sources/\n`);

  // 4. Build candidate list with signals
  const candidates: Candidate[] = queueEntries.map(entry => {
    const signals = parseQueueSignals(entry.queueReason);
    const status = statusMap.get(entry.sourceId);
    const url = canonicalUrls.get(entry.sourceId) ?? loadSourceUrl(entry.sourceId);
    return { entry, signals, status, url };
  });

  // 5. Filter out candidates without URLs (shouldn't happen per user, but be safe)
  const withUrl = candidates.filter(c => c.url !== null);
  const withoutUrl = candidates.length - withUrl.length;
  if (withoutUrl > 0) {
    console.warn(`  WARNING: ${withoutUrl} candidates have no URL in sources/ — skipping\n`);
  }
  console.log(`  ${withUrl.length} candidates with URLs\n`);

  // 6. Diversified selection
  const BATCH_SIZE = 50;
  const selected: BatchEntry[] = [];
  const usedIds = new Set<string>();

  const diversityState: DiversityState = {
    errorBuckets: new Set(),
    has404sValues: new Set(),
    consecutiveFailures: new Set(),
    lastEventsFound: new Set(),
    lastPathUsed: new Set(),
    triageResult: new Set(),
  };

  const remaining = [...withUrl];

  while (selected.length < BATCH_SIZE && remaining.length > 0) {
    // Score all remaining candidates
    let bestIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < remaining.length; i++) {
      if (usedIds.has(remaining[i].entry.sourceId)) continue;
      const score = scoreCandidate(remaining[i], diversityState);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    const chosen = remaining.splice(bestIdx, 1)[0];
    usedIds.add(chosen.entry.sourceId);

    // Update diversity tracking
    const errorBucket = bucketize(chosen.signals.errorCount);
    diversityState.errorBuckets.add(errorBucket);
    diversityState.has404sValues.add(chosen.signals.has404s);

    if (chosen.status) {
      diversityState.consecutiveFailures.add(chosen.status.consecutiveFailures);
      diversityState.lastEventsFound.add(chosen.status.lastEventsFound > 0 ? 1 : 0);
      if (chosen.status.lastPathUsed) {
        diversityState.lastPathUsed.add(chosen.status.lastPathUsed);
      }
      if (chosen.status.triageResult) {
        diversityState.triageResult.add(chosen.status.triageResult);
      }
    }

    const diversifiers = buildDiversifiers(chosen);
    const reason = diversityState.errorBuckets.size === 1 && selected.length === 0
      ? 'first_pick'
      : 'diversity_selection';

    selected.push({
      sourceId: chosen.entry.sourceId,
      url: chosen.url!,
      selectionReason: reason,
      diversifiers,
      queueReason: chosen.entry.queueReason,
      enrichedData: {
        lastPathUsed: chosen.status?.lastPathUsed ?? null,
        lastEventsFound: chosen.status?.lastEventsFound ?? 0,
        consecutiveFailures: chosen.status?.consecutiveFailures ?? 0,
        triageResult: chosen.status?.triageResult ?? null,
      },
    });
  }

  // 7. Report
  console.log('=== SELECTED BATCH ===\n');
  for (let i = 0; i < selected.length; i++) {
    const b = selected[i];
    console.log(`${i + 1}. ${b.sourceId}`);
    console.log(`   URL:        ${b.url}`);
    console.log(`   Reason:     ${b.selectionReason}`);
    console.log(`   Diversifiers: ${b.diversifiers.join(', ') || '(none)'}`);
    console.log(`   Path:       ${b.enrichedData.lastPathUsed ?? 'unknown'}`);
    console.log(`   Events:     ${b.enrichedData.lastEventsFound}`);
    console.log(`   Failures:   ${b.enrichedData.consecutiveFailures}`);
    console.log(`   Triage:     ${b.enrichedData.triageResult ?? 'unknown'}`);
    console.log();
  }

  // Diversity summary
  console.log('--- Diversity summary ---');
  console.log(`  Error buckets:  ${[...diversityState.errorBuckets].sort().join(', ')}`);
  console.log(`  404s presence:  ${[...diversityState.has404sValues].map(v => v.toString()).join(', ')}`);
  console.log(`  Failures:       ${[...diversityState.consecutiveFailures].sort().join(', ')}`);
  console.log(`  Events found:  ${[...diversityState.lastEventsFound].sort().join(', ')}`);
  console.log(`  Path used:      ${[...diversityState.lastPathUsed].sort().join(', ')}`);
  console.log(`  Triage:         ${[...diversityState.triageResult].sort().join(', ')}`);
  console.log();

  // 8. Write output
  const outputLines = selected.map(b => JSON.stringify(b)).join('\n');
  writeFileSync(OUTPUT_PATH, outputLines + '\n');
  console.log(`Batch written to: ${OUTPUT_PATH}\n`);

  console.log('Source IDs for run-batch:');
  console.log(selected.map(b => b.sourceId).join(', '));
  console.log();
}

try {
  main();
} catch (err) {
  console.error('Fatal error:', err);
  process.exit(1);
}
