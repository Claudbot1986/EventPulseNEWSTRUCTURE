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

export function parseMarkdownTable(content: string): RawSourceRow[] {
  const lines = content.split('\n');
  const rows: RawSourceRow[] = [];

  for (const line of lines) {
    if (/^\s*\|[\s|-]*\|\s*$/.test(line)) continue;
    if (!line.trim().startsWith('|')) continue;

    const cells = line.split('|')
      .map(c => c.trim())
      .filter(c => c.length > 0);

    if (cells.length < 6) continue;

    const [name, url, city, type, discoveredAt, ...noteParts] = cells;
    const note = noteParts.join(' | ');

    if (!url || !isValidUrl(url)) continue;

    rows.push({
      name: name.trim(),
      url: url.trim(),
      city: city.trim(),
      type: type.trim(),
      discoveredAt: discoveredAt.trim(),
      note: note.trim(),
    });
  }

  return rows;
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
    });
    stats.new++;
  }

  const sources = Array.from(outputMap.values());
  stats.outputSources = sources.length;

  return { sources, stats };
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
  console.log('=== 00A: ImportRawSources Tool (v4 — with manualreview detection) ===\n');

  const { input, output, sourcesDir } = parseArgs();

  if (!fs.existsSync(input)) {
    console.error(`ERROR: Input file not found: ${input}`);
    process.exit(1);
  }

  const canonicalSourcesDir = sourcesDir ?? path.join(process.cwd(), 'sources');

  console.log(`Input:         ${input}`);
  console.log(`Output:        ${output}`);
  console.log(`Sources dir:   ${canonicalSourcesDir}\n`);

  // Load existing canonical sources
  const existingSources = readExistingSources(canonicalSourcesDir);
  console.log(`Loaded ${existingSources.size} existing canonical sources\n`);

  // Parse import file
  const content = fs.readFileSync(input, 'utf-8');
  const rows = parseMarkdownTable(content);
  console.log(`Parsed: ${rows.length} raw rows\n`);

  // Run import with matching
  const { sources, stats } = importRawSourcesWithMatching(rows, existingSources);

  // Show results
  console.log('=== Import Summary ===');
  console.log(`  Raw rows parsed:              ${stats.totalRows}`);
  console.log(`  Existing sources loaded:      ${stats.existingSourcesLoaded}`);
  console.log(`  NEW sources:                 ${stats.new}`);
  console.log(`  MATCHED existing:           ${stats.matchedExisting}`);
  console.log(`  DUPLICATE rows in import:    ${stats.duplicateInImportRows}`);
  console.log(`  MANUALREVIEW:              ${stats.manualreview}`);
  console.log(`  Total output sources:        ${stats.outputSources}`);
  console.log();

  // Show new sources
  const newSources = sources.filter(s => s.matchStatus === 'new');
  if (newSources.length > 0) {
    console.log(`=== NEW sources (${newSources.length}) ===`);
    for (const s of newSources) {
      console.log(`  ${s.sourceId}: ${s.name} | ${s.sourceIdentityKey}`);
    }
    console.log();
  }

  // Show matched existing
  const matched = sources.filter(s => s.matchStatus === 'matched_existing');
  if (matched.length > 0) {
    console.log(`=== MATCHED existing sources (${matched.length}) ===`);
    for (const s of matched) {
      console.log(`  ${s.existingSource!.id}: "${s.existingSource!.name}"`);
      console.log(`    preferredPath=${s.existingSource!.preferredPath ?? 'null'}`);
      console.log(`    siteIdentityKey=${s.sourceIdentityKey}`);
      console.log(`    canonicalUrl=${s.canonicalUrl}`);
    }
    console.log();
  }

  // Show sources that had internal duplicates merged
  const mergedSources = sources.filter(s => s.isDuplicate);
  if (mergedSources.length > 0) {
    console.log(`=== SOURCES WITH INTERNAL DUPLICATES (${mergedSources.length}) ===`);
    for (const s of mergedSources) {
      console.log(`  ${s.sourceId}: ${s.name}`);
      console.log(`    rows merged: ${s.originalRows.length}`);
      for (const orig of s.originalRows) {
        console.log(`      → ${orig.name} | ${orig.url}`);
      }
    }
    console.log();
  }

  // Show manualreview sources
  const manualreviewSources = sources.filter(s => s.matchStatus === 'manualreview');
  if (manualreviewSources.length > 0) {
    console.log(`=== MANUALREVIEW sources (${manualreviewSources.length}) — NEEDS HUMAN DECISION ===`);
    for (const s of manualreviewSources) {
      console.log(`  ${s.temporarySourceId}: ${s.temporaryDisplayName}`);
      console.log(`    sourceIdentityKey: ${s.sourceIdentityKey}`);
      console.log(`    canonicalUrl: ${s.canonicalUrl}`);
      console.log(`    reason: ${s.manualReviewReason}`);
      if (s.existingSource) {
        console.log(`    existingSource: ${s.existingSource.id} (${s.existingSource.name})`);
      }
    }
    console.log();
  }

  // Write output
  const lines = sources.map(s => JSON.stringify(s)).join('\n') + '\n';
  fs.writeFileSync(output, lines, 'utf-8');
  console.log(`Written: ${output}`);
  console.log(`  ${sources.length} sources`);

  // Verification
  const originalsInOutput = sources.reduce((sum, s) => sum + s.originalRows.length, 0);
  console.log();
  console.log('=== Verification ===');
  console.log(`  Input rows:              ${stats.totalRows}`);
  console.log(`  Sum of originalRows:     ${originalsInOutput}`);
  console.log(`  Duplicate rows counted:  ${stats.duplicateInImportRows}`);
  console.log(`  Match: ${originalsInOutput === stats.totalRows ? 'YES ✓' : 'NO ✗'}`);
}

// Run
main();
