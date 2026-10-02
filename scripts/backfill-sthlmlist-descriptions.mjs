#!/usr/bin/env node
/**
 * Backfill sthlmlist descriptions via destination URL (Round 2 §4).
 *
 * sthlmlist är en aggregator som pekar till andra venues (kulturhusetstadsteatern.se,
 * nalen.com, sodrateatern.com, berns.se, etc.). Många av dessa destinationssidor
 * har description (antingen i JSON-LD Event eller i meta-taggar), men sthlmlist-
 * adaptern bygger sitt eget Event-objekt utan description.
 *
 * One-off migration: hämta varje unik ticket_url, kör universal-extractor, plocka
 * description, uppdatera alla events med samma ticket_url.
 *
 * Idempotent — hoppar över URLs där något event redan har description.
 *
 * Run: npx tsx scripts/backfill-sthlmlist-descriptions.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { extractEvents } from '../02-Ingestion/F-eventExtraction/universal-extractor.ts';
import { extractFromJsonLd } from '../02-Ingestion/F-eventExtraction/extractor.ts';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing env'); process.exit(2); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const SOURCE = process.argv[2] || 'sthlmlist';
const PAGE = 1000;

async function fetchAll() {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('events')
      .select('id, ticket_url, description_sv, description_en')
      .eq('source', SOURCE).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function fetchHtml(url) {
  const r = await fetch('https://eventpulse-fetch-worker.eventpulsefetch.workers.dev/fetch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return await r.text();
}

function isEmpty(v) { return v == null || String(v).trim().length < 10; }

async function main() {
  console.log(`[backfill-sthlmlist] START ${new Date().toISOString()}`);
  const events = await fetchAll();
  console.log(`[backfill-sthlmlist] fetched ${events.length} events`);

  // Gruppera per ticket_url
  const byUrl = new Map();
  for (const e of events) {
    if (!e.ticket_url) continue;
    if (!byUrl.has(e.ticket_url)) byUrl.set(e.ticket_url, []);
    byUrl.get(e.ticket_url).push(e);
  }
  console.log(`[backfill-sthlmlist] unique URLs: ${byUrl.size}`);

  let updated = 0, skipped = 0, errored = 0;
  const log = [];

  for (const [url, urlEvents] of byUrl) {
    // Hoppa över om NÅGOT event redan har description
    if (urlEvents.some(e => !isEmpty(e.description_sv) || !isEmpty(e.description_en))) {
      skipped++;
      continue;
    }
    try {
      const html = await fetchHtml(url);
      if (!html || html.length < 100) {
        log.push({ url, status: 'EMPTY_HTML' });
        errored++;
        continue;
      }
      // Kör båda extraktorer (universal-extractor och extractFromJsonLd)
      // för att maximera chansen att fånga description.
      const r1 = extractEvents(html, SOURCE, url);
      const r2 = extractFromJsonLd(html, SOURCE, url);
      const all = [...r1.events, ...r2.events];
      const desc = all.find(e => e.description && e.description.trim().length >= 10)?.description;
      if (!desc) {
        log.push({ url, status: 'NO_DESC' });
        skipped++;
        continue;
      }
      const ids = urlEvents.map(e => e.id);
      const { error } = await supabase.from('events')
        .update({ description_sv: desc, description_en: desc })
        .in('id', ids);
      if (error) throw error;
      const eventCount = ids.length;
      updated++;
      log.push({ url, status: 'OK', count: eventCount, desc_preview: desc.slice(0, 80) });
    } catch (err) {
      log.push({ url, status: 'ERROR', error: err.message });
      errored++;
    }
  }

  console.log(`\n[backfill-sthlmlist] DONE`);
  console.log(`  unique URLs processed: ${byUrl.size}`);
  console.log(`  URLs updated:          ${updated}`);
  console.log(`  URLs skipped:          ${skipped} (already had desc or no desc on page)`);
  console.log(`  URLs errored:          ${errored}`);

  // Print summary of what got fixed
  const okBySource = new Map();
  for (const entry of log.filter(l => l.status === 'OK')) {
    try {
      const host = new URL(entry.url).hostname;
      okBySource.set(host, (okBySource.get(host) || 0) + entry.count);
    } catch {}
  }
  console.log('\nTop destination-domäner:');
  for (const [host, n] of [...okBySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${host.padEnd(40)} ${n} events`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });