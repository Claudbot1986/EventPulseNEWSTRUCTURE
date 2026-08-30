/**
 * 08-Agent/scripts/quarantine_legacy_stamps.ts
 *
 * Flyttar filer med legacy AI-stämpel från `ai-originals/` till
 * `ai-quarantine/`. Dessa är de enda två filer (per XMP-skanning 2026-08-30)
 * som bär en gammal pixel-stämpel i nedre höger hörn. De får inte ingå i
 * `ai-stamped/`-bygget eftersom det skulle ge visuell dubbelstämpel.
 *
 *   npx tsx --env-file=.env 08-Agent/scripts/quarantine_legacy_stamps.ts
 *   npx tsx --env-file=.env 08-Agent/scripts/quarantine_legacy_stamps.ts --dry-run
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'event-posters';
const SOURCE_PREFIX = 'ai-originals';
const QUARANTINE_PREFIX = 'ai-quarantine';

const LEGACY_FILES: string[] = [
  'christmasnightstage1-stage1.png',
  'pjolterguysstockholm-stockholm.png',
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

  console.log(`[quarantine] ${LEGACY_FILES.length} filer att flytta  dryRun=${args.dryRun}`);

  for (const name of LEGACY_FILES) {
    const src = `${SOURCE_PREFIX}/${name}`;
    const dst = `${QUARANTINE_PREFIX}/${name}`;
    if (args.dryRun) {
      console.log(`  · ${src}  → ${dst}`);
      continue;
    }
    const { error: copyErr } = await supabase.storage
      .from(BUCKET)
      .copy(src, dst);
    if (copyErr) throw new Error(`copy ${src} → ${dst} failed: ${copyErr.message}`);
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([src]);
    if (rmErr) throw new Error(`remove ${src} failed: ${rmErr.message}`);
    console.log(`  ✓ ${src}  → ${dst}`);
  }

  console.log('');
  console.log(`[quarantine] DONE  (${args.dryRun ? 'dry-run' : 'flyttade'})`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[quarantine] FATAL:', msg);
  process.exit(1);
});
