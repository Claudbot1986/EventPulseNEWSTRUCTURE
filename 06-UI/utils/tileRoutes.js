/**
 * tileRoutes (2026-09-28): central tabell som mappar utforska-tile.id →
 * { fetcherExtra, clientFilter, eyebrowKey, emptyHintKey, dateMode }.
 *
 * ExploreDetailScreen slår upp payload.id här istället för att ha en
 * `isImorgon`-specialfall. När en tile saknar route → fallback till
 * MOCK_EVENTS i UtforskaSection (oförändrat default-beteende).
 *
 * Inga React-hooks, ingen fetch — bara rena data + filter-funktioner som
 * tar emot en rad-array. Filter-funktioner är client-side tills agent-API:t
 * (08-Agent) exponerar kategori/budget/dag-filter i fetchFeed-parametrarna.
 *
 * dateMode-styrning:
 *   - 'tomorrow'  → from = imorgon (addDays(today, 1)), days = 1
 *   - 'weekend'   → from = fredag (närmsta fre), days = 3 (fre–lör–sön)
 *   - 'today'     → from = idag, days = 1
 *   - 'any'       → from = idag, days = 14 (större fönster så klientfiltret
 *                   hinner hitta relevanta events)
 *
 * eyebrowKey / emptyHintKey refererar till i18n-trädet (sv.js + en.js).
 */

// Hur många dagar framåt varje tile ska hämta. 'any' har större fönster
// eftersom kategori/budget/weekend-filter kan gallra bort mycket.
//
// 2026-10-02 (helg = fre–lör–sön): weekend = 3. Användaren vill att
// "helg"-knappen täcker hela helgen — inte bara lör–sön. Fredag räknas
// som helg-start (många konserter/premiärer ligger på fre-kvällar).
export const DATE_MODE_DAYS = {
  tomorrow: 1,
  today: 1,
  weekend: 3,
  any: 14,
};

/**
 * Compute 'from' ISO för en dateMode, relativt en referensdag (default idag).
 * Ren funktion — testbar utan mock.
 */
export function computeFromIso(dateMode, today = new Date()) {
  if (dateMode === 'tomorrow') {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (dateMode === 'today') {
    return today.toISOString().slice(0, 10);
  }
  if (dateMode === 'weekend') {
    // 2026-10-02 (helg = fre–lör–sön): returnera fredagen som inleder
    // helgen, oavsett vilken veckodag idag är. DATE_MODE_DAYS.weekend
    // = 3 täcker fre+lör+sön. Tidigare variant stannade vid lör–sön;
    // användaren vill att "helg" innefattar fredag också.
    const d = new Date(today);
    const dow = d.getUTCDay(); // 0=Sun, 1=Mon, …, 5=Fri, 6=Sat
    if (dow === 5) {
      // Fredag → from=today (fre+lör+sön kvar)
      return d.toISOString().slice(0, 10);
    }
    if (dow === 6) {
      // Lördag → from=today-1 (fre), days=3 täcker fre+lör+sön
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    }
    if (dow === 0) {
      // Söndag → from=today-2 (fre), days=3 täcker fre+lör+sön
      d.setUTCDate(d.getUTCDate() - 2);
      return d.toISOString().slice(0, 10);
    }
    // Mån–tor → from = nästa fredag (mån=4, tis=3, ons=2, tor=1)
    const daysToFri = 5 - dow;
    d.setUTCDate(d.getUTCDate() + daysToFri);
    return d.toISOString().slice(0, 10);
  }
  // 'any'
  return today.toISOString().slice(0, 10);
}

// Hjälpfilter — tar emot rad-shape (efter mapAgentEventToRow) eller
// rå agent-feed event. Båda har category_slug + is_free.
//
// 2026-10-01: rowIsFree borttagen — gratis-tile flyttade sitt filter
// till servern (fetcherExtra: { isFree: true }) så klientfiltret inte
// behövdes längre. rowCategory finns kvar för live/skratt/category-
// routes vars klientfilter är defense-in-depth (no-op när servern
// redan filtrerat via ?category=).
function rowCategory(r) {
  if (r == null) return null;
  return r.category_slug || r.category || null;
}

/**
 * Smak-tiles (ExploreTilesSection) — 6 tiles.
 *
 * 2026-10-01 (filter consistency): gratis och helg har flyttats till
 * server-side filter (isFree=1 / helg-window i feed_events) så headerns
 * total speglar antalet events användaren faktiskt scrollar igenom.
 * Tidigare stod clientFilter kvar på dessa och headern rapporterade
 * hela fönstrets antal — inte de filtrerade. live/skratt behåller
 * clientFilter som defense-in-depth (no-op när servern filtrerat).
 */
const SMAK_ROUTES = {
  gratis: {
    eyebrowKey: 'home.explore.gratis.label',
    emptyHintKey: 'explore.empty.gratis',
    dateMode: 'any',
    // 2026-10-01: isFree=true skickas till feed_events som ?isFree=true
    // → .eq('is_free', true) på data- och count-query. Inget clientFilter
    // behövs — servern returnerar redan enbart gratis-events.
    fetcherExtra: { isFree: true },
  },
  live: {
    // "live" = musik-konserter (labelKey pekar på "musik"; tile.id heter
    // 'live' för att matcha analytics och wire-formatet etablerat 2026-09-26)
    eyebrowKey: 'home.explore.live.label',
    emptyHintKey: 'explore.empty.music',
    dateMode: 'any',
    // 2026-09-28: server-side category-filter (Utforska infinite scroll).
    // feed_events kör .eq('category_slug', 'music') på serversidan så varje
    // 15-radig-sida returnerar garanterat 15 musik-events istället för att
    // clientFilter gallrar bort 13 av 15. clientFilter behålls som
    // defense-in-depth (no-op om servern redan filtrerat).
    category: 'music',
    clientFilter: (rows) => rows.filter((r) => rowCategory(r) === 'music'),
  },
  skratt: {
    eyebrowKey: 'home.explore.skratt.label',
    emptyHintKey: 'explore.empty.theatreComedy',
    dateMode: 'any',
    // 2026-09-28: server-side category-filter (se live-route ovan).
    category: 'theatre-comedy',
    clientFilter: (rows) => rows.filter((r) => rowCategory(r) === 'theatre-comedy'),
  },
  stamning: {
    // Fas D har mood-stöd i fetchFeed → serversidefilter, inget klientfilter.
    eyebrowKey: 'home.explore.stamning.label',
    emptyHintKey: 'explore.empty.mood',
    dateMode: 'any',
    fetcherExtra: { mood: 'stamningsfullt' },
  },
  helg: {
    eyebrowKey: 'home.explore.helg.label',
    emptyHintKey: 'explore.empty.weekend',
    dateMode: 'weekend',
    // 2026-10-01: inget clientFilter — dateMode='weekend' ger fönster
    // [lör, mån) via computeFromIso, och DATE_MODE_DAYS.weekend = 2
    // täcker exakt lör+sön. feed_events räknar automatiskt events inom
    // det fönstret när ingen kategori anges (window-bounded count).
  },
  imorgon: {
    eyebrowKey: 'home.explore.imorgon.label',
    emptyHintKey: 'explore.empty.imorgon',
    dateMode: 'tomorrow',
    // Ingen clientFilter — fetchFeed ger redan rätt dag.
  },
};

/**
 * Generera en route per CATEGORY_FILTERS-rad. Förväntar sig samma shape som
 * App.js CATEGORY_FILTERS — { key, labelKey } (emoji/color/image ignoreras,
 * de styr bara HomeScreen-presentationen).
 */
function buildCategoryRoutes(categoryFilters) {
  const out = {};
  for (const cat of categoryFilters) {
    out[cat.key] = {
      eyebrowKey: cat.labelKey,
      emptyHintKey: `explore.empty.${cat.key}`,
      dateMode: 'any',
      // 2026-09-28: server-side category-filter (Utforska infinite scroll).
      // feed_events kör .eq('category_slug', cat.key) på serversidan så varje
      // 15-radig-sida returnerar 15 matchande events. clientFilter behålls
      // som defense-in-depth (no-op om servern redan filtrerat).
      category: cat.key,
      clientFilter: (rows) => rows.filter((r) => rowCategory(r) === cat.key),
    };
  }
  return out;
}

/**
 * Huvudtabell. Byggs vid modul-load via buildCategoryRoutes(CATEGORY_FILTERS).
 *
 * CATEGORY_FILTERS importeras lazy via en require i App.js (App.js har redan
 * require('./assets/categoryTiles/categoryTiles.data.js') lazy-mönster för
 * tile-bilderna, så vi håller samma stil). Exporten är dock statisk efter
 * första konstruktionen — testbar med mockade CATEGORY_FILTERS.
 */
let _routes = null;

/**
 * Initialize with a category list. Idempotent — om vi redan har byggt med
 * samma lista, returnera cachad. Tillåter test-injection av CATEGORY_FILTERS.
 */
export function buildTileRoutes(categoryFilters) {
  if (_routes && _routes.__builtWith === categoryFilters) return _routes;
  _routes = {
    ...SMAK_ROUTES,
    ...buildCategoryRoutes(categoryFilters),
    __builtWith: categoryFilters,
  };
  return _routes;
}

/**
 * Lookup. Returnerar null om tile.id inte har en route (→ MOCK_EVENTS-fallback).
 */
export function getTileRoute(tileId) {
  if (!tileId) return null;
  if (!_routes) {
    // Utan buildTileRoutes()-anrop: returnera bara smak-routes. Kategori-routes
    // kan inte finnas utan CATEGORY_FILTERS — testa med buildTileRoutes() först.
    return SMAK_ROUTES[tileId] || null;
  }
  return _routes[tileId] || null;
}

/**
 * Reset (för tester).
 */
export function _resetTileRoutesForTests() {
  _routes = null;
}