/**
 * 08-Agent/scripts/restamp_all_event_posters.ts
 *
 * Re-stämplar ALLA AI-bilder i Supabase Storage bucket `event-posters`
 * med EU AI Act Art. 50-disclosure (orange "● AI"-pill 200×48 + XMP-metadata).
 *
 * Täcker BÅDA mapparna som HemStarScreen faktiskt läser ifrån:
 *   - events/         — pipeline-original, ibland utan stämpel (gamla)
 *   - ai-generated/   — backfill / pre-baked / library_fallback-källa
 *
 * Den befintliga restyle_existing_ai_images.ts listar filer via
 * autoGenServer /events-first-proxyn som bara returnerar events-tabellen.
 * Det missar library_fallback-bilder (image_ai_generated=false men
 * image_url pekar ändå på ai-generated/ som delas med andra events).
 *
 * Den här scriptet listar BUCKET direkt via Supabase Storage API
 * (supabase.storage.from('event-posters').list(prefix)), vilket gör den
 * oberoende av events-tabellens state och täcker alla fysiska filer
 * som UI:t faktiskt kan rendera.
 *
 * Idempotent: checkAiStamp hoppar över redan-stämplade bilder om orange>20
 * pixlar i SE-hörn-regionen. --force re-stämplar ändå.
 *
 * Användning:
 *   npx tsx --env-file=.env 08-Agent/scripts/restamp_all_event_posters.ts [--prefix=events/] [--force] [--dry-run]
 *
 * Exempel:
 *   # Täck bara ai-generated/ (första gången — fixar library_fallback-bilder)
 *   npx tsx --env-file=.env 08-Agent/scripts/restamp_all_event_posters.ts --prefix=ai-generated/
 *
 *   # Täck hela bucketen (säker idempotent körning)
 *   npx tsx --env-file=.env 08-Agent/scripts/restamp_all_event_posters.ts --prefix=events/
 *   npx tsx --env-file=.env 08-Agent/scripts/restamp_all_event_posters.ts --prefix=ai-generated/
 */

import { createClient } from '@supabase/supabase-js';

import { applyAiCompliance, checkAiStamp } from '../tools/ai_compliance';

const MODEL_TAG = 'flux-dev';  // pipeline-modell som faktiskt skrev ai-generated/-filerna (per backfill_ai_images)

// ── CLI args ──────────────────────────────────────────────────────────────
interface CliArgs {
  bucket: string;
  prefix: string;
  force: boolean;
  dryRun: boolean;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  let bucket = 'event-posters';
  let prefix = '';
  let force = false;
  let dryRun = false;
  let limit = Infinity;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    // Stöd både `--prefix=foo` och `--prefix foo`
    const eqIdx = a.indexOf('=');
    const flag = eqIdx >= 0 ? a.slice(0, eqIdx) : a;
    const inlineVal = eqIdx >= 0 ? a.slice(eqIdx + 1) : null;
    const next = inlineVal ?? argv[i + 1] ?? null;

    if (flag === '--bucket' && next) { bucket = next; if (inlineVal === null) i++; }
    else if (flag === '--prefix' && next) { prefix = next.endsWith('/') ? next : `${next}/`; if (inlineVal === null) i++; }
    else if (flag === '--force') { force = true; }
    else if (flag === '--dry-run') { dryRun = true; }
    else if (flag === '--limit' && next) { limit = Math.max(1, parseInt(next, 10) || Infinity); if (inlineVal === null) i++; }
  }
  return { bucket, prefix, force, dryRun, limit };
}

// ── Storage listing ────────────────────────────────────────────────────────
interface BucketFile {
  name: string;
  objectPath: string;
}

async function listBucket(supabase: ReturnType<typeof createClient>, bucket: string, prefix: string): Promise<BucketFile[]> {
  const out: BucketFile[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  // supabase.storage.from(bucket).list returnerar bara metadata för filer i
  // prefix (eller root om prefix=''). Supabase listar mappar om man listar
  // roten med "" eller om man listar en path så listar den filerna där.
  // VIKTIGT: trailing slash gör att list returnerar 0 resultat — använd
  // prefix utan slash och bygg objectPath med slash manuellt.
  const listPath = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const objectPrefix = listPath.length > 0 ? `${listPath}/` : '';
  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(listPath, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`storage.list(${listPath}) failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      if (!entry.id) continue; // undermapp (t.ex. events/ under root), inte en fil
      const objectPath = objectPrefix + entry.name;
      out.push({ name: entry.name, objectPath });
    }
    if (data.length < PAGE_SIZE) break;
    offset += data.length;
  }
  return out;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`[restamp-all] bucket=${args.bucket}  prefix='${args.prefix}'  force=${args.force}  dryRun=${args.dryRun}  limit=${args.limit === Infinity ? '∞' : args.limit}`);

  // 1. Lista filer
  const files = await listBucket(supabase, args.bucket, args.prefix);
  console.log(`[restamp-all] ${files.length} filer i bucketen att inspektera`);

  // Filtrera bort icke-PNG (säkerhetsbälte — det ska bara vara PNG:er i
  // ai-generated/, men andra prefix kan råka ha annat).
  let pngs = files.filter((f) => f.name.toLowerCase().endsWith('.png'));
  if (pngs.length !== files.length) {
    console.log(`[restamp-all] ignorerar ${files.length - pngs.length} icke-PNG`);
  }

  // Valfri limit (för smoke-testing på första N filer)
  if (Number.isFinite(args.limit) && pngs.length > args.limit) {
    console.log(`[restamp-all] --limit=${args.limit}: tar första ${args.limit} av ${pngs.length}`);
    pngs = pngs.slice(0, args.limit);
  }

  let stamped = 0;
  let skipped = 0;
  let failed = 0;
  const startMs = Date.now();

  for (const f of pngs) {
    const fileUrl = `${url}/storage/v1/object/public/${args.bucket}/${f.objectPath}`;
    try {
      // Hämta filer
      const getRes = await fetch(fileUrl);
      if (!getRes.ok) throw new Error(`fetch ${getRes.status}`);
      const ab = await getRes.arrayBuffer();
      const buffer = Buffer.from(ab);

      // Kontrollera om redan stämplad
      const before = await checkAiStamp(buffer);
      if (before.ok && !args.force) {
        console.log(`  ⊝ ${f.name}  redan stämplad (orange=${before.orangeCount}) — skip`);
        skipped += 1;
        continue;
      }

      if (args.dryRun) {
        console.log(`  · ${f.name}  would stamp  (current orange=${before.orangeCount})`);
        stamped += 1;
        continue;
      }

      // Stämpla
      const newBuf = await applyAiCompliance({
        buffer,
        prompt: `EventPulse AI-generated event poster (restamped ${new Date().toISOString().slice(0, 10)})`,
        model: MODEL_TAG,
      });
      const after = await checkAiStamp(newBuf);
      if (!after.ok) throw new Error('applyAiCompliance did not produce visible stamp');

      // Ladda upp (upsert)
      const { error: upErr } = await supabase.storage
        .from(args.bucket)
        .upload(f.objectPath, newBuf, {
          contentType: 'image/png',
          upsert: true,
          cacheControl: '31536000',
        });
      if (upErr) throw new Error(`upload failed: ${upErr.message}`);

      console.log(`  ✓ ${f.name}  ${buffer.length}→${newBuf.length} B  orange=${after.orangeCount}  ${before.ok ? '(re-stamp)' : '(was missing!)'}`);
      stamped += 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${f.name}  ${msg}`);
      failed += 1;
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log('');
  console.log(`[restamp-all] DONE in ${elapsed}s`);
  console.log(`  stamped : ${stamped}`);
  console.log(`  skipped : ${skipped}  (redan Art. 50-compliant)`);
  console.log(`  failed  : ${failed}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[restamp-all] FATAL:', msg);
  process.exit(1);
});