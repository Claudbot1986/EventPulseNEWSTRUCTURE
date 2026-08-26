/**
 * 08-Agent/scripts/cleanup_non_ai_images.ts
 *
 * Safety wrapper for the 20260826-0002 cleanup migration. Runs the UPDATE
 * statement behind --dry-run / --confirm gates so we never accidentally
 * nuke image_url on hundreds of rows.
 *
 * Usage:
 *
 *   # 1. Dry-run (default) — show counts + 10 sample rows
 *   npx tsx 08-Agent/scripts/cleanup_non_ai_images.ts
 *
 *   # 2. Dry-run with skip-optout (preserve rows where image_ai_optout=true)
 *   npx tsx 08-Agent/scripts/cleanup_non_ai_images.ts --skip-optout
 *
 *   # 3. Sharp run (DESTRUCTIVE — requires --confirm flag)
 *   npx tsx 08-Agent/scripts/cleanup_non_ai_images.ts --confirm
 *   npx tsx 08-Agent/scripts/cleanup_non_ai_images.ts --confirm --skip-optout
 *
 * Implementation: uses Supabase Management API (`POST /v1/projects/{ref}/database/query`)
 * for direct SQL execution. Avoids PostgREST filter ambiguity around string
 * literals containing hyphens (e.g. 'ai-generated'). DATABASE_URL is not
 * reachable in this environment (DNS blocked), so we go through the
 * management endpoint using SUPABASE_PAT.
 *
 * Writes backup of affected IDs to runtime/cleanup-backup-DATE.json before
 * applying any UPDATE.
 */

import { config as dotenvConfig } from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

for (const candidate of [process.cwd(), resolve(process.cwd(), '..'), resolve(process.cwd(), '../..')]) {
  dotenvConfig({ path: resolve(candidate, '.env') });
}

const PAT = process.env.SUPABASE_PAT;
if (!PAT) {
  console.error('[cleanup-non-ai-images] SUPABASE_PAT not set in .env');
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const refMatch = SUPABASE_URL.match(/^https:\/\/([^.]+)\.supabase\.co/);
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? refMatch?.[1];
if (!PROJECT_REF) {
  console.error('[cleanup-non-ai-images] cannot derive project ref from SUPABASE_URL');
  process.exit(2);
}

interface CliArgs {
  dryRun: boolean;
  confirm: boolean;
  skipOptout: boolean;
  batchSize: number;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const args: CliArgs = {
    dryRun: true,
    confirm: false,
    skipOptout: false,
    batchSize: 1000,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--confirm':
        args.dryRun = false;
        args.confirm = true;
        break;
      case '--skip-optout':
        args.skipOptout = true;
        break;
      case '--batch-size': {
        const next = argv[i + 1];
        if (next) {
          args.batchSize = Math.max(1, parseInt(next, 10) || 1000);
          i++;
        }
        break;
      }
      default:
        console.error(`[cleanup-non-ai-images] unknown arg: ${a}`);
        process.exit(2);
    }
  }
  return args;
}

interface QueryResult {
  rows: unknown[];
  rowCount: number;
}

async function runSql(query: string): Promise<QueryResult> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const data = (await res.json()) as unknown[];
  return { rows: Array.isArray(data) ? (data as unknown[]) : [], rowCount: Array.isArray(data) ? data.length : 0 };
}

function buildWhere(skipOptout: boolean): string {
  const base = "(image_license IS DISTINCT FROM 'ai-generated' OR image_ai_generated IS NOT TRUE)";
  return skipOptout ? `${base} AND image_ai_optout = FALSE` : base;
}

async function fetchAffectedCount(whereClause: string): Promise<number> {
  const { rows } = await runSql(`SELECT count(*)::int AS n FROM events WHERE ${whereClause};`);
  const row = rows[0] as { n: number };
  return row?.n ?? 0;
}

async function fetchSamples(whereClause: string, limit = 10): Promise<unknown[]> {
  const { rows } = await runSql(
    `SELECT id, title_sv, title_en, image_url, image_license, image_ai_generated, image_ai_optout, image_generation_status ` +
      `FROM events WHERE ${whereClause} LIMIT ${limit};`,
  );
  return rows;
}

async function fetchAllAffectedIds(whereClause: string): Promise<string[]> {
  const { rows } = await runSql(`SELECT id::text AS id FROM events WHERE ${whereClause};`);
  return (rows as Array<{ id: string }>).map((r) => r.id);
}

async function runCleanup(whereClause: string): Promise<number> {
  const sql =
    `UPDATE events SET ` +
    `  image_url = NULL, ` +
    `  image_attribution = NULL, ` +
    `  image_source_url = NULL, ` +
    `  image_ai_generated = FALSE, ` +
    `  image_model = NULL, ` +
    `  image_generated_at = NULL, ` +
    `  image_generation_status = 'pending', ` +
    `  image_generation_attempts = 0, ` +
    `  image_generation_error = NULL ` +
    `WHERE ${whereClause};`;
  // Management API returns the rows affected when the result is a mutation.
  const { rowCount, rows } = await runSql(sql);
  if (Array.isArray(rows) && rows.length === 1 && (rows[0] as { count?: number }).count != null) {
    return (rows[0] as { count: number }).count;
  }
  return rowCount;
}

function writeBackup(ids: string[]): string {
  const dir = resolve(process.cwd(), 'runtime');
  mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const path = resolve(dir, `cleanup-backup-${date}.json`);
  writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), ids }, null, 2), 'utf8');
  return path;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const whereClause = buildWhere(args.skipOptout);

  console.log('[cleanup-non-ai-images] === RUN START ===');
  console.log(`[cleanup-non-ai-images] project=${PROJECT_REF}`);
  console.log(`[cleanup-non-ai-images] mode=${args.dryRun ? 'DRY-RUN' : 'SHARP'}`);
  console.log(`[cleanup-non-ai-images] skip_optout=${args.skipOptout}`);
  console.log(`[cleanup-non-ai-images] batch_size=${args.batchSize}`);
  console.log(`[cleanup-non-ai-images] WHERE ${whereClause}`);

  const count = await fetchAffectedCount(whereClause);
  console.log(`[cleanup-non-ai-images] affected_rows=${count}`);

  if (count > 0) {
    const samples = await fetchSamples(whereClause, 10);
    console.log('[cleanup-non-ai-images] sample (first 10):');
    for (const s of samples) {
      const row = s as Record<string, unknown>;
      console.log(
        `  ${row.id}  license=${row.image_license ?? 'NULL'}  ai=${row.image_ai_generated ?? 'NULL'}  optout=${row.image_ai_optout}  status=${row.image_generation_status ?? 'NULL'}  url=${((row.image_url as string) ?? '').slice(0, 60) || 'NULL'}  title=${((row.title_sv as string) ?? '').slice(0, 40) || (row.title_en as string)}`,
      );
    }
  }

  if (args.dryRun) {
    console.log('[cleanup-non-ai-images] DRY-RUN — no writes. Re-run with --confirm to apply.');
    return;
  }

  if (!args.confirm) {
    console.error('[cleanup-non-ai-images] SHARP run requires --confirm flag. Aborting.');
    process.exit(2);
  }

  console.log('[cleanup-non-ai-images] backing up affected IDs…');
  const affectedIds = await fetchAllAffectedIds(whereClause);
  const backupPath = writeBackup(affectedIds);
  console.log(`[cleanup-non-ai-images] backup written: ${backupPath} (${affectedIds.length} IDs)`);

  console.log('[cleanup-non-ai-images] running cleanup…');
  const updated = await runCleanup(whereClause);
  console.log(`[cleanup-non-ai-images] updated_rows=${updated}`);
  console.log('[cleanup-non-ai-images] === RUN COMPLETE ===');
  console.log('[cleanup-non-ai-images] Next step: trigger worker backfill:');
  console.log('  npx tsx 08-Agent/scripts/backfill_ai_images.ts --limit 50');
}

main().catch((err) => {
  console.error('[cleanup-non-ai-images] FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});