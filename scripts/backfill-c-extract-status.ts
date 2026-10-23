#!/usr/bin/env node
/**
 * Engångsreparation av de källstatusrader som C-htmlGate skrev fel.
 *
 * Varför (2026-10-23): `run-dynamic-pool.ts` anropte aldrig `updateSourceStatus`,
 * medan `runA.ts` och `runB.ts` gör det. B routar en källa till C med
 * "[breadth] unclear" och sätter då `status=fail`. C extrahterar sedan events
 * från den — men raden i `runtime/sources_status.jsonl` stod kvar som `fail`
 * för alltid. Eftersom `classify-dead-sources.ts`, dashboarden och E5/E6 bygger
 * sina *begravningslistor* på `status=fail`, skulle en begravning ha utplånat
 * källan till de eventen.
 *
 * Evidensen är C-gatets egen output — varje fil i
 * `03-Queue/03-extractedevents/C/<sourceId>.jsonl` är skriven av
 * `routeResult()` efter att C faktiskt extraherat raderna. Vi hävdar ingenting
 * som inte står i en sådan fil.
 *
 * ── Scope (korrigerat 2026-10-23 efter mätning) ────────────────────────────
 * Första versionen av detta skript skrev 108 rader. Mätningen visade att 82 av
 * dem hade varit fel:
 *
 *   • 64 begravda (42 i kyrkograv, 22 i karantän). För dessa är `fail` RÄTT.
 *     `ekero` är `permanentlyRetired` sedan 2026-10-04 (HTTP 000, DNS död) —
 *     att sätta den på `success` hade varit en återväckning.
 *   • 18 ospårade (ingen `sources/<id>.jsonl`): liseberg, malmopera,
 *     kungliga-operan … C-extrafiler från tiden innan scope:n smalnade till
 *     Stockholm. De ägs inte av A/B/C.
 *
 * Kvar blev 26 rader (517 events): spårade, inte begravda, C lyckades
 * extrahera ifrån dem, raden står ändå som fel.
 *
 * Detta är samma scope som E10-gaten i `scripts/verify-fixes.mjs`, så gaten
 * och reparationen kan inte glida isär.
 *
 * Riktningen är alltid åt samma håll: `fail` → `success`. Vi rör aldrig en rad
 * som redan är `success` eller `never_run`, och vi gissar aldrig ett antal —
 * vi tar det antal rader som ligger i filen.
 *
 *   npx tsx scripts/backfill-c-extract-status.ts            # dry-run, skriver inget
 *   npx tsx scripts/backfill-c-extract-status.ts --apply    # skriver
 *
 * Körningen är idempotent: en andra `--apply` efter att C skrivit om raderna
 * hittar inga trasiga rader och säger det.
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { updateSourceStatus } = await import('../02-Ingestion/tools/sourceRegistry.js');

const ROOT = path.resolve(__dirname, '..');
const EXTRACT_DIR = path.join(ROOT, '03-Queue/03-extractedevents/C');
const SOURCES_DIR = path.join(ROOT, 'sources');
const APPLY = process.argv.includes('--apply');

if (!existsSync(EXTRACT_DIR)) {
  console.error(`[backfill] ${EXTRACT_DIR} saknas — inget att göra, och detta är inte ett bevis.`);
  process.exit(2);
}

const files = readdirSync(EXTRACT_DIR).filter((f) => f.endsWith('.jsonl'));
if (files.length === 0) {
  console.error('[backfill] 0 extraherade filer — kan inte mäta något. Ingenting gjort.');
  process.exit(2);
}

// ── Uteslutningskriterier ────────────────────────────────────────────────────
const readIndex = (p: string): { sourceId: string }[] => {
  try { return JSON.parse(readFileSync(path.join(ROOT, p), 'utf8')); } catch { return []; }
};
const buried = new Set([
  ...readIndex('sources/_quarantine/INDEX.json'),
  ...readIndex('sources/_retired/INDEX.json'),
].map((e) => e.sourceId));
const tracked = new Set(readdirSync(SOURCES_DIR)
  .filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, '')));

const rows = readFileSync(path.join(ROOT, 'runtime/sources_status.jsonl'), 'utf8')
  .trim().split('\n')
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);
const latest = new Map<string, Record<string, unknown>>();
for (const r of rows) if (r.sourceId) latest.set(r.sourceId, r);

const fixes: { id: string; events: number; was: string }[] = [];
let skippedBuried = 0, skippedUntracked = 0, skippedOk = 0;
for (const f of files) {
  const id = f.replace(/\.jsonl$/, '');
  const events = readFileSync(path.join(EXTRACT_DIR, f), 'utf8')
    .trim().split('\n').filter((l) => l.trim()).length;
  if (events === 0) continue;
  const cur = latest.get(id);
  if (cur && cur.status === 'success') { skippedOk++; continue; }
  if (buried.has(id)) { skippedBuried++; continue; }
  if (!tracked.has(id)) { skippedUntracked++; continue; }
  // Ingen rad alls → updateSourceStatus skapar en, så den räknas också som trasig.
  fixes.push({ id, events, was: cur ? String(cur.status) : '(ingen rad)' });
}

console.log(`[backfill] ${files.length} C-extraherade filer.`);
console.log(`[backfill]   redan success      : ${skippedOk}`);
console.log(`[backfill]   hoppas över begravd : ${skippedBuried}  (status=fail är korrekt där)`);
console.log(`[backfill]   hoppas över ospårad : ${skippedUntracked}  (ingen sources/-fil, ägs inte av A/B/C)`);
console.log(`[backfill]   trasiga att rätta   : ${fixes.length}`);

if (fixes.length === 0) {
  console.log('[backfill] inget att göra — varje spårad, obegravd C-källa står redan som success.');
  process.exit(0);
}

if (!APPLY) {
  const withEvents = fixes.reduce((s, f) => s + f.events, 0);
  console.log(`[backfill] DRY-RUN — ${fixes.length}/${tracked.size} spårade källor skulle rättas, ${withEvents} events.`);
  fixes.forEach((f) => console.log(`  ${f.id.padEnd(44)} ${String(f.events).padStart(4)} ev  (nu: ${f.was})`));
  console.log('[backfill] inget skrivet. Kör om med --apply för att skriva.');
  process.exit(0);
}

for (const f of fixes) {
  // Exakt samma anrop som C-gatets fix i routeResult().
  updateSourceStatus(f.id, {
    success: true,
    eventsFound: f.events,
    pathUsed: 'html',
    ingestionStage: 'completed',
    lastRoutingReason: `C-htmlGate(backfill): ${f.events} events`,
    lastRoutingSource: 'runtime_status',
  });
}
const total = fixes.reduce((s, f) => s + f.events, 0);
console.log(`[backfill] KLART — ${fixes.length} källor rättade till success, ${total} events bokförda.`);