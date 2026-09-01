/**
 * 08-Agent/scripts/migrate_to_import_buckets.ts
 *
 * Migrerar `event-posters/`-bucketen till två roll-mappar:
 *   ai-generated/  → import-original/   (ostämplade BFL-original)
 *   ai-stamped/    → import-stamped/    (med transparent AI Act-stämpel inbakad)
 *
 * Bakgrund (2026-09-01)
 * ---------------------
 * R2-bucket `event-posters` har idag 5+ prefix med otydliga roller
 * (ai-generated, ai-stamped, ai-originals, events, ai-quarantine).
 * Användaren vill konsolidera till exakt två: import-original/ (råa BFL-bilder)
 * och import-stamped/ (samma bilder med stämpel inbakad, det UI läser).
 *
 * Library-bilder flyttas också hit — enhetlig upplevelse i Utforska
 * (se image_library.storage_path och events.image_url).
 *
 * Kostnad: 0 kr. Använder Supabase Storage `copy()` server-side —
 * ingen nedladdning, ingen uppladdning, ingen bandbredd.
 *
 * Idempotent: filer som redan finns i målet hoppas över (om inte --force).
 * Avbruten körning kan återupptas genom att köra scriptet igen.
 *
 * Användning:
 *   npx tsx 08-Agent/scripts/migrate_to_import_buckets.ts --dry-run
 *   npx tsx 08-Agent/scripts/migrate_to_import_buckets.ts [--limit=N] [--force]
 *
 * Efter migrering: kör migrate_storage_paths.sql för att uppdatera DB-paths.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'event-posters';

interface MigrationPair {
  readonly sourcePrefix: string;
  readonly targetPrefix: string;
  readonly description: string;
}

const MIGRATIONS: ReadonlyArray<MigrationPair> = [
  {
    sourcePrefix: 'ai-generated',
    targetPrefix: 'import-original',
    description: 'BFL-original (ostämplade råbilder)',
  },
  {
    sourcePrefix: 'ai-stamped',
    targetPrefix: 'import-stamped',
    description: 'Stämplade derivat (med transparent AI Act-stämpel)',
  },
];

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
  pair: string;
  name: string;
  status: 'copied' | 'skipped' | 'failed';
  message?: string;
}

async function copyOne(
  supabase: SupabaseClient,
  pair: MigrationPair,
  name: string,
  existing: ReadonlySet<string>,
  args: CliArgs,
): Promise<CopyOutcome> {
  if (existing.has(name) && !args.force) {
    return { pair: pair.targetPrefix, name, status: 'skipped' };
  }
  if (args.dryRun) {
    return { pair: pair.targetPrefix, name, status: 'copied' };
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .copy(`${pair.sourcePrefix}/${name}`, `${pair.targetPrefix}/${name}`);

  if (error) {
    if (args.force && existing.has(name)) {
      await supabase.storage.from(BUCKET).remove([`${pair.targetPrefix}/${name}`]);
      const retry = await supabase.storage
        .from(BUCKET)
        .copy(`${pair.sourcePrefix}/${name}`, `${pair.targetPrefix}/${name}`);
      if (retry.error) return { pair: pair.targetPrefix, name, status: 'failed', message: retry.error.message };
      return { pair: pair.targetPrefix, name, status: 'copied' };
    }
    return { pair: pair.targetPrefix, name, status: 'failed', message: error.message };
  }
  return { pair: pair.targetPrefix, name, status: 'copied' };
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
    `[migrate-import-buckets] dryRun=${args.dryRun} force=${args.force} ` +
      `limit=${args.limit === Infinity ? '∞' : args.limit}`,
  );

  let totalCopied = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const pair of MIGRATIONS) {
    console.log('');
    console.log(`[migrate] ${pair.sourcePrefix}/ → ${pair.targetPrefix}/  (${pair.description})`);

    const sourceNames = await listPrefix(supabase, pair.sourcePrefix);
    const existing = new Set(await listPrefix(supabase, pair.targetPrefix));
    console.log(
      `[migrate]   källa=${sourceNames.length}  redan i mål=${existing.size}`,
    );

    let candidates = sourceNames.filter((n) => n.toLowerCase().endsWith('.png'));
    if (Number.isFinite(args.limit) && candidates.length > args.limit) {
      console.log(`[migrate]   --limit: tar första ${args.limit} av ${candidates.length}`);
      candidates = candidates.slice(0, args.limit);
    }

    const startMs = Date.now();
    const outcomes = await runPool(candidates, COPY_CONCURRENCY, (name) =>
      copyOne(supabase, pair, name, existing, args),
    );

    const copied = outcomes.filter((o) => o.status === 'copied').length;
    const skipped = outcomes.filter((o) => o.status === 'skipped').length;
    const failures = outcomes.filter((o) => o.status === 'failed');

    for (const f of failures.slice(0, 10)) {
      console.error(`  ✗ ${f.name}  ${f.message ?? 'unknown error'}`);
    }
    if (failures.length > 10) {
      console.error(`  …och ${failures.length - 10} fler fel.`);
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(
      `[migrate]   klar på ${elapsed}s  copied=${copied}${args.dryRun ? ' (dry-run)' : ''}  ` +
        `skipped=${skipped}  failed=${failures.length}`,
    );

    totalCopied += copied;
    totalSkipped += skipped;
    totalFailed += failures.length;
  }

  console.log('');
  console.log(`[migrate-import-buckets] TOTAL`);
  console.log(`  copied  : ${totalCopied}${args.dryRun ? ' (dry-run)' : ''}`);
  console.log(`  skipped : ${totalSkipped}  (fanns redan i målmapp)`);
  console.log(`  failed  : ${totalFailed}`);

  if (totalFailed > 0) process.exit(1);

  if (!args.dryRun && totalCopied > 0) {
    console.log('');
    console.log('[migrate] Nästa steg: kör SQL-uppdateringen för att peka om image_library.storage_path');
    console.log('         och events.image_url mot de nya prefixen. Se plan-fil.');
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[migrate-import-buckets] FATAL:', msg);
  process.exit(1);
});
