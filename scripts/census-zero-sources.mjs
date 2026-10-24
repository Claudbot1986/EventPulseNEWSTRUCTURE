#!/usr/bin/env node
/**
 * census-zero-sources.mjs — vilka AKTIVA källor har noll rader i databasen?
 *
 * Syfte: hitta källor som fastnat. En källa som ger 0 events i Supabase
 * är antingen död (begravs), trasig (fixas) eller oskannad (körs om genom
 * C-gaten). Censusen är listan att jobba ifrån — inte en gissning.
 *
 * Kör:
 *   node scripts/census-zero-sources.mjs            # skriv ut listan
 *   node scripts/census-zero-sources.mjs --json     # JSON till stdout
 *   node scripts/census-zero-sources.mjs --file <p> # skriv listan till fil
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
// quiet: dotenv 17 skriver annars en banner på stdout — den skulle göra
// --json-utdata omparsbar.
dotenv.config({ path: path.join(ROOT, '.env'), override: true, quiet: true });

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const fileIdx = args.indexOf('--file');
const outFile = fileIdx >= 0 ? args[fileIdx + 1] : null;

// ---------------------------------------------------------------------------
// 1. Aktiva källor ur registret
// ---------------------------------------------------------------------------

const sourcesDir = path.join(ROOT, 'sources');
const active = [];
for (const file of fs.readdirSync(sourcesDir).sort()) {
  if (!file.endsWith('.jsonl')) continue;
  if (!file.includes('.')) continue;
  let src;
  try {
    src = JSON.parse(fs.readFileSync(path.join(sourcesDir, file), 'utf8').split('\n')[0]);
  } catch {
    continue;
  }
  if (!src?.url || !src?.id) continue;
  active.push({ id: src.id, url: src.url, name: src.name ?? '', city: src.city ?? '' });
}

// ---------------------------------------------------------------------------
// 2. Radantal i Supabase per källa
// ---------------------------------------------------------------------------

const url = args.find((a) => a.startsWith('--db-url='))?.slice('--db-url='.length) ?? process.env.SUPABASE_URL;
const key = args.find((a) => a.startsWith('--db-key='))?.slice('--db-key='.length) ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas i .env');
  process.exit(2);
}
const sb = createClient(url, key);

// PostgREST kapar svar på 1000 rader. En chunkad .in('source', [...])-fråga
// tappade därför alla rader efter rad 1000 — källor som låg sent i databasen
// räknades som nollraderade trots att de hade events. Vi läser ALLA rader
// med paging i stället.
//
// Ordning är INTE valfri: utan .order() kan PostgREST returnera samma rad
// två gånger på olika sidor och hoppa över en annan. Antalet rader stämmer
// då fortfarande — bara fördelningen per källa blir fel. Därför ordnas på
// id (primärnyckel, stabil).
const counts = new Map();
const PAGE = 1000;
let totalRows = 0;
for (let offset = 0; ; offset += PAGE) {
  const { data, error } = await sb
    .from('events')
    .select('source')
    .order('id', { ascending: true })
    .range(offset, offset + PAGE - 1);
  if (error) {
    console.error('DB-fel:', error.message);
    process.exit(2);
  }
  for (const row of data ?? []) {
    counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
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
      'Censusen är opålitlig och avbryts.',
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 3. Rapportera
// ---------------------------------------------------------------------------

const zero = active
  .filter((s) => (counts.get(s.id) ?? 0) === 0)
  .map((s) => ({ ...s, rows: 0 }));

const withRows = active.length - zero.length;

if (outFile) {
  fs.writeFileSync(outFile, zero.map((s) => s.id).join('\n') + '\n', 'utf8');
}

if (asJson) {
  console.log(JSON.stringify({ total: active.length, withRows, zero, totalRowsInDb: totalRows }, null, 2));
} else {
  console.log(`Aktiva källor: ${active.length}`);
  console.log(`Med rader i databasen: ${withRows}`);
  console.log(`Noll rader: ${zero.length}`);
  console.log(`Rader i databasen totalt: ${totalRows} (självkontroll OK)\n`);
  for (const s of zero) console.log(`  ${s.id.padEnd(42)} ${s.url}`);
}
