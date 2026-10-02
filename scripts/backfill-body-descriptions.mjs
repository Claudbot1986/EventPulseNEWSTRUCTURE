#!/usr/bin/env node
/**
 * Generic body description backfill (Round 2 utökning).
 *
 * Efter page-level body-fallback lades till i universal-extractor (commit 5fb9978)
 * kan vi nu backfilla description för källor som A1/A2/B/C hittar events på men
 * där description saknas. Tidigare backfill-script kördes innan body-fallback
 * var på plats — denna körning fångar events som behöver body fallback.
 *
 * Målkällor (per live DB 2026-10-02):
 *   - aviciiarena (29 events, 0%) — JSON-LD med raw entities, fixas via entity-avkodning
 *   - annexet (15 events, 0%) — body fallback
 *   - arkdes (7 events, 0%) — body fallback
 *   - mosebacke-2 (6 events, 0%) — body fallback
 *   - stockholm-live (13 events, 0%) — body fallback
 *   - konserthuset (2 events, 0%) — body fallback
 *   - hovet/friends/strawberryarena (3-4 events vardera, 0%) — body fallback
 *
 * Skippa:
 *   - ticketmaster-familjen (bot-blockerad, HTTP 401)
 *   - berwaldhallen-tixly (bot-blockerad)
 *   - gratisistockholm (saknar microdata/time-element, behöver ny source-adapter)
 *   - kultur-stockholm (WordPress utan JSON-LD)
 *   - gota-lejon (template-meta utan riktig text)
 *
 * Idempotent — hoppar över events där description redan finns.
 *
 * Run: npx tsx scripts/backfill-body-descriptions.mjs [source1] [source2] ...
 *      (utan args = kör mot alla stödda)
 */

import { createClient } from '@supabase/supabase-js';
import { extractEvents } from '../02-Ingestion/F-eventExtraction/universal-extractor.ts';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing env'); process.exit(2); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const TARGET_SOURCES = process.argv.length > 2
  ? process.argv.slice(2)
  : ['aviciiarena', 'annexet', 'arkdes', 'mosebacke-2', 'stockholm-live', 'konserthuset', 'hovetarena', 'friendsarena', 'strawberryarena', 'tele2arena', 'globen-3', '3arena'];

const PAGE = 1000;

async function fetchEventsForSource(source) {
  const events = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('events')
      .select('id, ticket_url, description_sv, description_en')
      .eq('source', source)
      .or('description_sv.is.null,description_en.is.null')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    events.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return events;
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
  console.log(`[backfill-body] BEGIN ${new Date().toISOString()}`);
  console.log(`[backfill-body] targets: ${TARGET_SOURCES.join(', ')}`);

  const allLog = [];
  let totalFetched = 0, totalUpdated = 0, totalSkipped = 0, totalErrored = 0;

  for (const source of TARGET_SOURCES) {
    console.log(`\n──── ${source} ────`);
    let events;
    try {
      events = await fetchEventsForSource(source);
    } catch (e) {
      console.log(`  [ERROR] fetch failed: ${e.message}`);
      totalErrored++;
      continue;
    }
    console.log(`  events without desc: ${events.length}`);
    totalFetched += events.length;
    if (events.length === 0) continue;

    // Gruppera per URL (försök hämta sidan en gång per URL, uppdatera alla events)
    const byUrl = new Map();
    for (const e of events) {
      const u = e.ticket_url;
      if (!u) continue;
      if (!byUrl.has(u)) byUrl.set(u, []);
      byUrl.get(u).push(e);
    }
    console.log(`  unique URLs: ${byUrl.size}`);

    let sourceUpdated = 0, sourceSkipped = 0, sourceErrored = 0;

    for (const [url, urlEvents] of byUrl) {
      try {
        const html = await fetchHtml(url);
        if (!html || html.length < 100) {
          sourceSkipped++;
          allLog.push({ source, url, status: 'EMPTY' });
          continue;
        }
        const result = extractEvents(html, source, url);
        const desc = result.events.find(e => e.description && e.description.trim().length >= 10)?.description;
        if (!desc) {
          sourceSkipped++;
          allLog.push({ source, url, status: 'NO_DESC', eventsExtracted: result.events.length });
          continue;
        }
        const ids = urlEvents.map(e => e.id);
        const { error } = await supabase.from('events')
          .update({ description_sv: desc, description_en: desc })
          .in('id', ids);
        if (error) throw error;
        sourceUpdated += ids.length;
        totalUpdated += ids.length;
        allLog.push({ source, url, status: 'OK', count: ids.length, preview: desc.slice(0, 60) });
      } catch (err) {
        sourceErrored++;
        totalErrored++;
        allLog.push({ source, url, status: 'ERROR', error: err.message });
      }
    }

    console.log(`  updated: ${sourceUpdated} | skipped: ${sourceSkipped} | errored: ${sourceErrored}`);
    totalSkipped += sourceSkipped;
    totalErrored += sourceErrored;
  }

  console.log(`\n[backfill-body] DONE`);
  console.log(`  total events fetched: ${totalFetched}`);
  console.log(`  total events updated: ${totalUpdated}`);
  console.log(`  total URLs skipped:   ${totalSkipped}`);
  console.log(`  total URLs errored:   ${totalErrored}`);

  // Per-källa summering
  const bySource = new Map();
  for (const l of allLog.filter(x => x.status === 'OK')) {
    bySource.set(l.source, (bySource.get(l.source) || 0) + l.count);
  }
  if (bySource.size > 0) {
    console.log('\nUpdatering per source');
    for (const [s, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${s.padEnd(30)} ${n} events`);
    }
  }

  // Failed
  const failed = allLog.filter(l => l.status !== 'OK');
  if (failed.length > 0) {
    console.log(`\nFailed/empty (${failed.length} URLs):`);
    for (const f of failed.slice(0, 30)) {
      console.log(`  [${f.status}] ${f.source} ${f.url?.slice(0, 80)}`);
    }
    if (failed.length > 30) console.log(`  ... +${failed.length - 30} more`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });