// scripts/extract-friendsarena.mjs — Hämta events från Strawberry Arena
// (tidigare Friends Arena, friendsarena.se) via JSON-LD ItemList på /evenemang.
//
// 2026-10-04: Strawberry Arena (före detta Friends Arena) har en JSON-LD
// ItemList-schema.org/Event-struktur på /evenemang-sidan. Detta script
// parsar den och skriver/uppdarer events_public-rader.
//
// Användning:
//   cd /Users/claudgashi/EventPulse && node scripts/extract-friendsarena.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Supabase credentials ──────────────────────────────────────────────────────
function loadEnv() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf8');
      for (const line of raw.split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (!m) continue;
        if (process.env[m[1]] == null) process.env[m[1]] = m[2];
      }
      return;
    } catch {}
  }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const { createClient } = await import('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DRY_RUN = process.argv.includes('--dry-run');
const SOURCE = 'friendsarena';
const VENUE_NAME = 'Strawberry Arena';
const VENUE_LAT = 59.3646; // Strawberry Arena, Solna (befintliga events har dessa koordinater)
const VENUE_LNG = 17.9969;

// ─── Hämta /evenemang och extrahera ItemList ─────────────────────────────────
async function fetchEvents() {
  // friendsarena.se redirectar till strawberryarena.se. Vi följer redirect.
  const res = await fetch('https://friendsarena.se/evenemang/', {
    headers: {
      'User-Agent': 'EventPulse-Ingestion/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for /evenemang`);
  const html = await res.text();
  console.log(`[friendsarena] Hämtade ${html.length} chars (final URL: ${res.url})`);

  // Extract JSON-LD ItemList
  const matches = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  let events = [];
  for (const m of matches) {
    try {
      const data = JSON.parse(m[1]);
      if (data['@type'] === 'ItemList' && Array.isArray(data.itemListElement)) {
        for (const item of data.itemListElement) {
          const e = item.item;
          if (e['@type'] === 'Event' && e.startDate && e.name && e.url) {
            events.push({
              title: e.name,
              url: e.url,
              startDate: e.startDate,
            });
          }
        }
      }
    } catch (err) {
      // JSON parse error — skip
    }
  }
  return events;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function decodeEntities(s) {
  return s
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8220;/g, '\u201c')
    .replace(/&#8221;/g, '\u201d')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// ─── Huvudflöde ─────────────────────────────────────────────────────────────
async function main() {
  const rawEvents = await fetchEvents();
  console.log(`[friendsarena] Hittade ${rawEvents.length} events i JSON-LD ItemList`);

  const now = new Date();
  const future = rawEvents
    .map((e) => ({
      ...e,
      title: decodeEntities(e.title),
      startTime: e.startDate, // ISO 8601 från schema.org
    }))
    .filter((e) => new Date(e.startTime) > now);

  console.log(`[friendsarena] Efter framtidsfilter: ${future.length}`);

  if (future.length === 0) {
    console.log('Inga framtida events — avbryter.');
    return;
  }

  // Sample
  console.log('\nSample:');
  for (const e of future.slice(0, 3)) {
    console.log(`  ${e.startTime} - ${e.title}`);
    console.log(`    url: ${e.url}`);
  }

  // Bygg event-rader
  const nowIso = new Date().toISOString();
  const rows = future.map((e) => ({
    title_sv: e.title,
    title_en: e.title,
    start_time: e.startTime,
    lat: VENUE_LAT,
    lng: VENUE_LNG,
    ticket_url: e.url,
    source: SOURCE,
    category_slug: 'sports', // Strawberry Arena primärt sport
    is_free: false,
    link_status: 'live',
    link_last_checked_at: nowIso,
    status: 'published',
    confidence_score: 75,
    freshness_at: nowIso,
  }));

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Skulle skriva/ovrende följande rader:');
    for (const r of rows) console.log(`  ${r.start_time} - ${r.title_sv}`);
    console.log(`Totalt: ${rows.length}`);
    return;
  }

  // Rensa befintliga friendsarena-rader för idempotency
  console.log(`\n[friendsarena] Rensar befintliga ${SOURCE}-rader...`);
  const { error: clearErr } = await supabase
    .from('events')
    .delete()
    .eq('source', SOURCE);
  if (clearErr) {
    console.warn(`  Rensning misslyckades: ${clearErr.message}`);
  } else {
    console.log('  Rensning klar.');
  }

  // Insert
  console.log(`\n[friendsarena] Skickar ${rows.length} events till Supabase...`);
  let ok = 0, fail = 0;
  for (const r of rows) {
    const { error } = await supabase.from('events').insert(r);
    if (error) {
        fail++;
        if (fail <= 3) console.warn(`  fail: ${error.message.slice(0, 200)}`);
      } else ok++;
  }
  console.log(`\n[friendsarena] OK: ${ok}, Fail: ${fail}`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});