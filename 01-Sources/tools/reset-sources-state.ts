/**
 * reset-sources-state.ts
 *
 * Phase 1 Reset enligt RebuildPlan.md
 *
 * ANVÄNDNING:
 *   npx tsx 01-Sources/tools/reset-sources-state.ts
 *
 * VAD SCRIPTET GÖR:
 * 1. Läser runtime/sources_status.jsonl
 * 2. Arkiverar den till runtime/archive/sources_status_PRE_RESET.jsonl
 * 3. Skapar runtime/sources_reset_state.jsonl med:
 *    - success-källor: behåller status och metadata
 *    - övriga: status=untreated, preferredPath=unknown,
 *              gammal state flyttas till legacyState
 *
 * VAD SCRIPTET INTE GÖR:
 * - Skriver INTE över runtime/sources_status.jsonl
 * - Ändrar INTE sources/*.jsonl
 * - Raderar INTE någon historik
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const RUNTIME_DIR  = path.join(process.cwd(), 'runtime');
const ARCHIVE_DIR   = path.join(RUNTIME_DIR, 'archive');
const STATUS_FILE   = path.join(RUNTIME_DIR, 'sources_status.jsonl');
const RESET_FILE    = path.join(RUNTIME_DIR, 'sources_reset_state.jsonl');
const ARCHIVE_FILE  = path.join(ARCHIVE_DIR, 'sources_status_PRE_RESET.jsonl');

interface LegacyState {
  previousStatus: string;
  attempts: number;
  consecutiveFailures: number;
  lastRun: string | null;
  lastSuccess: string | null;
  lastEventsFound: number;
  preferredPath: string | null;
  preferredPathConfidence: number | null;
  routingReason: string | null;
  routingSource: string | null;
  pendingNextTool: string | null;
  lastError: string | null;
  lastPathUsed: string | null;
  triageHistory: unknown[];
  triageAttempts: number;
  triageResult: string | null;
  triageRecommendedPath: string | null;
  triageReason: string | null;
}

interface SourceRecord {
  sourceId: string;
  status: string;
  legacyState?: LegacyState;
  resetAt: string;
  resetReason: string;
  // Fields kept verbatim for success sources:
  lastRun?: string | null;
  lastSuccess?: string | null;
  consecutiveFailures?: number;
  lastEventsFound?: number;
  attempts?: number;
  preferredPath?: string | null;
  preferredPathConfidence?: number | null;
  routingReason?: string | null;
  lastRoutingReason?: string | null;
  lastRoutingSource?: string | null;
  pendingNextTool?: string | null;
  lastError?: string | null;
  lastPathUsed?: string | null;
  triageHistory?: unknown[];
  triageAttempts?: number;
  triageResult?: string | null;
  triageRecommendedPath?: string | null;
  triageReason?: string | null;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  Created directory: ${dir}`);
  }
}

function readJsonl(filePath: string): SourceRecord[] {
  const records: SourceRecord[] = [];
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const lines = fileContent.split('\n').filter(l => l.trim().length > 0);
  for (const line of lines) {
    records.push(JSON.parse(line));
  }
  return records;
}

function writeJsonl(filePath: string, records: SourceRecord[]): void {
  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(filePath, lines, 'utf-8');
}

export function runReset(): void {
  console.log('=== Phase 1 Reset: reset-sources-state ===\n');

  // ── 1. Verify source file exists ────────────────────────────────────────
  if (!fs.existsSync(STATUS_FILE)) {
    console.error(`ERROR: ${STATUS_FILE} does not exist. Aborting.`);
    process.exit(1);
  }
  console.log(`Input:  ${STATUS_FILE}`);

  // ── 2. Create archive directory ─────────────────────────────────────────
  ensureDir(ARCHIVE_DIR);
  console.log(`Archive dir: ${ARCHIVE_DIR}`);

  // ── 3. Read current status ─────────────────────────────────────────────
  const records = readJsonl(STATUS_FILE);
  console.log(`Loaded ${records.length} records\n`);

  // ── 4. Count pre-reset stats ────────────────────────────────────────────
  const prePreferredPathNotUnknown = records.filter(r =>
    r.status !== 'success' && r.preferredPath && r.preferredPath !== 'unknown'
  ).length;

  // ── 5. Copy original to archive ────────────────────────────────────────
  fs.copyFileSync(STATUS_FILE, ARCHIVE_FILE);
  console.log(`Archived: ${ARCHIVE_FILE}`);

  // ── 6. Build reset state ────────────────────────────────────────────────
  const resetRecords: SourceRecord[] = [];
  const stats = { success: 0, untreated: 0 };

  for (const rec of records) {
    if (rec.status === 'success') {
      // Keep as-is, add reset metadata
      resetRecords.push({
        sourceId: rec.sourceId,
        status: 'success',
        lastRun: rec.lastRun,
        lastSuccess: rec.lastSuccess,
        consecutiveFailures: rec.consecutiveFailures,
        lastEventsFound: rec.lastEventsFound,
        attempts: rec.attempts,
        preferredPath: rec.preferredPath,
        preferredPathConfidence: rec.preferredPathConfidence,
        routingReason: rec.routingReason,
        lastRoutingReason: rec.lastRoutingReason,
        lastRoutingSource: rec.lastRoutingSource,
        pendingNextTool: rec.pendingNextTool,
        lastError: rec.lastError,
        lastPathUsed: rec.lastPathUsed,
        triageHistory: rec.triageHistory,
        triageAttempts: rec.triageAttempts,
        triageResult: rec.triageResult,
        triageRecommendedPath: rec.triageRecommendedPath,
        triageReason: rec.triageReason,
        resetAt: new Date().toISOString(),
        resetReason: 'Phase 1 reset according to RebuildPlan',
      });
      stats.success++;
    } else {
      // Build legacy state from original record
      const legacyState: LegacyState = {
        previousStatus: rec.status,
        attempts: rec.attempts ?? 0,
        consecutiveFailures: rec.consecutiveFailures ?? 0,
        lastRun: rec.lastRun ?? null,
        lastSuccess: rec.lastSuccess ?? null,
        lastEventsFound: rec.lastEventsFound ?? 0,
        preferredPath: rec.preferredPath ?? null,
        preferredPathConfidence: rec.preferredPathConfidence ?? null,
        routingReason: rec.routingReason ?? null,
        routingSource: rec.lastRoutingSource ?? null,
        pendingNextTool: rec.pendingNextTool ?? null,
        lastError: rec.lastError ?? null,
        lastPathUsed: rec.lastPathUsed ?? null,
        triageHistory: rec.triageHistory ?? [],
        triageAttempts: rec.triageAttempts ?? 0,
        triageResult: rec.triageResult ?? null,
        triageRecommendedPath: rec.triageRecommendedPath ?? null,
        triageReason: rec.triageReason ?? null,
      };

      resetRecords.push({
        sourceId: rec.sourceId,
        status: 'untreated',
        preferredPath: 'unknown',
        legacyState,
        resetAt: new Date().toISOString(),
        resetReason: 'Phase 1 reset according to RebuildPlan',
      });
      stats.untreated++;
    }
  }

  // ── 7. Write reset state file ──────────────────────────────────────────
  writeJsonl(RESET_FILE, resetRecords);
  console.log(`Created: ${RESET_FILE}\n`);

  // ── 8. Print summary ───────────────────────────────────────────────────
  console.log('=== Pre-reset stats ===');
  console.log(`  Total sources:              ${records.length}`);
  console.log(`  Sources with preferredPath != unknown (non-success): ${prePreferredPathNotUnknown}`);
  console.log('\n=== Post-reset stats ===');
  console.log(`  status=success:            ${stats.success}`);
  console.log(`  status=untreated:           ${stats.untreated}`);
  console.log(`  Total:                      ${stats.success + stats.untreated}`);
  console.log('\n=== Files created ===');
  console.log(`  ${ARCHIVE_FILE}`);
  console.log(`  ${RESET_FILE}`);
  console.log('\n=== Verification ===');
  console.log(`  Input records:  ${records.length}`);
  console.log(`  Output records: ${resetRecords.length}`);
  console.log(`  Match: ${records.length === resetRecords.length ? 'YES ✓' : 'NO ✗'}`);
}

// Run if executed directly
runReset();
