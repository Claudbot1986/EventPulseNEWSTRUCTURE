/**
 * 08-Agent/scripts/seed_ai_originals.ts
 *
 * Seedar `ai-originals/` i bucket `event-posters` med en kopia av HELA
 * `ai-generated/`-biblioteket.
 *
 * Bakgrund (2026-08-29)
 * ---------------------
 * `restamp_all_event_posters.ts` läste från och skrev tillbaka till SAMMA
 * prefix. Varje körning komponerade alltså en ny AI-stämpel OVANPÅ den
 * förra. Efter tre designiterationer (platt-opacitet 0.82 → 0.50 → 0.20)
 * hade de tio första filerna tre staplade plattor med effektiv opacitet
 * ~0.93 — pixlarna under är oåterkalleligt förstörda, och en "mer
 * transparent" stämpel gick inte längre att uppnå.
 *
 * Fixen är strukturell, inte kosmetisk: källa och derivat separeras.
 *
 *   ai-originals/  ← denna scriptets output. Stämplas ALDRIG.
 *   ai-stamped/    ← derivat, byggs av build_ai_stamped.ts. UI läser här.
 *   ai-generated/  ← legacy, fryst.
 *
 * Så länge byggsteget alltid läser från `ai-originals/` kan stämpelns
 * design ändras obegränsat antal gånger utan att stapla plattor.
 *
 * Kostnad: 0 kr. Använder Supabase Storage `copy()` som är en
 * server-side-operation — ingen nedladdning, ingen uppladdning, ingen
 * bildbehandling.
 *
 * Idempotent: filer som redan finns i `ai-originals/` hoppas över (såvida
 * inte --force). Avbruten körning kan återupptas.
 *
 * Användning:
 *   npx tsx --env-file=.env 08-Agent/scripts/seed_ai_originals.ts [--dry-run] [--limit=N] [--force]
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'event-posters';
const SOURCE_PREFIX = 'ai-generated';
const TARGET_PREFIX = 'ai-originals';

/**
 * Filer som INTE kopieras till `ai-originals/`.
 *
 * Detta är de tio alfabetiskt första i `ai-generated/` som blev
 * trippel-stämplade under felsökningen 2026-08-29. De är förstörda och
 * duger inte som original. De raderas separat av
 * `prune_ruined_ai_generated.ts`.
 */
const RUINED = new Set<string>([
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
]);

const COPY_CONCURRENCY = 8;

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
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`storage.list(${prefix}) failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      if (!entry.id) continue; // undermapp, inte fil
      out.push(entry.name);
    }
    if (data.length < PAGE_SIZE) break;
    offset += data.length;
  }
  return out;
}

interface CopyOutcome {
  name: string;
  status: 'copied' | 'skipped' | 'failed';
  message?: string;
}

async function copyOne(
  supabase: SupabaseClient,
  name: string,
  existing: ReadonlySet<string>,
  args: CliArgs,
): Promise<CopyOutcome> {
  if (existing.has(name) && !args.force) {
    return { name, status: 'skipped' };
  }
  if (args.dryRun) {
    return { name, status: 'copied' };
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .copy(`${SOURCE_PREFIX}/${name}`, `${TARGET_PREFIX}/${name}`);

  if (error) {
    // `copy` failar om destinationen finns. Med --force tar vi bort först.
    if (args.force && existing.has(name)) {
      await supabase.storage.from(BUCKET).remove([`${TARGET_PREFIX}/${name}`]);
      const retry = await supabase.storage
        .from(BUCKET)
        .copy(`${SOURCE_PREFIX}/${name}`, `${TARGET_PREFIX}/${name}`);
      if (retry.error) return { name, status: 'failed', message: retry.error.message };
      return { name, status: 'copied' };
    }
    return { name, status: 'failed', message: error.message };
  }
  return { name, status: 'copied' };
}

async function runPool<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function drain(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => drain()),
  );
  return results;
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
    `[seed-originals] ${SOURCE_PREFIX}/ → ${TARGET_PREFIX}/  ` +
      `dryRun=${args.dryRun}  force=${args.force}  ` +
      `limit=${args.limit === Infinity ? '∞' : args.limit}`,
  );

  const sourceNames = await listPrefix(supabase, SOURCE_PREFIX);
  const existing = new Set(await listPrefix(supabase, TARGET_PREFIX));
  console.log(
    `[seed-originals] källa=${sourceNames.length}  redan i mål=${existing.size}`,
  );

  let candidates = sourceNames.filter((n) => n.toLowerCase().endsWith('.png'));
  const ruinedHits = candidates.filter((n) => RUINED.has(n));
  candidates = candidates.filter((n) => !RUINED.has(n));
  if (ruinedHits.length > 0) {
    console.log(
      `[seed-originals] hoppar över ${ruinedHits.length} trippel-stämplade (se RUINED)`,
    );
  }

  if (Number.isFinite(args.limit) && candidates.length > args.limit) {
    console.log(`[seed-originals] --limit: tar första ${args.limit} av ${candidates.length}`);
    candidates = candidates.slice(0, args.limit);
  }

  const startMs = Date.now();
  const outcomes = await runPool(candidates, COPY_CONCURRENCY, (name) =>
    copyOne(supabase, name, existing, args),
  );

  const copied = outcomes.filter((o) => o.status === 'copied').length;
  const skipped = outcomes.filter((o) => o.status === 'skipped').length;
  const failures = outcomes.filter((o) => o.status === 'failed');

  for (const f of failures) {
    console.error(`  ✗ ${f.name}  ${f.message ?? 'unknown error'}`);
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log('');
  console.log(`[seed-originals] DONE in ${elapsed}s`);
  console.log(`  copied  : ${copied}${args.dryRun ? ' (dry-run)' : ''}`);
  console.log(`  skipped : ${skipped}  (fanns redan i ${TARGET_PREFIX}/)`);
  console.log(`  failed  : ${failures.length}`);

  if (failures.length > 0) process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[seed-originals] FATAL:', msg);
  process.exit(1);
});
