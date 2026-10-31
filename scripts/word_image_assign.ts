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
    out.push({
      ord: j.ord,
      key: j.image_key ?? f.split('__')[0],
      file: path.join(WORD_DIR, f),
      buffer: readFileSync(path.join(WORD_DIR, f)),
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

/**
 * Ordet förekommer i titeln? (helt ord ELLER som del av sammansatt ord)
 * Matchar på BÅDE den kanoniska nyckeln ("bastu") och ordformen ("bastun"),
 * så "bastun" som ensamt ord också träffar bastu-bilden.
 */
function wordInTitle(word: string, titleTokens: string[]): boolean {
  const w = word.toLowerCase();
  return titleTokens.some((t) => t === w || (t.length > w.length && t.endsWith(w)));
}

/** Ordformer som ska matcha samma bild (nyckel + ordform). */
function matchForms(img: WordImage): string[] {
  return [...new Set([img.key.toLowerCase(), img.ord.toLowerCase()].filter(Boolean))];
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
    const relPath = `${STORAGE_PREFIX}/${WORD_CATEGORY}/${path.basename(img.file)}`;
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
  //    OBS: PostgREST's standardgräns är 1 000 rader — utan .range() skulle
  //    bara de första 1 000 eventsen (gamla, sorterade på id) hämtas.
  //    Vi filtrerar i DB:t på de ord vi faktiskt bryr oss om.
  const orClause = candidates
    .flatMap((c) => matchForms(c))
    .filter((w) => w.length >= 3)
    .map((w) => `title_sv.ilike.%${w}%,title_en.ilike.%${w}%`)
    .join(',');
  const { data: events, error: evErr } = await db
    .from('events')
    .select('id, title_sv, title_en, image_url')
    .or(orClause)
    .range(0, 19999);
  if (evErr) { console.error(evErr.message); process.exit(1); }
  console.log(`[assign] eventrader med relevanta ord i titeln: ${events?.length ?? 0}`);

  const tokenize = (s: string) => s.toLowerCase()
    .split(/[^a-z0-9åäöéüæøèáàíóúñç]+/i)
    .filter(Boolean);

  const rows: string[] = ['event_id,titel,ord,bildfil,image_url_fbefore,image_url_fafter,status'];
  let assigned = 0, unmatched = 0, skipped = 0;

  for (const ev of events ?? []) {
    const title = ev.title_sv || ev.title_en || '';
    if (!title) continue;
    const toks = tokenize(title);
    // Ordmatchning: längsta ordet vinner (mest specifikt). "Dambastu" (8)
    // slår "bastu" (5) på titeln "Dambastu lördagmorgon Inre Bastu".
    const hits = candidates
      .filter((c) => matchForms(c).some((f) => wordInTitle(f, toks)))
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

    const changed = ev.image_url !== meta.public_url;
    const { error } = await db.from('events').update({
      image_url: meta.public_url,
      image_ai_generated: true,
      image_model: hit.model,
      image_prompt: hit.prompt.slice(0, 500),
      image_generated_at: new Date().toISOString(),
      image_generation_status: 'completed',   // check-constraint: pending|completed|failed|no_credits|library_fallback
      image_license: 'ai-generated',
    }).eq('id', ev.id);
    if (error) { console.log(`  [update-fel] ${ev.id}: ${error.message}`); unmatched++; continue; }
    rows.push(`"${ev.id}","${title.replace(/"/g, "'")}","${hit.ord}","${path.basename(hit.file)}","${(ev.image_url ?? '').replace(/"/g, "'")}","${meta.public_url}","${changed ? 'uppdaterad' : 'redan satt'}"`);
    if (changed) assigned++; else skipped++;
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
