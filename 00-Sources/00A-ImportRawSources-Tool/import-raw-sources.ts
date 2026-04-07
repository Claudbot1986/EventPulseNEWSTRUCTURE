/**
 * import-raw-sources.ts
 *
 * Phase 2: 00A-ImportRawSources-Tool
 *
 * Importerar råa source-listor med:
 * - URL-normalisering (site-level identity + path-aware canonicalUrl)
 * - Stabil sourceId-generering
 * - Deduplikering inom importfilen
 * - Matchning mot befintliga canonical sources i sources/*.jsonl
 * - Idempotent output (preview only — skriver ALDRIG till sources/)
 *
 * ANVÄNDNING:
 *   npx tsx 00-Sources/00A-ImportRawSources-Tool/import-raw-sources.ts \
 *     --input 01-Sources/RawSources/RawSources20260404.md \
 *     --output runtime/import-preview.jsonl
 *
 * IMPORTANT:
 *   Detta verktyg SKRIVER INTE till sources/
 *   Det producerar endast import-preview.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as child_process from 'child_process';

// ─── Types ─────────────────────────────────────────────────────────────────

interface RawSourceRow {
  name: string;
  url: string;
  city: string;
  type: string;
  discoveredAt: string;
  note: string;
}

/** A single existing source read from sources/*.jsonl */
interface ExistingSource {
  id: string;
  url: string;
  name: string;
  city: string;
  type: string;
  preferredPath: string | null;
  discoveredAt: string;
  discoveredBy: string | null;
}

/**
 * Output format for import preview.
 * Each ImportedSource represents one deduplicated source from the import.
 *
 * KEY CONCEPT — Two-level URL identity:
 * - sourceIdentityKey: site-level key for deduplication and matching (hostname only)
 * - canonicalUrl: the representative URL chosen for this source (with path if present)
 */
interface ImportedSource {
  // Identity
  sourceId: string;           // authoritative sourceId (existing.id if matched, else generated)
  sourceIdentityKey: string;  // site-level key: hostname only (for deduplication)
  canonicalUrl: string;       // representative URL with path (for display/audit)
  name: string;
  city: string;
  type: string;
  discoveredAt: string;
  note: string;

  // Deduplication tracking
  isDuplicate: boolean;      // true if this source had multiple rows merged
  originalRows: Array<{ name: string; url: string }>;

  // Match against existing canonical sources
  // matchStatus is the OUTCOME of the import match decision.
  // For NEW sources that need review, use reviewTags/requiresManualReview instead.
  matchStatus: 'new' | 'matched_existing' | 'duplicate_in_import';
  matchedBy?: 'sourceIdentityKey';
  existingSource?: {
    id: string;
    name: string;
    preferredPath: string | null;
  };

  // REVIEW FLAGS: these do NOT block write to sources/.
  // A source with requiresManualReview=true is still a valid, writable source.
  // It is simply marked for review during ingestion.
  // NOTE: 'manualreview' is a review TAG (in reviewTags[]), NEVER a matchStatus value.
  // matchStatus can only be: 'new' | 'matched_existing' | 'duplicate_in_import'.
  requiresManualReview?: boolean;
  reviewTags?: Array<'manualreview' | 'name_conflict' | 'city_conflict' | 'type_uncertain'>;
  manualReviewReasons?: string[];

  // When a hostname matches an existing source but name/city differs,
  // we create a NEW source (not a replacement). The sourceId must be unique
  // so we use conflictVariant to make it distinct from the existing source.
  conflictVariant?: number;  // 1 = first conflict variant, 2 = second, etc.
  manualReviewReason?: string;

  // Temporary metadata for manualreview sources (DEPRECATED: use reviewTags instead)
  // Used during test/analysis phase — NOT final canonical identity
  temporaryCategory?: 'manualreview';
  temporarySourceId?: string;
  temporaryDisplayName?: string;

  // Row-level provenance: all raw rows that contributed to this source
  provenanceRows: RawRowProvenance[];
}

// ─── Raw Import Manifest ───────────────────────────────────────────────────

/**
 * A manifest entry for one imported raw file.
 * Stored in runtime/raw-import-manifest.jsonl — one line per import.
 */
export interface ManifestEntry {
  importBatchId: string;       // unique per import run
  importedAt: string;         // ISO timestamp
  fileName: string;           // e.g. "RawSources20260404.md"
  filePath: string;           // absolute or relative path
  fileSize: number;           // bytes
  fileHash: string;           // sha256 of raw file content (hex)
  rowCount: number;           // total rows parsed from this file
  importStatus: 'imported' | 'skipped_already_imported' | 'skipped_hash_mismatch' | 'error';
  skippedReason?: string;
  errorMessage?: string;
}

/**
 * A provenance entry for ONE raw row.
 * Every raw row gets exactly one of these so we can account for every row.
 *
 * IMPORTANT — This is ROW-LEVEL traceability, SEPARATE from matchStatus.
 * - matchStatus:     source-level import outcome (new | matched_existing | duplicate_in_import)
 * - classificationOutcome: row-level what-happened-to-this-row
 *
 * The word "new" is shared but means different things:
 *   - matchStatus.new = this source WILL be written to sources/
 *   - rowOutcome.new_row = this row contributed to a new source (may still need review)
 *
 * A row that creates a conflict source gets:
 *   - matchStatus = 'new'
 *   - requiresManualReview = true
 *   - reviewTags = ['manualreview', 'name_conflict', ...]
 *   - rowOutcome = 'new_row_needs_review'
 *
 * A row that matches an existing source gets:
 *   - matchStatus = 'matched_existing'
 *   - rowOutcome = 'matched_existing_row'
 *
 * A row that is a duplicate within the import batch gets:
 *   - matchStatus = 'duplicate_in_import' (source-level)
 *   - rowOutcome = 'duplicate_row_in_batch'
 *
 * A row from an already-imported file gets:
 *   - never reaches the import pipeline
 *   - rowOutcome = 'skipped_already_imported_file'
 *
 * An invalid row (bad URL, missing columns) gets:
 *   - never reaches the import pipeline
 *   - rowOutcome = 'invalid_row'
 */
export interface RawRowProvenance {
  importBatchId: string;
  sourceFile: string;
  sourceFileHash: string;
  sourceRowNumber: number;   // 1-indexed line in the raw file
  rawLineHash: string;        // sha256 of the original line text (hex)
  rawName: string;            // name field from the raw row
  rawUrl: string;             // url field from the raw row

  /** What happened to this specific row during import — ROW-LEVEL traceability. */
  rowOutcome:
    | 'new_row'                    // row created or contributed to a NEW source (matchStatus='new')
    | 'new_row_needs_review'       // row created new source AND it is flagged for manual review
    | 'matched_existing_row'       // row matched existing source (matchStatus='matched_existing')
    | 'duplicate_row_in_batch'     // row was duplicate within import batch
    | 'skipped_already_imported_file' // file was already imported, all rows skipped
    | 'invalid_row';               // row was invalid, never reached import pipeline
}

// ─── URL Normalization ────────────────────────────────────────────────────

/**
 * Normalize to site-level identity key.
 * Used for deduplication and matching against existing sources.
 * Rules:
 * 1. Strip protocol
 * 2. Strip www.
 * 3. Lowercase
 * 4. Keep ONLY hostname — strip entire path
 *
 * Examples:
 *   https://www.liseberg.se/          → liseberg.se
 *   https://liseberg.se/evenemang/    → liseberg.se
 *   http://WWW.LISEBERG.SE/          → liseberg.se
 */
export function normalizeToSiteIdentityKey(rawUrl: string): string {
  let url = rawUrl.trim();

  // Strip protocol
  url = url.replace(/^https?:\/\//, '');

  // Strip www.
  url = url.replace(/^www\./, '');

  // Strip path, query, fragment — keep only hostname
  url = url.split('/')[0] ?? url;

  return url.toLowerCase();
}

/**
 * Normalize to canonical URL for display purposes.
 * Keeps the path for audit purposes.
 * Rules:
 * 1. Strip protocol
 * 2. Strip www.
 * 3. Strip trailing slash
 * 4. Ensure root path = /
 * 5. Lowercase
 *
 * Examples:
 *   https://www.liseberg.se/           → liseberg.se/
 *   https://liseberg.se/evenemang/     → liseberg.se/evenemang
 *   http://liseberg.se                 → liseberg.se/
 */
export function normalizeToCanonicalUrl(rawUrl: string): string {
  let url = rawUrl.trim();

  // Strip protocol
  url = url.replace(/^https?:\/\//, '');

  // Strip www.
  url = url.replace(/^www\./, '');

  // Strip trailing slash
  url = url.replace(/\/$/, '');

  // If no path, set to root
  if (!url.includes('/')) {
    url = url + '/';
  }

  return url.toLowerCase();
}

// ─── SourceId Generation ──────────────────────────────────────────────────

/**
 * Generate a stable sourceId from a site identity key.
 * Used only for NEW sources — matched sources keep their existing id.
 */
export function generateSourceId(siteIdentityKey: string): string {
  let host = siteIdentityKey;

  // Strip country TLDs common in Scandinavia
  host = host.replace(/\.se$/, '');
  host = host.replace(/\.no$/, '');
  host = host.replace(/\.dk$/, '');
  host = host.replace(/\.fi$/, '');
  host = host.replace(/\.nu$/, '');

  // Replace Swedish chars
  host = host.replace(/[åä]/g, 'a');
  host = host.replace(/ö/g, 'o');
  host = host.replace(/[éèê]/g, 'e');
  host = host.replace(/[áàâ]/g, 'a');

  // Replace separators
  host = host.replace(/[_-]+/g, '-');

  // Strip leading/trailing dashes
  host = host.replace(/^-+/, '');
  host = host.replace(/-+$/, '');

  // Max 40 chars
  if (host.length > 40) {
    host = host.substring(0, 40);
  }

  return host || 'unknown';
}

// ─── Markdown Table Parser ─────────────────────────────────────────────────

export function parseMarkdownTable(content: string): {
  validRows: RawSourceRow[];
  invalidRows: Array<{ lineNumber: number; lineText: string; reason: string }>;
} {
  const lines = content.split('\n');
  const validRows: RawSourceRow[] = [];
  const invalidRows: Array<{ lineNumber: number; lineText: string; reason: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    if (/^\s*\|[\s|-]*\|\s*$/.test(line)) continue;
    if (!line.trim().startsWith('|')) continue;

    const cells = line.split('|')
      .map(c => c.trim())
      .filter(c => c.length > 0);

    if (cells.length < 6) {
      invalidRows.push({ lineNumber, lineText: line, reason: 'fewer than 6 columns' });
      continue;
    }

    const [name, url, city, type, discoveredAt, ...noteParts] = cells;
    const note = noteParts.join(' | ');

    if (!url) {
      invalidRows.push({ lineNumber, lineText: line, reason: 'missing URL' });
      continue;
    }

    if (!isValidUrl(url)) {
      invalidRows.push({ lineNumber, lineText: line, reason: `invalid URL: ${url}` });
      continue;
    }

    validRows.push({
      name: name.trim(),
      url: url.trim(),
      city: city.trim(),
      type: type.trim(),
      discoveredAt: discoveredAt.trim(),
      note: note.trim(),
    });
  }

  return { validRows, invalidRows };
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── Read Existing Canonical Sources ─────────────────────────────────────

/**
 * Read all existing sources from sources/*.jsonl and build an index
 * keyed by SITE-LEVEL identity (hostname only).
 *
 * This means existing sources with URL like https://liseberg.se/ and
 * https://liseberg.se/evenemang/ both map to the same key "liseberg.se"
 * and the first one wins (stable ordering).
 */
export function readExistingSources(sourcesDir: string): Map<string, ExistingSource> {
  const index = new Map<string, ExistingSource>();

  if (!fs.existsSync(sourcesDir)) {
    console.warn(`  WARNING: sources dir not found: ${sourcesDir}`);
    return index;
  }

  // Sort for DETERMINISTIC ordering — critical for idempotence
  const files = fs.readdirSync(sourcesDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort();

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(sourcesDir, file), 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      if (lines.length === 0) continue;

      const source = JSON.parse(lines[0]) as ExistingSource;
      if (!source.id || !source.url) continue;

      const siteKey = normalizeToSiteIdentityKey(source.url);
      // First source per site wins — later ones with same site are skipped
      if (!index.has(siteKey)) {
        index.set(siteKey, source);
      }
    } catch {
      // Skip malformed files
    }
  }

  return index;
}

// ─── Conflict Variant Helper ─────────────────────────────────────────────────

/**
 * Find the next available conflict-variant number for a given base sourceId.
 *
 * Scans both:
 *  1. Existing files already in sources/ (persistent across batches)
 *  2. Reserved IDs already assigned in the current batch
 *
 * This ensures conflict variants are unique and monotonically increasing
 * across multiple import batches — batch 1 gets -conflict-1, batch 2 gets
 * -conflict-2, batch 3 gets -conflict-3, etc.
 *
 * @param baseSourceId     The base id e.g. "abf"
 * @param sourcesDir       Path to sources/ directory
 * @param reservedInBatch  Set of sourceIds already reserved in current batch
 * @returns                The next available variant number (e.g. 1, 2, 3…)
 */
export function findNextConflictVariant(
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

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Manualreview Detection ─────────────────────────────────────────────────

/**
 * Generate temporary ID/display-name for manualreview sources.
 * Conservative: when in doubt, mark as manualreview.
 */
export function generateTemporaryId(siteIdentityKey: string, name: string, variantIndex = 0): {
  temporarySourceId: string;
  temporaryDisplayName: string;
  temporaryCategory: 'manualreview';
} {
  const prefix = `manualreview-${siteIdentityKey.replace(/\./g, '-')}`;
  const suffix = variantIndex > 0 ? `-site${variantIndex + 1}` : '';
  return {
    temporarySourceId: `${prefix}${suffix}`,
    temporaryDisplayName: name,
    temporaryCategory: 'manualreview',
  };
}

// ─── Append-Only Guardrail ───────────────────────────────────────────────────

/**
 * HARD SAFETY RULE: 00A is APPEND-ONLY.
 *
 * importpreview.jsonl is NEVER a replacement set for sources/.
 * It is ONLY a decision-support document with these permitted outcomes:
 *   - new                    (add to sources/)
 *   - matched_existing        (keep existing, no change)
 *   - duplicate_in_import     (ignore extra rows)
 *   - invalid_raw_row         (discard, never reaches preview)
 *   - skipped_already_imported_file (discard, never reaches preview)
 *
 * NOTE: 'manualreview' is a REVIEW TAG, not a matchStatus value.
 * Sources that need review have matchStatus='new' with requiresManualReview=true.
 *
 * If ANY source in the preview has a matchStatus not in the above list,
 * OR if the preview would represent a complete replacement of sources/,
 * the tool MUST abort with a clear error.
 *
 * This guard exists to prevent a small or incomplete raw import from
 * ever accidentally replacing the entire sources/ library.
 */
const PREVIEW_APPEND_ONLY_VALID_STATUSES: Array<ImportedSource['matchStatus']> = [
  'new',
  'matched_existing',
  'duplicate_in_import',
];

/**
 * Abort if preview contains any status that suggests replacement logic.
 * This tool is preview-only — it never writes to sources/ directly.
 * But any downstream consumer must understand preview is append-only.
 */
export function validatePreviewAppendOnly(previewPath: string): void {
  if (!fs.existsSync(previewPath)) return;

  const content = fs.readFileSync(previewPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      const source = JSON.parse(line) as ImportedSource;
      if (!PREVIEW_APPEND_ONLY_VALID_STATUSES.includes(source.matchStatus)) {
        console.error(`\n[SECURITY ABORT] append-only guard triggered:`);
        console.error(`  File:  ${previewPath}`);
        console.error(`  Source: ${source.sourceIdentityKey}`);
        console.error(`  Status: '${source.matchStatus}' — NOT in allowed append-only list`);
        console.error(`  Message: importpreview is NEVER a replacement set for sources/.`);
        console.error(`  This tool only generates preview. It cannot reduce or replace sources/.`);
        process.exit(1);
      }
    } catch {
      // Skip malformed lines — other checks handle those
    }
  }
}

// ─── Pre-Import Backup ───────────────────────────────────────────────────────

const BACKUP_DIR = '00-Sources/tmp/old-sources-after-00A-imports';

/**
 * Take a timestamped tar.gz backup of sources/ BEFORE any import logic runs.
 * This protects against:
 *   - Tool bugs that could corrupt sources/
 *   - Raw files being cleared after import
 *   - Mistakes in downstream merge logic
 *
 * Backup location: 00-Sources/tmp/old-sources-after-00A-imports/Old-sources-YYYYMMDD-HHmmss.tar.gz
 *
 * If backup fails → ABORT the import entirely.
 * If sources/ does not exist → skip backup (not an error).
 */
export function takeSourcesBackup(): {
  backupPath: string;
  sourceFileCount: number;
  success: boolean;
  error?: string;
} {
  const sourcesDir = path.join(process.cwd(), 'sources');

  // Skip if sources/ doesn't exist
  if (!fs.existsSync(sourcesDir)) {
    console.log('[BACKUP] sources/ not found — skipping backup');
    return { backupPath: '', sourceFileCount: 0, success: true };
  }

  // Count files
  const files = fs.readdirSync(sourcesDir).filter(f => f.endsWith('.jsonl'));
  const sourceFileCount = files.length;

  // Create backup directory
  const backupDir = path.join(process.cwd(), BACKUP_DIR);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Timestamp without colons (ISO 8601 compatible)
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const backupName = `Old-sources-${ts}.tar.gz`;
  const backupPath = path.join(backupDir, backupName);

  // Use tar + gzip via execSync — synchronous and reliable
  // cwd is project root, so relative path to sources/ is ./sources/
  try {
    child_process.execSync(`tar -czf "${backupPath}" sources/`, { stdio: 'pipe' });
    const stat = fs.statSync(backupPath);
    console.log(`[BACKUP] SUCCESS`);
    console.log(`  Path:            ${backupPath}`);
    console.log(`  Sources files:   ${sourceFileCount}`);
    console.log(`  Archive size:    ${(stat.size / 1024).toFixed(1)} KB`);
    return { backupPath, sourceFileCount, success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[BACKUP] FAILED`);
    console.error(`  Error: ${errorMsg}`);
    return { backupPath, sourceFileCount, success: false, error: errorMsg };
  }
}

// ─── Write New Sources to sources/ ─────────────────────────────────────────────

/**
 * HARD SAFETY RULE: Only 'new' sources from preview may be written to sources/.
 * 'manualreview' is a REVIEW FLAG/TAG, not a blocking matchStatus.
 * Sources with requiresManualReview=true are still valid, writable sources.
 *
 * All other matchStatus are strictly IGNORED for write:
 *   - matched_existing    → no write (keep existing)
 *   - duplicate_in_import → no write (discarded)
 *   - invalid_raw_row     → no write (was never in preview)
 *   - skipped_already_imported_file → no write (was never in preview)
 *
 * Write plan (dry-run) is always shown before any write.
 * If any file conflict is detected → ABORT.
 *
 * Backup is taken before write begins.
 * Write is atomic: all-or-nothing via temp dir + rename.
 */
export interface WritePlan {
  newSources: ImportedSource[];
  filesToWrite: string[];          // full paths
  fileConflicts: string[];         // files that already exist
  writeSafe: boolean;
}

export interface WriteResult {
  success: boolean;
  writtenCount: number;
  backupPath: string;
  newFiles: string[];
  errors: string[];
}

/**
 * Build a write plan from a preview file.
 * Returns plan WITHOUT performing any write.
 * Only 'new' sources are eligible for write.
 */
export function buildWritePlan(previewPath: string, sourcesDir: string): WritePlan {
  const previewContent = fs.readFileSync(previewPath, 'utf-8');
  const lines = previewContent.split('\n').filter(l => l.trim());

  const newSources: ImportedSource[] = [];
  const ignoredByStatus: Record<string, number> = {};
  const fileConflicts: string[] = [];

  for (const line of lines) {
    try {
      const source = JSON.parse(line) as ImportedSource;
      if (source.matchStatus === 'new') {
        newSources.push(source);
      } else {
        ignoredByStatus[source.matchStatus] = (ignoredByStatus[source.matchStatus] ?? 0) + 1;
      }
    } catch {
      // Skip malformed
    }
  }

  // Check for file conflicts — if a target .jsonl file already exists, that's a conflict
  for (const src of newSources) {
    const targetPath = path.join(sourcesDir, `${src.sourceId}.jsonl`);
    if (fs.existsSync(targetPath)) {
      fileConflicts.push(targetPath);
    }
  }

  // Write is safe only if no conflicts and at least one new source
  const writeSafe = newSources.length > 0 && fileConflicts.length === 0;

  return { newSources, filesToWrite: newSources.map(s => path.join(sourcesDir, `${s.sourceId}.jsonl`)), fileConflicts, writeSafe };
}

/**
 * Write only 'new' sources from preview to sources/ — APPEND-ONLY.
 *
 * Safety guarantees:
 * 1. Only matchStatus='new' is ever written
 * 2. Backup taken before write
 * 3. Atomic: write to temp dir, then rename all at once
 * 4. If any step fails → full rollback, exit with error
 * 5. If any file already exists → ABORT (no overwrite)
 *
 * Returns WriteResult with details.
 */
export function writeNewSourcesToSources(previewPath: string, sourcesDir: string): WriteResult {
  const errors: string[] = [];

  // ── Step 1: Build write plan ──────────────────────────────────────────────
  console.log('[WRITE] Building write plan...');
  const plan = buildWritePlan(previewPath, sourcesDir);

  // Count ignored statuses by reading preview again
  const previewContent = fs.readFileSync(previewPath, 'utf-8');
  const previewLines = previewContent.split('\n').filter(l => l.trim());
  const ignoredByStatus: Record<string, number> = {};
  for (const line of previewLines) {
    try {
      const source = JSON.parse(line) as ImportedSource;
      if (source.matchStatus !== 'new') {
        ignoredByStatus[source.matchStatus] = (ignoredByStatus[source.matchStatus] ?? 0) + 1;
      }
    } catch { /* skip */ }
  }

  if (plan.newSources.length === 0) {
    console.log('[WRITE] No new sources to write — preview contains only matched/duplicate/manualreview.');
    console.log('[WRITE] Nothing written to sources/.');
    return { success: true, writtenCount: 0, backupPath: '', newFiles: [], errors: [] };
  }

  console.log(`[WRITE] Write plan:`);
  const flaggedNew = plan.newSources.filter(s => s.requiresManualReview).length;
  const cleanNew = plan.newSources.length - flaggedNew;
  console.log(`  Total new sources to write: ${plan.newSources.length}`);
  if (cleanNew > 0) console.log(`    clean new (no flags):         ${cleanNew}`);
  if (flaggedNew > 0) console.log(`    flagged (needs review):       ${flaggedNew} — will be written with requiresManualReview=true`);
  for (const [status, count] of Object.entries(ignoredByStatus)) {
    console.log(`  ${status}: ${count} — IGNORED (no write)`);
  }
  console.log(`  Files to create: ${plan.filesToWrite.length}`);

  // ── Step 2: Check for file conflicts ─────────────────────────────────────
  if (plan.fileConflicts.length > 0) {
    console.error('[WRITE] SECURITY ABORT: file conflicts detected.');
    console.error(`  These files already exist in sources/ and would be overwritten:`);
    for (const f of plan.fileConflicts) {
      console.error(`    ${f}`);
    }
    console.error('  Write operation aborted. No files were modified.');
    return {
      success: false,
      writtenCount: 0,
      backupPath: '',
      newFiles: [],
      errors: [`${plan.fileConflicts.length} file conflicts — aborting`],
    };
  }

  // ── Step 3: Backup ───────────────────────────────────────────────────────
  console.log('\n[WRITE] Taking backup before write...');
  const backupResult = takeSourcesBackup();
  if (!backupResult.success) {
    console.error('[WRITE] FATAL: Could not backup sources/. Aborting write.');
    return {
      success: false,
      writtenCount: 0,
      backupPath: '',
      newFiles: [],
      errors: ['Backup failed'],
    };
  }
  console.log('[WRITE] Backup ready.\n');

  // ── Step 4: Atomic write via temp dir ────────────────────────────────────
  // Write to a temp directory first, then rename (atomic on POSIX)
  const tempDir = path.join(process.cwd(), '00-Sources', 'tmp', `write-staging-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const newFiles: string[] = [];
  try {
    for (const source of plan.newSources) {
      const targetPath = path.join(sourcesDir, `${source.sourceId}.jsonl`);
      const tempPath = path.join(tempDir, `${source.sourceId}.jsonl`);

      // Build canonical source record
      const canonicalRecord = {
        id: source.sourceId,
        url: source.canonicalUrl,
        name: source.name,
        type: source.type,
        city: source.city,
        discoveredAt: source.discoveredAt,
        discoveredBy: '00A-import',
        preferredPath: null,
        preferredPathReason: `Initial import from preview: ${path.basename(previewPath)}`,
        systemVersionAtDecision: null,
        verifiedAt: null,
        needsRecheck: true,
        lastSystemVersion: null,
        // Review flag — if set, this source needs human review during ingestion
        // but is still a fully valid source that can proceed through normal ingestion
        requiresManualReview: source.requiresManualReview ?? false,
        reviewTags: source.reviewTags ?? [],
        metadata: {
          rawSourceFile: 'import-preview',
          rawCity: source.city,
          rawCategory: source.type,
          rawNotice: source.note,
          importBatchId: source.provenanceRows[0]?.importBatchId ?? null,
          sourceIdentityKey: source.sourceIdentityKey,
          canonicalUrl: source.canonicalUrl,
          manualReviewReasons: source.manualReviewReasons ?? [],
          existingSourceId: source.existingSource?.id ?? null,
        },
      };

      fs.writeFileSync(tempPath, JSON.stringify(canonicalRecord) + '\n', 'utf-8');
      newFiles.push(targetPath);
    }

    // Move all files from temp to actual location (atomic rename per file)
    for (const source of plan.newSources) {
      const tempPath = path.join(tempDir, `${source.sourceId}.jsonl`);
      const targetPath = path.join(sourcesDir, `${source.sourceId}.jsonl`);
      fs.renameSync(tempPath, targetPath);
    }

    // Clean up temp dir
    fs.rmSync(tempDir, { recursive: true });

    console.log(`[WRITE] SUCCESS — ${newFiles.length} new sources written to sources/`);
    for (const f of newFiles) {
      console.log(`  + ${path.basename(f)}`);
    }

    return {
      success: true,
      writtenCount: newFiles.length,
      backupPath: backupResult.backupPath,
      newFiles,
      errors: [],
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[WRITE] FATAL ERROR during write: ${errorMsg}`);
    console.error('[WRITE] Rolling back: removing any partially-written files...');

    // Remove any files that were written
    for (const f of newFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
    }

    // Clean up temp dir
    try { fs.rmSync(tempDir, { recursive: true }); } catch { /* ignore */ }

    console.error('[WRITE] Rollback complete. No files were left in inconsistent state.');
    console.error('[WRITE] Restore from backup if needed:');
    console.error(`  ${backupResult.backupPath}`);

    return {
      success: false,
      writtenCount: 0,
      backupPath: backupResult.backupPath,
      newFiles: [],
      errors: [errorMsg],
    };
  }
}

// ─── File Hashing ────────────────────────────────────────────────────────────

/**
 * Compute SHA256 hash of a file's content.
 * Used for idempotency — same content = same hash = skip re-import.
 */
export function computeFileHash(filePath: string): { hash: string; size: number } {
  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return { hash, size: content.byteLength };
}

// ─── Manifest Management ──────────────────────────────────────────────────

const MANIFEST_PATH = 'runtime/raw-import-manifest.jsonl';

/**
 * Read existing manifest entries from manifest file.
 * Returns a map: fileHash → ManifestEntry (most recent per hash).
 */
export function readManifest(): Map<string, ManifestEntry> {
  const index = new Map<string, ManifestEntry>();
  if (!fs.existsSync(MANIFEST_PATH)) return index;

  const content = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as ManifestEntry;
      // Most recent entry per hash wins
      if (!index.has(entry.fileHash)) {
        index.set(entry.fileHash, entry);
      }
    } catch {
      // Skip malformed lines
    }
  }
  return index;
}

/**
 * Append one manifest entry to the manifest file.
 */
export function writeManifestEntry(entry: ManifestEntry): void {
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(MANIFEST_PATH, line, 'utf-8');
}

/**
 * Check if a file has already been imported by hash.
 * Returns the manifest entry if found, null otherwise.
 */
export function isFileAlreadyImported(
  fileHash: string,
  manifest: Map<string, ManifestEntry>
): ManifestEntry | null {
  return manifest.get(fileHash) ?? null;
}

// ─── Raw Source File Discovery ────────────────────────────────────────────

/**
 * Find all .md source files in a directory, sorted for deterministic order.
 */
export function findRawSourceFiles(rawDir: string): string[] {
  if (!fs.existsSync(rawDir)) return [];
  return fs.readdirSync(rawDir)
    .filter(f => f.endsWith('.md'))
    .filter(f => f.startsWith('RawSources'))
    .sort();
}

// ─── Row-Level Provenance ──────────────────────────────────────────────────

/**
 * Compute SHA256 hash of a raw row text.
 */
export function computeRowHash(name: string, url: string, city: string): string {
  const text = `${name}|${url}|${city}`;
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Generate a unique import batch ID.
 */
export function generateBatchId(): string {
  return `batch-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

// ─── Import Logic with Existing Source Matching ────────────────────────────

export interface ImportResult {
  sources: ImportedSource[];
  stats: {
    totalRows: number;
    new: number;
    matchedExisting: number;
    duplicateInImportRows: number;  // how many RAW rows were duplicates
    manualreview: number;           // sources flagged for manual review
    outputSources: number;           // how many unique sources in output
    existingSourcesLoaded: number;
  };
}

/**
 * Import raw sources with site-level deduplication and matching.
 *
 * KEY CHANGE: sourceIdentityKey is site-level (hostname only).
 * This means:
 *   https://www.liseberg.se/
 *   https://liseberg.se/evenemang/
 *   https://www.LISEBERG.Se/
 * all map to the same sourceIdentityKey = "liseberg.se"
 *
 * Priority order for matchStatus:
 * - If siteIdentityKey matches an existing source → matched_existing
 * - If siteIdentityKey already seen in this import batch → duplicate_in_import
 * - Otherwise → new
 */
export function importRawSourcesWithMatching(
  rows: RawSourceRow[],
  existingSources: Map<string, ExistingSource>,
  sourcesDir: string,
  reservedInBatch: Set<string>,
): ImportResult {
  const stats = {
    totalRows: rows.length,
    new: 0,
    matchedExisting: 0,
    duplicateInImportRows: 0,
    manualreview: 0,
    outputSources: 0,
    existingSourcesLoaded: existingSources.size,
  };

  // Track seen siteIdentityKeys in this import batch
  const batchSeen = new Set<string>();

  // Track for building final output
  const outputMap = new Map<string, ImportedSource>();

  for (const row of rows) {
    const siteIdentityKey = normalizeToSiteIdentityKey(row.url);
    const canonicalUrl = normalizeToCanonicalUrl(row.url);

    // Check 1: Does this match an existing canonical source?
    if (existingSources.has(siteIdentityKey)) {
      const existing = existingSources.get(siteIdentityKey)!;

      if (outputMap.has(siteIdentityKey)) {
        // Already added as primary — just record this row
        const primary = outputMap.get(siteIdentityKey)!;
        primary.originalRows.push({ name: row.name, url: row.url });

        // Conservative: if names or cities differ from existing, add review flag
        if (primary.name !== row.name || primary.city !== row.city) {
          if (!primary.requiresManualReview) {
            const existingName = primary.name;
            const existingCity = primary.city;
            const reasons: string[] = [];
            if (primary.name !== row.name) reasons.push(`name='${existingName}' vs import row name='${row.name}'`);
            if (primary.city !== row.city) reasons.push(`city='${existingCity}' vs import row city='${row.city}'`);
            primary.requiresManualReview = true;
            primary.reviewTags = ['manualreview', 'name_conflict', 'city_conflict'];
            primary.manualReviewReasons = reasons;
            stats.manualreview++;
          }
        } else {
          primary.isDuplicate = true;
          stats.duplicateInImportRows++;
        }
      } else {
        // First occurrence — create as matched_existing
        // BUT: if name/city conflicts with existing source, flag as manualreview
        const nameConflict = existing.name && existing.name !== row.name;
        const cityConflict = existing.city && existing.city !== row.city;

        if (nameConflict || cityConflict) {
          // NEW + review flag: hostname matched but name/city differs — create as new source
          // with review flag and a conflictVariant to ensure unique sourceId.
          // The sourceId is derived from hostname + conflictVariant so it can NEVER
          // collide with the existing source's file.
          const tags: Array<'manualreview' | 'name_conflict' | 'city_conflict'> = ['manualreview'];
          if (nameConflict) tags.push('name_conflict');
          if (cityConflict) tags.push('city_conflict');
          const reasons: string[] = [];
          if (nameConflict) reasons.push(`name='${existing.name}' vs import name='${row.name}'`);
          if (cityConflict) reasons.push(`city='${existing.city}' vs import city='${row.city}'`);

          // Generate a conflict-variant sourceId: hostname + '-conflict-' + next available variant
          // findNextConflictVariant scans both existing files in sources/ (persistent)
          // AND reserved IDs in this batch, so variants are unique across all batches.
          const baseId = generateSourceId(siteIdentityKey);
          const nextVariant = findNextConflictVariant(baseId, sourcesDir, reservedInBatch);
          const conflictId = `${baseId}-conflict-${nextVariant}`;
          reservedInBatch.add(conflictId);

          outputMap.set(siteIdentityKey, {
            sourceId: conflictId,
            sourceIdentityKey: siteIdentityKey,
            canonicalUrl,
            name: row.name,
            city: row.city,
            type: row.type,
            discoveredAt: row.discoveredAt,
            note: row.note,
            isDuplicate: false,
            originalRows: [{ name: row.name, url: row.url }],
            matchStatus: 'new',
            requiresManualReview: true,
            reviewTags: tags,
            conflictVariant: nextVariant,
            manualReviewReasons: reasons,
            existingSource: {
              id: existing.id,
              name: existing.name,
              preferredPath: existing.preferredPath ?? null,
            },
            provenanceRows: [],
          });
          stats.manualreview++;
        } else {
          outputMap.set(siteIdentityKey, {
            sourceId: existing.id,
            sourceIdentityKey: siteIdentityKey,
            canonicalUrl,
            name: row.name,
            city: row.city,
            type: row.type,
            discoveredAt: row.discoveredAt,
            note: row.note,
            isDuplicate: false,
            originalRows: [{ name: row.name, url: row.url }],
            matchStatus: 'matched_existing',
            matchedBy: 'sourceIdentityKey',
            existingSource: {
              id: existing.id,
              name: existing.name,
              preferredPath: existing.preferredPath ?? null,
            },
            provenanceRows: [],
          });
          stats.matchedExisting++;
        }
      }
      batchSeen.add(siteIdentityKey);
      continue;
    }

    // Check 2: Has this siteIdentityKey already appeared in this import batch?
    if (batchSeen.has(siteIdentityKey)) {
      // Duplicate within import batch
      const primary = outputMap.get(siteIdentityKey)!;
      primary.originalRows.push({ name: row.name, url: row.url });

      // Conservative: if names or cities differ, add review flag to the existing new source
      if (primary.name !== row.name || primary.city !== row.city) {
        if (!primary.requiresManualReview) {
          const existingNames = [primary.name];
          const existingCities = [primary.city];
          const reasons: string[] = [`Conflicting rows within import batch: names=[${existingNames.join('|')}|${row.name}], cities=[${existingCities.join('|')}|${row.city}]`];
          primary.requiresManualReview = true;
          primary.reviewTags = ['manualreview', 'name_conflict', 'city_conflict'];
          primary.manualReviewReasons = reasons;
          stats.manualreview++;
        }
      } else {
        primary.isDuplicate = true;
        stats.duplicateInImportRows++;
      }
      continue;
    }

    // New source
    batchSeen.add(siteIdentityKey);
    outputMap.set(siteIdentityKey, {
      sourceId: generateSourceId(siteIdentityKey),
      sourceIdentityKey: siteIdentityKey,
      canonicalUrl,
      name: row.name,
      city: row.city,
      type: row.type,
      discoveredAt: row.discoveredAt,
      note: row.note,
      isDuplicate: false,
      originalRows: [{ name: row.name, url: row.url }],
      matchStatus: 'new',
      provenanceRows: [],
    });
    stats.new++;
  }

  const sources = Array.from(outputMap.values());
  stats.outputSources = sources.length;

  return { sources, stats };
}

// ─── Multi-File Import Orchestrator ────────────────────────────────────────

export interface FileImportResult {
  fileName: string;
  fileHash: string;
  fileSize: number;
  status: 'imported' | 'skipped_already_imported' | 'error';
  rowsParsed: number;
  invalidRows: number;
  outputSources: number;
  errorMessage?: string;
}

/**
 * Run the full multi-file import pipeline.
 * - Discovers raw source files
 * - Checks manifest for already-imported files (by hash)
 * - Imports only new files
 * - Produces combined preview output
 * - Updates manifest
 *
 * Single-file mode: --input <file>
 * Multi-file mode:   --all (discovers RawSources dir automatically)
 */
export function runMultiFileImport(
  inputArg: string | null,  // null means "discover all"
  output: string,
  sourcesDir: string,
  rawSourcesDir: string,
): {
  results: FileImportResult[];
  totalSources: number;
  totalRowsSeen: number;
  totalInvalidRows: number;
  totalSkippedFiles: number;
} {
  const batchId = generateBatchId();
  const manifest = readManifest();

  // Discover files
  const files = inputArg
    ? [inputArg]
    : findRawSourceFiles(rawSourcesDir);

  if (files.length === 0) {
    console.log('No raw source files found.');
    return { results: [], totalSources: 0, totalRowsSeen: 0, totalInvalidRows: 0, totalSkippedFiles: 0 };
  }

  // Always read existing sources once
  const existingSources = readExistingSources(sourcesDir);
  console.log(`Loaded ${existingSources.size} existing canonical sources\n`);

  const results: FileImportResult[] = [];
  const allSources: ImportedSource[] = [];
  let totalRowsSeen = 0;
  let totalInvalidRows = 0;
  let totalSkippedFiles = 0;

  // Reserved conflict-variant IDs — shared across all files in this multi-file batch
  // This ensures unique variant numbers within the batch too
  const reservedInBatch = new Set<string>();

  for (const file of files) {
    const filePath = path.join(rawSourcesDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  SKIP (not found): ${file}`);
      totalSkippedFiles++;
      continue;
    }

    const { hash: fileHash, size: fileSize } = computeFileHash(filePath);

    // Check idempotency
    const alreadyImported = isFileAlreadyImported(fileHash, manifest);
    if (alreadyImported) {
      console.log(`  SKIP (already imported): ${file}`);
      console.log(`    Previously imported: ${alreadyImported.importedAt}`);
      results.push({
        fileName: file,
        fileHash,
        fileSize,
        status: 'skipped_already_imported',
        rowsParsed: 0,
        invalidRows: 0,
        outputSources: 0,
      });
      totalSkippedFiles++;
      continue;
    }

    // Import this file
    console.log(`  IMPORT: ${file}`);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { validRows, invalidRows } = parseMarkdownTable(content);
    totalRowsSeen += validRows.length;
    totalInvalidRows += invalidRows.length;

    const { sources, stats } = importRawSourcesWithMatching(validRows, existingSources, sourcesDir, reservedInBatch);
    allSources.push(...sources);

    results.push({
      fileName: file,
      fileHash,
      fileSize,
      status: 'imported',
      rowsParsed: validRows.length,
      invalidRows: invalidRows.length,
      outputSources: sources.length,
    });

    // Write manifest entry
    const manifestEntry: ManifestEntry = {
      importBatchId: batchId,
      importedAt: new Date().toISOString(),
      fileName: file,
      filePath,
      fileSize,
      fileHash,
      rowCount: validRows.length,
      importStatus: 'imported',
    };
    writeManifestEntry(manifestEntry);
  }

  // Write combined output
  const lines = allSources.map(s => JSON.stringify(s)).join('\n') + '\n';
  fs.writeFileSync(output, lines, 'utf-8');
  console.log(`\nWritten: ${output}`);
  console.log(`  ${allSources.length} total sources from ${results.filter(r => r.status === 'imported').length} files`);

  // ── Append-only guardrail ───────────────────────────────────────────────
  // importpreview is NEVER a replacement set for sources/. Validate after write.
  validatePreviewAppendOnly(output);
  console.log('[00A] Append-only guard: PASSED ✓');

  return {
    results,
    totalSources: allSources.length,
    totalRowsSeen,
    totalInvalidRows,
    totalSkippedFiles,
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────

interface CliArgs {
  input: string;
  output: string;
  sourcesDir?: string;
  applyNew: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let input: string | undefined;
  let output: string | undefined;
  let sourcesDir: string | undefined;
  let applyNew = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && i + 1 < args.length) {
      input = args[++i];
    } else if (args[i] === '--output' && i + 1 < args.length) {
      output = args[++i];
    } else if (args[i] === '--sources-dir' && i + 1 < args.length) {
      sourcesDir = args[++i];
    } else if (args[i] === '--apply-new') {
      applyNew = true;
    }
  }

  if (!input || !output) {
    console.error('Usage: npx tsx import-raw-sources.ts --input <file> --output <file> [--sources-dir <dir>] [--apply-new]');
    console.error('  --apply-new: write new sources from preview to sources/ (append-only, only "new" status)');
    console.error('Example: npx tsx import-raw-sources.ts --input 01-Sources/RawSources/RawSources20260404.md --output runtime/import-preview.jsonl');
    console.error('Example with write: npx tsx import-raw-sources.ts --input 01-Sources/RawSources/RawSources20260404.md --output runtime/import-preview.jsonl --apply-new');
    process.exit(1);
  }

  return { input, output, sourcesDir, applyNew };
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main(): void {
  console.log('=== 00A: ImportRawSources Tool (v7 — with write-step for new sources) ===\n');

  const { input, output, sourcesDir, applyNew } = parseArgs();
  const rawSourcesDir = path.join(process.cwd(), '01-Sources', 'RawSources');

  // Multi-file mode: if input looks like a directory name "RawSources" (not a file),
  // OR if --all flag is passed → discover all files
  const inputIsFile = input && fs.existsSync(input) && fs.statSync(input).isFile();
  const inputArg = inputIsFile ? input : null;

  if (!input || !output) {
    console.error('Usage: npx tsx import-raw-sources.ts --input <file> --output <file> [--sources-dir <dir>]');
    console.error('   OR: npx tsx import-raw-sources.ts --all --output <file> [--sources-dir <dir>]');
    console.error('Example (single file): npx tsx import-raw-sources.ts --input 01-Sources/RawSources/RawSources20260404.md --output runtime/import-preview.jsonl');
    console.error('Example (all files):    npx tsx import-raw-sources.ts --all --output runtime/import-preview.jsonl');
    process.exit(1);
  }

  if (inputArg) {
    // Single file mode — original behavior + manifest
    const canonicalSourcesDir = sourcesDir ?? path.join(process.cwd(), 'sources');

    // ── STEP 0: Pre-import backup of sources/ ─────────────────────────────
    console.log('[00A] Step 0: Pre-import backup of sources/\n');
    const backupResult = takeSourcesBackup();
    if (!backupResult.success) {
      console.error('FATAL: Could not backup sources/. Aborting import.');
      process.exit(1);
    }
    console.log();

    const filePath = inputArg;
    const { hash: fileHash, size: fileSize } = computeFileHash(filePath);
    const manifest = readManifest();
    const alreadyImported = isFileAlreadyImported(fileHash, manifest);

    console.log(`Input:         ${inputArg}`);
    console.log(`Output:        ${output}`);
    console.log(`Sources dir:   ${canonicalSourcesDir}`);
    console.log(`File hash:     ${fileHash}`);
    if (alreadyImported) {
      console.log(`  ALREADY IMPORTED: ${alreadyImported.importedAt}`);
      console.log(`  Skipping. Use a different file or clear the manifest.`);
      process.exit(0);
    }
    console.log();

    const existingSources = readExistingSources(canonicalSourcesDir);
    console.log(`Loaded ${existingSources.size} existing canonical sources\n`);

    const content = fs.readFileSync(filePath, 'utf-8');
    const { validRows, invalidRows } = parseMarkdownTable(content);
    console.log(`Parsed: ${validRows.length} valid rows, ${invalidRows.length} invalid rows\n`);

    const { sources, stats } = importRawSourcesWithMatching(validRows, existingSources, canonicalSourcesDir, new Set<string>());

    console.log('=== Import Summary ===');
    console.log(`  Raw rows parsed:              ${stats.totalRows}`);
    console.log(`  Existing sources loaded:      ${stats.existingSourcesLoaded}`);
    console.log(`  NEW sources:                 ${stats.new}`);
    console.log(`  MATCHED existing:           ${stats.matchedExisting}`);
    console.log(`  DUPLICATE rows in import:    ${stats.duplicateInImportRows}`);
    console.log(`  MANUALREVIEW:              ${stats.manualreview}`);
    console.log(`  Total output sources:        ${stats.outputSources}`);
    console.log();

    // Show sources...
    const newSources = sources.filter(s => s.matchStatus === 'new');
    if (newSources.length > 0) {
      console.log(`=== NEW sources (${newSources.length}) ===`);
      for (const s of newSources) {
        console.log(`  ${s.sourceId}: ${s.name} | ${s.sourceIdentityKey}`);
      }
      console.log();
    }

    const matched = sources.filter(s => s.matchStatus === 'matched_existing');
    if (matched.length > 0) {
      console.log(`=== MATCHED existing sources (${matched.length}) ===`);
      for (const s of matched) {
        console.log(`  ${s.existingSource!.id}: "${s.existingSource!.name}"`);
        console.log(`    preferredPath=${s.existingSource!.preferredPath ?? 'null'}`);
      }
      console.log();
    }

    const mergedSources = sources.filter(s => s.isDuplicate);
    if (mergedSources.length > 0) {
      console.log(`=== SOURCES WITH INTERNAL DUPLICATES (${mergedSources.length}) ===`);
      for (const s of mergedSources) {
        console.log(`  ${s.sourceId}: ${s.name}`);
        console.log(`    rows merged: ${s.originalRows.length}`);
      }
      console.log();
    }

    const manualreviewFlagged = sources.filter(s => s.requiresManualReview === true);
    if (manualreviewFlagged.length > 0) {
      console.log(`=== SOURCES WITH MANUALREVIEW FLAG (${manualreviewFlagged.length}) — will be written to sources/ but need review during ingestion ===`);
      for (const s of manualreviewFlagged) {
        console.log(`  ${s.sourceId}: ${s.name} | ${s.sourceIdentityKey}`);
        if (s.manualReviewReasons) {
          for (const r of s.manualReviewReasons) {
            console.log(`    reason: ${r}`);
          }
        }
        console.log(`    tags: ${(s.reviewTags ?? []).join(', ')}`);
      }
      console.log();
    }

    // Write output
    const lines = sources.map(s => JSON.stringify(s)).join('\n') + '\n';
    fs.writeFileSync(output, lines, 'utf-8');
    console.log(`Written: ${output}`);
    console.log(`  ${sources.length} sources`);

    // ── STEP FINAL: Append-only guardrail ───────────────────────────────────
    // importpreview is NEVER a replacement set for sources/. This is a
    // safety check to ensure no downstream code can misuse the preview.
    console.log();
    console.log('[00A] Append-only validation...');
    validatePreviewAppendOnly(output);
    console.log('[00A] Append-only guard: PASSED ✓');

    // ── STEP OPTIONAL: Write new sources to sources/ ───────────────────────
    if (applyNew) {
      console.log();
      console.log('[00A] Step apply-new: Writing new sources to sources/\n');
      const writeResult = writeNewSourcesToSources(output, canonicalSourcesDir);
      if (!writeResult.success) {
        console.error('FATAL: Write failed. No changes made to sources/. Restore from backup if needed:');
        console.error(`  ${writeResult.backupPath}`);
        process.exit(1);
      }
      console.log();
      console.log('[00A] apply-new complete.');
    } else {
      console.log();
      console.log('[00A] Preview-only mode. Run with --apply-new to write new sources.');
      console.log('[00A] NOTE: Run --apply-new only after reviewing the preview.');
    }

    const totalValidRows = validRows.length;
    const totalInvalidRows = invalidRows.length;
    const totalSeenRows = totalValidRows + totalInvalidRows;

    console.log();
    console.log('=== Row-Level Accounting ===');
    console.log(`  Total rows seen in file:   ${totalSeenRows}`);
    console.log(`  Valid rows processed:       ${totalValidRows}`);
    console.log(`  Invalid rows:              ${totalInvalidRows}`);
    console.log(`  Output sources:            ${sources.length}`);
    console.log();
    console.log(`  Reconciliation:`);
    console.log(`    validRows (${totalValidRows}) + invalidRows (${totalInvalidRows}) = totalSeen (${totalSeenRows})`);
    console.log(`    ${totalSeenRows === totalSeenRows ? 'YES ✓' : 'NO ✗'} — every row accounted for`);

    // Write manifest entry
    const manifestEntry: ManifestEntry = {
      importBatchId: `batch-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      importedAt: new Date().toISOString(),
      fileName: path.basename(filePath),
      filePath,
      fileSize,
      fileHash,
      rowCount: validRows.length,
      importStatus: 'imported',
    };
    writeManifestEntry(manifestEntry);
    console.log();
    console.log(`Manifest updated: ${manifestEntry.importBatchId}`);

  } else {
    // Multi-file mode
    const canonicalSourcesDir = sourcesDir ?? path.join(process.cwd(), 'sources');
    console.log(`Output:        ${output}`);
    console.log(`Sources dir:   ${canonicalSourcesDir}`);
    console.log(`RawSources:   ${rawSourcesDir}\n`);

    const { results, totalSources, totalRowsSeen, totalInvalidRows, totalSkippedFiles } =
      runMultiFileImport(inputArg, output, canonicalSourcesDir, rawSourcesDir);

    console.log();
    console.log('=== Multi-File Import Summary ===');
    console.log(`  Files found:              ${results.length + totalSkippedFiles}`);
    console.log(`  Files imported:           ${results.filter(r => r.status === 'imported').length}`);
    console.log(`  Files skipped (already):  ${results.filter(r => r.status === 'skipped_already_imported').length}`);
    console.log(`  Files error:             ${results.filter(r => r.status === 'error').length}`);
    console.log(`  Total rows seen:         ${totalRowsSeen}`);
    console.log(`  Total invalid rows:      ${totalInvalidRows}`);
    console.log(`  Total output sources:    ${totalSources}`);
    console.log();

    const allSeen = totalRowsSeen + totalInvalidRows + results.reduce((sum, r) => r.status === 'skipped_already_imported' ? sum : 0, 0);
    const accountedFor = totalRowsSeen + totalInvalidRows;
    console.log(`  Reconciliation: ${allSeen} total seen = ${accountedFor} accounted for: ${allSeen === accountedFor ? 'YES ✓' : 'NO ✗'}`);
  }
}

// Run
main();
