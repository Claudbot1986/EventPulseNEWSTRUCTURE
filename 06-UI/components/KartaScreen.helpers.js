// AppleMapsScreen.helpers.js — pure helpers for the new Apple Maps screen.
//
// RATIONALE: vi duplicerar INTE logiken från MapScreen.js (som äger
// fetch + filter för PNG-kartan). Det här är en parallell pipeline som
// återanvänder mapTime (renta avständigheter) men håll fetch + filter
// i egna exporterade funktioner. På Test/Dev-hookning kan vi importera
// dem utan att React-render-trädet snurras upp.

import { computeTimeWindow, isFutureEvent } from './mapTime.js';
import { STOCKHOLM_BOUNDS, STOCKHOLM_CENTER } from './mapProjection.js';
import { attachDisplayTitles } from '../utils/displayTitles';

export { attachDisplayTitles };

// 2026-10-03: sänkt från 1000×10 för att PostgREST inte ska time:a ut
// (error 57014: canceling statement due to statement timeout).
// Stockholm-bounds i WHERE + LIMIT 500 rådar ett subset på ~2 000 rader
// som PostgREST returnerar på <2s. 500×7=3 500 rader är vår "soft cap" —
// tillräckligt för dagens 3 192 framtida Stockholm-events (med 10 %
// marginal för datatillväxt).
//
// 2026-10-03: SELECT utökad med alla fält som DetailsScreen-toDetailsScreenEvent-
// mappen behöver (title_sv/title_en, description_sv/description_en, ticket_url,
// source, image_ai_*) — så "Läs mer" öppnar samma fulla eventkort som Hem-
// karusellen producerar, inget avskalat subset.
//
// 2026-10-03: FETCH_HARD_CAP höjd från 2 000 till 5 000. Tidigare cap var
// en gissning ("tillräckligt för viewport") som nu gömde ~1 192 events.
// Mätning mot prod-DB visar 7-sidors sekventiell fetch ≈ 7s (första
// sidan 1.76s cold start, resterande <1.3s styck). För att inte göra
// initial-load 7s väntan laddar vi progressivt via onBatch-callback
// (se fetchFutureEvents) — första 500 events visas direkt, resterande
// appends i bakgrunden.
export const FETCH_PAGE_SIZE = 500;
export const FETCH_MAX_PAGES = 7;
export const FETCH_HARD_CAP = 5000;
export const FETCH_SELECT =
  'id, title_sv, title_en, description_sv, description_en, ' +
  'start_time, lat, lng, ' +
  'ticket_url, source, ' +
  'image_url, image_ai_generated, image_ai_optout, image_generation_status, ' +
  'category_slug, is_free';

/**
 * Hämta future events paginerat från Supabase events_public.
 *
 * Stockholm-bounds gör query:n index-vänlig och snabb även med 3 600+
 * events i tabellen (utan bounds hade PostgREST time:at ut vid 6s default
 * timeout — error 57014).
 *
 * 2026-10-03: progressiv laddning via onBatch-callback. Efter varje
 * 500-radssida anropas onBatch(eventsSoFar) så KartaScreen kan flippa
 * status='ready' direkt och låta resterande sidor appendas i bakgrunden.
 *
 * @param {object} supabase  Supabase client (services/supabaseClient)
 * @param {(batch: Array) => void} [onBatch]  valfri callback efter varje sida
 * @returns {Promise<{events: Array, error: Error|null}>}
 */
export async function fetchFutureEvents(supabase, onBatch) {
  const all = [];
  const now = new Date().toISOString();
  for (let page = 0; page < FETCH_MAX_PAGES; page++) {
    const from = page * FETCH_PAGE_SIZE;
    const to = from + FETCH_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('events_public')
      .select(FETCH_SELECT)
      .gte('start_time', now)
      // Stockholm-bounds: lat ∈ [59.06, 59.60], lng ∈ [17.65, 18.49].
      // Stockholms-fallback (lat=59.3293, lng=18.0686) ryms — så vi
      // behåller ALLA fallback-events + alla riktiga geo-events.
      .gte('lat', STOCKHOLM_BOUNDS.minLat)
      .lte('lat', STOCKHOLM_BOUNDS.maxLat)
      .gte('lng', STOCKHOLM_BOUNDS.minLng)
      .lte('lng', STOCKHOLM_BOUNDS.maxLng)
      .order('start_time', { ascending: true })
      .range(from, to);
    if (error) return { events: [], error };
    const rows = data || [];
    all.push(...rows);
    // 2026-10-30 (textintegritet): Karta läser Supabase direkt och passerar
    // därför INTE agentens feed. Events vars titel innehåller ett främmande
    // skript hämtar vi en översättning för visningsspråket — bara för de
    // få raderna som behöver det, inte för hela sidan.
    await attachDisplayTitles(supabase, rows);
    // Fire batch-callback efter varje sida så KartaScreen kan progressivt
    // rendera markers och flippa status='ready' efter första batchen.
    if (typeof onBatch === 'function') {
      try {
        onBatch([...all]);
      } catch (_) {
        /* KartaScreen felhanterar i sina egna setState */
      }
    }
    if (rows.length < FETCH_PAGE_SIZE) break;
    if (all.length >= FETCH_HARD_CAP) break;
  }
  return { events: all, error: null };
}


/**
 * Översätt rå Supabase/PostgREST-fel till användarvänlig svenska.
 * Returnerar aldrig rå felmeddelande eller felkode till UI:t
 * (enligt SCREEN_STATES.md § Error).
 *
 * @param {Error|{message?:string,code?:string}|null} err
 * @returns {string}
 */
export function translateError(err) {
  if (!err) return 'Kunde inte hämta events. Försök igen.';
  const msg = String(err.message || '');
  const code = String(err.code || '');
  // PG statement_timeout / PostgREST timeout
  if (code === '57014' || /timeout|canceling statement/i.test(msg)) {
    return 'Servern svarade för långsamt. Försök igen.';
  }
  // Nätverksfel (RN fetch-fel, ingen kontakt)
  if (/network|fetch failed|ENOTFOUND|ETIMEDOUT/i.test(msg)) {
    return 'Nätverksfel — kontrollera din anslutning.';
  }
  // Auktorisering / nyckel
  if (code === '401' || /unauthorized|invalid api key/i.test(msg)) {
    return 'Auktoriseringsfel — kontrollera Supabase-nycklar.';
  }
  // Övrigt — generiskt meddelande
  return 'Kunde inte hämta events. Försök igen.';
}

/**
 * Filtrera events till en tidsmod (today / weekend / next_weekend / all).
 * Returnerar NY array (immutabelt).
 *
 * @param {Array} events
 * @param {string} mode
 * @param {Date} [now=new Date()]
 * @returns {Array}
 */
export function filterEventsByMode(events, mode, now = new Date()) {
  const win = computeTimeWindow(mode, now);
  return events.filter((e) => {
    if (!isFutureEvent(e, now)) return false;
    if (!win || (win.from == null && win.to == null)) return true;
    const t = new Date(e.start_time).getTime();
    if (win.from && t < win.from.getTime()) return false;
    if (win.to && t > win.to.getTime()) return false;
    return true;
  });
}

/**
 * Räkna antal events per mode.
 *
 * @param {Array} events
 * @param {string[]} modes
 * @param {Date} [now=new Date()]
 * @returns {Object<string, number>}
 */
export function computeCountsByMode(events, modes, now = new Date()) {
  const out = {};
  for (const mode of modes) {
    out[mode] = filterEventsByMode(events, mode, now).length;
  }
  return out;
}

export const FILTER_MODES = ['today', 'weekend', 'next_weekend', 'all'];

// Initial region: STOCKHOLM_CENTER + utzoomning så hela Storstockholm syns.
// latitudeDelta/longitudeDelta ≈ 0.6° täcker samma bbox som z11 i PNG-versionen.
export const INITIAL_REGION = {
  latitude: STOCKHOLM_CENTER.lat,
  longitude: STOCKHOLM_CENTER.lng,
  latitudeDelta: 0.6,
  longitudeDelta: 0.6,
};