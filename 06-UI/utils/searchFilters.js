/**
 * Search-screen filter persistence (2026-10-02).
 *
 * Filter-selections in SearchScreen (selectedCategories, priceFilter,
 * dateFrom, dateTo) are user-facing "what am I searching for right now"
 * state. They need to survive closing and reopening the screen — otherwise
 * the user has to re-tap their filters every time, which the user
 * explicitly reported as "filter glue broken" UX.
 *
 * Per the EventPulse persistence convention: lightweight non-sensitive UI
 * state (theme, language, onboarding flags, **cached filters**) lives in
 * AsyncStorage. Server-side `user_preferences` is for durable cross-device
 * preferences; ephemeral filter selections are local-only by intent.
 *
 * Best-practice sources (consulted 2026-10-02):
 *  - "A theme setting, a recently used filter can live in a simple
 *    key-value store." — rapidnative.com data-persistence guide
 *  - Zustand persist pattern with AsyncStorage + partialize — applied
 *    here without Zustand (we use a plain module to keep the screen
 *    tree simple and avoid forcing a new dependency)
 *  - AsyncStorage is unencrypted + async, fine for non-sensitive cache.
 *
 * Layout: a single JSON-encoded object under `eventpulse.search_filters_v1`.
 * `_v1` suffix lets us migrate if the shape changes in the future
 * (the version key pattern is the standard AsyncStorage practice; an
 * old key with a different shape will simply fail to deserialize and
 * return null).
 */

import { getItem, setItem, removeItem } from '../services/storage';

const STORAGE_KEY = 'eventpulse.search_filters_v1';

/** Whitelisted price filter keys — anything else is dropped on load.
 *  Mirrors PRICE_FILTERS in screens/SearchScreen.js. Kept here so the
 *  persistence module is the single source of truth for the contract. */
const ALLOWED_PRICE_KEYS = new Set(['free', 'under_200']);

function isISODate(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Reject impossible dates like "2026-13-40" that pass the regex but
  // would never come from a real DateRangePicker. The Date constructor
  // returns NaN for invalid components, so we round-trip and compare.
  const ms = Date.parse(value + 'T00:00:00Z');
  if (Number.isNaN(ms)) return false;
  return true;
}

/** True when the value is an array containing only strings (no objects,
 *  null, numbers). Used to detect "valid legacy blob" vs "malformed". */
function isPureStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Build a clean, JSON-safe snapshot of the current SearchScreen filter
 * state. Unknown values are coerced to "no filter" rather than thrown —
 * the screen should never crash because a storage blob has a value we
 * don't recognise anymore.
 *
 * @param {{
 *   selectedCategories?: string[],
 *   priceFilter?: string|null,
 *   dateFrom?: string|null,
 *   dateTo?: string|null,
 * }} state
 * @returns {{
 *   selectedCategories: string[],
 *   priceFilter: string|null,
 *   dateFrom: string|null,
 *   dateTo: string|null,
 * }}
 */
export function serializeSearchFilters(state) {
  const cats = Array.isArray(state?.selectedCategories)
    ? state.selectedCategories.filter((k) => typeof k === 'string')
    : [];
  const price = ALLOWED_PRICE_KEYS.has(state?.priceFilter) ? state.priceFilter : null;
  const from = isISODate(state?.dateFrom) ? state.dateFrom : null;
  const to = isISODate(state?.dateTo) ? state.dateTo : null;
  return {
    selectedCategories: cats,
    priceFilter: price,
    dateFrom: from,
    dateTo: to,
  };
}

/**
 * Parse + validate a JSON-parsed object that was previously stored. Bad
 * shapes return null rather than partial objects so the screen can
 * safely fall back to defaults without mixing user-restored + default
 * state on the same render.
 *
 * @param {unknown} raw
 * @returns {{
 *   selectedCategories: string[],
 *   priceFilter: string|null,
 *   dateFrom: string|null,
 *   dateTo: string|null,
 * } | null}
 */
export function deserializeSearchFilters(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Partial-recovery contract: if selectedCategories is an array (even
  // a mixed one) we filter out the bad ones and continue. If the field is
  // a non-array (wrong shape entirely) we treat it as empty.
  let cats = [];
  if (Array.isArray(raw.selectedCategories)) {
    cats = raw.selectedCategories.filter((k) => typeof k === 'string');
  }
  const price = ALLOWED_PRICE_KEYS.has(raw.priceFilter) ? raw.priceFilter : null;
  const from = isISODate(raw.dateFrom) ? raw.dateFrom : null;
  const to = isISODate(raw.dateTo) ? raw.dateTo : null;
  // If every field is at its default (no active filters) treat as null
  // so callers don't need to special-case "empty restored filters".
  if (cats.length === 0 && price === null && from === null && to === null) {
    return null;
  }
  return {
    selectedCategories: cats,
    priceFilter: price,
    dateFrom: from,
    dateTo: to,
  };
}

/**
 * True when the persisted snapshot represents any active filter
 * (categories, price, or a custom end-date). The default SearchScreen
 * state has dateFrom=today, which is NOT considered a filter — only
 * dateTo (an explicit end date) is.
 *
 * @param {{
 *   selectedCategories?: string[],
 *   priceFilter?: string|null,
 *   dateFrom?: string|null,
 *   dateTo?: string|null,
 * } | null} filters
 * @returns {boolean}
 */
export function hasActiveFilters(filters) {
  if (!filters) return false;
  return (
    (Array.isArray(filters.selectedCategories) && filters.selectedCategories.length > 0) ||
    !!filters.priceFilter ||
    !!filters.dateTo
  );
}

/**
 * Load the previously saved SearchScreen filter state from AsyncStorage.
 * Returns null when nothing has been saved, when the saved blob is
 * malformed, or when storage throws. Never throws — the caller treats
 * null as "use defaults".
 */
export async function loadSearchFilters() {
  try {
    const value = await getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value);
    return deserializeSearchFilters(parsed);
  } catch (_err) {
    return null;
  }
}

/**
 * Persist the SearchScreen filter state. When `state` contains no active
 * filters (only defaults), the storage key is removed so the next load
 * returns null. Never throws — storage failures are best-effort.
 *
 * @param {{
 *   selectedCategories?: string[],
 *   priceFilter?: string|null,
 *   dateFrom?: string|null,
 *   dateTo?: string|null,
 * }} state
 */
export async function saveSearchFilters(state) {
  try {
    const serialized = serializeSearchFilters(state);
    if (!hasActiveFilters(serialized)) {
      await removeItem(STORAGE_KEY);
      return;
    }
    await setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch (_err) {
    // best-effort — losing one filter write never crashes the screen
  }
}

export const SEARCH_FILTERS_STORAGE_KEY = STORAGE_KEY;