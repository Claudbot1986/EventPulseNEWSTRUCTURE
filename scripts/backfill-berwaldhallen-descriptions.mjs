#!/usr/bin/env node
/**
 * Backfill berwaldhallen descriptions via event info page (Round 3).
 *
 * Strategi (per användarens direktiv 2026-10-02):
 *   - Köpknappen (ticket_url) = boka.berwaldhallen.se/sv/buyingflow/tickets/{id}/
 *     → BEHÅLLS som den är (användare klickar här för att köpa biljetter).
 *   - Beskrivning = boka.berwaldhallen.se/sv/event/{id}/{slug}/
 *     → HÄMTAS via ScrapingBee (köpflödet är JS-renderat Tix-spa).
 *
 * Pipeline per unik ticket_url:
 *   1. Hämta köpflödet via worker (icke-JS — räcker för att hitta länken)
 *   2. Extrahera /sv/event/{id}/{slug}/ länken
 *   3. Hämta eventsidan via ScrapingBee (render_js=true, premium_proxy=true)
 *   4. Plocka description från .event-description / [class*=description]
 *      eller första <p> med >200 tecken efter konsert-titel
 *   5. Uppdatera description_sv + description_en för alla events
 *      med matchande ticket_url
 *
 * Idempotent — hoppar över URLs där något event redan har description.
 *
 * Run: npx tsx scripts/backfill-berwaldhallen-descriptions.mjs
 */

import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { load } from 'cheerio';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_KEY = process.env.SCRAPINGBEE_API_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY || !SB_KEY) {
  console.error('Missing SUPABASE_URL/SERVICE_ROLE_KEY/SCRAPINGBEE_API_KEY');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const SOURCES = ['berwaldhallen', 'berwaldhallen-tixly'];
const PAGE = 1000;

async function fetchAll() {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('events')
      .select('id, ticket_url, description_sv, description_en, source')
      .in('source', SOURCES).range(from, from + PAGE - 1);
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

async function fetchViaScrapingBee(url) {
  const r = await axios.get('https://app.scrapingbee.com/api/v1/', {
    params: {
      api_key: SB_KEY,
      url,
      render_js: 'true',
      premium_proxy: 'true',
      country_code: 'se',
      block_resources: 'true',
      wait: 3000,
    },
    timeout: 60000,
    responseType: 'text',
  });
  return String(r.data || '');
}

/**
 * Given a buying-flow URL like
 *   https://boka.berwaldhallen.se/sv/buyingflow/tickets/28822/
 * or
 *   https://boka.berwaldhallen.se/sv/buyingflow/tickets/28822/119632/
 * return the corresponding event-info URL slug by fetching the buying-flow
 * page and extracting the /sv/event/{id}/{slug}/ link.
 */
async function buyingFlowToEventUrl(buyingFlowUrl) {
  // Pattern: /sv/buyingflow/tickets/{event_id}/{concert_id}?/
  const m = buyingFlowUrl.match(/\/tickets\/(\d+)/);
  if (!m) return null;
  const eventId = m[1];
  try {
    const html = await fetchHtml(buyingFlowUrl);
    const $ = load(html);
    // Find /sv/event/{eventId}/... link
    const link = $(`a[href*="/sv/event/${eventId}/"]`).first().attr('href');
    if (!link) return null;
    // Make absolute
    if (link.startsWith('http')) return link;
    return new URL(link, buyingFlowUrl).toString();
  } catch (err) {
    console.error(`[berw] fetch error for ${buyingFlowUrl}:`, err.message);
    return null;
  }
}

/**
 * Extract description from rendered event page.
 * Strategy: look for .event-description block; fallback to first <p> with >200 chars.
 */
function extractDescriptionFromRevent(html) {
  const $ = load(html);

  // Preferred — explicit description block
  let desc = $('.event-description').first().text().trim();
  if (desc.length < 50) {
    desc = $('[class*="description"]').first().text().trim();
  }

  // Fallback — first long paragraph after the title
  if (desc.length < 50) {
    $('p').each((_, el) => {
      if (desc.length >= 50) return;
      const text = $(el).text().trim();
      if (text.length > 200 && !text.toLowerCase().includes('cookie')) {
        desc = text;
      }
    });
  }

  // Cleanup — strip HTML entities, collapse whitespace
  desc = desc.replace(/\s+/g, ' ').trim();
  if (desc.length < 50) return null;
  // Truncate to reasonable size (DB column is TEXT but <1000 keeps it useful)
  return desc.slice(0, 1000);
}

function isEmpty(v) { return v == null || String(v).trim().length < 10; }

async function main() {
  console.log(`[backfill-berw] START ${new Date().toISOString()}`);
  const events = await fetchAll();
  console.log(`[backfill-berw] fetched ${events.length} events from sources ${SOURCES.join(', ')}`);

  const byUrl = new Map();
  for (const e of events) {
    if (!e.ticket_url) continue;
    if (!byUrl.has(e.ticket_url)) byUrl.set(e.ticket_url, []);
    byUrl.get(e.ticket_url).push(e);
  }
  console.log(`[backfill-berw] unique URLs: ${byUrl.size}`);

  let updated = 0, skipped = 0, errored = 0;
  let creditsUsed = 0;
  const log = [];

  for (const [buyingFlowUrl, urlEvents] of byUrl) {
    if (urlEvents.some(e => !isEmpty(e.description_sv) || !isEmpty(e.description_en))) {
      skipped++;
      continue;
    }
    try {
      const eventInfoUrl = await buyingFlowToEventUrl(buyingFlowUrl);
      if (!eventInfoUrl) {
        log.push({ buyingFlowUrl, status: 'NO_EVENT_LINK' });
        skipped++;
        continue;
      }
      const html = await fetchViaScrapingBee(eventInfoUrl);
      creditsUsed += 10; // premium+JS = ~5-10 cr
      const desc = extractDescriptionFromRevent(html);
      if (!desc) {
        log.push({ buyingFlowUrl, eventInfoUrl, status: 'NO_DESC_IN_HTML' });
        skipped++;
        continue;
      }
      const { error } = await supabase.from('events')
        .update({ description_sv: desc, description_en: desc })
        .in('id', urlEvents.map(e => e.id));
      if (error) throw error;
      updated++;
      log.push({
        buyingFlowUrl,
        eventInfoUrl,
        status: 'OK',
        count: urlEvents.length,
        desc_preview: desc.slice(0, 80),
      });
      console.log(`[berw] OK [${updated}/${urlEvents.length}] ${buyingFlowUrl} → ${desc.slice(0, 60)}...`);
    } catch (err) {
      log.push({ buyingFlowUrl, status: 'ERROR', error: err.message });
      errored++;
      console.error(`[berw] ERROR ${buyingFlowUrl}:`, err.message);
    }
  }

  console.log(`\n[backfill-berw] DONE`);
  console.log(`  unique URLs processed: ${byUrl.size}`);
  console.log(`  URLs updated:          ${updated}`);
  console.log(`  URLs skipped:          ${skipped} (already had desc or no desc on info page)`);
  console.log(`  URLs errored:          ${errored}`);
  console.log(`  ScrapingBee credits:   ~${creditsUsed} (estimate)`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });