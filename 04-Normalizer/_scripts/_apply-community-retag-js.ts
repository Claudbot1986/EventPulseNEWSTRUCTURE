/**
 * _apply-community-retag-js.ts
 *
 * Fallback path when SUPABASE_PAT is unavailable: uses the Supabase JS
 * client with the service role key to apply each UPDATE individually.
 * Slower than the Management API route (~603 round-trips, ~30-60s) but
 * works with only SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Reads:
 *   05-Supabase/migrations/2026-10-01-0001-retag-community-batch-dry-run.sql
 *
 * Approved 2026-10-01.
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

for (const candidate of [process.cwd(), resolve(process.cwd(), '..'), resolve(process.cwd(), '../..')]) {
  dotenvConfig({ path: resolve(candidate, '.env') });
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[apply-retag-js] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(2);
}

const MIGRATION_PATH = resolve(
  '05-Supabase/migrations/2026-10-01-0001-retag-community-batch-dry-run.sql',
);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

interface UpdateStatement {
  id: string;
  newCategory: string;
}

function parseUpdates(sql: string): UpdateStatement[] {
  const cleaned = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const out: UpdateStatement[] = [];
  const stmtRegex = /UPDATE\s+events\s+SET\s+category_slug\s*=\s*'([^']+)',\s*updated_at\s*=\s*now\(\)\s+WHERE\s+id\s*=\s*'([^']+)'\s+AND\s+category_slug\s*=\s*'community'\s*;/gi;
  let match: RegExpExecArray | null;
  while ((match = stmtRegex.exec(cleaned)) !== null) {
    out.push({
      id: match[2],
      newCategory: match[1],
    });
  }
  return out;
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
  const sql = readFileSync(MIGRATION_PATH, 'utf-8');
  const updates = parseUpdates(sql);
  console.log(`[apply-retag-js] parsed ${updates.length} UPDATE statements`);

  const before = await getCategoryCounts();
  console.log('[apply-retag-js] ── BEFORE ──');
  for (const [slug, n] of Array.from(before.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slug.padEnd(22)} ${n}`);
  }
  const beforeCommunity = before.get('community') ?? 0;
  console.log(`[apply-retag-js] community bucket size before: ${beforeCommunity}`);

  let success = 0;
  let skipped = 0; // event no longer in community (changed by another process)
  let errors = 0;

  for (let i = 0; i < updates.length; i++) {
    const u = updates[i];
    const { error, count } = await supabase
      .from('events')
      .update({ category_slug: u.newCategory }, { count: 'exact' })
      .eq('id', u.id)
      .eq('category_slug', 'community'); // safety: only touches community

    if (error) {
      console.error(`  ❌ ${u.id} → ${u.newCategory}: ${error.message}`);
      errors++;
    } else if (count === 0) {
      // Event no longer in community — another process moved it. Skip silently.
      skipped++;
    } else {
      success++;
    }

    if ((i + 1) % 50 === 0) {
      console.log(`[apply-retag-js] progress: ${i + 1}/${updates.length} (success=${success}, skipped=${skipped}, errors=${errors})`);
    }
  }

  console.log(`[apply-retag-js] ✅ done: success=${success}, skipped=${skipped}, errors=${errors}`);

  const after = await getCategoryCounts();
  console.log('[apply-retag-js] ── AFTER ──');
  for (const [slug, n] of Array.from(after.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slug.padEnd(22)} ${n}`);
  }

  const afterCommunity = after.get('community') ?? 0;
  const communityDelta = beforeCommunity - afterCommunity;
  console.log(`[apply-retag-js] ── community: ${beforeCommunity} → ${afterCommunity} (−${communityDelta} events moved)`);

  // Diff
  console.log('[apply-retag-js] ── DIFF (positive = grew) ──');
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
  console.error('[apply-retag-js] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
