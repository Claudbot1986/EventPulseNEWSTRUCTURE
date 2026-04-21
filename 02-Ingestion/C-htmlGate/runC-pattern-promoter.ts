/**
 * runC-pattern-promoter.ts — Permanently promotes confirmed patterns into C0/C2
 *
 * Reads reports/pattern-validation/*.json (runC-pattern-validator output).
 * For each CONFIRMED pattern:
 *   1. Append to C0-htmlFrontierDiscovery.ts SWEDISH_EVENT_PATTERNS array
 *   2. Add URL segment bonus in C2-htmlGate.ts eventUrlSegments array
 *   3. Append promotion record to reports/pattern-promotions.jsonl
 *
 * Generalization Protection Rule: patterns must be confirmed on ≥2 unrelated domains.
 * This script only promotes patterns marked 'confirmed' by the validator.
 *
 * Usage:
 *   npx tsx 02-Ingestion/C-htmlGate/runC-pattern-promoter.ts
 *   npx tsx 02-Ingestion/C-htmlGate/runC-pattern-promoter.ts --dry-run
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..', '..');
const C0_PATH = join(__dirname, 'C0-htmlFrontierDiscovery', 'C0-htmlFrontierDiscovery.ts');
const C2_PATH = join(__dirname, 'C2-htmlGate', 'C2-htmlGate.ts');
const VALIDATION_DIR = join(__dirname, 'reports', 'pattern-validation');
const PROMOTIONS_FILE = join(__dirname, 'reports', 'pattern-promotions.jsonl');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// ── Types ──────────────────────────────────────────────────────────────────────

interface ValidationReport {
  runId: string;
  timestamp: string;
  validations: Array<{
    pattern: string;
    improvement: number;
    improvedDomains: number;
    status: 'confirmed' | 'rejected' | 'insufficient-data';
    reason: string;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadLatestValidation(): ValidationReport | null {
  const files = readdirSync(VALIDATION_DIR).filter(f => f.startsWith('validation-') && f.endsWith('.json'));
  if (files.length === 0) return null;
  files.sort();
  const latest = files[files.length - 1];
  try {
    return JSON.parse(readFileSync(join(VALIDATION_DIR, latest), 'utf8')) as ValidationReport;
  } catch {
    return null;
  }
}

function getBuiltInPatterns(filePath: string, arrayName: string): string[] {
  try {
    const content = readFileSync(filePath, 'utf8');
    const match = content.match(new RegExp(`${arrayName}\\s*=\\s*\\[([\\s\\S]*?)\\];?`));
    if (!match) return [];
    const inner = match[1];
    return inner.match(/'([^']+)'/g)?.map(p => p.replace(/'/g, '')) ?? [];
  } catch {
    return [];
  }
}

function promoteToC0(pattern: string): void {
  const content = readFileSync(C0_PATH, 'utf8');
  const cleanPattern = pattern.startsWith('/') ? pattern.slice(1) : pattern;

  const existing = getBuiltInPatterns(C0_PATH, 'SWEDISH_EVENT_PATTERNS');
  if (existing.includes(cleanPattern)) {
    console.log(`  [SKIP] "${cleanPattern}" already in SWEDISH_EVENT_PATTERNS`);
    return;
  }

  const arrayEndMatch = content.match(/(SWEDISH_EVENT_PATTERNS\s*=\s*\[[\s\S]*?)\];/);
  if (!arrayEndMatch) {
    console.error(`  [ERROR] Could not find SWEDISH_EVENT_PATTERNS array end in C0`);
    return;
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const newEntry = `  '${cleanPattern}', // [AI-PROMOTED] added ${dateStr}`;

  const arrayContent = arrayEndMatch[1];
  const lastEntryMatch = arrayContent.match(/'([^']+)'\s*$/m);
  if (!lastEntryMatch) {
    console.error(`  [ERROR] Could not find last entry in SWEDISH_EVENT_PATTERNS`);
    return;
  }

  const newContent = content.replace(lastEntryMatch[0], `${lastEntryMatch[0]}\n${newEntry}`);

  if (dryRun) {
    console.log(`  [DRY-RUN] Would add "${cleanPattern}" to SWEDISH_EVENT_PATTERNS`);
  } else {
    writeFileSync(C0_PATH, newContent);
    console.log(`  [PROMOTED] Added "${cleanPattern}" to SWEDISH_EVENT_PATTERNS`);
  }
}

function promoteToC2(pattern: string): void {
  const content = readFileSync(C2_PATH, 'utf8');
  const cleanPattern = pattern.startsWith('/') ? pattern.slice(1) : pattern;

  const existing = getBuiltInPatterns(C2_PATH, 'eventUrlSegments');
  if (existing.includes(cleanPattern)) {
    console.log(`  [SKIP] "${cleanPattern}" already in eventUrlSegments`);
    return;
  }

  const arrayEndMatch = content.match(/(eventUrlSegments\s*=\s*\[[\s\S]*?)\];/);
  if (!arrayEndMatch) {
    console.error(`  [ERROR] Could not find eventUrlSegments array end in C2`);
    return;
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const newEntry = `  '${cleanPattern}', // [AI-PROMOTED] added ${dateStr}`;

  const arrayContent = arrayEndMatch[1];
  const lastEntryMatch = arrayContent.match(/'([^']+)'\s*$/m);
  if (!lastEntryMatch) {
    console.error(`  [ERROR] Could not find last entry in eventUrlSegments`);
    return;
  }

  const newContent = content.replace(lastEntryMatch[0], `${lastEntryMatch[0]}\n${newEntry}`);

  if (dryRun) {
    console.log(`  [DRY-RUN] Would add "${cleanPattern}" to eventUrlSegments`);
  } else {
    writeFileSync(C2_PATH, newContent);
    console.log(`  [PROMOTED] Added "${cleanPattern}" to eventUrlSegments`);
  }
}

function logPromotion(pattern: string, improvement: number, improvedDomains: number, validationRunId: string): void {
  const record = JSON.stringify({
    pattern,
    improvement,
    improvedDomains,
    validationRunId,
    promotedAt: new Date().toISOString(),
    source: 'runC-pattern-promoter',
  });
  appendFileSync(PROMOTIONS_FILE, record + '\n');
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  console.log('============================================================');
  console.log('PATTERN PROMOTER — implements confirmed AI patterns in C-layer');
  console.log('============================================================');
  if (dryRun) console.log('  [DRY RUN — no files will be modified]\n');

  mkdirSync(join(__dirname, 'reports'), { recursive: true });

  const report = loadLatestValidation();
  if (!report) {
    console.error('No validation report found. Run runC-pattern-validator.ts first.');
    process.exit(1);
  }

  console.log(`Loaded validation: ${report.runId}`);
  const confirmed = report.validations.filter(v => v.status === 'confirmed');
  console.log(`Confirmed patterns: ${confirmed.length}\n`);

  if (confirmed.length === 0) {
    console.log('No confirmed patterns to promote.');
    process.exit(0);
  }

  for (const v of confirmed) {
    console.log(`  ${v.pattern} — +${v.improvement}% on ${v.improvedDomains} domains`);
  }

  if (dryRun) {
    console.log('\n[DRY RUN] Would promote. Run without --dry-run to implement.');
    process.exit(0);
  }

  console.log('\nPromoting...');
  for (const v of confirmed) {
    console.log(`\n→ ${v.pattern}`);
    promoteToC0(v.pattern);
    promoteToC2(v.pattern);
    logPromotion(v.pattern, v.improvement, v.improvedDomains, report.runId);
  }

  console.log('\n============================================================');
  console.log(`PROMOTION COMPLETE — ${confirmed.length} pattern(s) implemented`);
  console.log('============================================================');
  console.log('  Restart any running C workers to pick up new patterns.');
}

main();
