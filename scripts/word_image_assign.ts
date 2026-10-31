#!/usr/bin/env tsx
/**
 * scripts/word_image_assign.ts — tildela ordbilder till events.
 *
 * Steg:
 *   1. Läs de genererade ordbilderna (local_image_library_stamped_v2/word/*.webp
 *      + sidecar .json). Endast bilder med verified_ok=true används.
 *   2. Ladda upp dem till Supabase Storage (event-posters/import-stamped/word/).
 *   3. Registrera i image_library med category_slug = 'word' — en reserverad
 *      pseudo-kategori som INGEN riktig event har. Det håller ordbilderna
 *      ute från både generiska fallback-poolerna (nullDefaultImage /
 *      genericFallbackImage) och från kategori-matchningen, så de bara
 *      används där de faktiskt hör hemma: på event vars TITEL innehåller
 *      ordet.
 *   4. Tilldela: för varje event vars titel innehåller ordet sätts
 *      events.image_url till just den bilden. Detta är test 3 —
 *      "är rätt titel matchad med rätt bild i UI".
 *
 * Titelmatchning (test 1, generaliserat):
 *   - ordet förekommer som helt ord i titeln, ELLER
 *   - ordet förekommer som del av ett sammansatt ord ("bastu" i "Dambastu")
 *   Vid flera träffar vinner det LÄNGSTA ordet (mest specifikt).
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/word_image_assign.ts --dry-run
 *   node --env-file=.env --import tsx scripts/word_image_assign.ts --apply
 *   node --env-file=.env --import tsx scripts/word_image_assign.ts --word=bastu --apply
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { verdictPasses } from './lib/word-image-verdict.js';
import { buildWordIndex, matchKeysInTitle, matchForms as matchFormsOf, storageFileName } from './lib/word-image-match.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORD_DIR = path.join(PROJECT_ROOT, 'local_image_library_stamped_v2', 'word');
const INVENTORY_CSV = path.join(PROJECT_ROOT, 'docs', 'audit', 'data', 'huvudattraktioner-2026-10-31-ord-inventering.csv');
const OUT_CSV = path.join(PROJECT_ROOT, 'runtime', 'word-image-gen', 'assignment.csv');

const BUCKET = 'event-posters';
const STORAGE_PREFIX = 'import-stamped';
const WORD_CATEGORY = 'word';

const IS_APPLY = process.argv.includes('--apply');
const wordArg = (() => {
  const a = process.argv.find((x) => x.startsWith('--word='));
  return a ? a.slice('--word='.length).trim().toLowerCase() : '';
})();

function env(name: string): string | undefined {
  const raw = process.env[name];
  if (raw) return raw;
  try {
    const m = readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
  } catch { return undefined; }
}

const SB_URL = env('SUPABASE_URL') ?? env('EXPO_PUBLIC_SUPABASE_URL');
const SB_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
if (!SB_URL || !SB_KEY) { console.error('SUPABASE_URL/SERVICE_ROLE_KEY saknas'); process.exit(2); }
const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ── CSV-läsning ──────────────────────────────────────────────────────────
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0];
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    head.forEach((h, i) => { o[h] = r[i] ?? ''; });
    return o;
  });
}

// ── Ord → bild ───────────────────────────────────────────────────────────
interface WordImage {
  ord: string;
  key: string;
  file: string;
  buffer: Buffer;
  prompt: string;
  model: string;
  meaning: string;
  passes: boolean;
  verified: boolean;
  appropriate: boolean;
  text_ok: boolean;
  no_foreground_face: boolean;
  shows: string;
  stam: string;
}

function loadWordImages(): WordImage[] {
  if (!existsSync(WORD_DIR)) { console.error(`Saknar ${WORD_DIR}`); process.exit(2); }
  const out: WordImage[] = [];
  for (const f of readdirSync(WORD_DIR).filter((x) => x.endsWith('.webp'))) {
    const sidecar = path.join(WORD_DIR, `${f}.json`);
    if (!existsSync(sidecar)) continue;
    const j = JSON.parse(readFileSync(sidecar, 'utf8'));
    // Filen kan ha flyttats till karantän mellan ls och läs (generatorn kör
    // parallellt) → hoppa över den i stället för att krascha.
    let buffer: Buffer;
    try {
      buffer = readFileSync(path.join(WORD_DIR, f));
    } catch {
      continue;
    }
    out.push({
      ord: j.ord,
      key: j.image_key ?? f.split('__')[0],
      file: path.join(WORD_DIR, f),
      buffer,
      prompt: j.prompt ?? '',
      model: j.model ?? 'image-01',
      meaning: j.meaning ?? '',
      // EN sanning: samma pass-logik som gaten (match + lämplig + ingen text
      // + inget ansikte i förgrunden).
      passes: verdictPasses(j.verify ?? null),
      verified: j.verified_match === true,
      appropriate: j.verified_appropriate === true,
      text_ok: (j.verified_text ?? 'none') === 'none',
      no_foreground_face: j.verified_foreground_face === false,
      shows: j.verify?.shows ?? '',
      stam: j.stam ?? '',
    });
  }
  return out;
}

/** Ordformer som ska matcha samma bild (nyckel + ordform) — se lib/word-image-match.ts. */
function matchForms(img: WordImage): string[] {
  return matchFormsOf(img.key, img.ord);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const images = loadWordImages();
  // Bara bilder som klarar HELA gaten får användas: matchar ordet, är lämpliga,
  // saknar text och saknar ansikte i förgrunden.
  const usable = images.filter((i) => i.passes);
  console.log(`[assign] ordbilder på disk: ${images.length} (verifierade + lämpliga: ${usable.length})`);
  if (!usable.length) { console.log('[assign] inget att tilldela'); return; }

  // Ord-inventeringen (bara innehållsord) — används för att veta vilka ord
  // som över huvud taget är giltiga för bildgenerering.
  const invRows = existsSync(INVENTORY_CSV) ? parseCsv(readFileSync(INVENTORY_CSV, 'utf8')) : [];
  const inventoryWords = new Set(invRows.map((r) => (r.ord ?? '').toLowerCase()).filter(Boolean));
  // Ordlistan är facit: varje ord -> dess bildnyckel (stam + beständ form).
  const wordIndex = buildWordIndex(invRows.map((r) => ({ ord: r.ord ?? '', stam: r.stam ?? '' })));

  // Ord med en verifierad bild, filtrerat på ordfilen.
  let candidates = usable;
  if (wordArg) {
    candidates = usable.filter((i) => i.ord.toLowerCase() === wordArg || i.key === wordArg);
    if (!candidates.length) { console.error(`Ingen verifierad bild för "${wordArg}"`); process.exit(2); }
  }
  const wordList = candidates.map((c) => c.ord.toLowerCase());
  const inInventory = wordList.filter((w) => inventoryWords.has(w));
  console.log(`[assign] ord i inventeringen: ${inInventory.length}/${wordList.length} ` +
    `${inInventory.length < wordList.length ? `(icke-inventerade: ${wordList.filter((w) => !inventoryWords.has(w)).join(', ')})` : ''}`);

  // 1) Ladda upp + registrera
  const byKey = new Map<string, { storage_path: string; public_url: string }>();
  for (const img of candidates) {
    // VIKTIGT: Supabase-JS tar sökvägen INOM bunken — "import-stamped/word/x.webp".
    // DB-kolumnen image_library.storage_path däremot är "event-posters/import-stamped/word/x.webp"
    // (med bunknamnet), och det är den som public_url byggs från.
    // (Blandar man ihop ger uppladdningen HTTP 400 på alla public-URL:er.)
    //
    // Filnamnet måste vara ASCII: Storage avvisar "handarbetscafé__086.webp"
    // med "Invalid key" (212 av 896 bilder hade å/ä/ö/é). Se
    // storageSafeName() i lib/word-image-match.ts — ASCII-vikning + kort hash
    // av originalnyckeln (annars slår "cafe"/"café" ihop).
    const fileName = storageFileName(img.key);
    const relPath = `${STORAGE_PREFIX}/${WORD_CATEGORY}/${fileName}`;
    const uploadPath = relPath;
    const storagePath = `${BUCKET}/${relPath}`;
    const publicUrl = `${SB_URL}/storage/v1/object/public/${storagePath}`;
    byKey.set(img.key, { storage_path: storagePath, public_url: publicUrl });

    if (IS_APPLY) {
      const { error: upErr } = await db.storage.from(BUCKET).upload(uploadPath, img.buffer, {
        contentType: 'image/webp', upsert: true,
      });
      if (upErr) { console.log(`  [upload-fel] ${img.ord}: ${upErr.message}`); continue; }

      const { error: libErr } = await db.from('image_library').upsert({
        storage_path: storagePath,
        public_url: publicUrl,
        category_slug: WORD_CATEGORY,
        venue_pattern: null,
        tags: [img.key, img.stam].filter(Boolean),
        cluster_tags: [img.ord.toLowerCase(), img.stam].filter(Boolean),
        rating: 5,
        approved_by: 'word-image-gen',
      }, { onConflict: 'storage_path' });
      if (libErr) console.log(`  [library-fel] ${img.ord}: ${libErr.message}`);
      else console.log(`  [ok] ${img.ord} → ${storagePath}`);
    } else {
      console.log(`  [dry] ${img.ord} → ${storagePath}`);
    }
  }

  // 2) Hämta events och matcha titel mot ord.
  //
  //    TVÅ FALLOR (upptäckta 2026-10-31):
  //    (a) PostgREST/S Supabase-projektet har ett eget radtak på 1 000 rader.
  //        .range(0, 19999) bryter INTE det taket — en fråga med .or()-filter
  //        gav 1 000 av 2 016 matchande rader. Hela hälften av eventen var
  //        osynliga för tilldelningen. Lösning: sidnumrering.
  //    (b) Ett .or()-filter med 1 000 ord blir ett URL på tiotals kilo —
  //        det riskerar att överlåta. Eftersom matchningen sker i JS
  //        (tokenize + längsta ordet vinner) behövs ingen DB-filtrering
  //        alls: vi hämtar alla events och matchar lokalt.
  const events: Array<{ id: string; title_sv: string | null; title_en: string | null; image_url: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: evErr } = await db
      .from('events')
      .select('id, title_sv, title_en, image_url')
      .range(from, from + 999);
    if (evErr) { console.error(evErr.message); process.exit(1); }
    if (!data || data.length === 0) break;
    events.push(...(data as typeof events));
    if (data.length < 1000) break;
  }
  console.log(`[assign] events hämtade: ${events.length}`);

  const rows: string[] = ['event_id,titel,ord,bildfil,image_url_fbefore,image_url_fafter,status'];
  let assigned = 0, unmatched = 0, skipped = 0;
  // Ord → de event som ska få just den bilden (grupperas för batch-skrivning).
  const buckets = new Map<string, { hit: WordImage; meta: { storage_path: string; public_url: string }; events: typeof events }>();

  for (const ev of events) {
    const title = ev.title_sv || ev.title_en || '';
    if (!title) continue;
    // ORDLISTAN ÄR FACIT. Vi delar titeln i tokens och slår upp varje
    // token i inventeringen — en token som inte finns i ordlistan
    // matchar ingenting.
    //
    // FÖRUT gissades suffixer ("tokenet slutar med nyckeln"), vilket gav
    // 922 FALSA träffar: "Ludwig Hart" -> "hart" slutar med "art" (konst),
    // "Digitalt Forum" -> "digitalt" slutar med "alt", "Tennis" -> "tennis"
    // slutar med "is" (isbana). Ingen gissning.
    const titleKeys = matchKeysInTitle(title, wordIndex);
    // Ordmatchning: längsta ordet vinner (mest specifikt). "Dambastu" (8)
    // slår "bastu" (5) på titeln "Dambastu lördagmorgon Inre Bastu".
    const hits = candidates
      .filter((c) => titleKeys.has(c.key)
        || matchForms(c).some((f) => titleKeys.has(f)))
      .sort((a, b) => b.key.length - a.key.length || b.ord.length - a.ord.length);
    if (!hits.length) continue;
    const hit = hits[0];
    const meta = byKey.get(hit.key);
    if (!meta) continue;

    if (!IS_APPLY) {
      rows.push(`"${ev.id}","${title.replace(/"/g, "'")}","${hit.ord}","${path.basename(hit.file)}","${(ev.image_url ?? '').replace(/"/g, "'")}","${meta.public_url}","dry-run"`);
      assigned++;
      continue;
    }

    // Tilldelningen grupperas per ord INNAN skrivningen: alla event som ska
    // få samma bild skrivs med EN uppdatering (.in('id', [...])) i stället för
    // en uppdatering per event. 7 238 event blev ~900 anrop i stället för
    // 7 238 — samma effekt, men snabbare och färre felchanser.
    const bucket = buckets.get(hit.key) ?? { hit, meta, events: [] as typeof events };
    bucket.events.push(ev);
    buckets.set(hit.key, bucket);
  }

  if (IS_APPLY) {
    const CHUNK = 100;
    for (const [key, bucket] of buckets) {
      const payload = {
        image_url: bucket.meta.public_url,
        image_ai_generated: true,
        image_model: bucket.hit.model,
        image_prompt: bucket.hit.prompt.slice(0, 500),
        image_generated_at: new Date().toISOString(),
        image_generation_status: 'completed',   // check-constraint: pending|completed|failed|no_credits|library_fallback
        image_license: 'ai-generated',
      };
      for (let i = 0; i < bucket.events.length; i += CHUNK) {
        const chunk = bucket.events.slice(i, i + CHUNK);
        const { error } = await db.from('events').update(payload).in('id', chunk.map((e) => e.id));
        if (error) {
          console.log(`  [update-fel] "${key}" (${chunk.length} event): ${error.message}`);
          unmatched += chunk.length;
          continue;
        }
        for (const ev of chunk) {
          const title = ev.title_sv || ev.title_en || '';
          const changed = ev.image_url !== bucket.meta.public_url;
          rows.push(`"${ev.id}","${title.replace(/"/g, "'")}","${bucket.hit.ord}","${path.basename(bucket.hit.file)}","${(ev.image_url ?? '').replace(/"/g, "'")}","${bucket.meta.public_url}","${changed ? 'uppdaterad' : 'redan satt'}"`);
          if (changed) assigned++; else skipped++;
        }
      }
    }
  }

  if (IS_APPLY) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(path.dirname(OUT_CSV), { recursive: true });
    writeFileSync(OUT_CSV, rows.join('\n'));
    console.log(`\n[assign] events uppdaterade: ${assigned} (redan samma: ${skipped}, fel: ${unmatched})`);
    console.log(`[assign] rapport: ${OUT_CSV}`);
  } else {
    console.log(`\n[assign] dry-run — ${assigned} event skulle få ordbild.`);
  }
}

main().catch((e) => { console.error('FEL:', e); process.exit(1); });
