#!/usr/bin/env node
/**
 * reconcile-source-status.mjs — rätta källstatus mot databasens sanna siffra.
 *
 * PROBLEMET (2026-10-24). En källa kan ha tusentals events i Supabase och
 * ändå stå som 'fail' eller 'routed' i runtime/sources_status.jsonl.
 * Mätt i dag: 22 av 24 "noll-event-källor" hade 5 327 / 3 495 / 797 / 513 /
 * 298 … rader i databasen. Statusen ljög.
 *
 * Varför den ljög: specialimportscripten (ingest-livespot-stockholm.mjs,
 * ingest-momentsapp, ingest-spelning, ingest-stampen, ingest-dn-kalendariet …)
 * persisterar events direkt till Supabase men SKRIVER ALDRIG källstatus.
 * A-gatens HTML-försök misslyckas för samma källa (den har ju ingen HTML att
 * hämta) → status 'fail' → dashboarden och begravningslistorna ser en död
 * källa. Källan lever. Data finns. Statusen är falsk.
 *
 * Varför det är farligt: bury-listorna (classify-dead-sources, E5/E6/E10)
 * byggs på status. En källa som råkar ligga i fel kön kan begravas med
 * tusentals events i databasen.
 *
 * VAD DETTA SCRIPT GÖR. Jämför varje AKTIV källas status mot antalet rader
 * i Supabase. Har källan rader men status är inte 'success' → rättas:
 *
 *   status              → 'success'
 *   lastEventsFound     → antalet rader i databasen
 *   consecutiveFailures → 0
 *   lastSuccess         → nyaste radens created_at (sann tid, inte "nu")
 *   ingestionStage      → 'completed'
 *   pendingNextTool     → rensas (källan väntar på inget)
 *
 * VAD DET INTE GÖR:
 *   - rör INTE källor i karantän eller begravda (de ägs av
 *     fix-retired-source-status.mjs — en begravd källa är inte 'success')
 *   - rör INTE källor med 0 rader i databasen (där är statusen sann — de
 *     behöver orsaksutredning, inte bokföring)
 *   - hittar inte upp nya events, bara rättar det som redan finns
 *
 * Kör:
 *   node scripts/reconcile-source-status.mjs           # rätta
 *   node scripts/reconcile-source-status.mjs --dry     # visa, rätta inte
 *   node scripts/reconcile-source-status.mjs --check   # gate: avsluta 1 vid drift
 *
 *   --db-url=<u> --db-key=<k>   # tvinga en specifik DB-anslutning.
 *   Behövs för negativa kontroller: dotenv laddas med override:true, så
 *   miljövariabler sätta utifrån skrivs över av .env — flaggorna går förbi
 *   det och kan därför peka på en trasig DB.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), override: true, quiet: true });

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const check = args.includes('--check');

const STATUS_FILE = path.join(ROOT, 'runtime', 'sources_status.jsonl');
const SOURCES_DIR = path.join(ROOT, 'sources');
const QUARANTINE_DIR = path.join(SOURCES_DIR, '_quarantine');

// ---------------------------------------------------------------------------
// 1. Aktiva källor (ur sources/, utan karantän)
// ---------------------------------------------------------------------------

function readActiveSources() {
  const active = new Set();
  for (const file of fs.readdirSync(SOURCES_DIR)) {
    if (!file.endsWith('.jsonl')) continue;     // t.ex. _archive/, _retired/
    if (!file.includes('.')) continue;          // samma filter som censusen
    if (file.startsWith('_')) continue;         // _index.jsonl m.fl.
    active.add(file.slice(0, -'.jsonl'.length));
  }
  return active;
}

function isQuarantined(sourceId) {
  return fs.existsSync(path.join(QUARANTINE_DIR, `${sourceId}.jsonl`));
}

// ---------------------------------------------------------------------------
// 2. Radantal i Supabase per källa
// ---------------------------------------------------------------------------

const url =
  args.find((a) => a.startsWith('--db-url='))?.slice('--db-url='.length) ??
  process.env.SUPABASE_URL;
const key =
  args.find((a) => a.startsWith('--db-key='))?.slice('--db-key='.length) ??
  process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas i .env');
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// PostgREST kapar svar på 1000 rader — läser ALLA rader med paging.
// Ordning är INTE valfri: utan .order('id') kan PostgREST returnera samma rad
// två gånger på olika sidor och hoppa över en annan. Antalet rader stämmer
// då fortfarande — bara fördelningen per källa blir fel.
const counts = new Map();
const newest = new Map();
const PAGE = 1000;
let totalRows = 0;
for (let offset = 0; ; offset += PAGE) {
  const { data, error } = await sb
    .from('events')
    .select('source, created_at')
    .order('id', { ascending: true })
    .range(offset, offset + PAGE - 1);
  if (error) {
    console.error('DB-fel:', error.message);
    process.exit(2);
  }
  for (const row of data ?? []) {
    if (!row.source) continue;
    counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
    const created = row.created_at;
    if (created && (!newest.has(row.source) || created > newest.get(row.source))) {
      newest.set(row.source, created);
    }
  }
  totalRows += (data ?? []).length;
  if ((data ?? []).length < PAGE) break;
}

// Självkontroll: antalet rader vi läst måste vara lika med databasens egna
// count(). Utan den kunde en kapad fråga få oss att rapportera fel.
const { count: exactTotal, error: countError } = await sb
  .from('events')
  .select('*', { count: 'exact', head: true });
if (countError) {
  console.error('DB-fel vid count:', countError.message);
  process.exit(2);
}
if (exactTotal !== totalRows) {
  console.error(
    `Självkontroll misslyckades: läste ${totalRows} rader men databasen har ${exactTotal}. ` +
      'Avstämningen är opålitlig och avbryts.',
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 3. Läs statusfilen (sista raden per sourceId vinner — samma som registret)
// ---------------------------------------------------------------------------

function readStatusRows() {
  const map = new Map();
  if (!fs.existsSync(STATUS_FILE)) return map;
  for (const line of fs.readFileSync(STATUS_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row?.sourceId) map.set(row.sourceId, row);
    } catch {}
  }
  return map;
}

const statuses = readStatusRows();
const active = readActiveSources();

// ---------------------------------------------------------------------------
// 4. Avstämning
// ---------------------------------------------------------------------------

const repairs = [];
const skippedQuarantine = [];
const skippedZero = [];

for (const [sourceId, row] of statuses) {
  if (!active.has(sourceId)) continue;          // historisk/begravd — ägs av annat verktyg
  if (isQuarantined(sourceId)) {
    skippedQuarantine.push(sourceId);
    continue;
  }
  const dbRows = counts.get(sourceId) ?? 0;
  if (dbRows === 0) {
    skippedZero.push(sourceId);
    continue;                                   // noll i DB = sant noll, orsaksutredning
  }
  if (row.status === 'success') continue;       // redan rätt

  const when = newest.get(sourceId) ?? null;
  repairs.push({
    sourceId,
    from: row.status,
    dbRows,
    when,
    row,
  });
}

console.log(`Aktiva källor:            ${active.size}`);
console.log(`Rader i databasen:        ${totalRows} (självkontroll OK)`);
console.log(`Statusrader:              ${statuses.size}`);
console.log(`Rättas (har rader, ej success): ${repairs.length}`);
console.log(`Karantän (ägs av annat verktyg): ${skippedQuarantine.length}`);
console.log(`Noll i DB (orsaksutredning):     ${skippedZero.length}`);

if (repairs.length) {
  console.log('\n─── rättas ───');
  for (const r of repairs) {
    console.log(
      `  ${r.sourceId.padEnd(34)} ${r.from.padEnd(8)} → success   ${String(r.dbRows).padStart(6)} rader   senast ${(r.when ?? '?').slice(0, 19)}`,
    );
  }
}

if (check) {
  // Gate-läge: avsluta 1 om något behöver rättas.
  process.exit(repairs.length > 0 ? 1 : 0);
}

if (dry) {
  console.log('\n(--dry: inga ändringar skrivna)');
  process.exit(0);
}

if (repairs.length === 0) {
  console.log('\nInget att rätta.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 5. Skriv — med backup
// ---------------------------------------------------------------------------

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(ROOT, 'runtime', `sources_status.backup-${stamp}.jsonl`);
fs.copyFileSync(STATUS_FILE, backup);
console.log(`\nBackup: ${path.relative(ROOT, backup)}`);

const now = new Date().toISOString();
for (const r of repairs) {
  const row = r.row;
  row.status = 'success';
  row.lastEventsFound = r.dbRows;
  row.consecutiveFailures = 0;
  row.lastSuccess = r.when ?? row.lastSuccess ?? now;
  row.ingestionStage = 'completed';
  row.lastError = undefined;
  row.pendingNextTool = undefined;
  row.routingReviewReason = undefined;
  const note =
    `reconcilerad ${now}: ${r.dbRows} rader i databasen` +
    (r.when ? ` (senast ${r.when})` : '') +
    ` — tidigare status ${r.from}`;
  row.lastRoutingReason = row.lastRoutingReason
    ? `${row.lastRoutingReason} | ${note}`
    : note;
}

const lines = [];
for (const row of statuses.values()) lines.push(JSON.stringify(row));
fs.writeFileSync(STATUS_FILE, lines.join('\n') + '\n', 'utf8');
console.log(`Skrev ${statuses.size} rader till ${path.relative(ROOT, STATUS_FILE)}`);
console.log(`Rättade ${repairs.length} källor.`);
