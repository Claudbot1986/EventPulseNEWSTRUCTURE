/**
 * 08-Agent/scripts/repoint_ruined_events.ts
 *
 * Uppdaterar events.image_url från ai-generated/<ruined> till
 * ai-stamped/<samma filnamn>. Förutsätter att ai-stamped/-filen finns
 * (bulk-build skapar den).
 *
 * Kör EFTER att `08-Agent/scripts/find_ruined_events.ts` har bekräftat
 * matchningen och FÖRE `quarantine_ruined_files.ts` som flyttar ruined
 * bort från ai-generated/.
 *
 * Idempotent: körs två gånger ger samma slutläge.
 *
 *   npx tsx --env-file=.env 08-Agent/scripts/repoint_ruined_events.ts
 *   npx tsx --env-file=.env 08-Agent/scripts/repoint_ruined_events.ts --dry-run
 */
import { createClient } from '@supabase/supabase-js';

const RUINED = [
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

  console.log(`[repoint] dryRun=${args.dryRun}`);

  const allEvents: { id: string; image_url: string }[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('events')
      .select('id, image_url')
      .range(offset, offset + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allEvents.push(...(data as { id: string; image_url: string }[]));
    if (data.length < 1000) break;
    offset += data.length;
  }

  type Pending = { id: string; newUrl: string };
  const pending: Pending[] = [];
  for (const ev of allEvents) {
    if (!ev.image_url) continue;
    for (const r of RUINED) {
      const marker = `/ai-generated/${r}`;
      if (ev.image_url.includes(marker)) {
        const newUrl = ev.image_url.replace('/ai-generated/', '/ai-stamped/');
        pending.push({ id: ev.id, newUrl });
        break;
      }
    }
  }
  console.log(`[repoint] events att uppdatera: ${pending.length}`);

  let updated = 0;
  let failed = 0;
  for (const p of pending) {
    if (args.dryRun) {
      console.log(`  · ${p.id}  → ${p.newUrl}`);
      updated += 1;
      continue;
    }
    const { error } = await supabase
      .from('events')
      .update({ image_url: p.newUrl })
      .eq('id', p.id);
    if (error) {
      console.error(`  ✗ ${p.id}  ${error.message}`);
      failed += 1;
    } else {
      updated += 1;
    }
  }

  console.log('');
  console.log(`[repoint] DONE  updated=${updated}  failed=${failed}  ${args.dryRun ? '(dry-run)' : ''}`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[repoint] FATAL:', msg);
  process.exit(1);
});
