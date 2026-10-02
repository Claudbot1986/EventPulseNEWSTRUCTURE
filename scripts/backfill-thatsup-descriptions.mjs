#!/usr/bin/env node
/**
 * Backfill thatsup-stockholm-articles description using 5.3 universal-extractor.
 *
 * One-off script (2026-10-02). After 5.3, re-extract each unique article URL,
 * get the WebPage.description, and write it to all events sharing that
 * ticket_url in DB.
 *
 * Idempotent — running again only updates events whose description is empty.
 *
 * Run: node scripts/backfill-thatsup-descriptions.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { extractEvents } from '../02-Ingestion/F-eventExtraction/universal-extractor.ts';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const SOURCE = 'thatsup-stockholm-articles';
const PAGE = 1000;

async function fetchThathsupEvents() {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('events_public')
      .select('id, source, ticket_url, description_sv, description_en')
      .eq('source', SOURCE)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetch error: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function fetchHtml(url) {
  const r = await fetch('https://eventpulse-fetch-worker.eventpulsefetch.workers.dev/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return await r.text();
}

function isEmptyDescription(v) {
  return v == null || String(v).trim().length < 10;
}

async function main() {
  console.log(`[backfill-thatsup] START ${new Date().toISOString()}`);
  const events = await fetchThathsupEvents();
  console.log(`[backfill-thatsup] fetched ${events.length} thatsup events`);

  // Group events by ticket_url
  const byUrl = new Map();
  for (const e of events) {
    if (!e.ticket_url) continue;
    if (!byUrl.has(e.ticket_url)) byUrl.set(e.ticket_url, []);
    byUrl.get(e.ticket_url).push(e);
  }

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const urlCount = byUrl.size;

  for (const [url, urlEvents] of byUrl) {
    // Skip if any event already has description
    if (urlEvents.some((e) => !isEmptyDescription(e.description_sv) || !isEmptyDescription(e.description_en))) {
      skippedCount++;
      continue;
    }
    try {
      const html = await fetchHtml(url);
      const result = extractEvents(html, SOURCE, url);
      // Get the first description from extracted events (they share the page description)
      const firstDesc = result.events.find((e) => e.description && e.description.trim().length >= 10)?.description;
      if (!firstDesc) {
        console.log(`[backfill-thatsup] no description in ${url} (${result.events.length} events)`);
        skippedCount++;
        continue;
      }
      // Update all events with this URL
      const ids = urlEvents.map((e) => e.id);
      const { error } = await supabase
        .from('events_public')
        .update({ description_sv: firstDesc, description_en: firstDesc })
        .in('id', ids);
      if (error) throw error;
      console.log(`[backfill-thatsup] ${url} → ${ids.length} events, desc="${firstDesc.slice(0, 60)}..."`);
      updatedCount++;
    } catch (err) {
      console.error(`[backfill-thatsup] ERROR ${url}:`, err.message);
      errorCount++;
    }
  }

  console.log(`\n[backfill-thatsup] DONE`);
  console.log(`  URLs processed: ${urlCount}`);
  console.log(`  URLs updated:   ${updatedCount}`);
  console.log(`  URLs skipped:   ${skippedCount}`);
  console.log(`  URLs errored:   ${errorCount}`);
}

main().catch((err) => {
  console.error('[backfill-thatsup] FAILED:', err);
  process.exit(1);
});