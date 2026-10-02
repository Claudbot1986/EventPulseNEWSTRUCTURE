#!/usr/bin/env node
/**
 * Ticketmaster description backfill via Discovery API (2026-10-02).
 *
 * Round 2-status identifierade ticketmaster-familjen (~220 utan beskrivning) som
 * "bot-blockerad" — men den klassificeringen var FEL. Vi HAR en Discovery
 * API-integration (`ticketmaster.ts` adapter) som returnerar hela event-datan
 * inklusive `info`-fältet (description). Anledning att DB ändå är tom:
 *
 *   1. Källan är quarantine'nd av link-health-trigger (cf>=2) — körs inte automatiskt
 *   2. Adaptern sätter `description: ev.info ?? null` men rule 3 (venue.country=SE)
 *      i descriptionRouting kräver venue.country från `venues`-lookup, vilket vi inte
 *      alltid lyckas slå upp
 *   3. Befintliga events har inte description_sv pga ovanstående
 *
 * Denna backfill gör DIREKT API-anrop för varje event-ID och uppdaterar description_sv
 * + description_en utan att gå via HTML-scraping. Inga bot-SVP-bypass behövs.
 *
 * API-dokumentation: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 *
 * Run: npx tsx scripts/backfill-ticketmaster-descriptions.mjs
 */

import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TM_API_KEY = process.env.TICKETMASTER_API_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing SUPABASE env'); process.exit(2); }
if (!TM_API_KEY) { console.error('Missing TICKETMASTER_API_KEY'); process.exit(2); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const TM_SOURCES = [
  'ticketmaster', 'ticketmaster-se', 'ticketmaster-sthlm-200km',
  'ticketmaster-linkoping', 'ticketmaster-goteborg', 'ticketmaster-malmo'
];

const PAGE = 1000;

async function fetchEventsWithoutDesc(source) {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('events')
      .select('id, source_id, source, description_sv, description_en')
      .eq('source', source)
      .not('source_id', 'is', null)
      .or('description_sv.is.null,description_en.is.null')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function fetchEventFromApi(sourceId) {
  const r = await axios.get(`https://app.ticketmaster.com/discovery/v2/events/${sourceId}.json`, {
    params: { apikey: TM_API_KEY },
  });
  return r.data;
}

async function main() {
  console.log(`[backfill-ticketmaster] BEGIN ${new Date().toISOString()}`);
  let totalUpdated = 0, totalSkipped = 0, totalErrored = 0, totalNoInfo = 0;

  for (const source of TM_SOURCES) {
    console.log(`\n──── ${source} ────`);
    let events;
    try {
      events = await fetchEventsWithoutDesc(source);
    } catch (e) {
      console.log(`  [ERROR] fetch failed: ${e.message}`);
      totalErrored++;
      continue;
    }
    console.log(`  events without desc: ${events.length}`);
    if (events.length === 0) continue;

    let sourceUpdated = 0, sourceNoInfo = 0, sourceErrored = 0;

    for (const evt of events) {
      try {
        const tmEvent = await fetchEventFromApi(evt.source_id);
        const info = (tmEvent.info || '').trim();
        if (!info || info.length < 10) {
          sourceNoInfo++;
          continue;
        }
        // Cap description length
        const desc = info.slice(0, 1500);
        const { error } = await supabase.from('events')
          .update({ description_sv: desc, description_en: desc })
          .eq('id', evt.id);
        if (error) throw error;
        sourceUpdated++;
      } catch (err) {
        sourceErrored++;
      }
    }

    console.log(`  updated: ${sourceUpdated} | no-info (API returned tomt): ${sourceNoInfo} | errored: ${sourceErrored}`);
    totalUpdated += sourceUpdated;
    totalNoInfo += sourceNoInfo;
    totalErrored += sourceErrored;
  }

  console.log(`\n[backfill-ticketmaster] DONE`);
  console.log(`  total events updated: ${totalUpdated}`);
  console.log(`  total events utan info: ${totalNoInfo}`);
  console.log(`  total events errored:  ${totalErrored}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });