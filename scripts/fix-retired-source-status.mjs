/**
 * Rättar sources_status-rader för källor som är begravda (retired) eller
 * i karantän.
 *
 * Bakgrund (2026-10-23): B-gatet rapporterade "N events" för 74 källor utan
 * databasrader. 47 av dem kördes om och gav ärligt 0 events. 27 var redan
 * begravda — men deras statusrad stod kvar som "success, network, N events",
 * vilket gjorde att dashboarden räknade dem som lyckade källor.
 *
 * En begravd källa är inte "success" — den är ute ur pipelinen. Raden ska
 * säga det, så att siffrorna i dashboarden stämmer.
 *
 * Kör: node scripts/fix-retired-source-status.mjs [--dry]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATUS = path.join(ROOT, 'runtime/sources_status.jsonl');
const dry = process.argv.includes('--dry');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function readIdx(file) {
  if (!existsSync(file)) return new Map();
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  return new Map(rows.map((r) => [r.sourceId, r]));
}

const retired = readIdx(path.join(ROOT, 'sources/_retired/INDEX.json'));
const quarantined = readIdx(path.join(ROOT, 'sources/_quarantine/INDEX.json'));

if (!existsSync(STATUS)) {
  console.error('SAKNAS: runtime/sources_status.jsonl');
  process.exit(1);
}

const lines = readFileSync(STATUS, 'utf8').split('\n').filter((l) => l.trim());
const rows = lines.map((l) => JSON.parse(l));

// Kandidater: begravda/karantänkällor vars statusrad påstår en lyckad
// körning med events.
const candidates = rows.filter((r) => {
  const bucket = retired.has(r.sourceId) ? 'retired' : quarantined.has(r.sourceId) ? 'quarantined' : null;
  return bucket && r.status === 'success' && (r.lastEventsFound ?? 0) > 0;
});

// Räkna faktiska DB-rader per källa — en rad som påstår events som INTE
// finns i databasen är den som är falsk. En rad som påstår events som
// FAKTISKT finns är historiskt korrekt och ska lämnas i fred.
const dbCounts = new Map();
if (candidates.length > 0) {
  const ids = candidates.map((r) => r.sourceId);
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from('events')
      .select('source')
      .in('source', ids.slice(i, i + 100));
    if (error) {
      console.error('DB-fel:', error.message);
      process.exit(1);
    }
    for (const row of data ?? []) {
      dbCounts.set(row.source, (dbCounts.get(row.source) ?? 0) + 1);
    }
  }
}

let fixed = 0;
let kept = 0;
const changed = [];
for (const r of candidates) {
  const ret = retired.get(r.sourceId);
  const qua = quarantined.get(r.sourceId);
  const bucket = ret ? 'retired' : 'quarantined';
  const entry = ret ?? qua;
  const reason = entry.note || entry.reasonCode || 'ingen orsak angiven';

  if ((dbCounts.get(r.sourceId) ?? 0) > 0) {
    // Påståendet stämmer — källan producerade verkligen events.
    kept += 1;
    continue;
  }

  const claimed = r.lastEventsFound;
  r.status = 'fail';
  r.lastEventsFound = 0;
  r.lastError = `${bucket}: ${reason}`;
  r.lastRoutingReason = `${bucket}: ${reason} — källan är ute ur pipelinen`;
  r.lastRoutingSource = 'runtime_status';
  r.pendingNextTool = undefined;
  r.ingestionStage = 'failed';
  fixed += 1;
  changed.push(`${r.sourceId} (${bucket}, påstådde ${claimed})`);
}

console.log(`Retired: ${retired.size}, quarantined: ${quarantined.size}`);
console.log(`Påstådda "success"-rader bland begravda: ${candidates.length}`);
console.log(`  falska (inga DB-rader) → rättas:      ${fixed}`);
console.log(`  sanna (DB-rader finns) → lämnas:      ${kept}`);

if (dry) {
  console.log('\nDRY RUN — inget skrivs.');
  for (const c of changed) console.log('  ' + c);
  process.exit(0);
}

writeFileSync(STATUS, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
console.log(`\nSkrev ${rows.length} rader till runtime/sources_status.jsonl`);
for (const c of changed) console.log('  ' + c);
