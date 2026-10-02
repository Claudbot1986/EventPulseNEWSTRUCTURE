/**
 * SearchScreen — Utforska sök (2026-10-02).
 *
 * Fristående sök-skärm som öppnas när användaren trycker på sökfältet i
 * Utforska. Innehåller:
 *   - Fritext-sökning (titel + beskrivning, server-side via feed_events
 *     `.or()` med ilike — se 08-Agent/tools/feed_events.ts)
 *   - Datumintervall via kalender-grid (DateRangePicker)
 *   - Kategori + pris-chips
 *   - Resultat som Spotify-stil rullista (samma UtforskaSection som Imorgon)
 *   - AI-relaxation: 0 träffar med fritext → auto-retry med bredare datum
 *
 * Tap på resultat-rad öppnar samma DetailsScreen som Hem använder.
 *
 * Designval:
 *   - Sök körs live (debouncad 350 ms) så listan inte flimmrar vid varje
 *     tangentnedslag. Datum/kategori-filter körs vid `onConfirm` (Klar).
 *   - fetchFeed-parametrarna (08-Agent) tar emot `q` + `dateTo` direkt,
 *     vilket ger server-side filtrering för text och datum. Filter som
 *     inte stöds server-side (multi-category, price) appliceras
 *     klient-side via applyBrowseFilters.
 *   - AI-relaxation är "tyst" — vi visar en banner ovanför resultatet
 *     som berättar vad som hände och låter användaren återställa.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../i18n/useI18n';
import { fetchFeed } from '../services/agentClient';
import { applyBrowseFilters } from '../utils/browseFilters';
import { mapAgentEventToRow } from '../components/rowMapping';
import UtforskaSection from '../components/UtforskaSection';
import DateRangePicker from '../components/DateRangePicker';
import { getItem, removeItem } from '../services/storage';
import {
  loadSearchFilters,
  saveSearchFilters,
  hasActiveFilters as hasActiveSearchFilters,
} from '../utils/searchFilters';

// AsyncStorage-nyckel där App.js skriver ev. pre-fill-query när
// användaren öppnar SearchScreen från Hem-sidans sökfält. Rensas efter
// läsning så en oavsiktlig remount inte återställer fritexten.
const INITIAL_QUERY_KEY = 'search_screen.initial_query';

// Sök-debounce (ms) — undviker att varje tangentnedslag triggar en fetch.
// 350 ms är branschstandard och snabbt nog att kännas direkt.
const SEARCH_DEBOUNCE_MS = 350;
// Persist-debounce (ms) — undvik att varje chip-tap spam-skriver
// AsyncStorage. 250 ms är under den mänskliga perceptionstiden för en
// uppdatering, så UI:n känns direkt medan skrivningarna batchas.
const FILTERS_SAVE_DEBOUNCE_MS = 250;
// Sidstorlek för search-results (samma som ExploreDetailScreen).
const SEARCH_PAGE_SIZE = 20;
// Max dagar framåt vi accepterar som default-fönster utan valt
// datumintervall. 365 dagar = ~1 år, vilket täcker "alla events"
// utan att kapacitetstesta servern i onödan.
const DEFAULT_WINDOW_DAYS = 365;
// Hur mycket vi vidgar datumintervallet vid AI-relaxation. 30 dagar
// på varje sida av användarens intervall ger en rimlig chans att hitta
// relaterade events.
const RELAX_EXTRA_DAYS = 30;

// ─── Chips ─────────────────────────────────────────────────────────────
// Kategori- och pris-chips speglar dem i UtforskaFilterDropdown men
// presenteras inline eftersom SearchScreen är dedikerad åt filtrering.
// Håller dem i en separat konstant så vi inte blandar in dropdown-
// komponentens hantering av "endast en grupp expanderad åt gången".
const CATEGORY_FILTERS = [
  { key: 'music', label: 'Musik' },
  { key: 'theatre', label: 'Teater' },
  { key: 'opera', label: 'Opera' },
  { key: 'theatre-comedy', label: 'Standup' },
  { key: 'exhibition', label: 'Utställning' },
  { key: 'food', label: 'Mat & dryck' },
  { key: 'wine-tasting', label: 'Vinprovning' },
  { key: 'family', label: 'Familj' },
  { key: 'kids', label: 'Barn' },
  { key: 'film', label: 'Film' },
  { key: 'talks-lectures', label: 'Föreläsning' },
  { key: 'workshop', label: 'Workshop' },
  { key: 'sports', label: 'Sport' },
  { key: 'community', label: 'Community' },
  { key: 'flea-market', label: 'Loppis' },
];

const PRICE_FILTERS = [
  { key: 'free', label: 'Gratis' },
  { key: 'under_200', label: 'Under 200 kr' },
];

// ─── Helper: bygg filter-objekt för applyBrowseFilters ────────────────
// SearchScreen har separata state-fält per filter-typ; vi slår ihop
// dem till det filter-objekt som applyBrowseFilters förväntar sig.
function buildFilters({
  query, selectedCategories, priceFilter, dateFrom, dateTo,
}) {
  const filters = {
    selectedCategories,
    priceFilter,
    pinnedDateIso: null,
    // queryTerms är den interna auto-prefill (genre-union). Search
    // använder den publika text-sökningen (q) istället; vi lämnar
    // queryTerms null så searchText-vägen inte körs igen.
    queryTerms: null,
    searchText: null,
  };
  // pinnedDateIso används för "exakt en dag"-filter. Search använder
  // intervall (dateFrom/dateTo) istället, så vi hoppar den.
  void query;
  void dateFrom;
  void dateTo;
  return filters;
}

// ─── Date-hjälpare ─────────────────────────────────────────────────────
function isoOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysIso(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

function formatDateRange(t, fromIso, toIso) {
  if (!fromIso && !toIso) {
    return t('explore.search.dateAny');
  }
  if (fromIso && (!toIso || fromIso === toIso)) {
    return t('explore.search.dateSetSingle', { from: fromIso });
  }
  const sep = t('explore.search.dateSep');
  return t('explore.search.dateSet', {
    from: fromIso,
    to: toIso,
    sep,
  });
}

// ─── Huvudkomponent ────────────────────────────────────────────────────
export default function SearchScreen({ onBack, onEventPress }) {
  const { t, language } = useI18n();

  // Filter-state
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [priceFilter, setPriceFilter] = useState(null);
  // dateFrom/dateTo = null betyder "alla framtida events" (vilket blir
  // 365 dagar via DEFAULT_WINDOW_DAYS).
  const [dateFrom, setDateFrom] = useState(isoOf(new Date()));
  const [dateTo, setDateTo] = useState(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  // 2026-10-02 (filter-UX): filter-chips är dolda från start. När
  // användaren fokuserar sökfältet expanderar de ner under sök-rutan.
  // Engångs-reveal — förblir expanderade tills användaren lämnar screenen
  // (sticky once-shown, ingen auto-collapse). Om AsyncStorage-restore
  // visar aktiva filter börjar vi redan expanderade så användaren ser vad
  // som är aktivt (annars döljs valda filter).
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Resultat-state
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [fetchState, setFetchState] = useState('idle'); // idle|loading|error
  const [relaxed, setRelaxed] = useState(null); // null | { from, to, original }

  // Refs — håller fetchen idempotent mot dubbla useEffect-bränningar
  // (StrictMode i dev, eller användare som snabbtväxlar filter).
  const debounceRef = useRef(null);
  const requestSeqRef = useRef(0);
  const lastRequestKeyRef = useRef(null);
  const initialQueryLoadedRef = useRef(false);
  const filtersLoadedRef = useRef(false);
  const filtersSaveTimerRef = useRef(null);

  // 2026-10-02: läs ev. pre-fill-query från AsyncStorage en gång vid
  // mount (sätts av App.js när användaren tappar sökfältet i Hem).
  // Rensas direkt efter läsning så oavsiktlig remount inte återställer.
  useEffect(() => {
    if (initialQueryLoadedRef.current) return;
    initialQueryLoadedRef.current = true;
    getItem(INITIAL_QUERY_KEY)
      .then((value) => {
        if (typeof value === 'string' && value.length > 0) {
          setQuery(value);
          setDebouncedQuery(value);
        }
      })
      .catch(() => {})
      .finally(() => {
        removeItem(INITIAL_QUERY_KEY).catch(() => {});
      });
  }, []);

  // 2026-10-02 (filter-persistens): läs ev. sparade filter från
  // AsyncStorage en gång vid mount. Om aktiva filter hittas startar vi
  // med `filtersExpanded=true` så användaren ser sina val direkt.
  // Vi gör INTE detta i useState-init eftersom AsyncStorage är async — att
  // anta sync-data i useState skulle antingen kräva en blockerande läsning
  // eller ge flash av defaults vid mount.
  useEffect(() => {
    if (filtersLoadedRef.current) return;
    filtersLoadedRef.current = true;
    loadSearchFilters().then((restored) => {
      if (!restored) return;
      if (restored.selectedCategories.length > 0) {
        setSelectedCategories(restored.selectedCategories);
      }
      if (restored.priceFilter) {
        setPriceFilter(restored.priceFilter);
      }
      if (restored.dateFrom) {
        setDateFrom(restored.dateFrom);
      }
      if (restored.dateTo) {
        setDateTo(restored.dateTo);
      }
      // Om restore hittade aktiva filter: visa filter-chips direkt så
      // användaren ser vad som är aktivt (annars laga dem alltid dolt vid
      // mount mitt och valen blir sävida för användaren).
      if (hasActiveSearchFilters(restored)) {
        setFiltersExpanded(true);
      }
    }).catch(() => {});
  }, []);

  // 2026-10-02 (filter-persistens): spara filter-state till AsyncStorage
  // när det ändras. Debounce 250 ms så en serie chip-tap blir EN
  // skrivning. Snykald: `saveSearchFilters` plockar inga defaults — vi
  // skickar rå state och modulen avgör om något är aktivt.
  useEffect(() => {
    // Hoppa första körningen (mount) — då har vi ev. just läst från
    // AsyncStorage och vill inte skriva tillbaka samma data direkt.
    if (!filtersLoadedRef.current) return;
    if (filtersSaveTimerRef.current) clearTimeout(filtersSaveTimerRef.current);
    filtersSaveTimerRef.current = setTimeout(() => {
      saveSearchFilters({
        selectedCategories,
        priceFilter,
        dateFrom,
        dateTo,
      }).catch(() => {});
    }, FILTERS_SAVE_DEBOUNCE_MS);
    return () => {
      if (filtersSaveTimerRef.current) clearTimeout(filtersSaveTimerRef.current);
    };
  }, [selectedCategories, priceFilter, dateFrom, dateTo]);

  // Debounce fritext — filter som byter snabbt (kategori/pris/datum)
  // körs direkt utan debounce. Detta minskar API-spam och flimmer.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // ─── Fetch ───────────────────────────────────────────────────────────
  // Använder requestSeqRef så äldre fetches inte skriver över nyare.
  // relaxed-värdet är null vid strikt query och sätts vid AI-bredning.
  const fetchResults = useCallback(async (opts = {}) => {
    const seq = ++requestSeqRef.current;
    const key = JSON.stringify({
      q: debouncedQuery,
      cats: selectedCategories.slice().sort(),
      price: priceFilter,
      from: dateFrom,
      to: dateTo,
      relaxation: opts.relaxation || null,
    });
    if (lastRequestKeyRef.current === key && !opts.force) {
      return; // identisk request — skippa
    }
    lastRequestKeyRef.current = key;
    setFetchState('loading');
    setRelaxed(null);

    try {
      const params = {
        from: dateFrom || isoOf(new Date()),
        days: dateTo ? DEFAULT_WINDOW_DAYS : DEFAULT_WINDOW_DAYS,
        limit: 100, // search-skärmen visar alla matchningar på en sida
        offset: 0,
        // q endast om användaren skrivit något — tom sträng skickas inte.
        ...(debouncedQuery && debouncedQuery.trim()
          ? { q: debouncedQuery.trim() }
          : {}),
        // dateTo sätts när användaren valt ett intervall. Null → default
        // (365 dagar från idag, så vi inte returnerar ALLA framtida events
        // i onödan — search-skärmen är inte en "bläddra hela DB"-vy).
        ...(dateTo ? { dateTo } : {}),
      };
      const page = await fetchFeed(params);
      if (seq !== requestSeqRef.current) return; // äldre request, ignorera

      let mapped = (page.events || [])
        .map((e) => mapAgentEventToRow(e, language))
        .filter(Boolean);

      // Klient-side multi-category + price-filter (fetchFeed stöder en
      // kategori + isFree, men search-skärmen vill ha multi-select).
      //
      // 2026-10-02 (live smoke mot PostgREST): server-side `.or()` är en
      // platt OR-lista — den ger INTE AND över multipla söktermer (det
      // skulle krävt nästade paranteser som PostgREST parsern inte
      // accepterar). Vi kompletterar därför med client-side AND-filter
      // via applyBrowseFilters + queryTerms när q har ≥ 2 ord.
      const trimmed = debouncedQuery.trim();
      const termsForClientAnd =
        trimmed && trimmed.includes(' ')
          ? trimmed.split(/\s+/)
          : null;
      const filters = buildFilters({
        query: debouncedQuery,
        selectedCategories,
        priceFilter,
        dateFrom,
        dateTo,
      });
      // applyBrowseFilters förväntar sig legacy event-shape med
      // category_slug + price_min/max — mappa tillfälligt.
      const rawEvents = (page.events || []).map((e) => ({
        ...e,
        category: e.category_slug,
        is_free: e.is_free === true,
        isFree: e.is_free === true,
        venue: e.venue_name,
        priceMin: e.price_min_sek,
        priceMax: e.price_max_sek,
      }));
      // Server-side .or() hanterar redan en-terms-sök och fält-OR; vid
      // multi-term vill vi ha strikt AND på klienten. Hämta först
      // server-resultat, sedan filtrera vidare.
      const filtered = applyBrowseFilters(rawEvents, {
        ...filters,
        ...(termsForClientAnd
          ? { queryTerms: termsForClientAnd, searchText: null }
          : {}),
      });
      const filteredIds = new Set(filtered.map((e) => e.id));
      mapped = mapped.filter((r) => filteredIds.has(r.id));

      // ─── AI-relaxation ────────────────────────────────────────────────
      // Om 0 träffar OCH användaren har en fritext-fråga OCH intervallet
      // är smalare än vad vi skulle få med relaxation: hämta samma fråga
      // men med bredare datumintervall. Visar banner.
      if (
        mapped.length === 0 &&
        debouncedQuery.trim() &&
        !opts.relaxation
      ) {
        const widenedFrom = dateFrom
          ? addDaysIso(dateFrom, -RELAX_EXTRA_DAYS)
          : isoOf(new Date());
        const widenedTo = dateTo
          ? addDaysIso(dateTo, RELAX_EXTRA_DAYS)
          : addDaysIso(isoOf(new Date()), RELAX_EXTRA_DAYS * 2);
        // Re-run med bredare fönster — sätter relaxed-state.
        const relaxedParams = {
          from: widenedFrom,
          days: DEFAULT_WINDOW_DAYS,
          limit: 100,
          offset: 0,
          q: debouncedQuery.trim(),
          dateTo: widenedTo,
        };
        const relaxedPage = await fetchFeed(relaxedParams);
        if (seq !== requestSeqRef.current) return;
        let relaxedMapped = (relaxedPage.events || [])
          .map((e) => mapAgentEventToRow(e, language))
          .filter(Boolean);
        const relaxedRaw = (relaxedPage.events || []).map((e) => ({
          ...e,
          category: e.category_slug,
          is_free: e.is_free === true,
          isFree: e.is_free === true,
          venue: e.venue_name,
          priceMin: e.price_min_sek,
          priceMax: e.price_max_sek,
        }));
        const relaxedFiltered = applyBrowseFilters(relaxedRaw, {
          ...filters,
          ...(termsForClientAnd
            ? { queryTerms: termsForClientAnd, searchText: null }
            : {}),
        });
        const relaxedFilteredIds = new Set(relaxedFiltered.map((e) => e.id));
        relaxedMapped = relaxedMapped.filter((r) =>
          relaxedFilteredIds.has(r.id)
        );
        if (relaxedMapped.length > 0) {
          setRows(relaxedMapped);
          setTotal(relaxedPage.total || relaxedMapped.length);
          setRelaxed({
            from: dateFrom,
            to: dateTo,
            widenedFrom,
            widenedTo,
          });
          setFetchState('idle');
          return;
        }
      }

      setRows(mapped);
      setTotal(page.total || mapped.length);
      setFetchState('idle');
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      console.warn('[SearchScreen] fetch failed:', err);
      setFetchState('error');
    }
  }, [
    debouncedQuery,
    selectedCategories,
    priceFilter,
    dateFrom,
    dateTo,
    language,
  ]);

  // Re-fetch när filter ändras (debounced för fritext).
  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  // ─── Filter-handlers ────────────────────────────────────────────────
  const toggleCategory = useCallback((key) => {
    setSelectedCategories((prev) =>
      prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key]
    );
  }, []);

  const togglePrice = useCallback((key) => {
    setPriceFilter((prev) => (prev === key ? null : key));
  }, []);

  const handleDateApply = useCallback(({ from, to }) => {
    setDateFrom(from || isoOf(new Date()));
    setDateTo(to || null);
    setDatePickerVisible(false);
  }, []);

  const handleClearAll = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setSelectedCategories([]);
    setPriceFilter(null);
    setDateFrom(isoOf(new Date()));
    setDateTo(null);
    setRelaxed(null);
  }, []);

  const handleRestoreFilters = useCallback(() => {
    // Manuell reset av relaxed — återhämtar original-filter genom att
    // tvinga fram en ny fetch med samma parametrar.
    setRelaxed(null);
    fetchResults({ force: true });
  }, [fetchResults]);

  // ─── Active-filter-räknare (för header + "Rensa allt") ──────────────
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (selectedCategories.length > 0) n += selectedCategories.length;
    if (priceFilter) n += 1;
    if (dateTo) n += 1;
    return n;
  }, [selectedCategories, priceFilter, dateTo]);

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.eyebrow}>{t('explore.search.title')}</Text>
          <Text style={styles.heading}>{t('explore.search.heading')}</Text>
        </View>
      </View>

      {/* Search-input + clear */}
      <View style={styles.searchBoxWrap}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color="#A9B0BE" />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setFiltersExpanded(true)}
            placeholder={t('explore.searchPlaceholder')}
            placeholderTextColor="#6F7785"
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel={t('explore.searchA11y')}
            testID="search-screen-input"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery('')}
              hitSlop={8}
              testID="search-screen-clear"
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              style={({ pressed }) => [styles.clearBtn, pressed && styles.pressed]}
            >
              <Ionicons name="close-circle" size={16} color="#A9B0BE" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* 2026-10-02 (filter-UX): filter-chips är dolda tills användaren
          fokuserar sökfältet (eller återställer aktiva filter från
          AsyncStorage). När expanderade wrappar de dåligar över flera
          rader (flexWrap) istället för EN horisontell scroll. */}
      {filtersExpanded ? (
        <View
          style={styles.filterWrap}
          testID="search-filter-bar"
        >
          {/* Datum-knapp (öppnar DateRangePicker-modal) */}
          <Pressable
            onPress={() => setDatePickerVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={t('explore.search.dateButton')}
            testID="search-date-button"
            style={({ pressed }) => [
              styles.chip,
              styles.chipDate,
              (dateFrom || dateTo) && styles.chipActive,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name="calendar-outline"
              size={14}
              color={(dateFrom || dateTo) ? '#000' : '#FFF'}
              style={styles.chipIcon}
            />
            <Text
              style={[
                styles.chipText,
                (dateFrom || dateTo) && styles.chipTextActive,
              ]}
              numberOfLines={1}
            >
              {formatDateRange(t, dateFrom, dateTo)}
            </Text>
          </Pressable>

          {/* Pris-chips */}
          {PRICE_FILTERS.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => togglePrice(f.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: priceFilter === f.key }}
              style={({ pressed }) => [
                styles.chip,
                priceFilter === f.key && styles.chipActive,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  priceFilter === f.key && styles.chipTextActive,
                ]}
              >
                {f.label}
              </Text>
            </Pressable>
          ))}

          {/* Kategori-chips (visar de viktigaste + ev. fler) */}
          {CATEGORY_FILTERS.map((f) => {
            const active = selectedCategories.includes(f.key);
            return (
              <Pressable
                key={f.key}
                onPress={() => toggleCategory(f.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.chip,
                  active && styles.chipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.chipText, active && styles.chipTextActive]}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Sub-info-rad + Rensa allt */}
      <View style={styles.subInfo}>
        <Text style={styles.subInfoText}>
          {debouncedQuery.trim()
            ? t('explore.search.applied', { q: debouncedQuery.trim() })
            : activeFilterCount > 0
              ? t('explore.search.activeFilterCount', {
                  count: activeFilterCount,
                })
              : t('explore.search.noFilters')}
        </Text>
        {activeFilterCount > 0 || debouncedQuery.trim() ? (
          <Pressable
            onPress={handleClearAll}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('explore.search.clearAll')}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Text style={styles.clearAllText}>
              {t('explore.search.clearAll')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* AI-relaxation banner */}
      {relaxed ? (
        <Animated.View style={styles.relaxBanner}>
          <Ionicons
            name="sparkles-outline"
            size={14}
            color="#000"
            style={styles.relaxIcon}
          />
          <Text style={styles.relaxText} numberOfLines={3}>
            {debouncedQuery.trim()
              ? t('explore.search.relaxedNotice', { q: debouncedQuery.trim() })
              : t('explore.search.relaxedNoticeNoQuery')}
          </Text>
          <Pressable
            onPress={handleRestoreFilters}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('explore.search.relaxedReset')}
          >
            <Text style={styles.relaxAction}>
              {t('explore.search.relaxedReset')}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}

      {/* Resultat — Spotify-stil rullista (samma som Imorgon) */}
      <View style={styles.resultsWrap}>
        {fetchState === 'error' ? (
          <View style={styles.centerMsg}>
            <Text style={styles.errorText}>{t('explore.search.error')}</Text>
          </View>
        ) : fetchState === 'loading' && rows.length === 0 ? (
          <View style={styles.centerMsg}>
            <ActivityIndicator color="#FFB454" />
          </View>
        ) : rows.length === 0 && fetchState === 'idle' ? (
          <View style={styles.centerMsg}>
            <Text style={styles.emptyText}>{t('explore.search.empty')}</Text>
          </View>
        ) : (
          <UtforskaSection
            events={rows}
            totalCount={total}
            eyebrowText={
              debouncedQuery.trim()
                ? `${t('explore.search.title')} · ${total}`
                : `${t('explore.search.appliedNoQuery')} · ${total}`
            }
            onEventPress={onEventPress}
            loadingSkeletonCount={6}
          />
        )}
      </View>

      {/* DateRangePicker modal */}
      <DateRangePicker
        key={datePickerVisible ? 'open' : 'closed'}
        visible={datePickerVisible}
        onClose={() => setDatePickerVisible(false)}
        onApply={handleDateApply}
        value={{ from: dateFrom, to: dateTo }}
        today={new Date()}
        language={language}
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    marginLeft: 8,
  },
  eyebrow: {
    color: '#FFB454',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  searchBoxWrap: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
    padding: 0,
  },
  clearBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingBottom: 8,
    rowGap: 8,
    columnGap: 6,
    alignItems: 'flex-start',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#1A1A1A',
    minHeight: 44,
  },
  chipActive: {
    backgroundColor: '#FFB454',
  },
  chipDate: {
    paddingHorizontal: 10,
  },
  chipIcon: {
    marginRight: 4,
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  subInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  subInfoText: {
    color: '#A9B0BE',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  clearAllText: {
    color: '#FFB454',
    fontSize: 12,
    fontWeight: '700',
  },
  relaxBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFB454',
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 8,
    gap: 8,
  },
  relaxIcon: {
    marginRight: 0,
  },
  relaxText: {
    flex: 1,
    color: '#000000',
    fontSize: 12,
    fontWeight: '600',
  },
  relaxAction: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  resultsWrap: {
    flex: 1,
  },
  centerMsg: {
    paddingVertical: 64,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  errorText: {
    color: '#FF8A8A',
    fontSize: 14,
    textAlign: 'center',
  },
  emptyText: {
    color: '#A9B0BE',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.5,
  },
});
