/**
 * _apply-community-retag-migration.ts
 *
 * Applies the dry-run SQL migration at:
 *   05-Supabase/migrations/2026-10-01-0001-retag-community-batch-dry-run.sql
 *
 * Uses the Supabase Management API (`POST /v1/projects/{ref}/database/query`)
 * to send batches of UPDATE statements in single calls — much faster than
 * 603 individual round-trips.
 *
 * Safety:
 *   * Reads the migration file (no DB writes until exec).
 *   * Parses only UPDATE events … statements (skips BEGIN/COMMIT/comments).
 *   * Sends each batch in a single transaction; aborts on any error.
 *   * Logs every batch + final row-count diff to stdout.
 *
 * User approved 2026-10-01 to apply (default threshold ≥ 0.85).
 *
 * Usage:
 *   tsx 04-Normalizer/_scripts/_apply-community-retag-migration.ts
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

for (const candidate of [process.cwd(), resolve(process.cwd(), '..'), resolve(process.cwd(), '../..')]) {
  dotenvConfig({ path: resolve(candidate, '.env') });
}

const PAT = process.env.SUPABASE_PAT;
if (!PAT) {
  console.error('[apply-retag] SUPABASE_PAT not set in .env');
  process.exit(2);
}
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const refMatch = SUPABASE_URL.match(/^https:\/\/([^.]+)\.supabase\.co/);
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? refMatch?.[1];
if (!PROJECT_REF) {
  console.error('[apply-retag] cannot derive project ref from SUPABASE_URL');
  process.exit(2);
}

const MIGRATION_PATH = resolve(
  '05-Supabase/migrations/2026-10-01-0001-retag-community-batch-dry-run.sql',
);

const BATCH_SIZE = 50; // UPDATEs per Management API call

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

interface UpdateStatement {
  id: string;
  newCategory: string;
  raw: string;
}

/**
 * Parse the dry-run SQL: extract only UPDATE events … WHERE id=… AND
 * category_slug='community' statements, strip comments, BEGIN, COMMIT.
 */
function parseUpdates(sql: string): UpdateStatement[] {
  // Strip SQL line-comments
  const cleaned = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const out: UpdateStatement[] = [];
  const stmtRegex = /UPDATE\s+events\s+SET\s+category_slug\s*=\s*'([^']+)',\s*updated_at\s*=\s*now\(\)\s+WHERE\s+id\s*=\s*'([^']+)'\s+AND\s+category_slug\s*=\s*'community'\s*;/gi;
  let match: RegExpExecArray | null;
  while ((match = stmtRegex.exec(cleaned)) !== null) {
    const [, newCategory, id] = match;
    out.push({
      id,
      newCategory,
      raw: match[0],
    });
  }
  return out;
}

async function runQuery(query: string): Promise<unknown> {
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
  return res.json();
}

async function getCategoryCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('category_slug')
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (data && data.length > 0) {
      for (const row of data) {
        const slug = (row as { category_slug: string | null }).category_slug ?? '(null)';
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
      offset += data.length;
      hasMore = data.length === 1000;
    } else {
      hasMore = false;
    }
  }
  return counts;
}

async function main(): Promise<void> {
  console.log(`[apply-retag] project_ref=${PROJECT_REF}`);
  console.log(`[apply-retag] reading ${MIGRATION_PATH}`);

  const sql = readFileSync(MIGRATION_PATH, 'utf-8');
  const updates = parseUpdates(sql);
  console.log(`[apply-retag] parsed ${updates.length} UPDATE statements`);

  if (updates.length === 0) {
    console.error('[apply-retag] No UPDATE statements found — aborting.');
    process.exit(3);
  }

  // Pre-apply snapshot
  const before = await getCategoryCounts();
  console.log('[apply-retag] ── BEFORE ──');
  for (const [slug, n] of Array.from(before.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slug.padEnd(22)} ${n}`);
  }

  // Batch and execute
  const totalBatches = Math.ceil(updates.length / BATCH_SIZE);
  let success = 0;
  let errors = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const query = batch.map((u) => u.raw).join('\n');
    console.log(`[apply-retag] batch ${batchNum}/${totalBatches} (${batch.length} updates)…`);
    try {
      await runQuery(query);
      success += batch.length;
    } catch (err) {
      errors += batch.length;
      console.error(`  ❌ batch ${batchNum} failed:`, err instanceof Error ? err.message : err);
      throw err; // abort on any failure (don't continue with partial state)
    }
  }

  console.log(`[apply-retag] ✅ ${success} updates applied, ${errors} errors`);

  // Post-apply snapshot
  const after = await getCategoryCounts();
  console.log('[apply-retag] ── AFTER ──');
  for (const [slug, n] of Array.from(after.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slug.padEnd(22)} ${n}`);
  }

  // Diff
  console.log('[apply-retag] ── DIFF (positive = grew) ──');
  const allSlugs = new Set([...before.keys(), ...after.keys()]);
  for (const slug of Array.from(allSlugs).sort()) {
    const b = before.get(slug) ?? 0;
    const a = after.get(slug) ?? 0;
    const diff = a - b;
    if (diff !== 0) {
      console.log(`  ${slug.padEnd(22)} ${String(b).padStart(5)} → ${String(a).padStart(5)}  (${diff >= 0 ? '+' : ''}${diff})`);
    }
  }
}

main().catch((err) => {
  console.error('[apply-retag] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
