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
 * Diversifieringssignaler vi kan använda från postB-preC + sources_status:
 * - Olika queueReason-mönster (404s vs errors, olika felräkningar)
 * - Olika triageResult (html_candidate vs still_unknown)
 * - Olika lastPathUsed (jsonld vs network)
 * - Olika consecutiveFailures (0 vs 1 vs 2)
 * - Olika lastEventsFound (0 vs >0)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';

import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RUNTIME_DIR = resolve(__dirname, '../../../runtime');
const POSTB_PREC_PATH = `${RUNTIME_DIR}/postB-preC-queue.jsonl`;
const SOURCES_STATUS_PATH = `${RUNTIME_DIR}/sources_status.jsonl`;
const OUTPUT_PATH = resolve(__dirname, './current-batch.jsonl');

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
  /** Canonical URL from sources/{sourceId}.jsonl — resolved at batch creation time */
  url: string | null;
  selectionReason: string;
  diversifiers: string[];
  queueReason: string;
  enrichedData?: {
    lastPathUsed?: string | null;
    lastEventsFound?: number;
    consecutiveFailures?: number;
    triageResult?: string | null;
  };
}

// Parse helpers
function parseJsonl<T>(path: string): T[] {
  const content = readFileSync(path, 'utf8');
  return content.split('\n').filter(Boolean).map(line => JSON.parse(line) as T);
}

/**
 * Load canonical source URLs from sources/ directory.
 * Returns a map: sourceId → url (from the canonical source file).
 * This is used to embed URL directly in batch output so C-testriggen
 * does not need to look it up from side-artifacts.
 */
function loadCanonicalSourceUrls(sourcesDir: string): Map<string, string> {
  const urlIndex = new Map<string, string>();
  if (!existsSync(sourcesDir)) {
    console.warn(`  WARNING: sources dir not found: ${sourcesDir}`);
    return urlIndex;
  }
  try {
    const files = readdirSync(sourcesDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      try {
        const content = readFileSync(join(sourcesDir, file), 'utf-8').trim();
        const source = JSON.parse(content);
        if (source.id && source.url) {
          urlIndex.set(source.id, source.url);
        }
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // Skip on error
  }
  return urlIndex;
}

// Extract signal from queueReason
function extractQueueSignals(reason: string): { errorCount: number; has404s: boolean; hasNetworkSignal: boolean } {
  const errorMatch = reason.match(/(\d+)\s*(?:fel|errors?|404s?)/i);
  const errorCount = errorMatch ? parseInt(errorMatch[1], 10) : 0;
  const has404s = /\d+\s*404/i.test(reason);
  const hasNetworkSignal = /network|api|endpoint/i.test(reason);
  return { errorCount, has404s, hasNetworkSignal };
}

// Select diverse batch
function selectDiversifiedBatch(
  entries: QueueEntry[],
  statuses: Map<string, SourceStatus>,
  count: number,
  canonicalUrls: Map<string, string>
): BatchEntry[] {
  const selected: BatchEntry[] = [];
  const usedSourceIds = new Set<string>();

  // Create candidate list with all signals
  const candidates: Array<{
    entry: QueueEntry;
    signals: ReturnType<typeof extractQueueSignals>;
    status?: SourceStatus;
  }> = entries.map(entry => {
    const status = statuses.get(entry.sourceId);
    const signals = extractQueueSignals(entry.queueReason);
    return { entry, signals, status };
  });

  // Diversifieringsaxlar
  const dimensions = {
    errorCountBuckets: new Set<number>(),    // 0, low, medium, high
    has404s: new Set<boolean>(),
    consecutiveFailures: new Set<number>(),
    lastEventsFound: new Set<number>(),        // 0 vs >0
    lastPathUsed: new Set<string>(),
    triageResult: new Set<string>(),
  };

  while (selected.length < count && candidates.length > 0) {
    // Find best candidate that adds diversity
    let bestIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (usedSourceIds.has(c.entry.sourceId)) continue;

      const signals = c.signals;
      const status = c.status;

      // Calculate diversity score
      let score = 0;

      // Prefer candidates that add new error-count bucket
      const errorBucket = signals.errorCount === 0 ? 0 : signals.errorCount < 10 ? 1 : signals.errorCount < 18 ? 2 : 3;
      if (!dimensions.errorCountBuckets.has(errorBucket)) score += 3;

      // Prefer candidates that add new has404s variation
      if (!dimensions.has404s.has(signals.has404s)) score += 2;

      // Prefer candidates with different consecutiveFailures
      if (status && !dimensions.consecutiveFailures.has(status.consecutiveFailures)) {
        score += 2;
      }

      // Prefer mix of lastEventsFound (0 vs >0)
      const hasEvents = (status?.lastEventsFound ?? 0) > 0;
      if (!dimensions.lastEventsFound.has(hasEvents ? 1 : 0)) score += 2;

      // Prefer mix of lastPathUsed
      if (status?.lastPathUsed && !dimensions.lastPathUsed.has(status.lastPathUsed)) {
        score += 1;
      }

      // Prefer mix of triageResult
      if (status?.triageResult && !dimensions.triageResult.has(status.triageResult)) {
        score += 1;
      }

      // Add small random factor to avoid always picking same within bucket
      score += Math.random() * 0.5;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      // No more diverse candidates, take remaining
      const remaining = candidates.find(c => !usedSourceIds.has(c.entry.sourceId));
      if (remaining) {
        selected.push(createBatchEntry(remaining.entry, remaining.signals, remaining.status, 'final_pick', [], canonicalUrls.get(remaining.entry.sourceId) ?? null));
        usedSourceIds.add(remaining.entry.sourceId);
      }
      break;
    }

    const chosen = candidates[bestIdx];
    candidates.splice(bestIdx, 1);

    // Update dimensions tracking
    const errorBucket = chosen.signals.errorCount === 0 ? 0 : chosen.signals.errorCount < 10 ? 1 : chosen.signals.errorCount < 18 ? 2 : 3;
    dimensions.errorCountBuckets.add(errorBucket);
    dimensions.has404s.add(chosen.signals.has404s);

    if (chosen.status) {
      dimensions.consecutiveFailures.add(chosen.status.consecutiveFailures);
      dimensions.lastEventsFound.add(chosen.status.lastEventsFound > 0 ? 1 : 0);
      if (chosen.status.lastPathUsed) dimensions.lastPathUsed.add(chosen.status.lastPathUsed);
      if (chosen.status.triageResult) dimensions.triageResult.add(chosen.status.triageResult);
    }

    const diversifiers: string[] = [];
    if (chosen.signals.has404s) diversifiers.push('has_404s');
    if (chosen.signals.errorCount > 0) diversifiers.push(`errors_${chosen.signals.errorCount}`);
    if (chosen.status) {
      if (chosen.status.consecutiveFailures > 0) diversifiers.push(`failures_${chosen.status.consecutiveFailures}`);
      if (chosen.status.lastEventsFound > 0) diversifiers.push(`has_events_${chosen.status.lastEventsFound}`);
      if (chosen.status.triageResult) diversifiers.push(`triage_${chosen.status.triageResult}`);
    }

    selected.push(createBatchEntry(chosen.entry, chosen.signals, chosen.status, 'diversity_selection', diversifiers, canonicalUrls.get(chosen.entry.sourceId) ?? null));
    usedSourceIds.add(chosen.entry.sourceId);
  }

  return selected;
}

function createBatchEntry(
  entry: QueueEntry,
  signals: ReturnType<typeof extractQueueSignals>,
  status: SourceStatus | undefined,
  reason: string,
  diversifiers: string[] = [],
  url: string | null = null
): BatchEntry {
  return {
    sourceId: entry.sourceId,
    url,
    selectionReason: reason,
    diversifiers,
    queueReason: entry.queueReason,
    enrichedData: status ? {
      lastPathUsed: status.lastPathUsed,
      lastEventsFound: status.lastEventsFound,
      consecutiveFailures: status.consecutiveFailures,
      triageResult: status.triageResult,
    } : undefined,
  };
}

async function main() {
  console.log('=== C-htmlGate Batchmaker ===\n');

  // Load queue entries
  console.log(`Reading: ${POSTB_PREC_PATH}`);
  const queueEntries = parseJsonl<QueueEntry>(POSTB_PREC_PATH);
  console.log(`  Found ${queueEntries.length} entries in postB-preC\n`);

  // Load source statuses for enrichment
  console.log(`Reading: ${SOURCES_STATUS_PATH}`);
  const allStatuses = parseJsonl<SourceStatus>(SOURCES_STATUS_PATH);
  const statusMap = new Map<string, SourceStatus>();
  for (const s of allStatuses) {
    statusMap.set(s.sourceId, s);
  }
  console.log(`  Loaded ${allStatuses.length} status records\n`);

  // Load canonical source URLs from sources/ for embedding in batch
  const canonicalSourcesDir = resolve(process.cwd(), 'sources');
  const canonicalUrls = loadCanonicalSourceUrls(canonicalSourcesDir);
  console.log(`Loaded ${canonicalUrls.size} canonical source URLs from sources/\n`);

  // Find sources that exist in both queue and status
  const inBoth = queueEntries.filter(e => statusMap.has(e.sourceId));
  const inQueueOnly = queueEntries.filter(e => !statusMap.has(e.sourceId));
  console.log(`Queue entries with status enrichment: ${inBoth.length}`);
  console.log(`Queue entries without status: ${inQueueOnly.length}\n`);

  // Select diversified batch
  const batch = selectDiversifiedBatch(queueEntries, statusMap, 10, canonicalUrls);

  console.log('=== SELECTED BATCH (10 sources) ===\n');
  for (let i = 0; i < batch.length; i++) {
    const b = batch[i];
    console.log(`${i + 1}. ${b.sourceId}`);
    console.log(`   URL: ${b.url ?? '(not found in canonical sources)'}`);
    console.log(`   Reason: ${b.selectionReason}`);
    console.log(`   Diversifiers: ${b.diversifiers.join(', ') || '(none)'}`);
    if (b.enrichedData) {
      const e = b.enrichedData;
      console.log(`   Path: ${e.lastPathUsed ?? 'unknown'}, Events: ${e.lastEventsFound ?? 0}, Failures: ${e.consecutiveFailures ?? 0}, Triage: ${e.triageResult ?? 'unknown'}`);
    }
    console.log(`   Queue reason: ${b.queueReason.substring(0, 80)}...`);
    console.log();
  }

  // Write batch to file
  const batchLines = batch.map(b => JSON.stringify(b)).join('\n');
  writeFileSync(OUTPUT_PATH, batchLines + '\n');
  console.log(`\nBatch written to: ${OUTPUT_PATH}`);

  // Also print sourceIds for easy copying
  console.log('\nSource IDs for run-batch:');
  console.log(batch.map(b => b.sourceId).join(', '));
}

main().catch(console.error);
