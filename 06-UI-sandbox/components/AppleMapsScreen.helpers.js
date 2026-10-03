// AppleMapsScreen.helpers.js — pure helpers for the new Apple Maps screen.
//
// RATIONALE: vi duplicerar INTE logiken från MapScreen.js (som äger
// fetch + filter för PNG-kartan). Det här är en parallell pipeline som
// återanvänder mapTime (renta avständigheter) men håll fetch + filter
// i egna exporterade funktioner. På Test/Dev-hookning kan vi importera
// dem utan att React-render-trädet snurras upp.

import { computeTimeWindow, isFutureEvent } from './mapTime.js';
import { STOCKHOLM_CENTER } from './mapProjection.js';

export const FETCH_PAGE_SIZE = 1000;
export const FETCH_MAX_PAGES = 10;
export const FETCH_SELECT =
  'id, title_sv, title_en, start_time, lat, lng, category_slug, is_free, confidence_score';

/**
 * Hämta future events paginerat från Supabase events_public.
 *
 * @param {object} supabase  Supabase client (services/supabaseClient)
 * @returns {Promise<{events: Array, error: Error|null}>}
 */
export async function fetchFutureEvents(supabase) {
  const all = [];
  for (let page = 0; page < FETCH_MAX_PAGES; page++) {
    const from = page * FETCH_PAGE_SIZE;
    const to = from + FETCH_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('events_public')
      .select(FETCH_SELECT)
      .gte('start_time', new Date().toISOString())
      .order('start_time', { ascending: true })
      .range(from, to);
    if (error) return { events: [], error };
    const rows = data || [];
    all.push(...rows);
    if (rows.length < FETCH_PAGE_SIZE) break;
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