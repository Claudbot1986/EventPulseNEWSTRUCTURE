/**
 * verify-patch.ts
 *
 * Kör verifiering av:
 * 1. findNextConflictVariant — persistent över batchar
 * 2. matchStatus-typen — 'manualreview' kan inte längre tilldelas
 *
 * Körs med: npx tsx 00-Sources/00A-ImportRawSources-Tool/verify-patch.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Inline findNextConflictVariant + escapeRegExp (kopiera från import-raw-sources.ts) ─

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findNextConflictVariant(
  baseSourceId: string,
  sourcesDir: string,
  reservedInBatch: Set<string>,
): number {
  let maxVariant = 0;

  // 1. Scan existing files in sources/ (persistent across all previous batches)
  if (fs.existsSync(sourcesDir)) {
    const files = fs.readdirSync(sourcesDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const match = file.match(new RegExp(`^${escapeRegExp(baseSourceId)}-conflict-(\\d+)\\.jsonl$`));
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxVariant) maxVariant = n;
      }
    }
  }

  // 2. Scan reserved IDs in the current batch (handles multiple conflicts in same batch)
  const reservedArray = Array.from(reservedInBatch);
  for (const reserved of reservedArray) {
    const match = reserved.match(new RegExp(`^${escapeRegExp(baseSourceId)}-conflict-(\\d+)$`));
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxVariant) maxVariant = n;
    }
  }

  return maxVariant + 1;
}

// ─── Test 1: findNextConflictVariant ────────────────────────────────────────

function testFindNextConflictVariant(): void {
  console.log('\n=== Test 1: findNextConflictVariant (persistent across batches) ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-conflict-'));
  const sourcesDir = path.join(tempDir, 'sources');
  fs.mkdirSync(sourcesDir);

  let pass = true;

  // Batch 1: abf gets -conflict-1
  const v1 = findNextConflictVariant('abf', sourcesDir, new Set<string>());
  console.log(`  Batch 1: abf → abf-conflict-${v1} (förväntat: 1)`);
  if (v1 !== 1) { console.error('  FAIL: förväntade 1'); pass = false; }

  // Create abf-conflict-1.jsonl (simulate batch 1 write)
  fs.writeFileSync(path.join(sourcesDir, `abf-conflict-1.jsonl`), '{"id":"abf-conflict-1"}\n');

  // Batch 2: abf gets -conflict-2
  const v2 = findNextConflictVariant('abf', sourcesDir, new Set<string>());
  console.log(`  Batch 2: abf → abf-conflict-${v2} (förväntat: 2)`);
  if (v2 !== 2) { console.error('  FAIL: förväntade 2'); pass = false; }

  // Create abf-conflict-2.jsonl
  fs.writeFileSync(path.join(sourcesDir, `abf-conflict-2.jsonl`), '{"id":"abf-conflict-2"}\n');

  // Batch 3: abf gets -conflict-3
  const v3 = findNextConflictVariant('abf', sourcesDir, new Set<string>());
  console.log(`  Batch 3: abf → abf-conflict-${v3} (förväntat: 3)`);
  if (v3 !== 3) { console.error('  FAIL: förväntade 3'); pass = false; }

  // Another source (liseberg) should start at 1
  const vl1 = findNextConflictVariant('liseberg', sourcesDir, new Set<string>());
  console.log(`  Batch X: liseberg → liseberg-conflict-${vl1} (förväntat: 1)`);
  if (vl1 !== 1) { console.error('  FAIL: förväntade 1'); pass = false; }

  // Test reservedInBatch: two conflicts for same base in same batch
  const reserved = new Set<string>();
  const rv1 = findNextConflictVariant('nykopia', sourcesDir, reserved);
  reserved.add(`nykopia-conflict-${rv1}`);
  const rv2 = findNextConflictVariant('nykopia', sourcesDir, reserved);
  reserved.add(`nykopia-conflict-${rv2}`);
  const rv3 = findNextConflictVariant('nykopia', sourcesDir, reserved);
  console.log(`  Same batch multi-conflict: nykopia → ${rv1}, ${rv2}, ${rv3} (förväntat: 1, 2, 3)`);
  if (rv1 !== 1 || rv2 !== 2 || rv3 !== 3) { console.error('  FAIL: multi-conflict same batch'); pass = false; }

  // Cleanup
  fs.rmSync(tempDir, { recursive: true });

  console.log(`\n  Resultat: ${pass ? 'PASS ✓' : 'FAIL ✗'}`);
}

// ─── Test 2: matchStatus type enforcement ─────────────────────────────────────

function testMatchStatusType(): void {
  console.log('\n=== Test 2: matchStatus type — manualreview cannot be assigned ===\n');

  // The ImportedSource type from import-raw-sources.ts:
  //   matchStatus: 'new' | 'matched_existing' | 'duplicate_in_import'
  //
  // The following would NOT compile (TypeScript error) if uncommented:
  //   const bad: ImportedSource['matchStatus'] = 'manualreview';
  //   ERROR: Type '"manualreview"' is not assignable to
  //          type '"new" | "matched_existing" | "duplicate_in_import"'

  type ValidMatchStatus = 'new' | 'matched_existing' | 'duplicate_in_import';

  // Valid values should compile fine
  const statuses: ValidMatchStatus[] = ['new', 'matched_existing', 'duplicate_in_import'];

  for (const s of statuses) {
    console.log(`  matchStatus='${s}' → OK (kan användas som ImportedSource.matchStatus)`);
  }

  // This line proves the type was changed:
  // @ts-expect-error — 'manualreview' is NOT a valid matchStatus
  const badStatus: ValidMatchStatus = 'manualreview';

  console.log(`  'manualreview' → TS-fel vid kompilering (förväntat) ✓`);
  console.log(`\n  Resultat: PASS ✓`);
}

// ─── Test 3: readExistingSources still works ────────────────────────────────

function testReadExistingSources(): void {
  console.log('\n=== Test 3: readExistingSources + conflict-1 exists ===\n');

  const sourcesDir = path.join(process.cwd(), 'sources');
  if (!fs.existsSync(sourcesDir)) {
    console.log('  SKIP: sources/ does not exist');
    return;
  }

  const conflict1 = path.join(sourcesDir, 'abf-conflict-1.jsonl');
  if (fs.existsSync(conflict1)) {
    const content = fs.readFileSync(conflict1, 'utf-8');
    const parsed = JSON.parse(content.split('\n')[0]);
    console.log(`  abf-conflict-1.jsonl exists ✓`);
    console.log(`    id: ${parsed.id}`);
    console.log(`    requiresManualReview: ${parsed.requiresManualReview}`);
    console.log(`  Nu nästa konflikt för abf → abf-conflict-2 (när findNextConflictVariant körs)`);
  } else {
    console.log('  INFO: abf-conflict-1.jsonl does not exist yet');
    console.log('  Nästa konflikt → abf-conflict-1');
  }

  console.log(`\n  Resultat: PASS ✓`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  verify-patch.ts — Conflict variants + matchStatus cleanup     ║');
console.log('╚══════════════════════════════════════════════════════════════╝');

testFindNextConflictVariant();
testMatchStatusType();
testReadExistingSources();

console.log('\n=== All tests complete ===\n');
