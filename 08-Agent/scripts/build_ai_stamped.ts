/**
 * 08-Agent/scripts/build_ai_stamped.ts
 *
 * Bygger `ai-stamped/` som ett DERIVAT av `ai-originals/`.
 *
 * Den centrala regeln
 * -------------------
 * Scriptet läser ALLTID från `ai-originals/` och skriver ALLTID till
 * `ai-stamped/`. Det läser aldrig sin egen output. Därför kan stämpelns
 * design (opacitet, storlek, text, position) ändras hur många gånger som
 * helst utan att plattor staplas ovanpå varandra.
 *
 * Det var precis det som gick fel i `restamp_all_event_posters.ts`, som
 * läste och skrev till samma prefix: tre designiterationer gav tre
 * staplade plattor och gjorde bilderna oåterkalleligt förstörda.
 *
 * Position
 * --------
 * Default är `both`: stämpeln läggs i BÅDA nedre hörnen. Disclosure:n
 * överlever därmed även om ena hörnet croppas bort av en UI-container med
 * oväntad aspect — cover-crop behåller en centrerad remsa, så ett enskilt
 * hörn är aldrig garanterat synligt.
 *
 * `--position=bottom-left` eller `bottom-right` ger en enda stämpel.
 *
 * Kostnad: 0 kr. Sharp-compute lokalt, ingen modell-API anropas.
 *
 * Idempotent: filer som redan finns i `ai-stamped/` hoppas över såvida
 * inte `--force`. Med `--force` byggs de om från originalet — inte från
 * det befintliga derivatet.
 *
 * Användning:
 *   npx tsx --env-file=.env 08-Agent/scripts/build_ai_stamped.ts [--limit=N] [--dry-run] [--force] [--position=bottom-left]
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { applyAiCompliance, checkAiStamp, type StampPosition } from '../tools/ai_compliance';

const BUCKET = 'event-posters';
const SOURCE_PREFIX = 'ai-originals';
const TARGET_PREFIX = 'ai-stamped';
const MODEL_TAG = 'flux-dev';   // modellen som faktiskt producerade bilderna

interface CliArgs {
  dryRun: boolean;
  force: boolean;
  limit: number;
  position: StampPosition;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  let dryRun = false;
  let force = false;
  let limit = Infinity;
  let position: StampPosition = 'bottom-left';

  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    const eqIdx = raw.indexOf('=');
    const flag = eqIdx >= 0 ? raw.slice(0, eqIdx) : raw;
    const inlineVal = eqIdx >= 0 ? raw.slice(eqIdx + 1) : null;
    const next = inlineVal ?? argv[i + 1] ?? null;

    if (flag === '--dry-run') dryRun = true;
    else if (flag === '--force') force = true;
    else if (flag === '--limit' && next) {
      limit = Math.max(1, parseInt(next, 10) || Infinity);
      if (inlineVal === null) i++;
    } else if (flag === '--position' && next) {
      if (next !== 'bottom-left' && next !== 'bottom-right') {
        throw new Error(`--position must be bottom-left or bottom-right, got '${next}'`);
      }
      position = next;
      if (inlineVal === null) i++;
    }
  }
  return { dryRun, force, limit, position };
}

async function listPrefix(supabase: SupabaseClient, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`storage.list(${prefix}) failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      if (!entry.id) continue;
      out.push(entry.name);
    }
    if (data.length < PAGE_SIZE) break;
    offset += data.length;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(
    `[build-stamped] ${SOURCE_PREFIX}/ → ${TARGET_PREFIX}/  ` +
      `position=${args.position}  dryRun=${args.dryRun}  force=${args.force}  ` +
      `limit=${args.limit === Infinity ? '∞' : args.limit}`,
  );

  const sourceNames = (await listPrefix(supabase, SOURCE_PREFIX))
    .filter((n) => n.toLowerCase().endsWith('.png'));
  const existing = new Set(await listPrefix(supabase, TARGET_PREFIX));
  console.log(`[build-stamped] källa=${sourceNames.length}  redan i mål=${existing.size}`);

  let candidates = sourceNames;
  if (Number.isFinite(args.limit) && candidates.length > args.limit) {
    console.log(`[build-stamped] --limit: tar första ${args.limit} av ${candidates.length}`);
    candidates = candidates.slice(0, args.limit);
  }

  let built = 0;
  let skipped = 0;
  let failed = 0;
  const startMs = Date.now();

  for (const name of candidates) {
    if (existing.has(name) && !args.force) {
      skipped += 1;
      continue;
    }
    try {
      const srcUrl = `${url}/storage/v1/object/public/${BUCKET}/${SOURCE_PREFIX}/${name}`;
      const res = await fetch(srcUrl);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      if (args.dryRun) {
        console.log(`  · ${name}  would build`);
        built += 1;
        continue;
      }

      const stampedBuf = await applyAiCompliance({
        buffer,
        prompt: `EventPulse AI-generated event poster (derived from ${SOURCE_PREFIX}/)`,
        model: MODEL_TAG,
        position: args.position,
      });

      // Differentiell verifiering: vi har originalet i handen, så vi kan
      // bevisa att stämpelregionen faktiskt ändrades i stället för att
      // gissa utifrån färg.
      const check = await checkAiStamp(stampedBuf, args.position, buffer);
      if (!check.ok) {
        throw new Error(
          `stamp not applied (changedRatio=${(check.changedRatio ?? 0).toFixed(3)})`,
        );
      }

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(`${TARGET_PREFIX}/${name}`, stampedBuf, {
          contentType: 'image/png',
          upsert: true,
          cacheControl: '31536000',
        });
      if (upErr) throw new Error(`upload failed: ${upErr.message}`);

      console.log(
        `  ✓ ${name}  ${buffer.length}→${stampedBuf.length} B  ` +
          `changed=${((check.changedRatio ?? 0) * 100).toFixed(1)}%`,
      );
      built += 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${name}  ${msg}`);
      failed += 1;
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log('');
  console.log(`[build-stamped] DONE in ${elapsed}s`);
  console.log(`  built   : ${built}${args.dryRun ? ' (dry-run)' : ''}`);
  console.log(`  skipped : ${skipped}  (fanns redan i ${TARGET_PREFIX}/)`);
  console.log(`  failed  : ${failed}`);

  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[build-stamped] FATAL:', msg);
  process.exit(1);
});
