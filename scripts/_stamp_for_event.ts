#!/usr/bin/env -S npx tsx
/**
 * _stamp_for_event.ts — applicera ny hörnpill-stämpel på EN bild och
 * uppdatera motsvarande event-rad i DB.
 *
 * Skillnad mot _stamp_bfl_round5*.ts:
 *   - Stämplar EN bild åt gången (för test + spot-fix)
 *   - Output till SEPARAT mapp: local_image_library_stamped/ (INTE samma
 *     som rå-biblioteket)
 *   - Laddar upp stämplad bild till Supabase Storage och uppdaterar
 *     events.image_url + image_attribution + image_license för evenemanget
 *   - Idempotent: skippar om events.image_url redan pekar på stämplad
 *     storage-path (förhindrar dubbel-stämpel)
 *
 * Säkerhetsmodell (användarbeslut 2026-10-08):
 *   - ENDAST 1 stämpel per bild: vi tar rå bild → KOPIERAR → stämplar →
 *     lagrar i stämplade-mappen. Inga re-stämplar av redan stämplade.
 *   - --apply krävs för skarp körning. Default = --dry-run som visar plan.
 *
 * Användning:
 *   npx tsx scripts/_stamp_for_event.ts --event "Skyview" --date 2026-10-21
 *   npx tsx scripts/_stamp_for_event.ts --event "Skyview" --date 2026-10-21 --apply
 *   npx tsx scripts/_stamp_for_event.ts --event "Skyview" --date 2026-10-21 \
 *     --source-img "exhibition/bfl5_a_wide_r0_XYZ.webp" --apply
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { applyAiCompliance, checkAiStamp, buildAiXmp } from '../08-Agent/tools/ai_compliance';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(2);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const STORAGE_BUCKET = 'event-posters';
const STAMPED_PREFIX = 'import-stamped';
const RAW_LIB = join(process.cwd(), 'local_image_library');
const STAMPED_LIB = join(process.cwd(), 'local_image_library_stamped');

const argIdx = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

interface Args {
  eventTitle: string;
  eventDate: string;       // YYYY-MM-DD
  sourceImg: string | null; // t.ex. "exhibition/bfl5_a_wide_r0_XYZ.webp" — null = auto-pick
  apply: boolean;
  force: boolean;          // re-stämpla även om image_url redan är stämplad
}

function parseArgs(): Args {
  const eventTitle = argIdx('--event');
  const eventDate = argIdx('--date');
  const sourceImg = argIdx('--source-img');
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  if (!eventTitle) { console.error('Saknar --event "<titel>"'); process.exit(2); }
  if (!eventDate) { console.error('Saknar --date YYYY-MM-DD'); process.exit(2); }
  return { eventTitle, eventDate, sourceImg, apply, force };
}

function publicUrlFor(storagePath: string): string {
  const base = process.env.SUPABASE_STORAGE_URL || process.env.AI_IMAGE_PUBLIC_URL
    || `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}`;
  return `${base.replace(/\/$/, '')}/${storagePath.replace(/^\//, '')}`;
}

/**
 * Hitta Skyview-rad (ons 21 okt) i DB. Matchar på title_sv LIKE + start_time
 * mellan 00:00 och 23:59 för angivet datum.
 */
async function findEvent(titleLike: string, date: string): Promise<{ id: string; title: string; image_url: string | null; start_time: string } | null> {
  const dayStart = `${date}T00:00:00+02:00`;
  const dayEnd = `${date}T23:59:59+02:00`;
  const { data, error } = await db
    .from('events')
    .select('id, title_sv, title_en, image_url, start_time')
    .or(`title_sv.ilike.%${titleLike}%,title_en.ilike.%${titleLike}%`)
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)
    .limit(10);
  if (error) { console.error('DB query error:', error.message); return null; }
  if (!data || data.length === 0) return null;
  if (data.length > 1) {
    console.warn(`Hittade ${data.length} matchande event för ${date}:`);
    for (const r of data) console.warn(`  ${r.id}: ${r.title_sv} / ${r.title_en} @ ${r.start_time}`);
  }
  const hit = data[0];
  return {
    id: hit.id,
    title: hit.title_sv ?? hit.title_en ?? '(saknar titel)',
    image_url: hit.image_url,
    start_time: hit.start_time,
  };
}

/**
 * Hitta rå bild att stämpla. Två strategier:
 *  1) --source-img är satt → använd exakt
 *  2) Auto: skanna local_image_library/<kategori>/ för senaste bfl5_*.webp
 *     som inte redan har en stämplad motsvarighet
 */
function pickSourceImage(explicit: string | null): { cat: string; filename: string; fullPath: string; metaPath: string } | null {
  if (explicit) {
    const [cat, fname] = explicit.split('/');
    if (!cat || !fname) { console.error(`--source-img format: <cat>/<filnamn>, fick '${explicit}'`); return null; }
    const fullPath = join(RAW_LIB, cat, fname);
    const metaPath = join(RAW_LIB, cat, fname.replace(/\.(webp|png|jpg|jpeg)$/, '.json'));
    if (!existsSync(fullPath)) { console.error(`Saknar rå bild: ${fullPath}`); return null; }
    return { cat, filename: fname, fullPath, metaPath };
  }
  // Auto: plocka första bfl5_*.webp vi hittar
  for (const cat of readdirSync(RAW_LIB)) {
    const sub = join(RAW_LIB, cat);
    let files: string[];
    try { files = readdirSync(sub); } catch { continue; }
    const match = files.find(f => /^bfl5[a-d]?_.*\.webp$/.test(f));
    if (match) {
      const fullPath = join(sub, match);
      const metaPath = join(sub, match.replace(/\.webp$/, '.json'));
      if (existsSync(metaPath)) return { cat, filename: match, fullPath, metaPath };
    }
  }
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[stamp-event] event="${args.eventTitle}" date=${args.eventDate} source=${args.sourceImg ?? 'auto'} apply=${args.apply}`);

  // 1. Hitta event i DB
  const evt = await findEvent(args.eventTitle, args.eventDate);
  if (!evt) {
    console.error(`[stamp-event] hittade INGEN event-rad i DB för "${args.eventTitle}" ${args.eventDate}. Avbryter.`);
    process.exit(1);
  }
  console.log(`[stamp-event] event hittad: id=${evt.id} titel="${evt.title}" start=${evt.start_time}`);

  // Idempotens-skydd: om image_url redan pekar på stämplad storage-path, skippa.
  // --force tillåter re-stämpel (t.ex. vid design-bytet 2026-10-08).
  if (evt.image_url && evt.image_url.includes(`/${STAMPED_PREFIX}/`) && !args.force) {
    console.log(`[stamp-event] event har redan stämplad image_url (${evt.image_url}) — skippar.`);
    console.log(`[stamp-event] använd --force för att re-stämpla (t.ex. vid design-byten).`);
    process.exit(0);
  }
  if (evt.image_url && evt.image_url.includes(`/${STAMPED_PREFIX}/`) && args.force) {
    console.log(`[stamp-event] --force: re-stämplar trots befintlig stämplad image_url.`);
    console.log(`[stamp-event]   gammal: ${evt.image_url}`);
  }

  // 2. Hitta rå bild
  const src = pickSourceImage(args.sourceImg);
  if (!src) {
    console.error(`[stamp-event] hittade INGEN rå bild att stämpla. Ange --source-img eller generera först.`);
    process.exit(1);
  }
  console.log(`[stamp-event] rå bild: ${src.cat}/${src.filename}`);

  // 3. KOPIERA rå bild till stämplad mapp (VI STÄMPLAR ALDRIG ORIGINEN)
  if (!existsSync(STAMPED_LIB)) mkdirSync(STAMPED_LIB, { recursive: true });
  const stampedCatDir = join(STAMPED_LIB, src.cat);
  if (!existsSync(stampedCatDir)) mkdirSync(stampedCatDir, { recursive: true });

  // Hämta metadata (prompt + model)
  const meta = JSON.parse(readFileSync(src.metaPath, 'utf8'));
  const prompt = meta.prompt ?? '';
  const model = meta.model ?? 'flux-pro-1.1';

  // 4. Pipeline = KOPIERA → STÄMPLA → SPARA
  const stampedFname = src.filename.replace(/\.(webp|png|jpg|jpeg)$/, '.stamped.webp');
  const stampedPath = join(stampedCatDir, stampedFname);
  const xmpPath = join(stampedCatDir, stampedFname.replace(/\.webp$/, '.xmp'));

  if (existsSync(stampedPath) && !args.apply) {
    console.log(`[stamp-event] stämplad fil finns redan: ${stampedPath} (dry-run)`);
  } else if (!args.apply) {
    // Dry-run: visa plan, skriv inte
    console.log('');
    console.log('PLAN (dry-run):');
    console.log(`  src (opåverkad):  ${src.fullPath.replace(process.cwd() + '/', '')}`);
    console.log(`  → kopia:          ${stampedPath.replace(process.cwd() + '/', '')}`);
    console.log(`  → stämplad (webp): ${stampedPath.replace(process.cwd() + '/', '')}`);
    console.log(`  → XMP sidecar:    ${xmpPath.replace(process.cwd() + '/', '')}`);
    console.log(`  → storage-path:   ${STORAGE_BUCKET}/${STAMPED_PREFIX}/${stampedFname}`);
    console.log(`  → DB update:      events.id=${evt.id} image_url=<storage-url>`);
    console.log('');
    console.log('Kör med --apply för att köra.');
    process.exit(0);
  }

  // Skarp körning
  console.log(`[stamp-event] kopierar rå → stämplad mapp...`);
  // Säkerhetsregel (användarbeslut 2026-10-08): ENDAST 1 stämpel per bild.
  // Arbetsflöde: rå bild → KOPIERA till STAMPED_LIB → stämpla kopian → spara
  // som webp med nytt filnamn (.stamped.webp). Originalfilen i RAW_LIB rörs aldrig.
  // Vi läser bytes från originalfilen EFTER kopian är gjord (read-only).
  copyFileSync(src.fullPath, join(stampedCatDir, src.filename));
  const rawBytes = await readFileSync(src.fullPath);
  const stamped = await applyAiCompliance({
    buffer: rawBytes,
    prompt,
    model,
    position: 'bottom-left',
  });
  // Konvertera stämplad PNG → WebP q80 (samma konvention som bfl5-batch)
  const webp = await sharp(stamped).webp({ quality: 80 }).toBuffer();
  writeFileSync(stampedPath, webp);

  // XMP-sidecar: Sharp stöder inte XMP i WebP, så vi skriver den som
  // separat .xmp-fil (DAM-standard). Laddas upp till storage bredvid.
  const xmpPacket = buildAiXmp({ model, prompt });
  writeFileSync(xmpPath, xmpPacket);

  // Verifiera med diff-metoden mot originalet (read-only — vi läser från rå fil)
  const refBytes = readFileSync(src.fullPath);
  const verify = await checkAiStamp(webp, 'bottom-left', refBytes);
  console.log(`[stamp-event] verify: method=${verify.method} ok=${verify.ok} changedRatio=${(verify.changedRatio ?? 0).toFixed(3)}`);

  // XMP-check (maskinläsbar Art. 50-disclosure) — läs sidecar-filen
  const xmpText = readFileSync(xmpPath, 'utf8');
  const hasAi = /<EventPulse:AIGenerated>\s*true\s*<\/EventPulse:AIGenerated>/i.test(xmpText);
  const hasPolicy = /<EventPulse:Policy>\s*(EU-AI-Act-Art-50|EU AI Act Art\.? 50)\s*<\/EventPulse:Policy>/i.test(xmpText);
  console.log(`[stamp-event] xmp (sidecar): aiGenerated=${hasAi} policy=${hasPolicy}`);

  if (!verify.ok && !hasAi) {
    console.error(`[stamp-event] VERIFIERING MISSLYCKADES — ångrar inte ut skrivningen, men sätter INTE image_url.`);
    console.error(`[stamp-event] Inspektera ${stampedPath} manuellt.`);
    process.exit(3);
  }

  // 5. Ladda upp till Supabase Storage
  const storagePath = `${STORAGE_BUCKET}/${STAMPED_PREFIX}/${stampedFname}`;
  const publicUrl = publicUrlFor(storagePath);

  console.log(`[stamp-event] laddar upp till ${storagePath}...`);
  const upload = await db.storage.from(STORAGE_BUCKET).upload(`${STAMPED_PREFIX}/${stampedFname}`, webp, {
    contentType: 'image/webp',
    upsert: true,
  });
  if (upload.error) {
    console.error(`[stamp-event] upload-fel: ${upload.error.message}`);
    process.exit(4);
  }
  console.log(`[stamp-event] upload OK: ${publicUrl}`);

  // 6. Uppdatera event-rad
  console.log(`[stamp-event] uppdaterar events.id=${evt.id}...`);
  const upd = await db.from('events').update({
    image_url: publicUrl,
    image_ai_generated: true,                        // krävs av events_image_url_contract_check
    image_attribution: `AI-generated by ${model} (EU AI Act Art. 50)`,
    image_license: 'ai-generated',
    image_source_url: publicUrl,
    image_generation_status: 'completed',
    image_generated_at: new Date().toISOString(),
  }).eq('id', evt.id);

  if (upd.error) {
    console.error(`[stamp-event] DB update-fel: ${upd.error.message}`);
    process.exit(5);
  }

  // Ladda även upp XMP-sidecar till storage (för DAM-kedjudna lokala filer)
// Supabase Storage accepterar som inte application/xml som mime-typ i standardbucket,
// så vi skippar uppladdning om det inte är konfigurerat. Sidecar-filen finns
// alltid lokalt för maskinläsbar verifiering.
  const xmpUpload = await db.storage.from(STORAGE_BUCKET).upload(
    `${STAMPED_PREFIX}/${stampedFname.replace(/\.webp$/, '.xmp')}`,
    xmpPacket,
    { contentType: 'application/xml', upsert: true },
  );
  if (xmpUpload.error) {
    console.log(`[stamp-event] XMP-upload till storage ej möjligt (${xmpUpload.error.message}); sidecar finns lokalt.`);
  } else {
    console.log(`[stamp-event] XMP sidecar uploaded.`);
  }

  console.log('');
  console.log('KLART:');
  console.log(`  rå bild (orörd):  ${src.fullPath.replace(process.cwd() + '/', '')}`);
  console.log(`  stämplad fil:     ${stampedPath.replace(process.cwd() + '/', '')}`);
  console.log(`  XMP sidecar:      ${xmpPath.replace(process.cwd() + '/', '')}`);
  console.log(`  storage path:     ${storagePath}`);
  console.log(`  public URL:       ${publicUrl}`);
  console.log(`  event id:         ${evt.id}`);
  console.log(`  verify ok:        ${verify.ok} (changedRatio=${(verify.changedRatio ?? 0).toFixed(3)})`);
  console.log(`  xmp ok:           aiGenerated=${hasAi} policy=${hasPolicy}`);
  console.log('');
  console.log(`Granska bilden visuellt innan du kör samma flöde för resten av bilderna.`);
}

main().catch(err => { console.error('[stamp-event] FATAL:', err); process.exit(99); });