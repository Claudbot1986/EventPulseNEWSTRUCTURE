/**
 * 08-Agent/scripts/quarantine_ruined_files.ts
 *
 * Flyttar de 10 RUINED-filerna från `ai-generated/` till
 * `ai-quarantine/`. Dessa exkluderades från `seed_ai_originals.ts`
 * 2026-08-29 eftersom de hade blivit trippel-stämplade under
 * felsökning — pixeldata i botten-höger är överskriven av 3
 * staplade plattor (effektiv opacitet ~0.93), olagligt att reparera.
 *
 * Förutsätter:
 *   - `build_ruined_into_stamped.ts` har skapat `ai-stamped/<ruined>`
 *   - `repoint_ruined_events.ts` har pekat om events.image_url till
 *     `ai-stamped/<ruined>`
 *
 * Idempotent: körs två gånger ger samma slutläge.
 *
 *   npx tsx --env-file=.env 08-Agent/scripts/quarantine_ruined_files.ts
 *   npx tsx --env-file=.env 08-Agent/scripts/quarantine_ruined_files.ts --dry-run
 */
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'event-posters';
const SOURCE_PREFIX = 'ai-generated';
const QUARANTINE_PREFIX = 'ai-quarantine';

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

  console.log(`[quarantine-ruined] ${RUINED.length} filer att flytta  dryRun=${args.dryRun}`);

  let moved = 0;
  let failed = 0;

  for (const name of RUINED) {
    const src = `${SOURCE_PREFIX}/${name}`;
    const dst = `${QUARANTINE_PREFIX}/${name}`;
    if (args.dryRun) {
      console.log(`  · ${src}  → ${dst}`);
      moved += 1;
      continue;
    }
    try {
      const { error: copyErr } = await supabase.storage
        .from(BUCKET)
        .copy(src, dst);
      if (copyErr) throw new Error(`copy failed: ${copyErr.message}`);
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([src]);
      if (rmErr) throw new Error(`remove failed: ${rmErr.message}`);
      console.log(`  ✓ ${src}  → ${dst}`);
      moved += 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${name}  ${msg}`);
      failed += 1;
    }
  }

  console.log('');
  console.log(`[quarantine-ruined] DONE  moved=${moved}  failed=${failed}  ${args.dryRun ? '(dry-run)' : ''}`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[quarantine-ruined] FATAL:', msg);
  process.exit(1);
});
