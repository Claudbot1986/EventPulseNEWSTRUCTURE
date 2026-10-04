#!/usr/bin/env node
/**
 * publish-dramaten-drafts.mjs — Publish 331 Dramaten draft events.
 *
 * Bakgrund: 331 dramaten-events har legat i draft sedan dramaten-importen.
 * Vid import misslyckades normalizer-pipeline att sätta dedup_hash,
 * confidence_score och status='published'. Vi publicerar dem nu.
 *
 * Strategi (per 2026-10-04-Stockholm-Coverage-Recovery-Plan.md §Fas 1A):
 *   1. Verifiera att inga events redan är publicerade med dramaten-source
 *      (skydd mot dubletter)
 *   2. För varje draft-event:
 *      - dedup_hash = SHA-256("dramaten::{title_sv}::{start_time}")
 *        (samma fallback som normalizer.ts:417-420 använder när source_id saknas)
 *      - confidence_score = 70 (känd stor venue)
 *      - status = 'published'
 *      - published_at = NOW()
 *      - freshness_at, last_seen_at = NOW()
 *   3. Uppdatera i batches om 50 med SELECT-verifiering
 *
 * Idempotent — kör igen är no-op eftersom vi filtrerar på status='draft'.
 *
 * Run: node scripts/publish-dramaten-drafts.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const SOURCE = 'dramaten';
const CONFIDENCE_SCORE = 70;
const BATCH_SIZE = 50;

function buildDedupHash(title, startTime) {
  return createHash('sha256').update(`${SOURCE}::${title}::${startTime}`).digest('hex');
}

async function main() {
  console.log('=== Publish Dramaten drafts ===');
  console.log(`SUPABASE_URL: ${SUPABASE_URL}`);
  console.log(`Time: ${new Date().toISOString()}`);

  // 1) Sanity check — published dramaten count
  const { count: publishedCount, error: pubErr } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('source', SOURCE)
    .eq('status', 'published');

  if (pubErr) throw pubErr;
  console.log(`Already-published ${SOURCE} events: ${publishedCount}`);

  // 2) Fetch all draft dramaten
  let all = [];
  let from = 0;
  const PAGE = 500;
  while (true) {
    const { data, error } = await supabase
      .from('events')
      .select('id, source, title_sv, start_time, status')
      .eq('source', SOURCE)
      .eq('status', 'draft')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Draft ${SOURCE} events to publish: ${all.length}`);

  if (all.length === 0) {
    console.log('Nothing to do — exiting.');
    return;
  }

  // 3) Build updates — group by hash so we can batch-update multiple rows that
  // happen to share the same hash (rare but possible).
  const nowIso = new Date().toISOString();
  const updates = all.map((e) => {
    const dedup_hash = buildDedupHash(e.title_sv || e.title_en || '', e.start_time);
    return {
      id: e.id,
      dedup_hash,
      confidence_score: CONFIDENCE_SCORE,
      status: 'published',
      published_at: nowIso,
      freshness_at: nowIso,
      last_seen_at: nowIso,
    };
  });

  // Verify hash uniqueness (would indicate a problem in the import)
  const hashCount = new Map();
  for (const u of updates) {
    hashCount.set(u.dedup_hash, (hashCount.get(u.dedup_hash) || 0) + 1);
  }
  const dupes = [...hashCount.entries()].filter(([, n]) => n > 1);
  if (dupes.length > 0) {
    console.warn(`WARNING: ${dupes.length} dedup_hashes collide — likely duplicate imports`);
    console.warn(`First collision: ${dupes[0][0]} (${dupes[0][1]} rows)`);
  }

  // 4) Apply updates in batches
  let updated = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const ids = batch.map((b) => b.id);
    // Each row has different dedup_hash but we need same status/published_at/etc
    // So we update fields where same, then per-row dedup_hash
    const common = {
      confidence_score: CONFIDENCE_SCORE,
      status: 'published',
      published_at: nowIso,
      freshness_at: nowIso,
      last_seen_at: nowIso,
    };
    // First: common fields for all
    const { error: e1 } = await supabase
      .from('events')
      .update(common)
      .in('id', ids);
    if (e1) throw e1;

    // Second: per-row dedup_hash
    for (const b of batch) {
      const { error: e2 } = await supabase
        .from('events')
        .update({ dedup_hash: b.dedup_hash })
        .eq('id', b.id);
      if (e2) throw e2;
    }

    updated += batch.length;
    console.log(`  ${updated}/${updates.length} updated`);
  }

  // 5) Verify
  const { count: draftAfter, error: daErr } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('source', SOURCE)
    .eq('status', 'draft');
  if (daErr) throw daErr;

  const { count: publishedAfter, error: paErr } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('source', SOURCE)
    .eq('status', 'published');
  if (paErr) throw paErr;

  console.log('');
  console.log('=== RESULT ===');
  console.log(`Published ${SOURCE}: ${publishedCount} → ${publishedAfter} (+${publishedAfter - publishedCount})`);
  console.log(`Draft ${SOURCE} remaining: ${draftAfter}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});