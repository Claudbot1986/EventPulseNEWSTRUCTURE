/**
 * import-raw-sources.ts
 *
 * Phase 2: 00A-ImportRawSources-Tool
 *
 * Importerar råa source-listor med:
 * - URL-normalisering
 * - Stabil sourceId-generering
 * - Deduplikering
 * - Idempotent output
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
import * as readline from 'readline';

// ─── Types ─────────────────────────────────────────────────────────────────

interface RawSourceRow {
  name: string;
  url: string;
  city: string;
  type: string;
  discoveredAt: string;
  note: string;
}

interface ImportedSource {
  sourceId: string;
  canonicalUrl: string;
  name: string;
  city: string;
  type: string;
  discoveredAt: string;
  note: string;
  dedupeKey: string;   // the normalized URL used for deduplication
  isDuplicate: boolean;
  originalRows: Array<{ name: string; url: string }>;
}

// ─── URL Normalization ────────────────────────────────────────────────────

/**
 * Normalize a URL to its canonical form for deduplication.
 * Rules:
 * 1. Strip protocol (http://, https://)
 * 2. Strip www. prefix
 * 3. Strip trailing slash
 * 4. Strip path if empty (root = /)
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

  // If path is empty, set to root
  if (!url.includes('/')) {
    url = url + '/';
  }

  return url.toLowerCase();
}

// ─── SourceId Generation ──────────────────────────────────────────────────

/**
 * Generate a stable sourceId from a hostname.
 * Rules:
 * 1. Extract hostname from canonical URL
 * 2. Strip .se, .no, .dk, .fi, .nu suffixes
 * 3. Replace Swedish chars: å→a, ä→a, ö→o
 * 4. Replace special chars: - and _ both become -
 * 5. Strip leading/trailing dashes
 * 6. Take max 40 chars
 */
export function generateSourceId(canonicalUrl: string): string {
  // Extract hostname
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

  // Replace separators: _ and - both become -
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

/**
 * Parse a markdown table with format:
 * | Namn | URL | Stad | Kategori | Insamlad | Notis |
 * | ABF | https://www.abf.se | Stockholm | förening | 2026-04-04 | Studieförbund |
 */
export function parseMarkdownTable(content: string): RawSourceRow[] {
  const lines = content.split('\n');
  const rows: RawSourceRow[] = [];

  for (const line of lines) {
    // Skip separator rows (contain only |, -, :, spaces)
    if (/^\s*\|[\s|-]*\|\s*$/.test(line)) continue;

    // Skip header-like rows that don't start with |
    if (!line.trim().startsWith('|')) continue;

    // Extract cells between |
    const cells = line.split('|')
      .map(c => c.trim())
      .filter(c => c.length > 0);

    // We expect at least 6 columns: Namn, URL, Stad, Kategori, Insamlad, Notis
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

// ─── Import Logic ─────────────────────────────────────────────────────────

/**
 * Import raw sources with deduplication.
 * Returns deduplicated sources and a list of duplicates.
 */
export function importRawSources(rows: RawSourceRow[]): ImportedSource[] {
  // Map from dedupeKey (normalized URL) → ImportedSource
  const dedupeMap = new Map<string, ImportedSource>();

  for (const row of rows) {
    const dedupeKey = normalizeUrl(row.url);
    const sourceId = generateSourceId(dedupeKey);

    if (dedupeMap.has(dedupeKey)) {
      // Duplicate: add to originalRows but mark as duplicate
      const existing = dedupeMap.get(dedupeKey)!;
      existing.originalRows.push({ name: row.name, url: row.url });
      existing.isDuplicate = true;

      // Keep the shortest/most canonical name as primary
      if (row.name.length < existing.name.length) {
        existing.name = row.name;
      }
    } else {
      // First occurrence: create new entry
      dedupeMap.set(dedupeKey, {
        sourceId,
        canonicalUrl: dedupeKey,
        name: row.name,
        city: row.city,
        type: row.type,
        discoveredAt: row.discoveredAt,
        note: row.note,
        dedupeKey,
        isDuplicate: false,
        originalRows: [{ name: row.name, url: row.url }],
      });
    }
  }

  return Array.from(dedupeMap.values());
}

// ─── CLI ──────────────────────────────────────────────────────────────────

interface CliArgs {
  input: string;
  output: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let input: string | undefined;
  let output: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && i + 1 < args.length) {
      input = args[i + 1];
      i++;
    } else if (args[i] === '--output' && i + 1 < args.length) {
      output = args[i + 1];
      i++;
    }
  }

  if (!input || !output) {
    console.error('Usage: npx tsx import-raw-sources.ts --input <file> --output <file>');
    console.error('Example: npx tsx import-raw-sources.ts --input 01-Sources/RawSources/RawSources20260404.md --output runtime/import-preview.jsonl');
    process.exit(1);
  }

  return { input, output };
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main(): void {
  console.log('=== 00A: ImportRawSources Tool ===\n');

  const { input, output } = parseArgs();

  // Check input exists
  if (!fs.existsSync(input)) {
    console.error(`ERROR: Input file not found: ${input}`);
    process.exit(1);
  }

  console.log(`Input:  ${input}`);
  console.log(`Output: ${output}\n`);

  // Read and parse
  const content = fs.readFileSync(input, 'utf-8');
  const rows = parseMarkdownTable(content);
  console.log(`Parsed: ${rows.length} raw rows\n`);

  // Import with dedupe
  const sources = importRawSources(rows);

  // Stats
  const dups = sources.filter(s => s.isDuplicate).length;
  const unique = sources.filter(s => !s.isDuplicate).length;
  const totalOriginals = sources.reduce((sum, s) => sum + s.originalRows.length, 0);

  console.log('=== Import Summary ===');
  console.log(`  Raw rows parsed:    ${rows.length}`);
  console.log(`  Total original rows: ${totalOriginals}`);
  console.log(`  Unique sources:      ${unique}`);
  console.log(`  Duplicate rows:      ${dups}`);
  console.log(`  Deduplicated to:     ${sources.length} unique sources`);
  console.log();

  // Show duplicates
  if (dups > 0) {
    console.log('=== Duplicates detected ===');
    for (const s of sources.filter(s => s.isDuplicate)) {
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
  console.log();
  console.log('=== Verification ===');
  console.log(`  Input rows:   ${rows.length}`);
  console.log(`  Output sources: ${sources.length}`);
  const originalsInOutput = sources.reduce((sum, s) => sum + s.originalRows.length, 0);
  console.log(`  Sum of originalRows in output: ${originalsInOutput}`);
  console.log(`  Match: ${originalsInOutput === rows.length ? 'YES ✓' : 'NO ✗'}`);
}

// Run
main();
