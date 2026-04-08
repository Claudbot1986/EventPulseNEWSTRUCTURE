/**
 * reset-queue-routing.ts
 *
 * Phase 1 Reset — komplettering till reset-sources-state.ts
 *
 * Problem: reset-sources-state.ts nollställde runtime/sources_status.jsonl
 * men Phase 5 (2026-04-07) återinförde operativ sortering i:
 *   - sources/*.jsonl (currentQueue, routingConfidence, routingReason, routedAt)
 *   - A/B/C/D/H-queue/ (415+ filer)
 *
 * ANVÄNDNING:
 *   npx tsx 01-Sources/tools/reset-queue-routing.ts
 *
 * VAD SCRIPTET GÖR:
 * 1. Arkiverar befintliga queue-filer till runtime/archive/queues_PRE_RESET/
 * 2. Uppdaterar sources/*.jsonl:
 *    - Lägger till legacyQueueRouting-fält med Phase 5-data
 *    - Sätter currentQueue="pending" (ej styrande)
 *    - Sätter routingConfidence="reset" (ej styrande)
 *    - routingReason behålls som history, markeras som legacy
 *    - routedAt behålls, markeras som pre-reset
 * 3. Skapar runtime/sources_reset_state.jsonl (420 poster, alla status=untreated)
 * 4. Skriver reset-report.md
 *
 * VAD SCRIPTET INTE GÖR:
 * - Raderar INTE någon historik
 * - Ändrar INTE url, name, type, city, discoveredAt, metadata
 * - Raderar INTE queue-filer (de arkiveras)
 */

import * as fs from 'fs';
import * as path from 'path';

const SOURCES_DIR = path.join(process.cwd(), 'sources');
const RUNTIME_DIR = path.join(process.cwd(), 'runtime');
const ARCHIVE_DIR  = path.join(RUNTIME_DIR, 'archive', 'queues_PRE_RESET');
const RESET_STATE  = path.join(RUNTIME_DIR, 'sources_reset_state.jsonl');
const RESET_REPORT = path.join(RUNTIME_DIR, 'queue-routing-reset-report.md');

const QUEUE_DIRS = [
  '02-Ingestion/A-directAPI-networkGate/A-queue',
  '02-Ingestion/B-JSON-feedGate/B-queue',
  '02-Ingestion/C-htmlGate/C-queue',
  '02-Ingestion/D-renderGate/D-queue',
  '02-Ingestion/H-manualReview/H-queue',
];

interface LegacyQueueRouting {
  previousCurrentQueue: string | null;
  previousRoutingConfidence: string | null;
  previousRoutingReason: string | null;
  previousRoutedAt: string | null;
  previousRouteHistory: unknown[];
  resetAt: string;
  resetReason: string;
}

interface SourceFile {
  id: string;
  url: string;
  name: string;
  type: string;
  city: string;
  discoveredAt: string;
  discoveredBy: string;
  preferredPath: string;
  preferredPathReason?: string;
  currentQueue?: string;
  routingConfidence?: string;
  routingReason?: string;
  routedAt?: string;
  'route-history'?: unknown[];
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ResetStateRecord {
  sourceId: string;
  status: 'untreated';
  preferredPath: 'unknown';
  legacyState: {
    previousStatus: string;
    preferredPath: string | null;
    routingConfidence: string | null;
    routingReason: string | null;
    currentQueue: string | null;
    routedAt: string | null;
    routeHistory: unknown[];
  };
  resetAt: string;
  resetReason: string;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  Created: ${dir}`);
  }
}

function archiveQueueDir(queuePath: string, archiveDir: string): number {
  if (!fs.existsSync(queuePath)) return 0;

  const queueName = path.basename(path.dirname(queuePath)); // e.g. "C-queue"
  const archiveQueueDir = path.join(archiveDir, queueName);
  ensureDir(archiveQueueDir);

  const files = fs.readdirSync(queuePath).filter(f => f.endsWith('.json'));
  let count = 0;
  for (const file of files) {
    const src = path.join(queuePath, file);
    const dst = path.join(archiveQueueDir, file);
    fs.copyFileSync(src, dst);
    count++;
  }
  return count;
}

function resetSourceFile(filePath: string): { legacy: LegacyQueueRouting; resetRec: ResetStateRecord } | null {
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return null;

  const source: SourceFile = JSON.parse(content);

  // Build legacy state from Phase 5 routing
  const legacy: LegacyQueueRouting = {
    previousCurrentQueue: source.currentQueue ?? null,
    previousRoutingConfidence: source.routingConfidence ?? null,
    previousRoutingReason: source.routingReason ?? null,
    previousRoutedAt: source.routedAt ?? null,
    previousRouteHistory: source['route-history'] ?? [],
    resetAt: new Date().toISOString(),
    resetReason: 'Phase 1 reset — queue routing neutralized, see legacyQueueRouting',
  };

  // Build reset state record
  const resetRec: ResetStateRecord = {
    sourceId: source.id,
    status: 'untreated',
    preferredPath: 'unknown',
    legacyState: {
      previousStatus: 'routed', // Phase 5 routing
      preferredPath: source.preferredPath ?? null,
      routingConfidence: source.routingConfidence ?? null,
      routingReason: source.routingReason ?? null,
      currentQueue: source.currentQueue ?? null,
      routedAt: source.routedAt ?? null,
      routeHistory: source['route-history'] ?? [],
    },
    resetAt: new Date().toISOString(),
    resetReason: 'Phase 1 reset according to RebuildPlan',
  };

  // Update source file: neutralize routing fields but keep history
  const updatedSource = { ...source };
  // Mark routing as non-authoritative
  updatedSource.currentQueue = 'pending'; // not authoritative
  updatedSource.routingConfidence = 'reset'; // not authoritative
  updatedSource.routingReason = legacy.previousRoutingReason
    ? `[LEGACY-pre-reset] ${legacy.previousRoutingReason}`
    : null;
  // Keep routedAt as-is but it no longer means "current queue"
  // route-history preserved as-is (already includes Phase 5 entry)

  // Add legacyQueueRouting field
  updatedSource.legacyQueueRouting = legacy;

  // Write updated source
  fs.writeFileSync(filePath, JSON.stringify(updatedSource, null, 2) + '\n', 'utf-8');

  return { legacy, resetRec };
}

export function runQueueRoutingReset(): void {
  console.log('=== Phase 1 Reset: queue-routing ===\n');

  const now = new Date().toISOString();

  // ── 1. Archive queue directories ─────────────────────────────────────
  ensureDir(ARCHIVE_DIR);
  console.log('Archiving queue directories...\n');

  const queueStats: Record<string, number> = {};
  for (const qd of QUEUE_DIRS) {
    const queuePath = path.join(process.cwd(), qd);
    const count = archiveQueueDir(queuePath, ARCHIVE_DIR);
    queueStats[qd] = count;
    console.log(`  ${qd}: ${count} files archived`);
  }

  // ── 2. Process all source files ──────────────────────────────────────
  const sourceFiles = fs.readdirSync(SOURCES_DIR).filter(f => f.endsWith('.jsonl'));
  console.log(`\nProcessing ${sourceFiles.length} source files...\n`);

  const resetRecords: ResetStateRecord[] = [];
  const legacyStats = { withRouting: 0, withoutRouting: 0 };

  for (const file of sourceFiles) {
    const filePath = path.join(SOURCES_DIR, file);
    const result = resetSourceFile(filePath);
    if (result) {
      resetRecords.push(result.resetRec);
      if (result.legacy.previousCurrentQueue) {
        legacyStats.withRouting++;
      } else {
        legacyStats.withoutRouting++;
      }
    }
  }

  // ── 3. Sort reset records by sourceId ───────────────────────────────
  resetRecords.sort((a, b) => a.sourceId.localeCompare(b.sourceId));

  // ── 4. Write reset state ─────────────────────────────────────────────
  const resetLines = resetRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(RESET_STATE, resetLines, 'utf-8');
  console.log(`Created: ${RESET_STATE}`);

  // ── 5. Write reset report ────────────────────────────────────────────
  const report = `# Phase 1 Reset Report — Queue Routing

**Skapad:** ${now}
**Phase:** Fas 1 — Reset enligt RebuildPlan.md
**Kördes:** reset-queue-routing.ts (komplettering till reset-sources-state.ts)

---

## Sammanfattning

Reset av Phase 5 queue-routing som återinfördes efter initial reset.

| Kategori | Antal |
|----------|-------|
| Total sources | ${sourceFiles.length} |
| Med legacyQueueRouting (hade Phase 5 routing) | ${legacyStats.withRouting} |
| Utan Phase 5 routing | ${legacyStats.withoutRouting} |

---

## Queue-filer arkiverade

| Kö | Filer arkiverade |
|----|-----------------|
| A-queue | ${queueStats['02-Ingestion/A-directAPI-networkGate/A-queue'] ?? 0} |
| B-queue | ${queueStats['02-Ingestion/B-JSON-feedGate/B-queue'] ?? 0} |
| C-queue | ${queueStats['02-Ingestion/C-htmlGate/C-queue'] ?? 0} |
| D-queue | ${queueStats['02-Ingestion/D-renderGate/D-queue'] ?? 0} |
| H-queue | ${queueStats['02-Ingestion/H-manualReview/H-queue'] ?? 0} |

Arkiv: runtime/archive/queues_PRE_RESET/

---

## Source-filer uppdaterade

Uppdaterade fält i sources/*.jsonl:
- currentQueue -> "pending" (neutraliserat, ej styrande)
- routingConfidence -> "reset" (neutraliserat, ej styrande)
- routingReason -> legacy-prefix tillagt
- legacyQueueRouting -> nytt fält med Phase 5-data bevarad

Bevarade fält (ej ändrade):
- id, url, name, type, city, discoveredAt, discoveredBy
- preferredPath, preferredPathReason, metadata
- route-history (historik bevarad)

---

## Nollställd state

runtime/sources_reset_state.jsonl innehåller ${resetRecords.length} poster.
Alla har:
- status: "untreated"
- preferredPath: "unknown"
- legacyState med tidigare state

---

## Arkivstruktur

runtime/archive/
  sources_status_PRE_RESET.jsonl  <- reset-sources-state.ts (2026-04-06)
  queues_PRE_RESET/               <- reset-queue-routing.ts (${now})
    A-queue/
    B-queue/
    C-queue/
    D-queue/
    H-queue/

---

## Nästa steg (enligt RebuildPlan)

1. **Fas 2:** Fastställ eller bygg 00A-verktyget
2. **Fas 3:** Canonical Sources Architecture
3. **Fas 4:** Queue Architecture (ny, tunn)
4. **Fas 5:** Kör initial routing igen efter reset

---

**Reset status:** COMPLETE
`;

  fs.writeFileSync(RESET_REPORT, report, 'utf-8');
  console.log(`Created: ${RESET_REPORT}`);

  // ── 6. Summary ─────────────────────────────────────────────────────
  console.log('\n=== Post-reset summary ===');
  console.log(`  Sources processed:     ${sourceFiles.length}`);
  console.log(`  With legacy routing:  ${legacyStats.withRouting}`);
  console.log(`  Without routing:      ${legacyStats.withoutRouting}`);
  console.log(`  Reset records:        ${resetRecords.length}`);
  console.log('\n=== Verification ===');
  console.log(`  Queue files archived: ${Object.values(queueStats).reduce((a, b) => a + b, 0)}`);
  console.log(`  Match: ${resetRecords.length === sourceFiles.length ? 'YES ✓' : 'NO ✗'}`);
}

// Run if executed directly
runQueueRoutingReset();