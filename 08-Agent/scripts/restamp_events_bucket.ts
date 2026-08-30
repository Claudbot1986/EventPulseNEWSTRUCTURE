/**
 * 08-Agent/scripts/restamp_events_bucket.ts
 *
 * Backfill: stämplar ALLA PNG-filer i `event-posters/events/` som saknar
 * AI-stämpel. Motsvarar den hook som nu finns i imageGen.ts för *nya*
 * bilder; det här skriptet fixar *befintliga* som laddades upp innan
 * hooken fanns.
 *
 * Hoppar över filer som redan är stämplade (XMP har EventPulse:AIGenerated).
 * `--force` re-stämplar ändå.
 *
 * Användning:
 *   npx tsx --env-file=.env 08-Agent/scripts/restamp_events_bucket.ts [--dry-run] [--force] [--limit=N]
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { applyAiCompliance, checkAiStamp, parseXmp } from '../tools/ai_compliance';

const BUCKET = 'event-posters';
const PREFIX = 'events';
const MODEL_TAG = 'flux-dev';

interface CliArgs {
  dryRun: boolean;
  force: boolean;
  limit: number;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  let dryRun = false;
  let force = false;
  let limit = Infinity;
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
    }
  }
  return { dryRun, force, limit };
}

async function listPrefix(supabase: SupabaseClient, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`storage.list(${prefix}) failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const e of data) if (e.id) out.push(e.name);
    if (data.length < PAGE_SIZE) break;
    offset += data.length;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(
    `[restamp-events] bucket=${BUCKET}/${PREFIX}/  ` +
      `dryRun=${args.dryRun}  force=${args.force}  ` +
      `limit=${args.limit === Infinity ? '∞' : args.limit}`,
  );

  const sourceNames = (await listPrefix(supabase, PREFIX))
    .filter((n) => n.toLowerCase().endsWith('.png'));

  let candidates = sourceNames;
  if (Number.isFinite(args.limit) && candidates.length > args.limit) {
    candidates = candidates.slice(0, args.limit);
  }
  console.log(`[restamp-events] kandidater: ${candidates.length}  (av ${sourceNames.length} totalt i ${PREFIX}/)`);

  let stamped = 0;
  let skipped = 0;
  let failed = 0;
  const startMs = Date.now();

  for (const name of candidates) {
    const path = `${PREFIX}/${name}`;
    try {
      const res = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${path}`);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());

      // Hoppa över om redan stämplad (om inte --force)
      if (!args.force) {
        const xmp = parseXmp(buf);
        if (xmp.found && xmp.hasAiGenerated) {
          skipped += 1;
          continue;
        }
      }

      if (args.dryRun) {
        console.log(`  · ${name}  would stamp`);
        stamped += 1;
        continue;
      }

      const stampedBuf = await applyAiCompliance({
        buffer: buf,
        prompt: `EventPulse AI-generated event image (restamped from ${PREFIX}/)`,
        model: MODEL_TAG,
        position: 'bottom-left',
      });

      const check = await checkAiStamp(stampedBuf, 'bottom-left', buf);
      if (!check.ok) {
        throw new Error(
          `stamp not applied (changedRatio=${(check.changedRatio ?? 0).toFixed(3)})`,
        );
      }

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, stampedBuf, {
          contentType: 'image/png',
          upsert: true,
          cacheControl: '31536000',
        });
      if (upErr) throw new Error(`upload failed: ${upErr.message}`);

      console.log(
        `  ✓ ${name}  ${buf.length}→${stampedBuf.length} B  ` +
          `changed=${((check.changedRatio ?? 0) * 100).toFixed(1)}%`,
      );
      stamped += 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${name}  ${msg}`);
      failed += 1;
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log('');
  console.log(`[restamp-events] DONE in ${elapsed}s`);
  console.log(`  stamped : ${stamped}${args.dryRun ? ' (dry-run)' : ''}`);
  console.log(`  skipped : ${skipped}  (redan stämplade)`);
  console.log(`  failed  : ${failed}`);

  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[restamp-events] FATAL:', msg);
  process.exit(1);
});
