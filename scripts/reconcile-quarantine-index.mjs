#!/usr/bin/env node
/**
 * reconcile-quarantine-index.mjs — städa bort stale rader i
 * sources/_quarantine/INDEX.json.
 *
 * Bakgrund (2026-10-24). `quarantineGuard.isSkipped()` (den enda källan
 * till sanning för "vilka källor ska inte bearbetas") läser INDEX-filen.
 * Men 18 källor har en INDEX-rad som säger "karantän" samtidigt som
 * källfilen ligger i `sources/` — de återställdes 2026-10-04 utan att
 * indexet uppdaterades (`recoveredAt: 2026-10-04` i källfilen).
 *
 * Följden: A-gaten (runA.ts:651) och C-gaten (run-dynamic-pool.ts:1569)
 * hoppar över dem. De är osynliga för hela pipelinen trots att filen finns
 * på plats. Bland dem: kth, nationalmuseum, fotografiska, globen-2.
 *
 * En källa är KARANTÄN om och endast om dess fil ligger i
 * `sources/_quarantine/`. En INDEX-rad utan fil där är stale.
 *
 * Skriptet är idempotent och rör ingen fil — bara indexet.
 *
 * Användning:
 *   node scripts/reconcile-quarantine-index.mjs --dry-run
 *   node scripts/reconcile-quarantine-index.mjs --apply
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCES_DIR = path.join(ROOT, 'sources');
const QUARANTINE_DIR = path.join(SOURCES_DIR, '_quarantine');
const INDEX = path.join(QUARANTINE_DIR, 'INDEX.json');

const mode = process.argv.includes('--apply') ? 'apply' : 'dry-run';

if (!existsSync(INDEX)) {
  console.error(`quarantine-index saknas: ${INDEX}`);
  process.exit(1);
}

const entries = JSON.parse(readFileSync(INDEX, 'utf8'));
if (!Array.isArray(entries)) {
  console.error('quarantine-index har oväntat format (förväntas en array)');
  process.exit(1);
}

const stale = [];
const kept = [];
for (const e of entries) {
  const id = e?.sourceId;
  const fileInQuarantine = id && existsSync(path.join(QUARANTINE_DIR, `${id}.jsonl`));
  const fileInSources = id && existsSync(path.join(SOURCES_DIR, `${id}.jsonl`));
  if (fileInSources && !fileInQuarantine) stale.push(e);
  else kept.push(e);
}

console.log(`INDEX: ${entries.length} rader — ${stale.length} stale, ${kept.length} giltiga`);

if (stale.length === 0) {
  console.log('Inget att städa.');
  process.exit(0);
}

for (const e of stale) {
  const src = path.join(SOURCES_DIR, `${e.sourceId}.jsonl`);
  const reason = e.reasonCode ?? 'okänd';
  console.log(`  stale: ${e.sourceId.padEnd(26)} filen ligger i sources/ (index: ${reason})`);
}

if (mode === 'dry-run') {
  console.log('\n[DRY-RUN] inget skrivet. Kör med --apply för att städa.');
  process.exit(0);
}

// Skriv atomärt: tmp + rename (samma mönster som lifecycle-admin.ts).
const tmp = `${INDEX}.tmp.${process.pid}`;
writeFileSync(tmp, JSON.stringify(kept, null, 2) + '\n', 'utf8');
renameSync(tmp, INDEX);
console.log(`\nStädade ${stale.length} stale rader. INDEX har nu ${kept.length} rader.`);
