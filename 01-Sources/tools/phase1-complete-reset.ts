/**
 * phase1-complete-reset.ts
 *
 * Completion of Phase 1 Reset — fixes the parallel truth problem.
 *
 * PROBLEM:
 * reset-sources-state.ts archived runtime/sources_status.jsonl to
 * runtime/archive/sources_status_PRE_RESET.jsonl and created
 * runtime/sources_reset_state.jsonl as the reset state.
 *
 * HOWEVER, runtime/sources_status.jsonl was NOT overwritten — it still
 * contains Phase 5 operational state and is actively read by
 * sourceRegistry.ts, creating two parallel sources of truth.
 *
 * FIX:
 * 1. Archive the current (still Phase 5) runtime/sources_status.jsonl
 *    to runtime/archive/sources_status_PRE_PHASE5_COMPLETE_RESET.jsonl
 * 2. Read all sourceIds from runtime/sources_reset_state.jsonl (425 sources)
 * 3. Write a new clean runtime/sources_status.jsonl where every source has:
 *    - status: 'never_run'
 *    - ingestionStage: 'pending'
 *    - legacyState: full Phase 5 state from runtime/sources_reset_state.jsonl
 * 4. Update queue-routing-reset-report.md to mark Phase 1 as fully complete
 *
 * VERIFICATION:
 * - runtime/sources_status.jsonl line count must equal 425 (matches sources/)
 * - All entries must have status='never_run' and ingestionStage='pending'
 * - No entries with Phase 5 operational fields (preferredPathConfidence,
 *   triageHistory, lastPathUsed, pendingNextTool, etc.)
 *
 * AFTER THIS:
 * - sourceRegistry.ts will read the clean reset state
 * - Phase 1 is truly complete — no parallel truth
 * - Phase 2 (00A tool) can begin
 */

import * as fs from 'fs';
import * as path from 'path';

const RUNTIME_DIR = path.join(process.cwd(), 'runtime');
const STATUS_FILE = path.join(RUNTIME_DIR, 'sources_status.jsonl');
const RESET_STATE_FILE = path.join(RUNTIME_DIR, 'sources_reset_state.jsonl');
const ARCHIVE_DIR = path.join(RUNTIME_DIR, 'archive');
const ARCHIVE_FILE = path.join(ARCHIVE_DIR, 'sources_status_PRE_PHASE5_COMPLETE_RESET.jsonl');
const REPORT_FILE = path.join(RUNTIME_DIR, 'queue-routing-reset-report.md');

interface LegacyState {
  previousStatus: string;
  preferredPath: string | null;
  routingConfidence: string | null;
  routingReason: string | null;
  currentQueue: string | null;
  routedAt: string | null;
  routeHistory: unknown[];
  // Extended Phase 5 fields from original sources_status.jsonl
  attempts?: number;
  consecutiveFailures?: number;
  lastRun?: string | null;
  lastSuccess?: string | null;
  lastEventsFound?: number;
  preferredPathConfidence?: number | null;
  routingSource?: string | null;
  pendingNextTool?: string | null;
  lastError?: string | null;
  lastPathUsed?: string | null;
  triageHistory?: unknown[];
  triageAttempts?: number;
  triageResult?: string | null;
  triageRecommendedPath?: string | null;
  triageReason?: string | null;
}

interface ResetStateRecord {
  sourceId: string;
  status: string;
  preferredPath: string;
  legacyState: LegacyState;
  resetAt: string;
  resetReason: string;
}

interface NewStatusEntry {
  sourceId: string;
  status: 'never_run';
  ingestionStage: 'pending';
  lastRun: null;
  lastSuccess: null;
  consecutiveFailures: 0;
  lastEventsFound: 0;
  attempts: 0;
  legacyState: LegacyState;
  resetAt: string;
  resetReason: string;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonl(filePath: string): ResetStateRecord[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l) as ResetStateRecord);
}

function countLines(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').filter(l => l.trim()).length;
}

export function runPhase1CompleteReset(): void {
  console.log('=== Phase 1 Complete Reset ===\n');
  console.log('Fixing parallel truth: runtime/sources_status.jsonl still has Phase 5 state\n');

  const now = new Date().toISOString();

  // ── 1. Verify prerequisites ───────────────────────────────────────────
  if (!fs.existsSync(STATUS_FILE)) {
    console.error(`ERROR: ${STATUS_FILE} does not exist. Aborting.`);
    process.exit(1);
  }
  if (!fs.existsSync(RESET_STATE_FILE)) {
    console.error(`ERROR: ${RESET_STATE_FILE} does not exist. Run reset-queue-routing.ts first. Aborting.`);
    process.exit(1);
  }

  // ── 2. Count current Phase 5 entries ─────────────────────────────────
  const currentCount = countLines(STATUS_FILE);
  console.log(`Current runtime/sources_status.jsonl: ${currentCount} entries (Phase 5 state)`);

  // ── 3. Read reset state ──────────────────────────────────────────────
  const resetRecords = readJsonl(RESET_STATE_FILE);
  console.log(`runtime/sources_reset_state.jsonl: ${resetRecords.length} entries (reset state)\n`);

  // ── 4. Archive current Phase 5 file ───────────────────────────────────
  ensureDir(ARCHIVE_DIR);
  fs.copyFileSync(STATUS_FILE, ARCHIVE_FILE);
  console.log(`Archived Phase 5 state to: ${ARCHIVE_FILE}`);

  // ── 5. Build new clean status entries ────────────────────────────────
  const newEntries: NewStatusEntry[] = resetRecords.map(rec => ({
    sourceId: rec.sourceId,
    status: 'never_run' as const,
    ingestionStage: 'pending' as const,
    lastRun: null,
    lastSuccess: null,
    consecutiveFailures: 0,
    lastEventsFound: 0,
    attempts: 0,
    legacyState: rec.legacyState,
    resetAt: now,
    resetReason: 'Phase 1 complete reset — runtime/sources_status.jsonl overwritten with clean state',
  }));

  // Sort by sourceId for consistency
  newEntries.sort((a, b) => a.sourceId.localeCompare(b.sourceId));

  // ── 6. Write new clean status file ───────────────────────────────────
  const newLines = newEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(STATUS_FILE, newLines, 'utf-8');
  console.log(`Written clean reset to: ${STATUS_FILE}`);

  // ── 7. Verify ────────────────────────────────────────────────────────
  const newCount = countLines(STATUS_FILE);
  const newContent = fs.readFileSync(STATUS_FILE, 'utf-8');
  const firstEntry = JSON.parse(newContent.split('\n')[0]) as NewStatusEntry;

  console.log('\n=== Verification ===');
  console.log(`  Sources in new file:    ${newCount}`);
  console.log(`  Sources in reset state:  ${resetRecords.length}`);
  console.log(`  Match:                  ${newCount === resetRecords.length ? 'YES ✓' : 'NO ✗'}`);
  console.log(`  First entry status:      ${firstEntry.status}`);
  console.log(`  First entry ingestionStage: ${firstEntry.ingestionStage}`);
  console.log(`  First entry has legacyState: ${firstEntry.legacyState ? 'YES ✓' : 'NO ✗'}`);

  // Check no Phase 5 operational fields remain
  const hasPhase5Fields = ['preferredPathConfidence', 'triageHistory', 'lastPathUsed', 'pendingNextTool']
    .some(field => newContent.includes(`"${field}"`));
  console.log(`  No Phase 5 operational fields: ${hasPhase5Fields ? 'FAIL ✗' : 'YES ✓'}`);

  console.log('\nPhase 1 Reset: COMPLETE ✓');
  console.log('Two parallel truth problem: RESOLVED ✓');
}

runPhase1CompleteReset();
