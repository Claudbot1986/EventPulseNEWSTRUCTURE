/**
 * RawSources Importer — Tool "0" (pre-A entry point)
 *
 * Läser källor från 01-Sources/RawSources/*.md och importerar dem till preA-queue.jsonl.
 * För varje RawSources-rad: kontrollera om source redan finns i sources/ (sourceRegistry).
 * Om ny → lägg till i preA-queue.jsonl för att köras av verktyg A.
 *
 * Flöde:
 *   RawSources (*.md)
 *     → kontrollera om source finns i sourceRegistry
 *     → om ny: lägg i preA-queue.jsonl
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
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

import { getAllSources, getSource, getSourceStatus } from './tools/sourceRegistry';

// ─── Paths ────────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RAWSOURCES_DIR = path.resolve(PROJECT_ROOT, '01-Sources/RawSources');
const RUNTIME_DIR = path.resolve(PROJECT_ROOT, 'runtime');
const PREA_QUEUE_FILE = path.resolve(RUNTIME_DIR, 'preA-queue.jsonl');

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

function isInSourceRegistry(sourceId: string): boolean {
  const source = getSource(sourceId);
  return source !== null;
}

function isNeverRun(sourceId: string): boolean {
  const status = getSourceStatus(sourceId);
  return status.status === 'never_run';
}

// ─── Import Single File ──────────────────────────────────────────────────────

interface ImportResult {
  file: string;
  totalRows: number;
  newToRegistry: number;
  alreadyInRegistry: number;
  addedToQueue: number;
  alreadyInQueue: number;
  errors: string[];
}

function importFile(filePath: string, dry: boolean): ImportResult {
  const result: ImportResult = {
    file: path.basename(filePath),
    totalRows: 0,
    newToRegistry: 0,
    alreadyInRegistry: 0,
    addedToQueue: 0,
    alreadyInQueue: 0,
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

  for (const entry of entries) {
    const { sourceId, name, url, city } = entry;

    if (isInSourceRegistry(sourceId)) {
      result.alreadyInRegistry++;
      continue;
    }

    result.newToRegistry++;

    if (preAIds.has(sourceId)) {
      result.alreadyInQueue++;
      continue;
    }

    if (!dry) {
      addToPreAQueue(sourceId, `imported from RawSources: ${name} (${city})`);
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
  preAQueueSize: number;
}

function getStatus(): RawSourcesStatus {
  const files = readdirSync(RAWSOURCES_DIR).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
  const status: RawSourcesStatus = {
    files: [],
    totalRows: 0,
    newToRegistry: 0,
    alreadyInRegistry: 0,
    preAQueueSize: readPreAQueue().length,
  };

  for (const file of files) {
    const content = readFileSync(path.join(RAWSOURCES_DIR, file), 'utf8');
    const entries = parseRawSourcesMarkdown(content);
    status.files.push({ name: file, entryCount: entries.length });
    status.totalRows += entries.length;

    for (const entry of entries) {
      if (isInSourceRegistry(entry.sourceId)) {
        status.alreadyInRegistry++;
      } else {
        status.newToRegistry++;
      }
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
        .map(f => path.join(RAWSOURCES_DIR, f));

  if (targetFiles.length === 0 || (fileIdx !== -1 && !existsSync(targetFiles[0]))) {
    console.error('Inga .md-filer hittade i 01-Sources/RawSources/');
    return;
  }

  const allResults: ImportResult[] = [];
  for (const file of targetFiles) {
    const result = importFile(file, dry);
    allResults.push(result);
  }

  // ── Print results ────────────────────────────────────────────────────────
  for (const r of allResults) {
    console.log(`\n─── ${r.file} ───`);
    console.log(`  Rader: ${r.totalRows}`);
    console.log(`  Nya till registry: ${r.newToRegistry}`);
    console.log(`  Redan i registry: ${r.alreadyInRegistry}`);
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
  const totalAdded = allResults.reduce((s, r) => s + r.addedToQueue, 0);
  const totalAlready = allResults.reduce((s, r) => s + r.alreadyInRegistry, 0);
  const totalAlreadyQueue = allResults.reduce((s, r) => s + r.alreadyInQueue, 0);

  console.log(`\n═══ IMPORT SUMMARY ═══`);
  console.log(`  Filer: ${allResults.length}`);
  console.log(`  Nya till registry: ${totalNew}`);
  console.log(`  Redan i registry: ${totalAlready}`);
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
