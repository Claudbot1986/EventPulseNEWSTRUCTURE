import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchEvents, PAGE_SIZE } from '../services/eventServiceClient';
import { useI18n } from '../i18n';
import {
  formatPublishedEventTotal,
  usePublishedEventTotal,
} from '../context/EventTotalContext';

const EXPLORE_TIME_FILTERS = [
  { key: 'ikvall', label: 'Ikväll' },
  { key: 'imorgon', label: 'Imorgon' },
  { key: 'helgen', label: 'Helgen' },
  { key: 'denna_vecka', label: '7 dagar' },
];

const EXPLORE_CATEGORY_FILTERS = [
  { key: 'music', label: 'Musik' },
  { key: 'culture', label: 'Kultur' },
  { key: 'sports', label: 'Sport' },
  { key: 'theatre', label: 'Teater' },
  { key: 'food', label: 'Mat &' },
];

const CATEGORY_LABELS = {
  music: 'MUSIK',
  culture: 'KULTUR',
  sports: 'SPORT',
  theatre: 'TEATER',
  food: 'MAT & DRYCK',
};

function deduplicateEvents(events) {
  const seen = new Map();
  for (const event of events) {
    const stableKey = event.id
      ? `id:${event.id}`
      : `src:${event.source || 'unknown'}:ttl:${event.title || ''}:tm:${event.start_time || event.date || ''}`;
    if (!seen.has(stableKey)) {
      seen.set(stableKey, event);
    }
  }
  return Array.from(seen.values());
}

function formatCardDate(dateString, timeString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const days = ['Sön', 'Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör'];
  const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const time = timeString ? timeString.slice(0, 5) : '';
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}${time ? ` ${time}` : ''}`;
}

/** Collapsible search row height: input (46) + margin (16). */
const SEARCH_ROW_HEIGHT = 62;

/** Hide/show scroll thresholds — small hysteresis so jitter near the top
 *  doesn't flicker the bar. */
const SCROLL_HIDE_DELTA = 6;
const SCROLL_SHOW_DELTA = -6;
const SCROLL_HIDE_MIN_Y = 40;

/** Case- and accent-insensitive match text: NÅ => na. Multilingual-friendly
 *  (sv/en/de/fi …) without any language-specific rules in the client. */
function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining marks U+0300..U+036F
    .toLowerCase();
}

function isToday(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function filterByTime(events, timeFilter) {
  if (!timeFilter) return events;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return events.filter((event) => {
    if (!event.date) return false;
    const eventDate = new Date(`${event.date}T${event.time || '00:00'}`);
    const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());

    switch (timeFilter) {
      case 'ikvall':
        return eventDay.getTime() === today.getTime() && eventDate > now;
      case 'imorgon': {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return eventDay.getTime() === tomorrow.getTime();
      }
      case 'helgen': {
        const day = eventDay.getDay();
        return day === 0 || day === 6;
      }
      case 'denna_vecka': {
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        return eventDay >= today && eventDay <= nextWeek;
      }
      default:
        return true;
    }
  });
}

function ExploreEventCard({ event, onPress }) {
  const imageUrl = event.imageUrl || event.image_url;
  const categoryLabel = CATEGORY_LABELS[event.category] || 'EVENT';

  return (
    <TouchableOpacity style={styles.eventCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.eventImageWrap}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.eventImage} resizeMode="cover" />
        ) : (
          <View style={[styles.eventImage, styles.eventImagePlaceholder]} />
        )}
        <View style={styles.eventBadges}>
          <View style={styles.dateBadge}>
            <Text style={styles.dateBadgeText}>{formatCardDate(event.date, event.time)}</Text>
          </View>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryBadgeText}>{categoryLabel}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.eventTitle} numberOfLines={2}>
        {event.title}
      </Text>
    </TouchableOpacity>
  );
}

export default function ExploreScreen({ onEventPress }) {
  const { t } = useI18n();
  const { total, loading: totalLoading } = usePublishedEventTotal();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [timeFilter, setTimeFilter] = useState(null);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [query, setQuery] = useState('');
  const [searchHidden, setSearchHidden] = useState(false);
  const isFetchingRef = useRef(false);
  const lastScrollYRef = useRef(0);
  const searchBarAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(searchBarAnim, {
      toValue: searchHidden ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [searchHidden, searchBarAnim]);

  const loadEvents = useCallback(async (pageNum = 0, isLoadMore = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (isLoadMore) setLoadingMore(true);
    else setLoading(true);

    try {
      const result = await fetchEvents({ page: pageNum, limit: PAGE_SIZE });
      const uniqueData = deduplicateEvents(result.events || []);

      if (isLoadMore) {
        setEvents((prev) => deduplicateEvents([...prev, ...uniqueData]));
      } else {
        setEvents(uniqueData);
      }
      setPage(pageNum);
    } catch (err) {
      console.error('[ExploreScreen] failed to load events:', err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadEvents(0);
  }, [loadEvents]);

  const filteredEvents = useMemo(() => {
    let result = events;
    if (selectedCategories.length > 0) {
      result = result.filter((event) => selectedCategories.includes(event.category));
    }
    result = filterByTime(result, timeFilter);
    return result;
  }, [events, selectedCategories, timeFilter]);

  const trimmedQuery = query.trim();
  const searchResults = useMemo(() => {
    if (!trimmedQuery) return [];
    const needle = normalizeSearchText(trimmedQuery);
    return filteredEvents.filter((event) =>
      normalizeSearchText(`${event.title || ''} ${event.venue_name || event.venue || ''}`).includes(
        needle
      )
    );
  }, [filteredEvents, trimmedQuery]);

  const todayEvents = useMemo(
    () => filteredEvents.filter((event) => isToday(event.date)),
    [filteredEvents]
  );

  const visibleEvents = trimmedQuery ? searchResults : todayEvents;

  const totalLabel = formatPublishedEventTotal(total);

  const handleScroll = (event) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const y = contentOffset.y;
    const delta = y - lastScrollYRef.current;
    lastScrollYRef.current = y;

    // Collapse on scroll down past the header, bring back on scroll up.
    if (!searchHidden && delta > SCROLL_HIDE_DELTA && y > SCROLL_HIDE_MIN_Y) {
      setSearchHidden(true);
    } else if (searchHidden && (delta < SCROLL_SHOW_DELTA || y <= SCROLL_HIDE_MIN_Y)) {
      setSearchHidden(false);
    }

    const nearBottom = layoutMeasurement.height + y >= contentSize.height - 200;
    const hasMore = total == null || events.length < total;
    if (nearBottom && hasMore && !loadingMore && !loading) {
      loadEvents(page + 1, true);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.kicker}>CITY DISCOVERY</Text>
        <Text style={styles.title}>Vad händer i stan?</Text>
        <Text style={styles.subtitle}>
          {totalLoading ? (
            'Hämtar event från Supabase…'
          ) : totalLabel ? (
            <>
              <Text style={styles.subtitleCount}>{totalLabel} riktiga event</Text>
              {' att upptäcka. Börja browsa, filtrera när du vill.'}
            </>
          ) : (
            'Börja browsa, filtrera när du vill.'
          )}
        </Text>

        <Animated.View
          style={[
            styles.searchRow,
            {
              height: searchBarAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [SEARCH_ROW_HEIGHT, 0],
              }),
              opacity: searchBarAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            },
          ]}
          pointerEvents={searchHidden ? 'none' : 'auto'}
        >
          <View style={styles.searchBox}>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={t('explore.searchPlaceholder')}
              placeholderTextColor="#888888"
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="never"
              accessibilityLabel={t('explore.searchA11y')}
              testID="explore-search-input"
            />
            {query.length > 0 ? (
              <TouchableOpacity
                onPress={() => setQuery('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="explore-search-clear"
                style={styles.searchClearBtn}
              >
                <Ionicons name="close-circle" size={18} color="#888888" />
              </TouchableOpacity>
            ) : null}
            <Ionicons name="search" size={18} color="#333333" />
          </View>
        </Animated.View>

        <Text style={styles.filterHeading}>NÄR</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {EXPLORE_TIME_FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter.key}
              style={[styles.filterPill, timeFilter === filter.key && styles.filterPillActive]}
              onPress={() => setTimeFilter((prev) => (prev === filter.key ? null : filter.key))}
            >
              <Text
                style={[
                  styles.filterPillText,
                  timeFilter === filter.key && styles.filterPillTextActive,
                ]}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.filterHeading}>KATEGORI</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {EXPLORE_CATEGORY_FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter.key}
              style={[
                styles.filterPill,
                selectedCategories.includes(filter.key) && styles.filterPillActive,
              ]}
              onPress={() =>
                setSelectedCategories((prev) =>
                  prev.includes(filter.key)
                    ? prev.filter((key) => key !== filter.key)
                    : [...prev, filter.key]
                )
              }
            >
              <Text
                style={[
                  styles.filterPillText,
                  selectedCategories.includes(filter.key) && styles.filterPillTextActive,
                ]}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {!trimmedQuery ? <Text style={styles.sectionHeading}>Idag</Text> : null}

        {loading && events.length === 0 ? (
          <ActivityIndicator color="#E8A838" style={styles.loader} />
        ) : trimmedQuery && searchResults.length === 0 ? (
          <Text style={styles.emptyText}>{t('explore.noSearchResults', { q: trimmedQuery })}</Text>
        ) : !trimmedQuery && todayEvents.length === 0 ? (
          <Text style={styles.emptyText}>Inga event idag med valda filter.</Text>
        ) : (
          visibleEvents.map((event) => (
            <ExploreEventCard
              key={event.id || `${event.source}-${event.title}-${event.date}`}
              event={event}
              onPress={() => onEventPress(event)}
            />
          ))
        )}

        {loadingMore ? <ActivityIndicator color="#E8A838" style={styles.loader} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  kicker: {
    color: '#E8A838',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  subtitle: {
    color: '#9A9A9A',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  subtitleCount: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  searchRow: {
    overflow: 'hidden',
  },
  searchBox: {
    height: 46,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    color: '#111111',
    fontSize: 15,
    paddingVertical: 0,
  },
  searchClearBtn: {
    marginHorizontal: 6,
  },
  filterHeading: {
    color: '#666666',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },
  filterRow: {
    marginBottom: 16,
  },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#1c1c1c',
    marginRight: 8,
  },
  filterPillActive: {
    backgroundColor: '#E8A838',
  },
  filterPillText: {
    color: '#AAAAAA',
    fontSize: 14,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#0f0f0f',
  },
  sectionHeading: {
    color: '#E8A838',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 14,
    marginTop: 8,
  },
  eventCard: {
    marginBottom: 20,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#171717',
  },
  eventImageWrap: {
    position: 'relative',
  },
  eventImage: {
    width: '100%',
    height: 220,
    backgroundColor: '#2a2a2a',
  },
  eventImagePlaceholder: {
    backgroundColor: '#252525',
  },
  eventBadges: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  dateBadge: {
    backgroundColor: 'rgba(60, 40, 20, 0.92)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  dateBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  categoryBadge: {
    backgroundColor: 'rgba(90, 60, 140, 0.92)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  categoryBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  eventTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    padding: 16,
    lineHeight: 24,
  },
  loader: {
    marginVertical: 20,
  },
  emptyText: {
    color: '#777777',
    fontSize: 15,
    marginBottom: 20,
  },
});
