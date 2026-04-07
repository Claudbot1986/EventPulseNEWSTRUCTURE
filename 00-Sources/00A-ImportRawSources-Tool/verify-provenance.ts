/**
 * verify-provenance.ts
 *
 * Minimal end-to-end test that all six rowOutcome values are produced.
 *
 * Creates a temporary test directory with:
 * - sources/ existing sources
 * - RawSources/ test input file
 * - runtime/ output directory
 *
 * Runs import-raw-sources.ts and verifies all rowOutcome values appear.
 *
 * Run: npx tsx 00-Sources/00A-ImportRawSources-Tool/verify-provenance.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import type { RawRowProvenance, ImportedSource } from './import-raw-sources';

// ─── Test data ───────────────────────────────────────────────────────────────

/**
 * RawSources markdown with 5+1 cases:
 * 1. new_row               — genuinely new site (abf.se)
 * 2. new_row_needs_review — same hostname as existing source but DIFFERENT name+city
 * 3. matched_existing_row — matches existing source (konserthuset.se with same Stockholm)
 * 4. duplicate_row_in_batch — same hostname twice (kulturhuset.se)
 * 5. invalid_row           — bad URL (row 5)
 * 6. skipped_already_imported_file — tested via second run (same file skipped)
 */
const TEST_RAW_SOURCES = `| Namn | URL | Stad | Kategori | Insamlad | Notis |
| ABF | https://www.abf.se | Stockholm | förening | 2026-04-04 | Test: ny source |
| Konserthuset Stockholm | https://www.konserthuset.se | Stockholm | nöje | 2026-04-02 | Matchar existerande källa |
| Konserthuset Göteborg | https://www.konserthuset.se | Göteborg | nöje | 2026-04-02 | New+review: hostname match but different city |
| Kulturhuset | https://www.kulturhuset.se | Stockholm | kultur | 2026-04-02 | Dubblett i import |
| Kulturhuset | https://www.kulturhuset.se | Stockholm | kultur | 2026-04-02 | Dubblett rad 2 |
| BadURL | httsp://bad-url.test | Stockholm | test | 2026-04-02 | Invalid URL |
`;

/**
 * One existing source — konserthuset.se already exists.
 * This makes the import row for konserthuset.se a 'matched_existing_row'.
 */
const EXISTING_SOURCES: Record<string, string> = {
  'konserthuset.jsonl': JSON.stringify({
    id: 'konserthuset',
    url: 'konserthuset.se/',
    name: 'Konserthuset Stockholm',
    type: 'nöje',
    city: 'Stockholm',
    discoveredAt: '2026-01-01',
    discoveredBy: 'manual',
    preferredPath: null,
  }) + '\n',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function setup(testDir: string): void {
  // Clean up any previous test run
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
  }

  fs.mkdirSync(path.join(testDir, 'sources'), { recursive: true });
  fs.mkdirSync(path.join(testDir, '01-Sources', 'RawSources'), { recursive: true });
  fs.mkdirSync(path.join(testDir, 'runtime'), { recursive: true });

  // Write existing sources
  for (const [filename, content] of Object.entries(EXISTING_SOURCES)) {
    fs.writeFileSync(path.join(testDir, 'sources', filename), content);
  }

  // Write test input
  fs.writeFileSync(
    path.join(testDir, '01-Sources', 'RawSources', 'RawSourcesVerify.md'),
    TEST_RAW_SOURCES,
  );

  // Write empty manifest (clear any previous state)
  fs.mkdirSync(path.join(testDir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(testDir, 'runtime', 'raw-import-manifest.jsonl'), '');
}

function collectProvenance(testDir: string): {
  allOutcomes: Set<string>;
  sourcesWithEmptyProvenance: string[];
  provenanceRowsCount: number;
  skippedOutcomes: Set<string>;
  invalidOutcomes: Set<string>;
} {
  const previewPath = path.join(testDir, 'runtime', 'import-preview.jsonl');
  const skippedPath = path.join(testDir, 'runtime', 'import-preview.skipped-provenance.jsonl');
  const invalidPath = path.join(testDir, 'runtime', 'import-preview.invalid-provenance.jsonl');
  const allOutcomes = new Set<string>();
  const sourcesWithEmptyProvenance: string[] = [];
  let provenanceRowsCount = 0;
  const skippedOutcomes = new Set<string>();
  const invalidOutcomes = new Set<string>();

  if (!fs.existsSync(previewPath)) {
    return { allOutcomes, sourcesWithEmptyProvenance, provenanceRowsCount, skippedOutcomes, invalidOutcomes };
  }

  const lines = fs.readFileSync(previewPath, 'utf-8').split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const source = JSON.parse(line) as ImportedSource;
      const prov = source.provenanceRows ?? [];
      if (prov.length === 0) {
        sourcesWithEmptyProvenance.push(source.sourceIdentityKey);
      }
      provenanceRowsCount += prov.length;
      for (const p of prov) {
        allOutcomes.add(p.rowOutcome);
      }
    } catch {
      // skip
    }
  }

  // Check skipped provenance file (second run)
  const skippedPath2 = path.join(testDir, 'runtime', 'import-preview2.skipped-provenance.jsonl');
  if (fs.existsSync(skippedPath2)) {
    const skippedLines = fs.readFileSync(skippedPath2, 'utf-8').split('\n').filter(l => l.trim());
    for (const line of skippedLines) {
      try {
        const prov = JSON.parse(line) as RawRowProvenance;
        skippedOutcomes.add(prov.rowOutcome);
        allOutcomes.add(prov.rowOutcome);
      } catch {
        // skip
      }
    }
  }

  // Check invalid provenance file
  if (fs.existsSync(invalidPath)) {
    const invalidLines = fs.readFileSync(invalidPath, 'utf-8').split('\n').filter(l => l.trim());
    for (const line of invalidLines) {
      try {
        const prov = JSON.parse(line) as RawRowProvenance;
        invalidOutcomes.add(prov.rowOutcome);
        allOutcomes.add(prov.rowOutcome);
      } catch {
        // skip
      }
    }
  }

  return { allOutcomes, sourcesWithEmptyProvenance, provenanceRowsCount, skippedOutcomes, invalidOutcomes };
}

// ─── Run import ──────────────────────────────────────────────────────────────

function runImport(testDir: string): void {
  const originalCwd = process.cwd();
  const scriptPath = path.join(originalCwd, '00-Sources', '00A-ImportRawSources-Tool', 'import-raw-sources.ts');
  const inputPath = path.join(testDir, '01-Sources', 'RawSources', 'RawSourcesVerify.md');
  const outputPath = path.join(testDir, 'runtime', 'import-preview.jsonl');
  const manifestPath = path.join(testDir, 'runtime', 'raw-import-manifest.jsonl');

  // First run: normal import
  console.log('\n=== First import run ===');
  try {
    execSync(`npx tsx "${scriptPath}" --input "${inputPath}" --output "${outputPath}"`, {
      cwd: testDir,
      stdio: 'inherit',
    });
  } catch (e) {
    console.error('Import failed:', e);
    process.exit(1);
  }

  // Check intermediate result
  const result1 = collectProvenance(testDir);
  console.log('\n=== After first import ===');
  console.log('Outcomes found:', Array.from(result1.allOutcomes).sort().join(', '));
  console.log('Provenance rows:', result1.provenanceRowsCount);

  // Second run: same file (should be skipped_already_imported_file)
  console.log('\n=== Second import run (same file — idempotency check) ===');
  const outputPath2 = path.join(testDir, 'runtime', 'import-preview2.jsonl');
  try {
    execSync(`npx tsx "${scriptPath}" --input "${inputPath}" --output "${outputPath2}"`, {
      cwd: testDir,
      stdio: 'inherit',
    });
  } catch (e) {
    // Expected to exit early
  }

  process.chdir(originalCwd);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const testDir = path.join(process.cwd(), '00-Sources', '00A-ImportRawSources-Tool', 'verify-temp');
  console.log('=== Provenance Verification ===');
  console.log('Test dir:', testDir);

  setup(testDir);
  runImport(testDir);

  const { allOutcomes, sourcesWithEmptyProvenance, provenanceRowsCount, skippedOutcomes, invalidOutcomes } =
    collectProvenance(testDir);

  console.log('\n=== RESULTS ===');
  console.log('All outcomes found:', Array.from(allOutcomes).sort().join(', '));
  console.log('Sources with empty provenanceRows:', sourcesWithEmptyProvenance.length === 0 ? 'none ✓' : sourcesWithEmptyProvenance.join(', '));
  console.log('Total provenance rows in preview:', provenanceRowsCount);
  console.log('Invalid outcomes:', Array.from(invalidOutcomes).sort().join(', '));
  console.log('Skipped outcomes:', Array.from(skippedOutcomes).sort().join(', '));

  const REQUIRED_OUTCOMES = [
    'new_row',
    'new_row_needs_review',
    'matched_existing_row',
    'duplicate_row_in_batch',
    'invalid_row',
    'skipped_already_imported_file',
  ];

  console.log('\n=== OUTCOME CHECK ===');
  let allFound = true;
  for (const outcome of REQUIRED_OUTCOMES) {
    const found = allOutcomes.has(outcome);
    console.log(`  ${found ? '✓' : '✗'} ${outcome}`);
    if (!found) allFound = false;
  }

  console.log('\n=== EMPTY PROVENANCE CHECK ===');
  if (sourcesWithEmptyProvenance.length === 0) {
    console.log('  ✓ No source has empty provenanceRows');
  } else {
    console.log('  ✗ Sources with empty provenanceRows:', sourcesWithEmptyProvenance.join(', '));
    allFound = false;
  }

  // Read the preview and show details
  const previewPath = path.join(testDir, 'runtime', 'import-preview.jsonl');
  if (fs.existsSync(previewPath)) {
    console.log('\n=== SOURCE DETAILS ===');
    const lines = fs.readFileSync(previewPath, 'utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const src = JSON.parse(line) as ImportedSource;
        const prov = src.provenanceRows ?? [];
        const outcomes = prov.map(p => p.rowOutcome);
        console.log(`  ${src.sourceIdentityKey}: ${src.matchStatus} | provenanceRows=${prov.length} | outcomes=[${outcomes.join(', ')}]`);
      } catch {
        // skip
      }
    }
  }

  // Check manifest
  const manifestPath = path.join(testDir, 'runtime', 'raw-import-manifest.jsonl');
  if (fs.existsSync(manifestPath)) {
    const manifestLines = fs.readFileSync(manifestPath, 'utf-8').split('\n').filter(l => l.trim());
    console.log(`\n=== MANIFEST ===`);
    console.log(`  Entries: ${manifestLines.length}`);
    for (const ml of manifestLines) {
      try {
        const entry = JSON.parse(ml);
        console.log(`  - ${entry.fileName}: ${entry.importStatus} (batch ${entry.importBatchId})`);
      } catch {
        // skip
      }
    }
  }

  console.log('\n=== FINAL ===');
  if (allFound && sourcesWithEmptyProvenance.length === 0) {
    console.log('ALL CHECKS PASSED ✓');
    console.log('provenanceRows is no longer empty — every row is accounted for.');
  } else {
    console.log('SOME CHECKS FAILED ✗');
    process.exit(1);
  }

  // Clean up
  fs.rmSync(testDir, { recursive: true });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
