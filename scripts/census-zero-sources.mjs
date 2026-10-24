#!/usr/bin/env node
/**
 * census-zero-sources.mjs — vilka AKTIVA källor har noll rader i databasen?
 *
 * Syfte: hitta källor som fastnat. En källa som ger 0 events i Supabase
 * är antingen död (begravs), trasig (fixas), oskannad (körs om genom
 * C-gaten) eller UTREDD OCH TOM (lådan har ingen eventyta — då är 0
 * rader riktigt svar, inte fel).
 *
 * De två sista fallen får inte se likadana ut. En källa med
 * `metadata.audit_status` + `audit_reason` är verifierad tom: auditen
 * står i källfilen med bevis. En källa UTAN sådan audit står i
 * "fastnar"-listan — det är den listan att jobba ifrån.
 *
 * Kör:
 *   node scripts/census-zero-sources.mjs            # skriv ut listan
 *   node scripts/census-zero-sources.mjs --json     # JSON till stdout
 *   node scripts/census-zero-sources.mjs --file <p> # skriv FASTNAR-listan till fil
 *   node scripts/census-zero-sources.mjs --file <p> --file-include-verified
 *                                                    # skriv alla nollradskällor
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
import { classifyZeroRowSource } from './lib/sourceAudit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// quiet: dotenv 17 skriver annars en banner på stdout — den skulle göra
// --json-utdata omparsbar.
dotenv.config({ path: path.join(ROOT, '.env'), override: true, quiet: true });

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const fileIdx = args.indexOf('--file');
const outFile = fileIdx >= 0 ? args[fileIdx + 1] : null;
const sourcesDirIdx = args.indexOf('--sources-dir');
// --sources-dir pekar om registret som läses. Det behövs för negativa
// kontroller: en kopia av sources/ med auditen borttagen ur EN källa måste
// kunna visas som "fastnar" — utan att röra produktionsfilen.
const sourcesDir =
  sourcesDirIdx >= 0 && args[sourcesDirIdx + 1]
    ? path.resolve(ROOT, args[sourcesDirIdx + 1])
    : path.join(ROOT, 'sources');
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
  active.push({
    id: src.id,
    url: src.url,
    name: src.name ?? '',
    city: src.city ?? '',
    metadata: src.metadata ?? {},
  });
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

/**
 * Är källan UTREDD och medvetet tom?
 *
 * Logiken ligger i sourceAudit.mjs så att censusen och dess test delar
 * samma sanning — annars kunde testet bevisa något annat än vad
 * operatören ser.
 */
const zero = active
  .filter((s) => (counts.get(s.id) ?? 0) === 0)
  .map((s) => {
    const { state, audit } = classifyZeroRowSource(s);
    return {
      id: s.id,
      url: s.url,
      name: s.name,
      city: s.city,
      rows: 0,
      state,
      audit,
    };
  });

const stuck = zero.filter((s) => s.state === 'fastnar');
const verifiedEmpty = zero.filter((s) => s.state === 'verifierat-tom');
const withRows = active.length - zero.length;

if (outFile) {
  const list = args.includes('--file-include-verified') ? zero : stuck;
  fs.writeFileSync(outFile, list.map((s) => s.id).join('\n') + '\n', 'utf8');
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        total: active.length,
        withRows,
        zero,
        zeroStuck: stuck.length,
        zeroVerified: verifiedEmpty.length,
        stuck: stuck.map((s) => s.id),
        verifiedEmpty: verifiedEmpty.map((s) => s.id),
        totalRowsInDb: totalRows,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`Aktiva källor: ${active.length}`);
  console.log(`Med rader i databasen: ${withRows}`);
  console.log(`Noll rader: ${zero.length}`);
  console.log(`  fastnar (kräver utredning): ${stuck.length}`);
  console.log(`  verifierat tomma (utredd, ingen åtgärd): ${verifiedEmpty.length}`);
  console.log(`Rader i databasen totalt: ${totalRows} (självkontroll OK)\n`);
  if (stuck.length > 0) {
    console.log('FASTNAR:');
    for (const s of stuck) console.log(`  ${s.id.padEnd(42)} ${s.url}`);
    console.log('');
  }
  if (verifiedEmpty.length > 0) {
    console.log('VERIFIERAT TOMMA:');
    for (const s of verifiedEmpty) {
      console.log(`  ${s.id.padEnd(42)} ${s.audit.status}: ${s.audit.reason}`);
    }
  }
}
