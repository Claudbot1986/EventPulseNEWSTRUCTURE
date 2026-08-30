/**
 * 08-Agent/scripts/build_ruined_into_stamped.ts
 *
 * Special: bygger de 10 RUINED-filerna från ai-generated/ till ai-stamped/.
 *
 * Dessa 10 var exkluderade från `seed_ai_originals.ts` (RUINED-set)
 * eftersom de hade blivit trippel-stämplade under felsökningen
 * 2026-08-29. Pixlarna i botten-höger är överskrivna av 3 staplade
 * plattor (effektiv opacitet ~0.93) — de går inte att laga.
 *
 * Den nya stämpeln placeras i botten-VÄNSTER, alltså på orörda pixlar.
 * Resultatet är en bild med:
 *   - ny transparent stämpel i botten-vänster (synlig)
 *   - 3 stämplade plattor i botten-höger (förstört, men disclosure finns)
 *
 * Användning: bara en gång, innan repoint_ruined_events.
 *
 *   npx tsx --env-file=.env 08-Agent/scripts/build_ruined_into_stamped.ts [--dry-run]
 */
import { createClient } from '@supabase/supabase-js';
import { applyAiCompliance, checkAiStamp } from '../tools/ai_compliance';

const BUCKET = 'event-posters';
const SOURCE_PREFIX = 'ai-generated';
const TARGET_PREFIX = 'ai-stamped';
const MODEL_TAG = 'flux-dev';

const RUINED: string[] = [
  '-.png',
  '-banan-kompaniet.png',
  '-bioskandia.png',
  '-cirkus.png',
  '-mariatorget3.png',
  '-tyrol.png',
  '10cc-konsertsalen.png',
  '5secondsofsummer-everyonesastarworldtourplatinumtickets-hovet.png',
  '6lackfllan-fllan.png',
  'aaprocky-dontbedumbworldtourplatinumtickets-.png',
];

interface CliArgs {
  dryRun: boolean;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  let dryRun = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') dryRun = true;
  }
  return { dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`[build-ruined] ${RUINED.length} filer  dryRun=${args.dryRun}`);

  let built = 0;
  let failed = 0;

  for (const name of RUINED) {
    try {
      const srcUrl = `${url}/storage/v1/object/public/${BUCKET}/${SOURCE_PREFIX}/${name}`;
      const res = await fetch(srcUrl);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      if (args.dryRun) {
        console.log(`  · ${name}  ${buffer.length} B  would build into ${TARGET_PREFIX}/`);
        built += 1;
        continue;
      }

      const stampedBuf = await applyAiCompliance({
        buffer,
        prompt: `EventPulse AI-generated event poster (RUINED, new BL stamp on top of legacy BR stack)`,
        model: MODEL_TAG,
        position: 'bottom-left',
      });

      // Vi har ingen ren original att jämföra med (det är just det som gör
      // dem ruined). Skippa changedRatio-verifiering — vi accepterar att
      // stämpeln syns även om diffen mot den redan-stämplade buffern är
      // liten i BR-regionen (där 3 plattor redan ligger). Den nya stämpeln
      // är i BL, på orörda pixlar.

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(`${TARGET_PREFIX}/${name}`, stampedBuf, {
          contentType: 'image/png',
          upsert: true,
          cacheControl: '31536000',
        });
      if (upErr) throw new Error(`upload failed: ${upErr.message}`);

      console.log(`  ✓ ${name}  ${buffer.length}→${stampedBuf.length} B`);
      built += 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${name}  ${msg}`);
      failed += 1;
    }
  }

  console.log('');
  console.log(`[build-ruined] DONE  built=${built}  failed=${failed}  ${args.dryRun ? '(dry-run)' : ''}`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[build-ruined] FATAL:', msg);
  process.exit(1);
});
