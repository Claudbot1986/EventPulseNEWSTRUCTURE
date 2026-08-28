/**
 * 08-Agent/scripts/cleanup_orphaned_originals.ts
 *
 * List (and optionally delete) files in the `event-posters` Supabase Storage
 * bucket that live OUTSIDE the `ai-generated/` prefix. After the 2026-08-26
 * rollout, only `ai-generated/` should remain — any other prefix is either
 *   (a) original/scrape images that violated the "no originals in supabase" rule,
 *   (b) test artifacts, or
 *   (c) legitimate non-AI files (rare; review carefully before --confirm).
 *
 * Usage:
 *
 *   # 1. Dry-run (default) — list files, no deletes
 *   npx tsx 08-Agent/scripts/cleanup_orphaned_originals.ts
 *
 *   # 2. Dry-run with custom bucket
 *   npx tsx 08-Agent/scripts/cleanup_orphaned_originals.ts --bucket event-posters
 *
 *   # 3. Sharp run (DESTRUCTIVE — requires --confirm flag)
 *   npx tsx 08-Agent/scripts/cleanup_orphaned_originals.ts --confirm
 *
 *   # 4. Limit scope to a specific prefix (safer for staged cleanup)
 *   npx tsx 08-Agent/scripts/cleanup_orphaned_originals.ts --prefix events/ --confirm
 *
 *   # 5. Skip top-level 'events/' prefix (often contains venue logos etc. — review first)
 *   npx tsx 08-Agent/scripts/cleanup_orphaned_originals.ts --skip-prefix=events/
 *
 * Outputs:
 *   - runtime/storage-cleanup-DATE.json: backup of file list (paths + sizes + metadata)
 *   - logs: full path list, sizes, count summary
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

interface CliArgs {
  bucket: string;
  dryRun: boolean;
  confirm: boolean;
  prefix: string | null;
  skipPrefix: string[];
  keepPrefixes: string[];   // never delete files under these
  pageSize: number;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const args: CliArgs = {
    bucket: process.env.AUTOGEN_BUCKET || 'event-posters',
    dryRun: true,
    confirm: false,
    prefix: null,
    skipPrefix: [],
    keepPrefixes: ['ai-generated/'],  // never touch the AI bucket
    pageSize: 1000,
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
      case '--bucket': {
        const next = argv[i + 1];
        if (next) {
          args.bucket = next;
          i++;
        }
        break;
      }
      case '--prefix': {
        const next = argv[i + 1];
        if (next) {
          args.prefix = next;
          i++;
        }
        break;
      }
      case '--skip-prefix': {
        const next = argv[i + 1];
        if (next) {
          args.skipPrefix.push(next);
          i++;
        }
        break;
      }
      case '--page-size': {
        const next = argv[i + 1];
        if (next) {
          args.pageSize = Math.max(100, parseInt(next, 10) || 1000);
          i++;
        }
        break;
      }
      default:
        console.error(`[cleanup-orphaned-originals] unknown arg: ${a}`);
        process.exit(2);
    }
  }
  return args;
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('[cleanup-orphaned-originals] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(2);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

interface StorageObject {
  name: string;
  id?: string;
  updated_at?: string;
  created_at?: string;
  last_accessed_at?: string;
  metadata?: Record<string, unknown> | null;
}

async function listAll(bucket: string, prefix: string | null, pageSize: number): Promise<StorageObject[]> {
  const all: StorageObject[] = [];
  let offset = 0;
  while (true) {
    const listOpts: { limit: number; offset: number; sortBy?: { column: string; order: 'asc' | 'desc' }; prefix?: string } = {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    };
    if (prefix) listOpts.prefix = prefix;
    const { data, error } = await supabase.storage.from(bucket).list(listOpts.prefix ?? '', {
      limit: listOpts.limit,
      offset: listOpts.offset,
      sortBy: listOpts.sortBy,
    });
    if (error) throw new Error(`storage list failed: ${error.message}`);
    const page = (data ?? []) as StorageObject[];
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
    if (all.length > 100_000) {
      console.warn('[cleanup-orphaned-originals] WARN: > 100k objects — bailing early to avoid runaway scan');
      break;
    }
  }
  return all;
}

function filterOrphans(
  files: StorageObject[],
  keepPrefixes: string[],
  skipPrefixes: string[],
): StorageObject[] {
  return files.filter((f) => {
    if (!f.name) return false;
    if (keepPrefixes.some((p) => f.name.startsWith(p))) return false;
    if (skipPrefixes.some((p) => f.name.startsWith(p))) return false;
    return true;
  });
}

async function deleteFiles(bucket: string, paths: string[]): Promise<number> {
  let deleted = 0;
  // Storage API supports up to 100 paths per remove() call.
  const chunkSize = 100;
  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize);
    const { error } = await supabase.storage.from(bucket).remove(chunk);
    if (error) throw new Error(`storage remove failed: ${error.message}`);
    deleted += chunk.length;
    console.log(`[cleanup-orphaned-originals] deleted ${deleted}/${paths.length}`);
  }
  return deleted;
}

function writeBackup(files: StorageObject[]): string {
  const dir = resolve(process.cwd(), 'runtime');
  mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const path = resolve(dir, `storage-cleanup-${date}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        count: files.length,
        files: files.map((f) => ({ name: f.name, updated_at: f.updated_at, metadata: f.metadata })),
      },
      null,
      2,
    ),
    'utf8',
  );
  return path;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  console.log('[cleanup-orphaned-originals] === RUN START ===');
  console.log(`[cleanup-orphaned-originals] bucket=${args.bucket}`);
  console.log(`[cleanup-orphaned-originals] mode=${args.dryRun ? 'DRY-RUN' : 'SHARP'}`);
  console.log(`[cleanup-orphaned-originals] prefix=${args.prefix ?? '(root)'}`);
  console.log(`[cleanup-orphaned-originals] skip_prefixes=[${args.skipPrefix.join(', ')}]`);
  console.log(`[cleanup-orphaned-originals] keep_prefixes=[${args.keepPrefixes.join(', ')}]`);

  console.log('[cleanup-orphaned-originals] listing objects…');
  const allFiles = await listAll(args.bucket, args.prefix, args.pageSize);
  console.log(`[cleanup-orphaned-originals] total_objects=${allFiles.length}`);

  const orphans = filterOrphans(allFiles, args.keepPrefixes, args.skipPrefix);
  console.log(`[cleanup-orphaned-originals] orphan_objects=${orphans.length}`);

  if (orphans.length === 0) {
    console.log('[cleanup-orphaned-originals] nothing to delete. Bucket is clean.');
    return;
  }

  // Show breakdown by top-level folder for human review.
  const folderCounts = new Map<string, number>();
  for (const f of orphans) {
    const top = f.name.split('/')[0] ?? '(root)';
    folderCounts.set(top, (folderCounts.get(top) ?? 0) + 1);
  }
  console.log('[cleanup-orphaned-originals] orphan breakdown by top-level folder:');
  for (const [folder, count] of Array.from(folderCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${folder}/  ${count}`);
  }

  console.log('[cleanup-orphaned-originals] sample (first 10):');
  for (const f of orphans.slice(0, 10)) {
    console.log(`  ${f.name}  updated=${f.updated_at ?? '?'}`);
  }

  if (args.dryRun) {
    console.log('[cleanup-orphaned-originals] DRY-RUN — no deletes. Re-run with --confirm to apply.');
    return;
  }

  if (!args.confirm) {
    console.error('[cleanup-orphaned-originals] SHARP run requires --confirm flag. Aborting.');
    process.exit(2);
  }

  console.log('[cleanup-orphaned-originals] writing backup…');
  const backupPath = writeBackup(orphans);
  console.log(`[cleanup-orphaned-originals] backup written: ${backupPath}`);

  console.log('[cleanup-orphaned-originals] deleting…');
  const deleted = await deleteFiles(args.bucket, orphans.map((f) => f.name));
  console.log(`[cleanup-orphaned-originals] deleted_objects=${deleted}`);
  console.log('[cleanup-orphaned-originals] === RUN COMPLETE ===');
}

main().catch((err) => {
  console.error('[cleanup-orphaned-originals] FATAL:', err.message);
  process.exit(1);
});
