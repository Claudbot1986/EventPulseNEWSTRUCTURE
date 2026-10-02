// mapTime.js — tidsfönster för MapScreen-filter.
//
// Fyra lägen som MapScreen's filter-knappar mappar till:
//   'today'         — idag kl 00:00 → 23:59:59
//   'weekend'       — innevarande helg (fre 00:00 → sön 23:59:59)
//   'next_weekend'  — nästa helg (fre 00:00 → sön 23:59:59)
//   'all'           — alla future events
//
// Logiken är inom tidsrendering: 'idag' räknas från midnatt-lokal-tid
// till midnatt+lokal-tid. Helg = fre 00:00 → sön 23:59:59 lokal-tid.
//
// Alla funktioner tar emot en `now` för testbarhet (default new Date()).

const SWEDISH_WEEKDAY = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];

/**
 * Klipp av hour/min/sec/ms — returnera midnatt samma dag.
 */
function startOfDay(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/**
 * Sista millisekund samma dag (23:59:59.999).
 */
function endOfDay(d) {
  const c = startOfDay(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

/**
 * Beräkna helg-fönster (fre 00:00 → sön 23:59:59) för given `now`.
 *
 * Regler (samma som HemSupabase.js):
 *   mån–tor  → kommande fre
 *   fre      → dagens fre
 *   lör      → förra fre (som startar innevarande helg)
 *   sön      → förra fre (helgen började i fredags)
 */
function weekendWindow(now) {
  const day = now.getDay(); // 0=Sun, 5=Fri, 6=Sat
  let daysToFri;
  if (day === 0) daysToFri = -2; // sön → förra fre
  else if (day === 5) daysToFri = 0; // fre → idag
  else if (day === 6) daysToFri = -1; // lör → förra fre
  else daysToFri = 5 - day; // mån–tor → denna veckas fre

  const fri = new Date(now);
  fri.setDate(now.getDate() + daysToFri);
  fri.setHours(0, 0, 0, 0);

  const son = new Date(fri);
  son.setDate(fri.getDate() + 2);
  son.setHours(23, 59, 59, 999);

  return { from: fri, to: son };
}

/**
 * Beräkna nästa helg-fönster. Om vi redan är i en helg → helgen efter.
 * Om vi är mån–tor → helgen som börjar 2–5 dagar bort.
 *
 * Reglerna är: target_always_nästa_fre_efter_söndag.
 */
function nextWeekendWindow(now) {
  const day = now.getDay();
  let daysToFri;
  if (day === 0) daysToFri = 5; // sön → nästa fre (+5)
  else if (day === 5) daysToFri = 7; // fre → fredag nästa vecka
  else if (day === 6) daysToFri = 6; // lör → fre nästa vecka
  else daysToFri = 5 - day + 7; // mån–tor → fre nästa vecka

  const fri = new Date(now);
  fri.setDate(now.getDate() + daysToFri);
  fri.setHours(0, 0, 0, 0);

  const son = new Date(fri);
  son.setDate(fri.getDate() + 2);
  son.setHours(23, 59, 59, 999);

  return { from: fri, to: son };
}

/**
 * Returnera tidsfönster för given mode.
 *
 * @param {'today'|'weekend'|'next_weekend'|'all'} mode
 * @param {Date} now (default new Date())
 * @returns {{from:Date,to:Date}|null}
 *   'all' → null (ingen begränsning)
 */
export function computeTimeWindow(mode, now = new Date()) {
  if (mode === 'all') return { from: null, to: null };
  if (mode === 'today') {
    return { from: startOfDay(now), to: endOfDay(now) };
  }
  if (mode === 'weekend') return weekendWindow(now);
  if (mode === 'next_weekend') return nextWeekendWindow(now);
  throw new Error(`Unknown mode: ${mode}`);
}

/**
 * Hjälpare: formatera start_time för tooltip (t.ex. "fre 19:30").
 */
export function formatStartLabel(isoString) {
  if (!isoString) return '';
  const t = new Date(isoString);
  if (Number.isNaN(t.getTime())) return '';
  return `${SWEDISH_WEEKDAY[t.getDay()]} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

/**
 * Sortera events efter start_time, ta bort avbrutna events.
 */
export function isFutureEvent(event, now = new Date()) {
  if (!event || !event.start_time) return false;
  const t = new Date(event.start_time);
  if (Number.isNaN(t.getTime())) return false;
  return t.getTime() >= now.getTime();
}