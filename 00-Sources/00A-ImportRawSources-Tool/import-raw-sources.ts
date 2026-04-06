/**
 * import-raw-sources.ts
 *
 * Phase 2: 00A-ImportRawSources-Tool
 *
 * Importerar råa source-listor med:
 * - URL-normalisering
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
  id: string;          // sourceId in canonical sources
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
 * Each ImportedSource represents one deduplicated source from the import,
 * with matchStatus indicating how it relates to existing canonical sources.
 */
interface ImportedSource {
  // Identity
  sourceId: string;        // authoritative sourceId (existing.id if matched, else generated)
  canonicalUrl: string;    // normalized URL
  name: string;
  city: string;
  type: string;
  discoveredAt: string;
  note: string;

  // Deduplication tracking
  dedupeKey: string;       // the normalized URL used for deduplication
  isDuplicate: boolean;    // true if this was a duplicate within the import batch
  originalRows: Array<{ name: string; url: string }>;

  // Match against existing canonical sources
  matchStatus: 'new' | 'matched_existing' | 'duplicate_in_import';
  matchedBy?: 'canonicalUrl';      // which field matched
  existingSource?: {                  // populated only if matchStatus === 'matched_existing'
    id: string;
    name: string;
    preferredPath: string | null;
  };
}

// ─── URL Normalization ────────────────────────────────────────────────────

/**
 * Normalize a URL to its canonical form for deduplication.
 * Rules:
 * 1. Strip protocol (http://, https://)
 * 2. Strip www. prefix
 * 3. Strip trailing slash
 * 4. Ensure path exists (root = /)
 * 5. Lowercase
 */
export function normalizeUrl(rawUrl: string): string {
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
 * Generate a stable sourceId from a hostname.
 * Used only for NEW sources — matched sources keep their existing id.
 */
export function generateSourceId(canonicalUrl: string): string {
  let host = canonicalUrl.split('/')[0] ?? canonicalUrl;

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
 * keyed by normalized URL.
 */
export function readExistingSources(sourcesDir: string): Map<string, ExistingSource> {
  const index = new Map<string, ExistingSource>();

  if (!fs.existsSync(sourcesDir)) {
    console.warn(`  WARNING: sources dir not found: ${sourcesDir}`);
    return index;
  }

  const files = fs.readdirSync(sourcesDir).filter(f => f.endsWith('.jsonl'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(sourcesDir, file), 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      if (lines.length === 0) continue;

      const source = JSON.parse(lines[0]) as ExistingSource;
      if (!source.id || !source.url) continue;

      const dedupeKey = normalizeUrl(source.url);
      index.set(dedupeKey, source);
    } catch {
      // Skip malformed files
    }
  }

  return index;
}

// ─── Import Logic with Existing Source Matching ────────────────────────────

export interface ImportResult {
  sources: ImportedSource[];
  stats: {
    totalRows: number;
    new: number;
    matchedExisting: number;
    duplicateInImport: number;
    existingSourcesLoaded: number;
  };
}

/**
 * Import raw sources with:
 * 1. Matching against existing canonical sources
 * 2. Internal deduplication within the import batch
 *
 * Priority order:
 * - If dedupeKey matches an existing source → matchStatus = 'matched_existing'
 * - If dedupeKey matches another row in the same import batch → matchStatus = 'duplicate_in_import'
 * - Otherwise → matchStatus = 'new'
 */
export function importRawSourcesWithMatching(
  rows: RawSourceRow[],
  existingSources: Map<string, ExistingSource>
): ImportResult {
  const stats = {
    totalRows: rows.length,
    new: 0,
    matchedExisting: 0,
    duplicateInImport: 0,
    existingSourcesLoaded: existingSources.size,
  };

  // Phase 1: For each row, determine matchStatus
  const rowResults: Array<{
    row: RawSourceRow;
    dedupeKey: string;
    matchStatus: 'new' | 'matched_existing' | 'duplicate_in_import';
    existingSource?: ExistingSource;
  }> = [];

  for (const row of rows) {
    const dedupeKey = normalizeUrl(row.url);

    // Check 1: Does this match an existing canonical source?
    if (existingSources.has(dedupeKey)) {
      rowResults.push({
        row,
        dedupeKey,
        matchStatus: 'matched_existing',
        existingSource: existingSources.get(dedupeKey),
      });
      continue;
    }

    // Check 2: Has this dedupeKey already appeared in this import batch?
    const alreadySeen = rowResults.some(r => r.dedupeKey === dedupeKey);
    if (alreadySeen) {
      rowResults.push({
        row,
        dedupeKey,
        matchStatus: 'duplicate_in_import',
      });
      continue;
    }

    // New source
    rowResults.push({
      row,
      dedupeKey,
      matchStatus: 'new',
    });
  }

  // Phase 2: Build ImportedSource array from row results
  const sources: ImportedSource[] = [];
  const dedupeSeen = new Set<string>();

  for (const result of rowResults) {
    const { row, dedupeKey, matchStatus, existingSource } = result;

    // Track for internal dedup detection
    if (dedupeSeen.has(dedupeKey)) {
      // This is a duplicate within the batch — find the primary entry
      const primary = sources.find(s => s.dedupeKey === dedupeKey);
      if (primary) {
        primary.originalRows.push({ name: row.name, url: row.url });
        primary.isDuplicate = true;
      }
      continue;
    }
    dedupeSeen.add(dedupeKey);

    // Build the ImportedSource
    const imported: ImportedSource = {
      sourceId: existingSource?.id ?? generateSourceId(dedupeKey),
      canonicalUrl: dedupeKey,
      name: row.name,
      city: row.city,
      type: row.type,
      discoveredAt: row.discoveredAt,
      note: row.note,
      dedupeKey,
      isDuplicate: false,
      originalRows: [{ name: row.name, url: row.url }],
      matchStatus,
    };

    if (matchStatus === 'matched_existing' && existingSource) {
      imported.matchedBy = 'canonicalUrl';
      imported.existingSource = {
        id: existingSource.id,
        name: existingSource.name,
        preferredPath: existingSource.preferredPath ?? null,
      };
      stats.matchedExisting++;
    } else if (matchStatus === 'duplicate_in_import') {
      imported.isDuplicate = true;
      stats.duplicateInImport++;
    } else {
      stats.new++;
    }

    sources.push(imported);
  }

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
  console.log('=== 00A: ImportRawSources Tool (v2 — with existing source matching) ===\n');

  const { input, output, sourcesDir } = parseArgs();

  if (!fs.existsSync(input)) {
    console.error(`ERROR: Input file not found: ${input}`);
    process.exit(1);
  }

  // Default sources dir to sources/ in project root
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
  console.log(`  NEW sources:                  ${stats.new}`);
  console.log(`  MATCHED existing:            ${stats.matchedExisting}`);
  console.log(`  DUPLICATE in import batch:   ${stats.duplicateInImport}`);
  console.log(`  Total deduplicated output:    ${sources.length}`);
  console.log();

  // Show new sources
  const newSources = sources.filter(s => s.matchStatus === 'new');
  if (newSources.length > 0) {
    console.log(`=== NEW sources (${newSources.length}) ===`);
    for (const s of newSources) {
      console.log(`  ${s.sourceId}: ${s.name} | ${s.canonicalUrl}`);
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
      console.log(`    import URL: ${s.canonicalUrl}`);
    }
    console.log();
  }

  // Show internal duplicates
  const internalDups = sources.filter(s => s.matchStatus === 'duplicate_in_import');
  if (internalDups.length > 0) {
    console.log(`=== DUPLICATES in import batch (${internalDups.length}) ===`);
    for (const s of internalDups) {
      console.log(`  ${s.sourceId} (${s.canonicalUrl})`);
      for (const orig of s.originalRows) {
        console.log(`    → ${orig.name} | ${orig.url}`);
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
  console.log(`  Match: ${originalsInOutput === stats.totalRows ? 'YES ✓' : 'NO ✗'}`);
}

// Run
main();
