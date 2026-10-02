/**
 * Pins SearchScreen filter persistence to:
 *  - serializeSearchFilters: state → clean JSON-safe object, drops unknowns
 *  - deserializeSearchFilters: parsed JSON → state, null on bad shape
 *  - hasActiveFilters: classifies default vs active state
 *  - loadSearchFilters / saveSearchFilters: AsyncStorage round-trip
 *
 * User-facing contract (2026-10-02): the user reported "filters forget
 * which were tapped". The screen therefore MUST restore categories/price
 * /dateTo from AsyncStorage on next mount, and MUST persist on every
 * change. These tests pin that contract end-to-end so a future refactor
 * of SearchScreen cannot silently regress it.
 *
 * Run:  npx vitest run 06-UI/utils/searchFilters.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock AsyncStorage before importing storage.js so it picks up our stub.
// Same pattern as storage.test.ts: in-memory map keeps tests hermetic.
vi.mock('@react-native-async-storage/async-storage', () => {
  const map = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: async (k: string, v: string) => { map.set(k, v); },
      removeItem: async (k: string) => { map.delete(k); },
    },
  };
});

import {
  serializeSearchFilters,
  deserializeSearchFilters,
  hasActiveFilters,
  loadSearchFilters,
  saveSearchFilters,
  SEARCH_FILTERS_STORAGE_KEY,
} from './searchFilters';
import { setItem, removeItem } from '../services/storage';

async function clearKey() {
  await removeItem(SEARCH_FILTERS_STORAGE_KEY);
}

describe('serializeSearchFilters', () => {
  it('passes through a known valid state unchanged', () => {
    const state = {
      selectedCategories: ['music', 'theatre'],
      priceFilter: 'free',
      dateFrom: '2026-10-15',
      dateTo: '2026-10-20',
    };
    expect(serializeSearchFilters(state)).toEqual(state);
  });

  it('drops categories that aren\'t strings', () => {
    const out = serializeSearchFilters({
      selectedCategories: ['music', null, 42, undefined, 'theatre'] as any,
    });
    expect(out.selectedCategories).toEqual(['music', 'theatre']);
  });

  it('drops priceFilter values not in the allowlist', () => {
    expect(serializeSearchFilters({ priceFilter: 'free' }).priceFilter).toBe('free');
    expect(serializeSearchFilters({ priceFilter: 'under_200' }).priceFilter).toBe('under_200');
    expect(serializeSearchFilters({ priceFilter: 'premium' as any }).priceFilter).toBe(null);
    expect(serializeSearchFilters({ priceFilter: undefined }).priceFilter).toBe(null);
    expect(serializeSearchFilters({ priceFilter: null }).priceFilter).toBe(null);
  });

  it('drops date strings that are not ISO YYYY-MM-DD', () => {
    expect(serializeSearchFilters({ dateFrom: '2026-10-15' }).dateFrom).toBe('2026-10-15');
    expect(serializeSearchFilters({ dateFrom: '10/15/2026' as any }).dateFrom).toBe(null);
    expect(serializeSearchFilters({ dateFrom: '2026-13-40' as any }).dateFrom).toBe(null);
    expect(serializeSearchFilters({ dateFrom: '' as any }).dateFrom).toBe(null);
    expect(serializeSearchFilters({ dateFrom: undefined }).dateFrom).toBe(null);
  });

  it('handles missing/null/undefined state gracefully', () => {
    expect(serializeSearchFilters({})).toEqual({
      selectedCategories: [],
      priceFilter: null,
      dateFrom: null,
      dateTo: null,
    });
    expect(serializeSearchFilters(undefined as any)).toEqual({
      selectedCategories: [],
      priceFilter: null,
      dateFrom: null,
      dateTo: null,
    });
    expect(serializeSearchFilters(null as any)).toEqual({
      selectedCategories: [],
      priceFilter: null,
      dateFrom: null,
      dateTo: null,
    });
  });
});

describe('deserializeSearchFilters', () => {
  it('reconstructs a known valid blob', () => {
    const out = deserializeSearchFilters({
      selectedCategories: ['music'],
      priceFilter: 'under_200',
      dateFrom: '2026-10-15',
      dateTo: '2026-10-20',
    });
    expect(out).toEqual({
      selectedCategories: ['music'],
      priceFilter: 'under_200',
      dateFrom: '2026-10-15',
      dateTo: '2026-10-20',
    });
  });

  it('returns null when the input is missing or not an object', () => {
    expect(deserializeSearchFilters(null)).toBe(null);
    expect(deserializeSearchFilters(undefined)).toBe(null);
    expect(deserializeSearchFilters('hi')).toBe(null);
    expect(deserializeSearchFilters(42)).toBe(null);
  });

  it('drops invalid items but keeps valid ones (partial-recovery contract)', () => {
    // The contract: invalid items are stripped, valid items survive. This
    // prevents one bad field from wiping an entire user\'s saved filter
    // set on next launch.
    const out = deserializeSearchFilters({
      selectedCategories: ['music', null, 'theatre'],
      priceFilter: 'premium', // unknown
      dateFrom: '10/15/2026', // malformed
      dateTo: '2026-10-20',
    });
    expect(out).toEqual({
      selectedCategories: ['music', 'theatre'],
      priceFilter: null,
      dateFrom: null,
      dateTo: '2026-10-20',
    });
  });

  it('returns null when every field is at default (no active filters)', () => {
    expect(deserializeSearchFilters({
      selectedCategories: [],
      priceFilter: null,
      dateFrom: null,
      dateTo: null,
    })).toBe(null);
  });

  it('returns null for non-array selectedCategories', () => {
    expect(deserializeSearchFilters({ selectedCategories: 'music' as any })).toBe(null);
    expect(deserializeSearchFilters({ selectedCategories: null as any })).toBe(null);
  });
});

describe('hasActiveFilters', () => {
  it('counts selected categories, price, and dateTo — but NOT bare dateFrom', () => {
    // dateFrom alone (= today) is the default and not a user filter
    expect(hasActiveFilters({ dateFrom: '2026-10-02' })).toBe(false);
    expect(hasActiveFilters({ dateFrom: '2026-10-02', dateTo: null })).toBe(false);
    expect(hasActiveFilters({ dateTo: '2026-10-02' })).toBe(true);
    expect(hasActiveFilters({ priceFilter: 'free' })).toBe(true);
    expect(hasActiveFilters({ selectedCategories: ['music'] })).toBe(true);
    expect(hasActiveFilters({
      selectedCategories: ['music'],
      priceFilter: 'free',
      dateFrom: '2026-10-02',
      dateTo: '2026-10-05',
    })).toBe(true);
  });

  it('returns false for null and empty', () => {
    expect(hasActiveFilters(null)).toBe(false);
    expect(hasActiveFilters({} as any)).toBe(false);
  });
});

describe('loadSearchFilters / saveSearchFilters — AsyncStorage round-trip', () => {
  beforeEach(async () => {
    await clearKey();
  });

  it('round-trips a multi-filter state', async () => {
    await saveSearchFilters({
      selectedCategories: ['music', 'theatre'],
      priceFilter: 'under_200',
      dateFrom: '2026-10-15',
      dateTo: '2026-10-20',
    });
    const restored = await loadSearchFilters();
    expect(restored).toEqual({
      selectedCategories: ['music', 'theatre'],
      priceFilter: 'under_200',
      dateFrom: '2026-10-15',
      dateTo: '2026-10-20',
    });
  });

  it('returns null when nothing has been saved', async () => {
    expect(await loadSearchFilters()).toBe(null);
  });

  it('removes the storage key when saving an empty (default) state', async () => {
    // First save something so we know the key exists
    await saveSearchFilters({
      selectedCategories: ['music'],
      priceFilter: null,
      dateFrom: null,
      dateTo: null,
    });
    // Then save defaults — should clear the key
    await saveSearchFilters({
      selectedCategories: [],
      priceFilter: null,
      dateFrom: null,
      dateTo: null,
    });
    expect(await loadSearchFilters()).toBe(null);
  });

  it('survives a simulated cold start by going through JSON.stringify/parse', async () => {
    await saveSearchFilters({
      selectedCategories: ['music'],
      priceFilter: 'free',
      dateFrom: '2026-10-15',
      dateTo: '2026-10-20',
    });
    // Read raw value, stringify/parse the literal, simulate restart
    const raw = await import('../services/storage').then((m) => m.getItem(SEARCH_FILTERS_STORAGE_KEY));
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    const restored = await loadSearchFilters();
    expect(restored).toEqual(deserializeSearchFilters(parsed));
  });

  it('returns null when stored blob is malformed JSON', async () => {
    await setItem(SEARCH_FILTERS_STORAGE_KEY, 'not-json{{{');
    expect(await loadSearchFilters()).toBe(null);
  });

  it('returns null when stored blob has wrong shape entirely', async () => {
    await setItem(SEARCH_FILTERS_STORAGE_KEY, JSON.stringify({ random: 'object' }));
    expect(await loadSearchFilters()).toBe(null);
  });

  it('uses the namespaced eventpulse.search_filters_v1 storage key', async () => {
    // Pin the storage key so a rename does not silently lose users'
    // saved filters on the next release.
    expect(SEARCH_FILTERS_STORAGE_KEY).toBe('eventpulse.search_filters_v1');
    await saveSearchFilters({ selectedCategories: ['music'] });
    const { getItem } = await import('../services/storage');
    expect(await getItem(SEARCH_FILTERS_STORAGE_KEY)).toContain('"selectedCategories":["music"]');
  });
});

describe('persistence contract — what "remembers selections" actually requires', () => {
  // These tests describe the user-facing requirement directly so the
  // next person who refactors SearchScreen.js sees the contract.
  beforeEach(async () => {
    await clearKey();
  });

  it('user selects [music] + [free] → closes SearchScreen → reopens → still selected', async () => {
    // Simulate user toggling both
    await saveSearchFilters({
      selectedCategories: ['music'],
      priceFilter: 'free',
      dateFrom: null,
      dateTo: null,
    });
    // Simulate closing & reopening the screen (which would normally
    // re-init useState from default values) — loadSearchFilters is what
    // re-hydrates the state.
    const restored = await loadSearchFilters();
    expect(restored?.selectedCategories).toEqual(['music']);
    expect(restored?.priceFilter).toBe('free');
  });

  it('user clears all → close → reopen → state is null (no stale selections)', async () => {
    await saveSearchFilters({ selectedCategories: ['music'], priceFilter: 'free' });
    await saveSearchFilters({ selectedCategories: [], priceFilter: null, dateTo: null });
    const restored = await loadSearchFilters();
    expect(restored).toBe(null);
  });
});