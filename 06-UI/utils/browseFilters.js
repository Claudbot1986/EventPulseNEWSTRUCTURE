/**
 * Pure browse-filter chain for Utforska (extracted from App.js 2026-09-20 so
 * vitest can pin every chip-promised behavior — see browseFilters.test.ts).
 *
 * No React, no fetch, no Date.now() hidden inside: every function takes `now`
 * explicitly where time matters, so tests are timezone- and run-date-proof.
 *
 * Filter chain order (applyBrowseFilters):
 *   categories → time → price → pinned date → query/search
 */

/** Case- and accent-insensitive match text: NFD + combining-mark strip, so
 *  "cafe" matches "Café" without language-specific rules (2026-09-20). */
export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Pill key → real feed `event.category` slugs. The feed's category values are
 * chaotic (art-exhibitions, theatre-comedy, barn AND family, food-drink …),
 * so a pill must match a GROUP of slugs or it silently matches nothing.
 * Keys not listed here pass through as themselves (music/sports/nightlife).
 */
export const CATEGORY_GROUPS = {
  culture: ['culture', 'art', 'art-exhibitions'],
  barn: ['barn', 'family'],
  theatre: ['theatre', 'theatre-comedy'],
  food: ['food', 'food-drink'],
};

/** True when the event's category matches ANY selected pill key (groups applied). */
export function matchesCategoryWithGroups(event, selectedKeys) {
  if (!selectedKeys || selectedKeys.length === 0) return true;
  const category = event?.category;
  if (!category) return false;
  return selectedKeys.some((key) => {
    const group = CATEGORY_GROUPS[key] || [key];
    return group.includes(category);
  });
}

/** Time window filter moved verbatim from App.js; `now` injectable for tests. */
export function filterEventsByTime(events, timeFilter, now = new Date()) {
  if (!timeFilter) return events;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return events.filter(event => {
    if (!event.date) return false;

    const eventDate = new Date(event.date + 'T' + (event.time || '00:00'));
    const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());

    switch (timeFilter) {
      case 'ikvall': {
        // Events happening today after current time
        const isToday = eventDay.getTime() === today.getTime();
        return isToday && eventDate > now;
      }
      case 'imorgon': {
        // Events happening tomorrow
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return eventDay.getTime() === tomorrow.getTime();
      }
      case 'helgen': {
        // Events happening Saturday (6) or Sunday (0)
        const dayOfWeek = eventDay.getDay();
        return dayOfWeek === 0 || dayOfWeek === 6;
      }
      case 'denna_vecka': {
        // Events within the next 7 days
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        return eventDay >= today && eventDay <= nextWeek;
      }
      default:
        return true;
    }
  });
}

function priceMinOf(event) {
  const v = event?.price_min_sek ?? event?.priceMin;
  return typeof v === 'number' ? v : null;
}

function priceMaxOf(event) {
  const v = event?.price_max_sek ?? event?.priceMax;
  return typeof v === 'number' ? v : null;
}

/**
 * Price pill matcher.
 *  - 'free': only explicitly-free events.
 *  - 'under_200': free counts (0 ≤ 200); else price_min ≤ 200; when min is
 *    missing, price_max ≤ 200 is enough. Events with NO price info at all do
 *    NOT match — "under 200 kr" must not show unknown-price rows.
 */
export function matchesPriceFilter(event, key) {
  if (!key) return true;
  const isFree = Boolean(event?.isFree || event?.is_free);
  if (key === 'free') return isFree;
  if (key === 'under_200') {
    if (isFree) return true;
    const min = priceMinOf(event);
    if (min !== null) return min <= 200;
    const max = priceMaxOf(event);
    return max !== null && max <= 200;
  }
  return true;
}

/** Exact-date pin ("Gratis på lördag" → that Saturday only). */
export function matchesPinnedDate(event, isoDate) {
  if (!isoDate) return true;
  const date = typeof event?.date === 'string' ? event.date.slice(0, 10) : '';
  return date === isoDate;
}

/** Any-match over title + venue against an array of terms (genre prefill:
 *  ['klassisk','classical'] matches either). Empty array → no constraint. */
export function matchesQuery(event, queryTerms) {
  if (!queryTerms || queryTerms.length === 0) return true;
  const haystack = normalizeSearchText(`${event?.title || ''} ${event?.venue_name || event?.venue || ''}`);
  return queryTerms.some((term) => haystack.includes(normalizeSearchText(term)));
}

/**
 * The whole Utforska filter chain in one place.
 *
 * @param {Array} events
 * @param {{ timeFilter?: string|null, priceFilter?: string|null,
 *           selectedCategories?: string[], pinnedDateIso?: string|null,
 *           queryTerms?: string[], searchText?: string }} filters
 *   queryTerms (auto-intent prefill, any-match) takes precedence over the
 *   free-text searchText — otherwise a 'klassisk' box would narrow away the
 *   'classical' union term.
 * @param {Date} now
 */
export function applyBrowseFilters(events, filters = {}, now = new Date()) {
  let result = Array.isArray(events) ? events : [];

  const selectedCategories = filters.selectedCategories || [];
  if (selectedCategories.length > 0) {
    result = result.filter((event) => matchesCategoryWithGroups(event, selectedCategories));
  }

  if (filters.timeFilter) {
    result = filterEventsByTime(result, filters.timeFilter, now);
  }

  if (filters.priceFilter) {
    result = result.filter((event) => matchesPriceFilter(event, filters.priceFilter));
  }

  if (filters.pinnedDateIso) {
    result = result.filter((event) => matchesPinnedDate(event, filters.pinnedDateIso));
  }

  const queryTerms = Array.isArray(filters.queryTerms) && filters.queryTerms.length > 0
    ? filters.queryTerms
    : (filters.searchText && filters.searchText.trim() ? [filters.searchText.trim()] : []);
  if (queryTerms.length > 0) {
    result = result.filter((event) => matchesQuery(event, queryTerms));
  }

  return result;
}
