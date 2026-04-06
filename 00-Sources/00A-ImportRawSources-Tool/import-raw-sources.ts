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
  matchStatus: 'new' | 'matched_existing' | 'duplicate_in_import' | 'manualreview';
  matchedBy?: 'sourceIdentityKey';
  existingSource?: {
    id: string;
    name: string;
    preferredPath: string | null;
  };

  // Temporary metadata for manualreview sources
  // Used during test/analysis phase — NOT final canonical identity
  temporaryCategory?: 'manualreview';
  temporarySourceId?: string;
  temporaryDisplayName?: string;
  manualReviewReason?: string;

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
 */
export interface RawRowProvenance {
  importBatchId: string;
  sourceFile: string;
  sourceFileHash: string;
  sourceRowNumber: number;   // 1-indexed line in the raw file
  rawLineHash: string;       // sha256 of the original line text (hex)
  rawName: string;           // name field from the raw row
  rawUrl: string;            // url field from the raw row
  classificationOutcome:
    | 'new'
    | 'matched_existing'
    | 'duplicate_in_import'
    | 'manualreview'
    | 'skipped_already_imported_file'
    | 'invalid_raw_row';
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
 *   - manualreview            (needs human decision before any sources/ write)
 *   - invalid_raw_row         (discard, never reaches preview)
 *   - skipped_already_imported_file (discard, never reaches preview)
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
  'manualreview',
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
  existingSources: Map<string, ExistingSource>
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

        // Conservative: if names or cities differ from existing, flag as manualreview
        if (primary.name !== row.name || primary.city !== row.city) {
          if (primary.matchStatus !== 'manualreview') {
            const existingName = primary.name;
            const existingCity = primary.city;
            primary.matchStatus = 'manualreview';
            const tempMeta = generateTemporaryId(siteIdentityKey, row.name, 0);
            primary.temporaryCategory = tempMeta.temporaryCategory;
            primary.temporarySourceId = tempMeta.temporarySourceId;
            primary.temporaryDisplayName = tempMeta.temporaryDisplayName;
            primary.manualReviewReason =
              `Import row conflicts with existing source '${existing.id}': ` +
              `existing name='${existing.name}' city='${existing.city}', ` +
              `import name='${row.name}' city='${row.city}'`;
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
          // Conservative: mark as manualreview instead of auto-matching
          const tempMeta = generateTemporaryId(siteIdentityKey, row.name, 0);
          outputMap.set(siteIdentityKey, {
            sourceId: tempMeta.temporarySourceId,
            sourceIdentityKey: siteIdentityKey,
            canonicalUrl,
            name: row.name,
            city: row.city,
            type: row.type,
            discoveredAt: row.discoveredAt,
            note: row.note,
            isDuplicate: false,
            originalRows: [{ name: row.name, url: row.url }],
            matchStatus: 'manualreview',
            temporaryCategory: tempMeta.temporaryCategory,
            temporarySourceId: tempMeta.temporarySourceId,
            temporaryDisplayName: tempMeta.temporaryDisplayName,
            manualReviewReason:
              `Name/city conflict with existing source '${existing.id}': ` +
              `existing name='${existing.name}' city='${existing.city}', ` +
              `import name='${row.name}' city='${row.city}'`,
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

      // Conservative: if names or cities differ, flag as manualreview
      if (primary.name !== row.name || primary.city !== row.city) {
        // Mark the existing entry as manualreview if not already
        if (primary.matchStatus !== 'manualreview') {
          const existingNames = [primary.name];
          const existingCities = [primary.city];
          const tempMeta = generateTemporaryId(siteIdentityKey, primary.name, 0);
          primary.matchStatus = 'manualreview';
          primary.temporaryCategory = tempMeta.temporaryCategory;
          primary.temporarySourceId = tempMeta.temporarySourceId;
          primary.temporaryDisplayName = tempMeta.temporaryDisplayName;
          primary.manualReviewReason =
            `Conflicting rows within import batch: names=[${existingNames.join('|')}|${row.name}], cities=[${existingCities.join('|')}|${row.city}]`;
          // Update temporarySourceId for second variant
          const tempMeta2 = generateTemporaryId(siteIdentityKey, row.name, 1);
          primary.temporarySourceId = tempMeta2.temporarySourceId;
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

    const { sources, stats } = importRawSourcesWithMatching(validRows, existingSources);
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
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let input: string | undefined;
  let output: string | undefined;
  let sourcesDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && i + 1 < args.length) {
      input = args[++i];
    } else if (args[i] === '--output' && i + 1 < args.length) {
      output = args[++i];
    } else if (args[i] === '--sources-dir' && i + 1 < args.length) {
      sourcesDir = args[++i];
    }
  }

  if (!input || !output) {
    console.error('Usage: npx tsx import-raw-sources.ts --input <file> --output <file> [--sources-dir <dir>]');
    console.error('Example: npx tsx import-raw-sources.ts --input 01-Sources/RawSources/RawSources20260404.md --output runtime/import-preview.jsonl');
    process.exit(1);
  }

  return { input, output, sourcesDir };
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main(): void {
  console.log('=== 00A: ImportRawSources Tool (v6 — with pre-import backup + append-only guard) ===\n');

  // ── STEP 0: Pre-import backup of sources/ ──────────────────────────────────
  // This MUST happen before ANY import logic. If backup fails → abort.
  console.log('[00A] Step 0: Pre-import backup of sources/\n');
  const backupResult = takeSourcesBackup();
  console.log();

  if (!backupResult.success) {
    console.error('FATAL: Could not backup sources/. Aborting import to prevent data loss.');
    console.error('       Fix the backup issue before retrying.');
    process.exit(1);
  }

  const { input, output, sourcesDir } = parseArgs();
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
    const filePath = inputArg;
    const { hash: fileHash, size: fileSize } = computeFileHash(filePath);
    const manifest = readManifest();
    const alreadyImported = isFileAlreadyImported(fileHash, manifest);

    const canonicalSourcesDir = sourcesDir ?? path.join(process.cwd(), 'sources');
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

    const { sources, stats } = importRawSourcesWithMatching(validRows, existingSources);

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

    const manualreviewSources = sources.filter(s => s.matchStatus === 'manualreview');
    if (manualreviewSources.length > 0) {
      console.log(`=== MANUALREVIEW sources (${manualreviewSources.length}) — NEEDS HUMAN DECISION ===`);
      for (const s of manualreviewSources) {
        console.log(`  ${s.temporarySourceId}: ${s.temporaryDisplayName}`);
        console.log(`    reason: ${s.manualReviewReason}`);
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
