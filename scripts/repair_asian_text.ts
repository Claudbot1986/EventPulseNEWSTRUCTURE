#!/usr/bin/env -S npx tsx
/**
 * repair_asian_text.ts — reparera icke-latina skript som läcker in i appen.
 *
 * Körs efter `scripts/check_asian_chars.ts` rapporterat fynd. Tre felklasser
 * hanteras:
 *
 *   1. LOKAL-LÄCKA — en rad i `venues` har ett namn i ett främmande skript
 *      (t.ex. "왕의 정원"). 1 000+ events pekade på den raden trots att de
 *      tillhör helt olika lokaler. Vi kopplar om varje event till den
 *      kurerade lokalen med samma namn, annars kopplar vi loss den
 *      (venue_id = null) så appen faller tillbaka på källans eget lokalnamn.
 *
 *   2. GENERERAD TEXT — `eventpulse_summary` och `editorial_description` är
 *      text vi genererat. Främmande skript där är alltid vårt fel:
 *        - innehåller frånsvaret TITELN → vi använder den svenska
 *          översättningen i summary:t och nollställer editorial-texten
 *          (den är AI-genererad och kan inte repareras deterministiskt);
 *        - annars → den främmande frasen tas bort.
 *
 *   3. EVENT MED FRÄMMANDE TITEL — titeln raderas ALDRIG. Den översätts
 *      (scripts/translate_foreign_titles.mjs) och summary:t byggs om med den
 *      översatta titeln, så den svenska appen visar svensk text.
 *
 * Summary genereras om med normalizerns deterministiska funktioner — ingen
 * LLM, ingen påhittad data.
 *
 * Användning:
 *   npx tsx --env-file=.env scripts/repair_asian_text.ts --dry-run
 *   npx tsx --env-file=.env scripts/repair_asian_text.ts --apply
 *
 * Exit: 0 = ok, 1 = fel under körning.
 */

import { createClient } from '@supabase/supabase-js';
import {
  buildEventpulseFacts,
  buildEventpulseSummary,
} from '../04-Normalizer/eventpulseSummary';
import {
  findForeignScriptRuns,
  isCompatibleWithLanguage,
} from '../packages/shared/src/text/scriptScan.js';

const PAGE = 1000;

type Args = { apply: boolean; language: string; limit: number };
function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, language: 'sv', limit: 0 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--language') args.language = argv[++i] ?? 'sv';
    else if (arg === '--limit') args.limit = Number.parseInt(argv[++i] ?? '', 10) || 0;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npx tsx scripts/repair_asian_text.ts [--dry-run|--apply] [--language TAG] [--limit N]');
      process.exit(0);
    }
  }
  return args;
}

/** Normalisera ett lokalnamn för jämförelse. */
function normalizeName(value: string | null | undefined): string {
  if (!value) return '';
  return value.toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '').trim();
}

async function fetchAll(sb: ReturnType<typeof createClient>, table: string, columns: string) {
  const rows: Array<Record<string, any>> = [];
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as Array<Record<string, any>>));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY krävs.');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const stats = {
    foreignVenues: 0,
    eventsRelinked: 0,
    eventsUnlinked: 0,
    venueNamesCleared: 0,
    summariesRegenerated: 0,
    summariesCleared: 0,
    editorialCleaned: 0,
    editorialCleared: 0,
    unchanged: 0,
  };

  // ── Lokaler med främmande skript i namnet ───────────────────────────────
  const venues = await fetchAll(sb, 'venues', 'id,name,address,city');
  const foreignVenues = venues.filter(
    (v) => typeof v.name === 'string' && !isCompatibleWithLanguage(v.name, args.language),
  );
  stats.foreignVenues = foreignVenues.length;
  const foreignVenueIds = new Set(foreignVenues.map((v) => String(v.id)));

  console.log(`[repair] ${foreignVenues.length} lokal(er) med främmande skript i namnet.`);
  for (const venue of foreignVenues) {
    console.log(`  - ${venue.id} "${venue.name}" @ ${venue.address ?? '?'}`);
  }

  // Namn → kurerad lokal (för omkoppling). Endast rena namn.
  const curatedByName = new Map<string, { id: string; name: string }>();
  for (const venue of venues) {
    if (!venue.name) continue;
    if (!isCompatibleWithLanguage(venue.name, args.language)) continue;
    const key = normalizeName(venue.name);
    if (!key) continue;
    const existing = curatedByName.get(key);
    if (!existing || String(venue.id) < String(existing.id)) {
      curatedByName.set(key, { id: venue.id, name: venue.name });
    }
  }

  // ── Alla publicerade events ────────────────────────────────────────────
  const events = await fetchAll(
    sb,
    'events',
    'id,source,status,title_sv,title_en,description_sv,description_en,category_slug,venue_id,venue_full_name,venue_full_address,venue_city,start_time,end_time,is_free,price_min_sek,price_max_sek,eventpulse_summary,eventpulse_summary_facts,eventpulse_summary_provenance,eventpulse_summary_generated_at,eventpulse_summary_model,editorial_description',
  );
  const published = events.filter((e) => e.status === 'published');

  // ── Översatta titlar (språk = args.language) ───────────────────────────
  const translatedTitles = new Map<string, string>();
  for (let i = 0; i < published.length; i += 100) {
    const ids = published.slice(i, i + 100).map((e) => String(e.id));
    const { data: rows } = await sb
      .from('event_translations')
      .select('event_id,title')
      .eq('language', args.language)
      .in('event_id', ids);
    for (const row of rows ?? []) {
      if (row.title) translatedTitles.set(String(row.event_id), String(row.title));
    }
  }
  console.log(`[repair] ${published.length} publicerade events, ${translatedTitles.size} med ${args.language}-översättning.`);

  const affected = published.filter((e) => e.venue_id && foreignVenueIds.has(String(e.venue_id)));
  console.log(`[repair] ${affected.length} events pekar på främmande lokaler.`);

  // ── En pass över alla events som behöver repareras ─────────────────────
  const candidates = published.filter((event) => {
    if (event.venue_id && foreignVenueIds.has(String(event.venue_id))) return true;
    if (translatedTitles.has(String(event.id))) return true;
    for (const field of ['editorial_description', 'eventpulse_summary'] as const) {
      const value = event[field];
      if (typeof value !== 'string' || !value) continue;
      if (findForeignScriptRuns(value, args.language).length > 0) return true;
    }
    return false;
  });

  const limit = args.limit > 0 ? Math.min(args.limit, candidates.length) : candidates.length;
  console.log(`[repair] ${candidates.length} events behöver repareras (bearbetar ${limit}).`);

  for (let i = 0; i < limit; i += 1) {
    const event = candidates[i];
    const patch: Record<string, unknown> = {};

    // ── 1. Lokal ──────────────────────────────────────────────────────────
    let newVenueName: string | null = null;
    if (event.venue_id && foreignVenueIds.has(String(event.venue_id))) {
      const sourceVenue = typeof event.venue_full_name === 'string' ? event.venue_full_name.trim() : '';
      const sourceVenueClean = sourceVenue && isCompatibleWithLanguage(sourceVenue, args.language);
      const curated = sourceVenueClean ? curatedByName.get(normalizeName(sourceVenue)) : undefined;

      if (curated) {
        patch.venue_id = curated.id;
        newVenueName = curated.name;
        stats.eventsRelinked += 1;
      } else {
        patch.venue_id = null;
        newVenueName = sourceVenueClean ? sourceVenue : null;
        stats.eventsUnlinked += 1;
      }

      if (typeof event.venue_full_name === 'string'
        && !isCompatibleWithLanguage(event.venue_full_name, args.language)) {
        patch.venue_full_name = newVenueName;
        stats.venueNamesCleared += 1;
      }
    }

    // ── 2. Visningstitel (översättning om vi har en) ─────────────────────
    const translated = translatedTitles.get(String(event.id)) ?? null;
    const sourceTitle = String(event.title_sv ?? event.title_en ?? '');
    const displayTitle = translated ?? sourceTitle;

    // ── 3. Summary: bygg om när lokalen ändrats eller titeln är översatt ──
    const summaryHasForeign = typeof event.eventpulse_summary === 'string'
      && findForeignScriptRuns(event.eventpulse_summary, args.language).length > 0;
    const venueChanged = Object.prototype.hasOwnProperty.call(patch, 'venue_id');
    if (venueChanged || (translated && summaryHasForeign)) {
      const rawDesc = event.description_sv ?? event.description_en ?? null;
      const { facts, provenance } = buildEventpulseFacts({
        category_slug: event.category_slug,
        venue_name: newVenueName,
        city: 'Stockholm',
        start_time: event.start_time,
        end_time: event.end_time,
        is_free: event.is_free,
        price_min_sek: event.price_min_sek,
        price_max_sek: event.price_max_sek,
        title: displayTitle,
        raw_description: rawDesc,
        source: event.source,
      });
      const summary = buildEventpulseSummary(facts);
      if (summary !== null) {
        patch.eventpulse_summary = summary;
        patch.eventpulse_summary_facts = facts;
        patch.eventpulse_summary_provenance = provenance;
        patch.eventpulse_summary_generated_at = new Date().toISOString();
        patch.eventpulse_summary_model = 'deterministic-v1';
        stats.summariesRegenerated += 1;
      }
    }

    // ── 4. Genererad text med främmande skript ───────────────────────────
    for (const field of ['editorial_description', 'eventpulse_summary'] as const) {
      const value = event[field];
      if (typeof value !== 'string' || !value) continue;
      if (field === 'eventpulse_summary' && Object.prototype.hasOwnProperty.call(patch, 'eventpulse_summary')) {
        continue; // redan omgenererat ovan
      }
      const runs = findForeignScriptRuns(value, args.language);
      if (runs.length === 0) continue;

      const titleRuns = new Set(findForeignScriptRuns(sourceTitle, args.language).map((r) => r.text));
      const titleDerived = runs.some((r) => titleRuns.has(r.text));

      if (titleDerived && translated) {
        // Främmande skript som hör till titeln: editorial-texten är
        // AI-genererad och kan inte repareras deterministiskt. Vi nollställer
        // den — appen faller tillbaka på summary:t, som byggs med den
        // översatta titeln.
        patch[field] = null;
        if (field === 'editorial_description') stats.editorialCleared += 1;
        else stats.summariesCleared += 1;
        console.log(`  [${args.apply ? 'apply' : 'dry-run'}] ${event.id} ${field}: nollställs (titeln är översatt)`);
        continue;
      }

      let cleaned = value;
      for (const run of runs) cleaned = cleaned.split(run.text).join('');
      cleaned = cleaned
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/([,;:])\s*([,.])/g, '$2')
        .replace(/\(\s*\)/g, '')
        .trim();
      if (cleaned !== value) {
        patch[field] = cleaned;
        if (field === 'editorial_description') stats.editorialCleaned += 1;
        else stats.summariesCleaned += 1;
        console.log(`  [${args.apply ? 'apply' : 'dry-run'}] ${event.id} ${field}: främmande tecken borttagna`);
      }
    }

    if (Object.keys(patch).length === 0) {
      stats.unchanged += 1;
      continue;
    }
    if (!args.apply) continue;

    const { error } = await sb.from('events').update(patch).eq('id', event.id);
    if (error) {
      console.error(`[repair] kunde inte uppdatera ${event.id}: ${error.message}`);
      process.exit(1);
    }
  }

  console.log(`\n[repair] ${args.apply ? 'APPLY' : 'DRY-RUN'}: ${JSON.stringify(stats)}`);
  if (!args.apply) {
    console.log('[repair] Kör med --apply för att skriva ändringarna.');
  }
}

main().catch((error) => {
  console.error('[repair] fatal:', (error as Error).message);
  process.exit(1);
});
