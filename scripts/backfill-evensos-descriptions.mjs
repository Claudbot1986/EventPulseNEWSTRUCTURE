import { createClient } from '@supabase/supabase-js';
import { extractEvents } from '/Users/claudgashi/EventPulse/02-Ingestion/F-eventExtraction/universal-extractor.ts';
import { extractFromJsonLd } from '/Users/claudgashi/EventPulse/02-Ingestion/F-eventExtraction/extractor.ts';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const SOURCE = 'evensos-stockholm';
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
  console.log('[backfill-evensos] START');
  const events = await fetchAll();
  console.log('[backfill-evensos] fetched', events.length, 'events');

  const byUrl = new Map();
  for (const e of events) {
    if (!e.ticket_url) continue;
    if (!byUrl.has(e.ticket_url)) byUrl.set(e.ticket_url, []);
    byUrl.get(e.ticket_url).push(e);
  }

  let updated = 0, skipped = 0, errored = 0;
  for (const [url, urlEvents] of byUrl) {
    if (urlEvents.some(e => !isEmpty(e.description_sv) || !isEmpty(e.description_en))) { skipped++; continue; }
    try {
      const html = await fetchHtml(url);
      const r1 = extractFromJsonLd(html, SOURCE, url);
      const r2 = extractEvents(html, SOURCE, url);
      const all = [...r1.events, ...r2.events];
      const desc = all.find(e => e.description && e.description.trim().length >= 10)?.description;
      if (!desc) { skipped++; continue; }
      const { error } = await supabase.from('events')
        .update({ description_sv: desc, description_en: desc })
        .in('id', urlEvents.map(e => e.id));
      if (error) throw error;
      updated++;
      if (updated % 50 === 0 || updated < 3) {
        console.log(`[backfill-evensos] ${updated} URLs done. Last: ${url.slice(0, 60)}...`);
      }
    } catch (err) {
      console.error('[backfill-evensos] ERROR', url, err.message);
      errored++;
    }
  }
  console.log(`\n[backfill-evensos] DONE: ${updated} updated, ${skipped} skipped, ${errored} errored`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
