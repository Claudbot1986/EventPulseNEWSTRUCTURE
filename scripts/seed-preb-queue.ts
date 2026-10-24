/**
 * seed-preb-queue.ts — lägg källor i preB-kön så att B- och C-gatet kan köas om.
 *
 * Bakgrund (2026-10-23): en del extraherade filer i
 * 03-Queue/03-extractedevents/ skrevs FÖRE extraktor-fixen för JSON-LD-objektfält
 * och innehåller därför venue/address = '[object Object]' (599 rader i 21
 * källor). De kan inte rättas genom omimport — importen läser filerna som de
 * är — utan genom att köra källorna genom kedjan igen med den fixade
 * extraktorn.
 *
 * Kedjan A → B → C är driven av köfiler:
 *   runtime/preB-queue.jsonl      → B-gatens ingång
 *   runtime/postB-preC-queue.jsonl → C-gatens ingång (B skriver den när en
 *                                    källa INTE gav events i B-spåret)
 *   runtime/postB-queue.jsonl      → samlade B-resultat
 *
 * Kör:
 *   npx tsx scripts/seed-preb-queue.ts --source a,b,c   # bara de angivna
 *   npx tsx scripts/seed-preb-queue.ts --dry             # visa utan att skriva
 *
 * Retired/quarantined-källor hoppas ALLTID över — de ska inte köas igen.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSkippedSourceIds } from '../02-Ingestion/lib/quarantineGuard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREB = path.join(ROOT, 'runtime/preB-queue.jsonl');
const SOURCES_DIR = path.join(ROOT, 'sources');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const sourceIdx = args.indexOf('--source');
const only = new Set(
  sourceIdx >= 0 && args[sourceIdx + 1]
    ? args[sourceIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : [],
);

/** Alla källor som har en definitionsfil i sources/ (C-gatens canonical-källa). */
function listSourceFiles(): string[] {
  if (!existsSync(SOURCES_DIR)) return [];
  const out: string[] = [];
  // sources/ innehåller EN fil per källa. Underkataloger (_retired,
  // _quarantine) är ute ur pipelinen och hoppas över — de hanteras av
  // quarantineGuard.
  for (const name of readdirSync(SOURCES_DIR)) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      const entry = JSON.parse(readFileSync(path.join(SOURCES_DIR, name), 'utf8'));
      if (entry?.id) out.push(entry.id);
    } catch {
      // trasig fil i sources/ — hoppa över den
    }
  }
  return out;
}

const skipped = loadSkippedSourceIds();
const all = listSourceFiles();

const wanted = only.size > 0 ? [...only] : all;
const selected: string[] = [];
const skippedOut: string[] = [];
const missing: string[] = [];

for (const id of wanted) {
  if (skipped.has(id)) {
    skippedOut.push(id);
    continue;
  }
  if (!all.includes(id)) {
    missing.push(id);
    continue;
  }
  selected.push(id);
}

console.log(`källor i sources/: ${all.length}`);
console.log(`valda: ${selected.length}${selected.length ? ` → ${selected.join(', ')}` : ''}`);
if (skippedOut.length) console.log(`begravda/karantän (hoppas över): ${skippedOut.join(', ')}`);
if (missing.length) console.log(`saknar definitionsfil (kan inte köas): ${missing.join(', ')}`);

if (dry) {
  console.log('\n(dry-run — inget skrevs)');
  process.exit(0);
}

// Befintlig kö: behåll de som redan står där, lägg bara till de nya.
const existing: any[] = existsSync(PREB)
  ? readFileSync(PREB, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
  : [];

const byId = new Map(existing.map((e) => [e.sourceId, e]));
const now = new Date().toISOString();
let added = 0;
for (const id of selected) {
  if (byId.has(id)) continue;
  byId.set(id, {
    sourceId: id,
    queueName: 'preB',
    queuedAt: now,
    priority: 2,
    attempt: 1,
    queueReason: 'seed-preb-queue: re-extrahering av källa med artefaktrader',
  });
  added++;
}

const out = [...byId.values()];
writeFileSync(PREB, out.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
console.log(`\npreB-kö: ${out.length} rader (${added} nya, ${existing.length} befintliga)`);
