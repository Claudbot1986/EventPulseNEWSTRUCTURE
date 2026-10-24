#!/usr/bin/env node
/**
 * cleanup-nav-artifact-events.mjs — städa bort navigationsartefakter ur events.
 *
 * Bakgrund (2026-10-24): några sidor har sektioner vars rubrik är en länk
 * ("Biljettinformation", "Platsöversikt Stora salen", "Andra tillfällen",
 * "Om konserten", "Hitta hit", "Läs mer om ..."). C-gatens
 * html-rich-card-extraktion plockar upp dem som om de vore event, och
 * datofältet får ofta konsertens SLUTTID istället för starttid — t.ex.
 * "Wagner och Världen av igår" (start 2026-11-19 19:00, slut 2026-11-21 17:00)
 * födde raden "Andra tillfällen" med start 2026-11-21.
 *
 * Två saker gör detta till data, inte till buggar:
 *   1. Raderna har fel titel (en navigationsrubrik) och fel datum (sluttid).
 *   2. De har en dedup_hash som hör till en annan företrädesdag (identitets-
 *      stöld) — de höll ihop den riktiga raden i databasen.
 *
 * Rätt ställe att fixa:
 *   - NYTT: källans egen uteslutningslista (metadata.ignoreTitles) i
 *     sources/<id>.jsonl — importeraren hoppar över dem. Se
 *     02-Ingestion/lib/sourceTitleExclusions.ts.
 *   - HÄR: städa bort de rader som redan skrevs till databasen.
 *
 * Varför radera och inte bara dölja: `events_public` filtrerar på
 * status='published', men ingenting i koden skriver något annat värde än
 * 'published'. En ny statusklass skulle bli en tyst kategori som varken
 * censusen eller agenten förstår. Raderna är dessutom trasiga till sin
 * natur — de kan inte återskapas korrekt, bara tas bort.
 *
 * Raderna säkerhetskopieras till runtime/nav-artifact-events-backup.jsonl
 * innan de raderas, så att en raderad rad kan återskapas.
 *
 * Användning:
 *   node scripts/cleanup-nav-artifact-events.mjs          # dry-run (default)
 *   node scripts/cleanup-nav-artifact-events.mjs --apply  # radera
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');

dotenv.config({ path: path.join(ROOT, '.env'), override: true, quiet: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const BACKUP_FILE = path.join(ROOT, 'runtime', 'nav-artifact-events-backup.jsonl');

/**
 * Raderna som ska bort. Varje post är bunden till ett BESTÄMT id — inte
 * till en titel — så att en ny extraktion inte kan få fel rad utslag.
 *
 * src = radens ursprungliga extraherade rad (C-gatens artefakt), som
 * dokumenterar VARFÖR raden är trasig.
 */
const TARGETS = [
  {
    id: '1b8d8188-816c-4db3-aa8e-ff8ddaa2bd8c',
    source: 'konserthuset-2',
    title: 'Om konserten',
    start: '2026-10-24',
    why:
      'Navigationsrubrik på den engelska Sibelius-sidan. Konserten var ' +
      '2026-09-12 15:00 (redan passerad); raden bar 2026-10-24.',
  },
  {
    id: '60f5f847-8b95-46d8-8a75-2816bb7d61e5',
    source: 'konserthuset-2',
    title: 'Om konserten',
    start: '2026-11-19',
    why:
      'Navigationsrubrik på Wagner-sidan. Den riktiga företrädesdagen ' +
      '2026-11-19 19:00 finns som "Wagner och Världen av igår" (13de936d). ' +
      'Radens dedup_hash hörde till en annan rad (identitetsstöld).',
  },
  {
    id: '3a1038a4-2896-43e8-aa16-47e64849b590',
    source: 'konserthuset-2',
    title: 'Andra tillfällen',
    start: '2026-11-21',
    why:
      'Navigationsrubrik i sektionen "Andra tillfällen". 2026-11-21 är ' +
      'konsertens SLUTTID ("Sluttid: Ca kl 17.00"), inte ett nytt tillfälle.',
  },
  {
    id: null,
    source: 'konserthuset-2',
    title: 'Läs mer om chefdirigent Ryan Bancroft',
    start: '2026-10-24',
    why:
      'Länkkort till en artikel om en dirigent — inte ett event.',
  },
  {
    id: 'be483f91-e792-43a6-8b35-f4ac5557a53c',
    source: 'wwwsfotose',
    title: 'Hitta hit',
    start: '2026-11-12',
    why:
      'Länkkort till Google Maps ("Hitta hit") på sfoto.se — inte ett event.',
  },
];

async function main() {
  const { data, error } = await supabase
    .from('events')
    .select('id,source,title_sv,start_time,ticket_url,dedup_hash,status,venue_id,category_slug')
    .in('source', [...new Set(TARGETS.map((t) => t.source))]);
  if (error) throw new Error(`select: ${error.message}`);

  /**
   * Hitta raden per (källa, titel, datum) — och kräv att det FÖRSTÅR
   * exakt en träff. Två träffar betyder att målet är tvetydigt, och då
   * raderas ingenting: hellre att stanna än att radera fel rad.
   */
  const resolve = (t) => {
    const hits = (data ?? []).filter(
      (r) =>
        r.source === t.source &&
        r.title_sv === t.title &&
        String(r.start_time ?? '').startsWith(t.start),
    );
    if (hits.length === 1) return { row: hits[0] };
    if (hits.length > 1) return { ambiguous: hits.length };
    return null;
  };

  const resolved = new Map();
  console.log(`\n  Rader som ska städas: ${TARGETS.length}`);
  let planned = 0;
  for (const t of TARGETS) {
    const hit = resolve(t);
    if (!hit) {
      console.log(`  – ${t.source}  "${t.title}"  ${t.start}  (finns inte i DB — hoppas över)`);
      continue;
    }
    if (hit.ambiguous) {
      console.log(`  ! ${t.source}  "${t.title}"  ${t.start}  — ${hit.ambiguous} träffar, tvetydigt, hoppas över`);
      continue;
    }
    resolved.set(t, hit.row);
    planned += 1;
    console.log(`  ✓ ${hit.row.id}  ${t.source}  "${t.title}"  ${hit.row.start_time}`);
    console.log(`      ${t.why}`);
  }

  if (!APPLY) {
    console.log(`\n  [DRY-RUN] ${planned} rader skulle raderas. Kör med --apply för att skriva.`);
    return;
  }

  // Säkerhetskopia först — en raderad rad ska kunna återskapas.
  fs.mkdirSync(path.dirname(BACKUP_FILE), { recursive: true });
  const backupLines = [];
  for (const [t, row] of resolved) {
    backupLines.push(JSON.stringify({ ...row, cleanup_reason: t.why, cleaned_at: new Date().toISOString() }));
  }
  fs.writeFileSync(BACKUP_FILE, backupLines.join('\n') + '\n');
  console.log(`\n  Säkerhetskopia: ${backupLines.length} rader → ${path.relative(ROOT, BACKUP_FILE)}`);

  let deleted = 0;
  for (const [t, row] of resolved) {
    const { error: delErr } = await supabase.from('events').delete().eq('id', row.id);
    if (delErr) {
      console.error(`  ✗ ${row.id}: ${delErr.message}`);
      continue;
    }
    deleted += 1;
    console.log(`  ✗ raderad ${row.id}  ${t.source}  "${t.title}"`);
  }
  console.log(`\n  KLAR  │  ${deleted} rader raderade`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
