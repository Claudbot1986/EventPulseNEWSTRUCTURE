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
 *   - 'weekend'   → from = fredag (idag + 4 dagar), days = 3 (fångar lör-sön-mån)
 *   - 'today'     → from = idag, days = 1
 *   - 'any'       → from = idag, days = 14 (större fönster så klientfiltret
 *                   hinner hitta relevanta events)
 *
 * eyebrowKey / emptyHintKey refererar till i18n-trädet (sv.js + en.js).
 */

// Hur många dagar framåt varje tile ska hämta. 'any' har större fönster
// eftersom kategori/budget/weekend-filter kan gallra bort mycket.
//
// 2026-10-01 (helg consistency): weekend = 2 (lör+sön). Tidigare 3
// (fre+lör+sön) täckte en extra dag som inte är helg → count och
// faktiska helg-events matchade inte.
export const DATE_MODE_DAYS = {
  tomorrow: 1,
  today: 1,
  weekend: 2,
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
    // 2026-10-01 (helg consistency): tidigare "idag + 4 dagar" fungerade
    // bara för måndag-start (täckte då fre+lör+sön) och missade helgen
    // helt på onsdag–söndag. Ny logik: returnera nästa lördag (eller
    // idag om idag redan är lör/sön). DATE_MODE_DAYS.weekend = 2 så
    // fönstret blir exakt lör+sön och count matchar data.
    const d = new Date(today);
    const dow = d.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
    if (dow === 6) {
      // Lördag → from=today (lör+sön kvar)
      return d.toISOString().slice(0, 10);
    }
    if (dow === 0) {
      // Söndag → from=today-1 (lör), days=2 täcker lör+sön
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    }
    // Mån–fre → from = nästa lördag
    const daysToSat = 6 - dow; // mån=5, tis=4, ons=3, tor=2, fre=1
    d.setUTCDate(d.getUTCDate() + daysToSat);
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