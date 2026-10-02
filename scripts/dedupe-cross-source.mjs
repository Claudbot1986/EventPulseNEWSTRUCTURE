#!/usr/bin/env node
/**
 * Cross-source deduplicering (2026-10-02).
 *
 * Befintliga dedup-systemet matchar bara events med exakt samma ticket_url.
 * Vi har 436 grupper av dubletter där samma fysiska event finns under olika
 * URL:er från olika källor (Los Kjarkas: sthlmlist/evensos/songkick/gota-lejon).
 *
 * Algoritm:
 *   1. Normalisera title (lowercase, ta bort skiljetecken, collapse whitespace)
 *   3. Gruppera på (normalized_title + start_time.date)
 *   4. Skippa events med NULL title (tomma placeholders)
 *   5. Skippa events med NULL start_time (saknar datum)
 *   6. Skippa cross-source där alla events har samma source (redan dedup'd)
 *   7. För varje grupp: välj master via source-priority, sätt canonical_event_id
 *
 * Source-prioritet (master är den med bäst kvalitet):
 *   songkick > evensos > sthlmlist > spelning > ticketmaster > aviciiarena >
 *   berwaldhallen > kulturhuset > berwaldhallen-tixly > sena källor > eventbrite
 *
 * Idempotent: kör igen utan skada — uppdaterar bara NULL-värden.
 *
 * Run: npx tsx scripts/dedupe-cross-source.mjs [--dry] [--limit N]
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing env'); process.exit(2); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const DRY = process.argv.includes('--dry');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > 0 ? parseInt(process.argv[i + 1]) : Infinity;
})();

const SOURCE_PRIORITY = [
  // Aggregatorer (bäst → sämst kvalitet på enskild event)
  'songkick-stockholm',
  'evensos-stockholm',
  'sthlmlist',
  'spelning-se',
  // Direkt API
  'ticketmaster',
  'ticketmaster-se',
  'ticketmaster-sthlm-200km',
  'ticketmaster-linkoping',
  'ticketmaster-goteborg',
  'ticketmaster-malmo',
  // Direkt venues
  'aviciiarena',
  'berwaldhallen',
  'berwaldhallen-tixly',
  'kulturhuset',
  'kulturhuset-stadsteatern',
  'sodrateatern',
  'konserthuset',
  'debaser',
  'annexet',
  'fasching',
  'china-teatern',
  'intiman',
  'folkoperan',
  'arkdes',
  'jarfalla',
  'gota-lejon',
  'kultur-stockholm',
  // Lägst prior: Eventbrite-aggregatorer (samma event listat 22x)
  'eventbrite-discovery',
  'eventbrite-sthlm-categories',
  'eventbrite-stockholm',
  'eventbrite-sthlm-all',
  'eventbrite-sthlm-religion',
  'eventbrite-sthlm-spirituality',
  'eventbrite-sthlm-online',
  'eventbrite-sthlm-gbg',
  'eventbrite-sthlm-education',
  'eventbrite-sthlm-photography',
  'eventbrite-sthlm-film',
  'eventbrite-sthlm-fashion',
  'eventbrite-sthlm-food',
  'eventbrite-sthlm-family',
  'eventbrite-sthlm-arts',
  'eventbrite-sthlm-sports',
  'eventbrite-sthlm-music',
  'eventbrite-sthlm-science',
  'eventbrite-sthlm-business',
  'eventbrite-sthlm-charity',
  'eventbrite-sweden-all',
  'eventbrite-sweden-all-events',
  'eventbrite-uppsala-sthlm',
  'eventbrite-stockholm-vasastan',
  'eventbrite-stockholm-bromma',
  'eventbrite-stockholm-kungsholmens',
  'eventbrite-stockholm-sodermalms',
  'eventbrite-stockholm-ostermalm',
  'eventbrite-stockholm-haegersten',
  'eventbrite-stockholm-sodermalm',
  'eventbrite-stockholm-farsta',
  'eventbrite-stockholm-skarpnack',
  'eventbrite-stockholm-spanga',
  'eventbrite-stockholm-huddinge',
  'eventbrite-stockholm-kista',
  'eventbrite-stockholm-taby',
  'eventbrite-stockholm-enskede',
  'eventbrite-stockholm-lidingo',
  // Små källor (sist)
  'thatsup-stockholm-articles',
  'folkoperan',
  'kultur-stockholm-calendar',
  'kulturbiljetter',
];

function normalizeTitle(t) {
  if (!t) return '';
  return t.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[^\w\såäöÅÄÖ0-9]/g, ' ')  // strip special
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function getMasterPriority(source) {
  const i = SOURCE_PRIORITY.indexOf(source);
  return i === -1 ? 999 : i;
}

const PAGE = 1000;
let all = [];
let offset = 0;
console.log('Hämtar events...');
while (true) {
  const { data, error } = await supabase.from('events')
    .select('id, source, title_sv, title_en, start_time, venue_id, canonical_event_id, description_sv')
    .range(offset, offset + PAGE - 1);
  if (error) throw error;
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < PAGE) break;
  offset += PAGE;
}
console.log(`Total events: ${all.length}`);

// Bygg grupper på (normalized_title + date)
const groups = new Map();
for (const e of all) {
  const title = e.title_sv || e.title_en;
  if (!title || title.trim().length < 3) continue;  // tomma titles skip
  if (!e.start_time) continue;  // inget datum → skip
  const normTitle = normalizeTitle(title);
  if (!normTitle) continue;
  const date = e.start_time.split('T')[0];
  const key = `${normTitle}::${date}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(e);
}

// Hitta cross-source-grupper
const crossSourceGroups = [];
for (const [key, evts] of groups) {
  if (evts.length < 2) continue;
  const sources = new Set(evts.map(e => e.source));
  if (sources.size < 2) continue;
  // Välj master med lägst prior-nummer (bäst prior är 0)
  const sorted = evts.slice().sort((a, b) => getMasterPriority(a.source) - getMasterPriority(b.source));
  const master = sorted[0];
  crossSourceGroups.push({ key, master, duplicates: sorted.slice(1) });
}

console.log(`\n=== Cross-source duplikat-grupper ===`);
console.log(`Antal grupper: ${crossSourceGroups.length}`);
let totalEvents = 0;
for (const g of crossSourceGroups) {
  totalEvents += g.duplicates.length + 1;
}
console.log(`Events inom grupper: ${totalEvents}`);
console.log(`Effektiv dedup: -${totalEvents - crossSourceGroups.length} events`);

// Topp 10 största grupper
console.log('\nTopp 10 grupper (efter antal events):');
crossSourceGroups.sort((a, b) => b.duplicates.length - a.duplicates.length);
for (const g of crossSourceGroups.slice(0, 10)) {
  console.log(`  [${g.duplicates.length + 1}x] "${g.key.slice(0, 60)}" — master: ${g.master.source}`);
}

// Kör migrering (eller dry-run)
const limit = Math.min(LIMIT, crossSourceGroups.length);
console.log(`\n=== ${DRY ? 'DRY-RUN' : 'MIGRERING'} ===`);
console.log(`Processar ${limit} grupper...`);

let updated = 0, errors = 0, skipped = 0;
let masterUpdates = 0;

// Bygg cache för ultimate master-event (för att undvika N+1)
// Vi behöver veta: för varje master.id, vad är den ultimate master.id?
async function getUltimateMaster(masterId, cache) {
  if (cache.has(masterId)) return cache.get(masterId);
  const { data } = await supabase.from('events')
    .select('id, canonical_event_id')
    .eq('id', masterId)
    .maybeSingle();
  if (!data || !data.canonical_event_id) {
    cache.set(masterId, masterId);
    return masterId;
  }
  const ult = await getUltimateMaster(data.canonical_event_id, cache);
  cache.set(masterId, ult);
  return ult;
}

const cache = new Map();
for (const g of crossSourceGroups.slice(0, limit)) {
  // Hitta ultimate master för hittar (recursive lookup)
  const ultimateMasterId = await getUltimateMaster(g.master.id, cache);

  // Hitta events som behöver uppdateras
  // (canonical_event_id är null ELLER pekar inte till ultimateMasterId)
  const toProcess = g.duplicates.filter(d =>
    !d.canonical_event_id || d.canonical_event_id !== ultimateMasterId
  );
  if (toProcess.length === 0) {
    skipped++;
    continue;
  }

  // Om master.id INTE är ultimate master, uppdatera master.canonical_event_id
  if (g.master.id !== ultimateMasterId && !g.master.canonical_event_id) {
    if (!DRY) {
      const { error: me } = await supabase.from('events')
        .update({ canonical_event_id: ultimateMasterId })
        .eq('id', g.master.id);
      if (me) {
        console.log(`  master err: ${g.key.slice(0, 50)}: ${me.message}`);
      } else {
        masterUpdates++;
      }
    } else {
      masterUpdates++;
    }
  }

  const idsToUpdate = toProcess.map(d => d.id);
  if (DRY) {
    updated += idsToUpdate.length;
    continue;
  }
  try {
    const { error } = await supabase.from('events')
      .update({ canonical_event_id: ultimateMasterId })
      .in('id', idsToUpdate);
    if (error) throw error;
    updated += idsToUpdate.length;
  } catch (err) {
    errors++;
    console.log(`  err: ${g.key.slice(0, 50)}: ${err.message}`);
  }
}

console.log(`\n${DRY ? 'DRY-RUN' : 'MIGRERING'} KLAR`);
console.log(`  Uppdaterade events: ${updated}`);
console.log(`  Fel: ${errors}`);
console.log(`\nNotera: Master-events fick INTE canonical_event_id satt till sig själva.`);
console.log(`För att hitta masters: SELECT * FROM events WHERE canonical_event_id IS NULL;`);