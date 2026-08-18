/**
 * RawSources Importer — Tool "0" (pre-A entry point)
 *
 * Läser källor från 01-Sources/RawSources/*.md och skapar sources/{sourceId}.jsonl + preA-queue.jsonl.
 * Canonical URL (ingen dublett-URL); unikt id (slug, vid fil-/slug-krock slug-2, slug-3, …).
 *
 * Flöde:
 *   RawSources (*.md)
 *     → om ny URL: skapa sources/{id}.jsonl + lägg i preA-queue.jsonl
 *     → A-runner (runA.ts) kör source
 *     → Utfall A:
 *         - events hittas → postA-UI (via preUI-queue.jsonl)
 *         - inga events → PreB-queue.jsonl
 *     → B-runner (runB.ts) kör PreB-sources
 *     → Utfall B:
 *         - events hittas → postB-UI (via preUI-queue.jsonl)
 *         - inga events → postB-preC-queue.jsonl
 *
 * Usage:
 *   npx tsx 02-Ingestion/importRawSources.ts              # normal: parse & import
 *   npx tsx 02-Ingestion/importRawSources.ts --dry        # visa utan att köra
 *   npx tsx 02-Ingestion/importRawSources.ts --file FILE  # parse specifik fil
 *   npx tsx 02-Ingestion/importRawSources.ts --status     # visa råstatus
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

import { getAllSources, getSource, type SourceTruth } from './tools/sourceRegistry';

// ─── Paths ────────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RAWSOURCES_DIR = path.resolve(PROJECT_ROOT, '01-Sources/RawSources');
const SOURCES_DIR = path.resolve(PROJECT_ROOT, 'sources');
const RUNTIME_DIR = path.resolve(PROJECT_ROOT, 'runtime');
const PREA_QUEUE_FILE = path.resolve(RUNTIME_DIR, 'preA-queue.jsonl');

/** Delad karta under en CLI-körning så flera RawSources-filer ser samma nya URL:er/id:n. */
export interface ImportSessionState {
  canonicalByUrl: Map<string, string>;
  reservedIds: Set<string>;
}

// ─── RawSource Entry (from markdown table) ──────────────────────────────────

interface RawSourceEntry {
  sourceId: string;   // URL-based slug: "abb-arena", "aik"
  name: string;      // Display name from table
  url: string;       // URL from table
  city: string;      // City from table
  category: string;  // Category from table
  collectedAt: string;
  notes: string;
}

interface PreAQueueEntry {
  sourceId: string;
  addedAt: string;
  addedBy: string;   // 'RawSources'
  reason: string;   // t.ex. "imported from RawSources: NAME"
  attempts: number;
}

// ─── Parse Markdown Table ────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics (ö → o, etc.)
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function parseRawSourcesMarkdown(content: string): RawSourceEntry[] {
  const lines = content.split('\n');
  const entries: RawSourceEntry[] = [];
  let inTable = false;
  let headerCols: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect markdown table
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (trimmed.includes('---')) {
        inTable = true;
        continue;
      }

      if (!inTable) continue;

      const cols = trimmed.split('|').map(c => c.trim()).filter(c => c.length > 0);

      if (cols.length >= 2 && !headerCols.length) {
        // First data row = header
        headerCols = cols;
        continue;
      }

      if (cols.length >= 2) {
        const name = cols[0] || '';
        const url = cols[1] || '';
        const city = cols[2] || '';
        const category = cols[3] || '';
        const collectedAt = cols[4] || new Date().toISOString().split('T')[0];
        const notes = cols[5] || '';

        if (!url || !url.startsWith('http')) continue;

        const sourceId = slugify(name);
        if (!sourceId) continue;

        entries.push({ sourceId, name, url, city, category, collectedAt, notes });
      }
    }
  }

  return entries;
}

// ─── Queue Operations ────────────────────────────────────────────────────────

function readPreAQueue(): PreAQueueEntry[] {
  if (!existsSync(PREA_QUEUE_FILE)) return [];
  const content = readFileSync(PREA_QUEUE_FILE, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as PreAQueueEntry);
}

function addToPreAQueue(sourceId: string, reason: string): void {
  const queue = readPreAQueue();
  if (queue.some(e => e.sourceId === sourceId)) return; // redan i kön
  queue.push({
    sourceId,
    addedAt: new Date().toISOString(),
    addedBy: 'RawSources',
    reason,
    attempts: 0,
  });
  writeFileSync(PREA_QUEUE_FILE, queue.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

// ─── Import Single File ──────────────────────────────────────────────────────

interface ImportResult {
  file: string;
  totalRows: number;
  newToRegistry: number;
  sourceFilesWritten: number;
  alreadyInRegistry: number;
  addedToQueue: number;
  alreadyInQueue: number;
  blockedByCanonicalUrl: number;
  invalidUrls: number;
  errors: string[];
}

function normalizeUrlForIdentity(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    let pathname = parsed.pathname || '/';
    pathname = pathname.replace(/\/{2,}/g, '/');
    if (pathname !== '/') pathname = pathname.replace(/\/+$/, '');
    const search = parsed.search || '';
    return `${protocol}//${host}${pathname}${search}`;
  } catch {
    return null;
  }
}

function buildInitialCanonicalMap(): Map<string, string> {
  const canonicalByUrl = new Map<string, string>();
  for (const source of getAllSources()) {
    const norm = normalizeUrlForIdentity(source.url);
    if (!norm) continue;
    if (!canonicalByUrl.has(norm)) {
      canonicalByUrl.set(norm, source.id);
    }
  }
  return canonicalByUrl;
}

function sourceJsonlPath(sourceId: string): string {
  return path.join(SOURCES_DIR, `${sourceId}.jsonl`);
}

/**
 * Välj ett ledigt id: börja med baseSlug; om filen finns med annan URL → slug-2, slug-3, …
 * Om filen redan har samma canonical URL → returnera det id:t (ingen ny källa).
 */
function allocateSourceIdForUrl(
  baseSlug: string,
  normalizedIncomingUrl: string,
  reservedIds: Set<string>
): { kind: 'new'; id: string } | { kind: 'same_url_existing'; id: string } {
  let suffix = 2;
  let candidate = baseSlug;

  for (;;) {
    if (reservedIds.has(candidate)) {
      candidate = `${baseSlug}-${suffix}`;
      suffix++;
      continue;
    }

    const p = sourceJsonlPath(candidate);
    if (!existsSync(p)) {
      return { kind: 'new', id: candidate };
    }

    const existing = getSource(candidate);
    const existingNorm = existing ? normalizeUrlForIdentity(existing.url) : null;
    if (existing && existingNorm === normalizedIncomingUrl) {
      return { kind: 'same_url_existing', id: candidate };
    }

    // Upptagen av annan URL, eller trasig fil — prova nästa suffix.
    candidate = `${baseSlug}-${suffix}`;
    suffix++;
    if (suffix > 1000) {
      throw new Error(`Kunde inte allokera sourceId för bas "${baseSlug}" (för många krockar)`);
    }
  }
}

function writeMinimalSourceFile(sourceId: string, entry: RawSourceEntry): void {
  mkdirSync(SOURCES_DIR, { recursive: true });
  const row: SourceTruth = {
    id: sourceId,
    url: entry.url.trim(),
    name: entry.name,
    type: entry.category?.trim() || 'unknown',
    city: entry.city?.trim() || undefined,
    discoveredAt: new Date().toISOString(),
    discoveredBy: 'source_import',
    preferredPath: 'unknown',
    preferredPathReason: 'Tool 0 RawSources import',
    metadata: {
      rawSourcesCollectedAt: entry.collectedAt,
      ...(entry.notes?.trim() ? { rawSourcesNotes: entry.notes.trim() } : {}),
    },
  };
  writeFileSync(sourceJsonlPath(sourceId), JSON.stringify(row) + '\n', 'utf8');
}

function importFile(filePath: string, dry: boolean, session: ImportSessionState): ImportResult {
  const result: ImportResult = {
    file: path.basename(filePath),
    totalRows: 0,
    newToRegistry: 0,
    sourceFilesWritten: 0,
    alreadyInRegistry: 0,
    addedToQueue: 0,
    alreadyInQueue: 0,
    blockedByCanonicalUrl: 0,
    invalidUrls: 0,
    errors: [],
  };

  const content = readFileSync(filePath, 'utf8');
  const entries = parseRawSourcesMarkdown(content);
  result.totalRows = entries.length;

  if (entries.length === 0) {
    result.errors.push('Inga rader hittade i tabellen (kontrollera att | --- | raden finns)');
    return result;
  }

  const preAQueue = readPreAQueue();
  const preAIds = new Set(preAQueue.map(e => e.sourceId));
  const { canonicalByUrl, reservedIds } = session;

  for (const entry of entries) {
    const { sourceId: baseSlug, name, url, city } = entry;

    const normalizedIncomingUrl = normalizeUrlForIdentity(url);
    if (!normalizedIncomingUrl) {
      result.invalidUrls++;
      result.errors.push(`Ogiltig URL för ${baseSlug}: ${url}`);
      continue;
    }

    const urlOwner = canonicalByUrl.get(normalizedIncomingUrl);
    if (urlOwner) {
      result.alreadyInRegistry++;
      if (urlOwner !== baseSlug) {
        result.blockedByCanonicalUrl++;
        result.errors.push(
          `URL redan registrerad som "${urlOwner}" (rad slug ${baseSlug}): ${url}`
        );
      }
      continue;
    }

    const allocated = allocateSourceIdForUrl(baseSlug, normalizedIncomingUrl, reservedIds);
    if (allocated.kind === 'same_url_existing') {
      canonicalByUrl.set(normalizedIncomingUrl, allocated.id);
      result.alreadyInRegistry++;
      continue;
    }

    const finalId = allocated.id;
    canonicalByUrl.set(normalizedIncomingUrl, finalId);
    reservedIds.add(finalId);

    if (preAIds.has(finalId)) {
      result.alreadyInQueue++;
      result.sourceFilesWritten++;
      if (!dry) {
        writeMinimalSourceFile(finalId, entry);
      }
      continue;
    }

    result.newToRegistry++;
    result.sourceFilesWritten++;

    if (!dry) {
      writeMinimalSourceFile(finalId, entry);
      addToPreAQueue(finalId, `imported from RawSources: ${name} (${city}) [id=${finalId}]`);
    }

    result.addedToQueue++;
  }

  return result;
}

// ─── Status Overview ─────────────────────────────────────────────────────────

interface RawSourcesStatus {
  files: { name: string; entryCount: number }[];
  totalRows: number;
  newToRegistry: number;
  alreadyInRegistry: number;
  blockedByCanonicalUrl: number;
  invalidUrls: number;
  preAQueueSize: number;
}

function getStatus(): RawSourcesStatus {
  const files = readdirSync(RAWSOURCES_DIR)
    .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
    .sort();
  const status: RawSourcesStatus = {
    files: [],
    totalRows: 0,
    newToRegistry: 0,
    alreadyInRegistry: 0,
    blockedByCanonicalUrl: 0,
    invalidUrls: 0,
    preAQueueSize: readPreAQueue().length,
  };

  const canonicalByUrl = buildInitialCanonicalMap();
  const reservedIds = new Set<string>();

  for (const file of files) {
    const content = readFileSync(path.join(RAWSOURCES_DIR, file), 'utf8');
    const entries = parseRawSourcesMarkdown(content);
    status.files.push({ name: file, entryCount: entries.length });
    status.totalRows += entries.length;

    for (const entry of entries) {
      const baseSlug = entry.sourceId;
      const normalizedIncomingUrl = normalizeUrlForIdentity(entry.url);
      if (!normalizedIncomingUrl) {
        status.invalidUrls++;
        continue;
      }

      const urlOwner = canonicalByUrl.get(normalizedIncomingUrl);
      if (urlOwner) {
        status.alreadyInRegistry++;
        if (urlOwner !== baseSlug) {
          status.blockedByCanonicalUrl++;
        }
        continue;
      }

      const allocated = allocateSourceIdForUrl(baseSlug, normalizedIncomingUrl, reservedIds);
      if (allocated.kind === 'same_url_existing') {
        canonicalByUrl.set(normalizedIncomingUrl, allocated.id);
        status.alreadyInRegistry++;
        continue;
      }

      const finalId = allocated.id;
      canonicalByUrl.set(normalizedIncomingUrl, finalId);
      reservedIds.add(finalId);
      status.newToRegistry++;
    }
  }

  return status;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage:');
    console.log('  npx tsx 02-Ingestion/importRawSources.ts          # parse & import all');
    console.log('  npx tsx 02-Ingestion/importRawSources.ts --dry   # visa utan att köra');
    console.log('  npx tsx 02-Ingestion/importRawSources.ts --file F # parse specifik fil');
    console.log('  npx tsx 02-Ingestion/importRawSources.ts --status # visa råstatus');
    return;
  }

  // ── Status ──────────────────────────────────────────────────────────────
  if (args.includes('--status')) {
    const s = getStatus();
    console.log('═══ RAWSOURCES STATUS ═══');
    console.log(`Filer: ${s.files.length}`);
    for (const f of s.files) {
      console.log(`  ${f.name}: ${f.entryCount} rader`);
    }
    console.log(`\nTotal rader: ${s.totalRows}`);
    console.log(`Nya till registry: ${s.newToRegistry}`);
    console.log(`Redan i registry: ${s.alreadyInRegistry}`);
    console.log(`Blockerade av canonical URL-krock: ${s.blockedByCanonicalUrl}`);
    console.log(`Ogiltiga URL-rader: ${s.invalidUrls}`);
    console.log(`preA-queue: ${s.preAQueueSize}`);
    return;
  }

  // ── Dry run ──────────────────────────────────────────────────────────────
  const dry = args.includes('--dry');

  // ── Single file or all files ─────────────────────────────────────────────
  const fileIdx = args.indexOf('--file');
  const targetFiles = fileIdx !== -1 && args[fileIdx + 1]
    ? [path.isAbsolute(args[fileIdx + 1]) ? args[fileIdx + 1] : path.join(RAWSOURCES_DIR, args[fileIdx + 1])]
    : readdirSync(RAWSOURCES_DIR)
        .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
        .sort()
        .map(f => path.join(RAWSOURCES_DIR, f));

  if (targetFiles.length === 0 || (fileIdx !== -1 && !existsSync(targetFiles[0]))) {
    console.error('Inga .md-filer hittade i 01-Sources/RawSources/');
    return;
  }

  const session: ImportSessionState = {
    canonicalByUrl: buildInitialCanonicalMap(),
    reservedIds: new Set<string>(),
  };

  const allResults: ImportResult[] = [];
  for (const file of targetFiles) {
    const result = importFile(file, dry, session);
    allResults.push(result);
  }

  // ── Print results ────────────────────────────────────────────────────────
  for (const r of allResults) {
    console.log(`\n─── ${r.file} ───`);
    console.log(`  Rader: ${r.totalRows}`);
    console.log(`  Nya till registry: ${r.newToRegistry}`);
    console.log(`  Redan i registry: ${r.alreadyInRegistry}`);
    console.log(`  Blockerade av canonical URL-krock: ${r.blockedByCanonicalUrl}`);
    console.log(`  Ogiltiga URL-rader: ${r.invalidUrls}`);
    if (dry) {
      console.log(`  SKULLE läggas i preA-queue: ${r.addedToQueue}`);
      console.log(`  Redan i preA-queue: ${r.alreadyInQueue}`);
    } else {
      console.log(`  Lades i preA-queue: ${r.addedToQueue}`);
      console.log(`  Redan i preA-queue: ${r.alreadyInQueue}`);
    }
    for (const err of r.errors) {
      console.log(`  ⚠️  ${err}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const totalNew = allResults.reduce((s, r) => s + r.newToRegistry, 0);
  const totalSourceFilesWritten = allResults.reduce((s, r) => s + r.sourceFilesWritten, 0);
  const totalAdded = allResults.reduce((s, r) => s + r.addedToQueue, 0);
  const totalAlready = allResults.reduce((s, r) => s + r.alreadyInRegistry, 0);
  const totalAlreadyQueue = allResults.reduce((s, r) => s + r.alreadyInQueue, 0);
  const totalBlockedCanonical = allResults.reduce((s, r) => s + r.blockedByCanonicalUrl, 0);
  const totalInvalidUrls = allResults.reduce((s, r) => s + r.invalidUrls, 0);

  console.log(`\n═══ IMPORT SUMMARY ═══`);
  console.log(`  Filer: ${allResults.length}`);
  console.log(`  Nya till registry: ${totalNew}`);
  if (dry) {
    console.log(`  SKULLE skriva källfiler under sources/: ${totalSourceFilesWritten}`);
  } else {
    console.log(`  Källfiler skrivna under sources/: ${totalSourceFilesWritten}`);
  }
  console.log(`  Redan i registry: ${totalAlready}`);
  console.log(`  Blockerade av canonical URL-krock: ${totalBlockedCanonical}`);
  console.log(`  Ogiltiga URL-rader: ${totalInvalidUrls}`);
  if (dry) {
    console.log(`  SKULLE läggas i preA-queue: ${totalAdded}`);
    console.log(`  Redan i preA-queue: ${totalAlreadyQueue}`);
  } else {
    console.log(`  Lades i preA-queue: ${totalAdded}`);
    console.log(`  Redan i preA-queue: ${totalAlreadyQueue}`);
  }

  if (totalAdded > 0 && !dry) {
    console.log(`\n➡️  Nästa steg: kör 'npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts' för att köra A-verktyget på ${totalAdded} nya sources.`);
    console.log(`   A-verktyget skickar sources vidare till preB om inga events hittas.`);
    console.log(`   Kör 'npx tsx 02-Ingestion/B-JSON-feedGate/runB.ts' för att köra B-verktyget.`);
  }
}

main().catch(console.error);
