#!/usr/bin/env node
/**
 * restore-source-metadata.mjs — återställ en källas metadata från en arkivfil.
 *
 * Bakgrund (2026-10-24). `sources/*.jsonl` har flera producenter, och de
 * skriver ibland över varandra. 2026-10-04 skrev description-URL-mining
 * över `sources/billetto-stockholm.jsonl` och tappade:
 *
 *   - `type: 'aggregator-listing'`
 *   - `preferredPath: 'render'`
 *   - `metadata.categoryUrls` (20 fasta Stockholms-kategorier)
 *   - `metadata.extractionMethod` (two-stage-render)
 *
 * Utan dem kan D-gatens tvåstegs-listingkörning inte köras ("Source
 * billetto-stockholm has no metadata.categoryUrls"), och källan hamnade i
 * C-gatens manual-review i stället för D-gaten.
 *
 * Originalet finns kvar i `sources/_archive/2026-08-19-cleanup/`. Detta
 * skript slår ihop arkivets metadata in i den AKTIVA källfilen — url:en
 * behålls som den är (den kan ha blivit rättad sedan), bara metadata och
 * de toppnivå-fält som explicitly anges kopieras.
 *
 * Skriver ingen databasrad. Använder sourceRegistry.updateSourceMetadata()
 * — samma kodväg som updateSourceUrl().
 *
 * Användning:
 *   npx tsx scripts/restore-source-metadata.mjs <sourceId> --from <arkiv.jsonl> [--yes]
 *
 *   --yes   skriv utan bekräftelse (testkörning)
 */

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const skipConfirm = args.includes('--yes');
const fromIdx = args.indexOf('--from');
const fromPath = fromIdx >= 0 ? args[fromIdx + 1] : null;
// `--from <värde>` — värdet är inte en positionell argument.
const positional = args.filter(
  (a, i) => !a.startsWith('--') && i !== fromIdx + 1,
);

if (positional.length !== 1 || !fromPath) {
  console.error(
    'usage: npx tsx scripts/restore-source-metadata.mjs <sourceId> --from <arkiv.jsonl> [--yes]',
  );
  process.exit(1);
}

const [sourceId] = positional;
const archivePath = path.isAbsolute(fromPath)
  ? fromPath
  : path.join(ROOT, fromPath);

if (!existsSync(archivePath)) {
  console.error(`fel: arkivfilen finns inte: ${archivePath}`);
  process.exit(1);
}

const { getSource, updateSourceMetadata } = await import(
  path.join(ROOT, '02-Ingestion/tools/sourceRegistry.ts')
);

const source = getSource(sourceId);
if (!source) {
  console.error(`fel: källan "${sourceId}" finns inte i sources/`);
  process.exit(1);
}

let archived;
try {
  const raw = readFileSync(archivePath, 'utf8').trim();
  archived = JSON.parse(raw.split('\n')[0]);
} catch (err) {
  console.error(
    `fel: kunde inte läsa arkivfilen — ${err instanceof Error ? err.message : err}`,
  );
  process.exit(1);
}

if (archived.id !== sourceId) {
  console.error(
    `fel: arkivfilen tillhör "${archived.id}", inte "${sourceId}" — skrev inte.`,
  );
  process.exit(1);
}

// Endast dessa toppnivå-fält kopieras. `url` kopieras INTE — den kan ha
// blivit rättad sedan arkivet skrevs, och det är den aktiva sanningen.
const TOP_LEVEL_FIELDS = ['type', 'preferredPath', 'preferredPathReason', 'currentQueue'];
const patch = {};
for (const field of TOP_LEVEL_FIELDS) {
  if (archived[field] !== undefined) patch[field] = archived[field];
}
if (archived.metadata && typeof archived.metadata === 'object') {
  patch.metadata = archived.metadata;
}

if (Object.keys(patch).length === 0) {
  console.error('fel: arkivfilen har inga metadata att återställa');
  process.exit(1);
}

console.log(`källa:   ${sourceId}`);
console.log(`arkiv:   ${archivePath}`);
console.log(`url:     behålls som ${source.url}`);
console.log('');
console.log('fält som återställs:');
for (const field of TOP_LEVEL_FIELDS) {
  if (patch[field] !== undefined) {
    console.log(`  ${field}: ${JSON.stringify(source[field])} → ${JSON.stringify(patch[field])}`);
  }
}
if (patch.metadata) {
  const before = source.metadata ?? {};
  const added = Object.keys(patch.metadata).filter((k) => !(k in before));
  const changed = Object.keys(patch.metadata).filter(
    (k) => k in before && JSON.stringify(before[k]) !== JSON.stringify(patch.metadata[k]),
  );
  console.log(`  metadata: +${added.length} nya nycklar, ${changed.length} ändrade`);
  for (const key of added) console.log(`    + ${key}`);
  for (const key of changed) console.log(`    ~ ${key}`);
}

if (!skipConfirm) {
  console.error('\nAvbruten — kör med --yes för att skriva.');
  process.exit(1);
}

const ok = updateSourceMetadata(sourceId, patch);
if (!ok) {
  console.error('fel: updateSourceMetadata misslyckades');
  process.exit(1);
}
console.log(`\nOK: ${sourceId} har fått tillbaka metadata.`);
