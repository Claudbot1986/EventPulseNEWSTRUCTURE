import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, SectionList, ActivityIndicator, TouchableOpacity, ScrollView, Linking, Image } from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { fetchFeed, addDays } from './services/agentClient';

const TOKENS = {
  color: {
    appBg: '#050507',
    surface: '#0E0E12',
    surfaceRaised: '#191D28',
    surfaceSoft: '#202635',
    border: '#2B3140',
    borderStrong: '#3A4254',
    text: '#F7F2EA',
    textMuted: '#A9B0BE',
    textSoft: '#727B8D',
    accent: '#FFB454',
    accentSoft: '#332516',
    mint: '#72E0C5',
    coral: '#FF6B8A',
    danger: '#FF7597',
    black: '#000000',
    white: '#FFFFFF',
  },
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 28,
  },
  radius: {
    sm: 10,
    md: 16,
    lg: 22,
    pill: 999,
  },
};

// Calculate end date (1 year from now)
function getEndDate() {
  const now = new Date();
  const endDate = new Date(now);
  endDate.setFullYear(endDate.getFullYear() + 1);
  return endDate.toISOString().split('T')[0];
}

/**
 * Deduplicate events by stable key (id or title+start_time fallback)
 * Returns unique events in original order
 */
function deduplicateEvents(events) {
  const seen = new Map();
  
  for (const event of events) {
    // Primary key: event.id (most stable)
    // Fallback key: source + title + start_time (for events without id)
    const stableKey = event.id 
      ? `id:${event.id}`
      : `src:${event.source || 'unknown'}:ttl:${event.title || ''}:tm:${event.start_time || event.date || ''}`;
    
    if (!seen.has(stableKey)) {
      seen.set(stableKey, event);
    }
  }
  
  return Array.from(seen.values());
}

// Event categories with colors for visual distinction
const CATEGORIES = {
  music: { label: 'MUSIK', color: '#BB86FC', bgColor: '#2D2D3A' },
  food: { label: 'MAT & DRYCK', color: '#FF7597', bgColor: '#3A2D2D' },
  culture: { label: 'KULTUR', color: '#4ECDC4', bgColor: '#2D3A35' },
  nightlife: { label: 'NATTLIV', color: '#FFE66D', bgColor: '#3A3A2D' },
  sports: { label: 'SPORT', color: '#95E1D3', bgColor: '#2D353A' },
  tech: { label: 'TECH', color: '#74B9FF', bgColor: '#2D3140' },
  barn: { label: 'BARN', color: '#FF9F43', bgColor: '#3A352D' },
  theatre: { label: 'TEATER', color: '#FF6B6B', bgColor: '#3A2A2A' },
};

// Category filter labels (Swedish)
const CATEGORY_FILTERS = [
  { key: 'music', label: 'Musik' },
  { key: 'culture', label: 'Kultur' },
  { key: 'sports', label: 'Sport' },
  { key: 'theatre', label: 'Teater' },
  { key: 'food', label: 'Mat & Dryck' },
  { key: 'nightlife', label: 'Nattliv' },
  { key: 'barn', label: 'Barn' },
];

// Time filter definitions
const TIME_FILTERS = [
  { key: 'ikvall', label: 'Ikväll' },
  { key: 'imorgon', label: 'Imorgon' },
  { key: 'helgen', label: 'Helgen' },
  { key: 'denna_vecka', label: '7 dagar' },
];

const PRICE_FILTERS = [
  { key: 'free', label: 'Gratis' },
];

// Fallback provider definitions (used when API doesn't provide sources)
// Keys must match canonical event.source from API server
//
// NOTE: Only ACTIVE sources with real data are included.
// stockholm-venues is INACTIVE (blocked by Cloudflare, no public API).
const FALLBACK_PROVIDERS = [
  { key: 'all', label: 'Alla arrangörer' },
  { key: 'ticketmaster', label: 'Ticketmaster' },
  { key: 'kulturhuset', label: 'Kulturhuset' },
  { key: 'malmo-live', label: 'Malmö Live' },
];

// Build PROVIDERS from available sources (with 'all' option prepended)
function buildProviders(availableSources) {
  if (!availableSources || availableSources.length === 0) {
    return FALLBACK_PROVIDERS;
  }
  
  // Normalize sources: handle both string arrays and object arrays
  const normalizedSources = availableSources.map(s => {
    if (typeof s === 'string') {
      // Source is a string (e.g., "ticketmaster", "kulturhuset")
      return { key: s, label: formatProviderLabel(s) };
    }
    // Source is an object with key/label properties
    return { key: s.key, label: s.label || formatProviderLabel(s.key) };
  });
  
  // Prepend 'all' option
  return [
    { key: 'all', label: 'Alla arrangörer' },
    ...normalizedSources,
  ];
}

// Format provider key to human-readable label
function formatProviderLabel(key) {
  const labels = {
    'ticketmaster': 'Ticketmaster',
    'kulturhuset': 'Kulturhuset',
    'malmo-live': 'Malmö Live',
  };
  return labels[key] || key;
}

// Get CTA button text based on source
function getCtaText(source) {
  const ctaLabels = {
    'ticketmaster': 'Köp biljett via Ticketmaster',
    'kulturhuset': 'Läs mer på Kulturhuset',
    'malmo-live': 'Läs mer på Malmö Live',
  };
  return ctaLabels[source] || 'Läs mer';
}

function getVenueLabel(event) {
  return event.venue || event.venue_name || null;
}

function getAreaLabel(event) {
  return event.area || event.city || null;
}

function formatPrice(event) {
  if (event.isFree || event.is_free) {
    return 'Gratis';
  }

  const min = event.priceMin ?? event.price_min;
  const max = event.priceMax ?? event.price_max;

  if (min != null && max != null && min !== max) {
    return `${min}-${max} kr`;
  }

  if (min != null) {
    return `${min} kr`;
  }

  return null;
}

// Format date for display in Swedish (e.g., "Lör 21 mars")
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const daysSwedish = ['Sön', 'Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör'];
  const monthsSwedish = ['jan', 'feb', 'mars', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return `${daysSwedish[date.getDay()]} ${date.getDate()} ${monthsSwedish[date.getMonth()]}`;
}

// Format full date for details (e.g., "Fredag 20 mars 2026")
function formatFullDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const days = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
  const months = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// Format time for display in 24-hour Swedish format (e.g., "19:30")
function formatTime(timeString) {
  if (!timeString) return '';
  const [hours, minutes] = timeString.split(':');
  return `${hours}:${minutes}`;
}

function formatEventTime(event) {
  const start = formatTime(event.time);
  return start || 'Tid ej angiven';
}

// Format day header for grouped events (Swedish)
function formatDayHeader(dateString) {
  if (!dateString) return '';
  
  const date = new Date(dateString);
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const eventDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
  const daysSwedish = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
  const monthsSwedish = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  
  // Check if today
  if (eventDate.getTime() === todayDate.getTime()) {
    return 'Idag';
  }
  
  // Check if tomorrow
  if (eventDate.getTime() === tomorrow.getTime()) {
    return 'Imorgon';
  }
  
  // Otherwise, show day and date (e.g., "Lördag 14 mars")
  return `${daysSwedish[date.getDay()]} ${date.getDate()} ${monthsSwedish[date.getMonth()]}`;
}

// Group events by day, and group same-title events together within each day
function groupEventsByDay(events) {
  const dayGroups = {};
  
  // First group by date
  events.forEach(event => {
    if (!event.date) return;
    
    if (!dayGroups[event.date]) {
      dayGroups[event.date] = [];
    }
    dayGroups[event.date].push(event);
  });
  
  // For each day, group events by title
  Object.keys(dayGroups).forEach(date => {
    const dayEvents = dayGroups[date];
    const titleGroups = {};
    
    dayEvents.forEach(event => {
      const title = event.title || '';
      if (!titleGroups[title]) {
        titleGroups[title] = [];
      }
      titleGroups[title].push(event);
    });
    
    // Sort events within each title group by time
    Object.keys(titleGroups).forEach(title => {
      titleGroups[title].sort((a, b) => {
        if (!a.time && !b.time) return 0;
        if (!a.time) return 1;
        if (!b.time) return -1;
        return a.time.localeCompare(b.time);
      });
    });
    
    // Replace the day's events with grouped events
    dayGroups[date] = Object.keys(titleGroups).map(title => ({
      isGrouped: true,
      title: title,
      events: titleGroups[title],
      category: titleGroups[title][0].category,
      venue: titleGroups[title][0].venue,
      area: titleGroups[title][0].area,
      date: date,
    }));
    
    // Sort grouped events by first event's time
    dayGroups[date].sort((a, b) => {
      const aTime = a.events[0]?.time || '';
      const bTime = b.events[0]?.time || '';
      if (!aTime && !bTime) return 0;
      if (!aTime) return 1;
      if (!bTime) return -1;
      return aTime.localeCompare(bTime);
    });
  });
  
  // Convert to array and sort by date
  const result = Object.keys(dayGroups)
    .sort((a, b) => a.localeCompare(b))
    .map(date => ({
      date,
      title: formatDayHeader(date),
      events: dayGroups[date],
    }));
  
  return result;
}

// Filter events by time
function filterEventsByTime(events, timeFilter) {
  if (!timeFilter) return events;
  
  const now = new Date();
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

// Filter events by category
function filterEventsByCategory(events, selectedCategories) {
  if (!selectedCategories || selectedCategories.length === 0) return events;
  
  return events.filter(event => {
    return selectedCategories.includes(event.category);
  });
}

function SplashScreen() {
  return (
    <View style={styles.splashContainer}>
      <Text style={styles.splashText}>EventPulse</Text>
    </View>
  );
}

function CategoryBadge({ category }) {
  const cat = CATEGORIES[category] || CATEGORIES.music;
  return (
    <View style={[styles.categoryBadge, { backgroundColor: cat.bgColor }]}>
      <Text style={[styles.categoryText, { color: cat.color }]}>{cat.label}</Text>
    </View>
  );
}

function DateCluster({ event }) {
  return (
    <View style={styles.dateCluster}>
      <Text style={styles.dateClusterDay}>{formatDate(event.date) || 'Datum saknas'}</Text>
      <Text style={styles.dateClusterTime}>{formatEventTime(event)}</Text>
    </View>
  );
}

function EventItem({ event, onPress }) {
  const venue = getVenueLabel(event);
  const area = getAreaLabel(event);
  const price = formatPrice(event);

  return (
    <TouchableOpacity style={styles.eventCard} onPress={onPress} activeOpacity={0.7}>
      {event.imageUrl ? (
        <Image source={{ uri: event.imageUrl }} style={styles.eventImage} />
      ) : (
        <View style={styles.eventImageFallback}>
          <Text style={styles.eventImageFallbackText}>Ingen bild från källan</Text>
        </View>
      )}
      <View style={styles.eventCardBody}>
        <View style={styles.eventHeader}>
          <DateCluster event={event} />
          <CategoryBadge category={event.category} />
        </View>
        <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
        <View style={styles.eventMetaRow}>
          <Text style={styles.eventVenue} numberOfLines={1}>{venue || 'Plats ej angiven'}</Text>
          {area && <Text style={styles.eventArea} numberOfLines={1}> · {area}</Text>}
        </View>
        <View style={styles.eventFooter}>
          {price && <Text style={styles.eventPrice}>{price}</Text>}
          <View style={styles.eventActionRow}>
            {event.hasExternalLink && (
              <Text style={styles.externalLinkChip} numberOfLines={1}>
                {event.externalLinkChipLabel || 'Extern länk'}
              </Text>
            )}
            <Text style={styles.eventOpenText}>Visa event</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function GroupedEventItem({ groupedEvent, onEventPress }) {
  const firstEvent = groupedEvent.events[0] || groupedEvent;
  const venue = getVenueLabel(firstEvent);
  const area = getAreaLabel(firstEvent);

  return (
    <TouchableOpacity style={styles.eventCard} onPress={() => onEventPress(groupedEvent.events[0])} activeOpacity={0.7}>
      {firstEvent.imageUrl ? (
        <Image source={{ uri: firstEvent.imageUrl }} style={styles.eventImage} />
      ) : (
        <View style={styles.eventImageFallback}>
          <Text style={styles.eventImageFallbackText}>Ingen bild från källan</Text>
        </View>
      )}
      <View style={styles.eventCardBody}>
        <View style={styles.eventHeader}>
          <DateCluster event={firstEvent} />
          <CategoryBadge category={groupedEvent.category} />
        </View>
        <Text style={styles.eventTitle} numberOfLines={2}>{groupedEvent.title}</Text>
        <View style={styles.eventMetaRow}>
          <Text style={styles.eventVenue} numberOfLines={1}>{venue || 'Plats ej angiven'}</Text>
          {area && <Text style={styles.eventArea} numberOfLines={1}> · {area}</Text>}
        </View>
        <View style={styles.groupedSummaryRow}>
          <Text style={styles.groupedCount}>{groupedEvent.events.length} tider tillgängliga</Text>
          {firstEvent.hasExternalLink && (
            <Text style={styles.externalLinkChip} numberOfLines={1}>
              {firstEvent.externalLinkChipLabel || 'Extern länk'}
            </Text>
          )}
        </View>
        <View style={styles.groupedTimesContainer}>
          {groupedEvent.events.map((event, index) => (
            <TouchableOpacity
              key={`${event.id || event.start_time || index}`}
              style={styles.groupedRowContainer}
              onPress={() => onEventPress(event)}
              activeOpacity={0.7}
            >
              <Text style={styles.groupedDateText}>
                {formatDate(event.date)} · {formatEventTime(event)}
              </Text>
              <Text style={styles.groupedRowArrowText}>Visa</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function LoadingMore() {
  return (
    <View style={styles.loadingMore}>
      <ActivityIndicator size="small" color={TOKENS.color.accent} />
      <Text style={styles.loadingMoreText}>Hämtar fler event...</Text>
    </View>
  );
}

function LoadingSkeleton() {
  return (
    <SafeAreaView style={styles.homeContainer}>
      <View style={styles.header}>
        <Text style={styles.appKicker}>City discovery</Text>
        <Text style={styles.appTitle}>EventPulse</Text>
        <Text style={styles.appSubtitle}>Hämtar riktiga event nära dig.</Text>
      </View>
      <View style={styles.skeletonList}>
        {[0, 1, 2].map(item => (
          <View key={item} style={styles.skeletonCard}>
            <View style={styles.skeletonImage} />
            <View style={styles.skeletonLineWide} />
            <View style={styles.skeletonLineShort} />
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}

function StateView({ title, detail, actionLabel, onAction }) {
  return (
    <View style={styles.stateContainer}>
      <Text style={styles.stateTitle}>{title}</Text>
      {detail && <Text style={styles.stateDetail}>{detail}</Text>}
      {actionLabel && onAction && (
        <TouchableOpacity style={styles.stateButton} onPress={onAction} activeOpacity={0.8}>
          <Text style={styles.stateButtonText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function HomeScreen({ onEventPress, scrollPositionRef }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [timeFilter, setTimeFilter] = useState(null);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [priceFilter, setPriceFilter] = useState(null);
  // Pagination: `weekStart` advances by 7 days on each scroll-end load.
  const [weekStart, setWeekStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [hasMore, setHasMore] = useState(true);
  const sectionListRef = useRef(null);
  const scrollPositionRefLocal = useRef(0);
  const isFetchingRef = useRef(false);

  /**
   * Load events for the current `weekStart`.
   * - On initial mount, if the page is empty (e.g. a quiet Sunday), advance
   *   `weekStart` by 1 day and retry, up to 7 attempts.
   * - On scroll-end (loadMore=true), append the next 7-day window without
   *   retry semantics — caller already chose to advance.
   */
  const loadEvents = useCallback(async (opts = {}) => {
    const { append = false, fromOverride = null } = opts;
    if (isFetchingRef.current) return;

    isFetchingRef.current = true;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);

    try {
      let from = fromOverride ?? weekStart;
      let attempts = 0;
      let page;

      while (attempts < 7) {
        page = await fetchFeed({ from, days: 7 });
        if (page.events.length > 0 || append) break;
        // Empty page on initial load → try next day (handles quiet Sundays).
        attempts += 1;
        from = addDays(from, 1);
      }

      if (!append) setWeekStart(from);

      setEvents((prev) => {
        const next = append ? [...prev, ...page.events] : page.events;
        return deduplicateEvents(next);
      });
      setHasMore(page.has_more);
    } catch (err) {
      setError(err.message || 'Kunde inte hämta event');
      console.error('Failed to load events:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      isFetchingRef.current = false;
    }
  }, [weekStart]);

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTimeFilterPress = useCallback((filterKey) => {
    setTimeFilter(prev => prev === filterKey ? null : filterKey);
  }, []);

  const handleCategoryFilterPress = useCallback((categoryKey) => {
    setSelectedCategories(prev => (
      prev.includes(categoryKey)
        ? prev.filter(c => c !== categoryKey)
        : [...prev, categoryKey]
    ));
  }, []);

  const clearFilters = useCallback(() => {
    setTimeFilter(null);
    setSelectedCategories([]);
    setPriceFilter(null);
  }, []);

  const filteredEvents = useMemo(() => {
    let result = events;
    
    if (selectedCategories.length > 0) {
      result = result.filter(event => selectedCategories.includes(event.category));
    }
    
    if (timeFilter) {
      result = filterEventsByTime(result, timeFilter);
    }

    if (priceFilter === 'free') {
      result = result.filter(event => event.isFree || event.is_free);
    }
    
    return result;
  }, [events, timeFilter, selectedCategories, priceFilter]);

  const groupedEvents = useMemo(() => groupEventsByDay(filteredEvents), [filteredEvents]);
  const hasActiveFilters = Boolean(timeFilter || selectedCategories.length > 0 || priceFilter);

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <SafeAreaView style={styles.homeContainer}>
        <View style={styles.header}>
          <Text style={styles.appKicker}>City discovery</Text>
          <Text style={styles.appTitle}>EventPulse</Text>
          <Text style={styles.appSubtitle}>Riktiga event från verifierade källor.</Text>
        </View>
        <StateView
          title="Vi kunde inte hämta event just nu"
          detail={error}
          actionLabel="Försök igen"
          onAction={loadEvents}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.homeContainer}>
      <View style={styles.header}>
        <Text style={styles.appKicker}>City discovery</Text>
        <Text style={styles.appTitle}>Vad händer i stan?</Text>
        <Text style={styles.appSubtitle}>
          {events.length} riktiga event att upptäcka. Börja browsa, filtrera när du vill.
        </Text>
      </View>

      <View style={styles.filtersPanel}>
        <Text style={styles.filterLabel}>När</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {TIME_FILTERS.map(filter => (
            <TouchableOpacity
              key={filter.key}
              style={[
                styles.filterButton,
                timeFilter === filter.key && styles.filterButtonActive
              ]}
              onPress={() => handleTimeFilterPress(filter.key)}
            >
              <Text style={[
                styles.filterButtonText,
                timeFilter === filter.key && styles.filterButtonTextActive
              ]}>
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
          {PRICE_FILTERS.map(filter => (
            <TouchableOpacity
              key={filter.key}
              style={[
                styles.filterButton,
                priceFilter === filter.key && styles.filterButtonActive
              ]}
              onPress={() => setPriceFilter(prev => prev === filter.key ? null : filter.key)}
            >
              <Text style={[
                styles.filterButtonText,
                priceFilter === filter.key && styles.filterButtonTextActive
              ]}>
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.filterLabel}>Kategori</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {CATEGORY_FILTERS.map(filter => (
            <TouchableOpacity
              key={filter.key}
              style={[
                styles.filterButton,
                selectedCategories.includes(filter.key) && styles.filterButtonActive
              ]}
              onPress={() => handleCategoryFilterPress(filter.key)}
            >
              <Text style={[
                styles.filterButtonText,
                selectedCategories.includes(filter.key) && styles.filterButtonTextActive
              ]}>
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {hasActiveFilters && (
          <TouchableOpacity style={styles.clearFiltersButton} onPress={clearFilters}>
            <Text style={styles.clearFiltersText}>Rensa filter</Text>
          </TouchableOpacity>
        )}
      </View>
      
      {groupedEvents.length === 0 ? (
        <StateView
          title={hasActiveFilters ? 'Inga event matchar filtren' : 'Inga event hittades'}
          detail={hasActiveFilters ? 'Testa att rensa filtren eller bredda datumet.' : 'När nya publicerade event finns visas de här.'}
          actionLabel={hasActiveFilters ? 'Rensa filter' : 'Hämta igen'}
          onAction={hasActiveFilters ? clearFilters : loadEvents}
        />
      ) : (
        <SectionList
          ref={sectionListRef}
          sections={groupedEvents.map(group => ({
            title: group.title,
            data: group.events,
          }))}
          keyExtractor={(item, index) => {
            if (item.isGrouped) {
              return `grouped-${item.title}-${item.date}`;
            }
            return item.id ? `event-${item.id}` : `event-${item.source || 'unknown'}-${item.title}-${item.date || index}`;
          }}
          renderItem={({ item }) => (
            item.isGrouped ? (
              <GroupedEventItem
                groupedEvent={item}
                onEventPress={onEventPress}
              />
            ) : (
              <EventItem
                event={item}
                onPress={() => onEventPress(item)}
              />
            )
          )}
          renderSectionHeader={({ section }) => (
            <View style={styles.dayHeader}>
              <Text style={styles.dayHeaderText}>{section.title}</Text>
            </View>
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={loadingMore ? <LoadingMore /> : (!hasMore && events.length > 0 ? (
            <View style={styles.endOfList}>
              <Text style={styles.endOfListText}>Det var allt vi har just nu.</Text>
            </View>
          ) : null)}
          stickySectionHeadersEnabled={false}
          onEndReached={() => {
            if (!loadingMore && hasMore) {
              const next = addDays(weekStart, 7);
              setWeekStart(next);
              loadEvents({ append: true, fromOverride: next });
            }
          }}
          onEndReachedThreshold={0.5}
          onScroll={(event) => {
            scrollPositionRefLocal.current = event.nativeEvent.contentOffset.y;
            if (scrollPositionRef) {
              scrollPositionRef.current = event.nativeEvent.contentOffset.y;
            }
          }}
          scrollEventThrottle={16}
        />
      )}
    </SafeAreaView>
  );
}

function DetailsScreen({ event, onBack }) {
  const [ctaError, setCtaError] = useState(null);

  const handleOpenUrl = async () => {
    if (!event.url) {
      return;
    }

    try {
      const canOpen = await Linking.canOpenURL(event.url);
      if (!canOpen) {
        setCtaError('Länken kunde inte öppnas på den här enheten.');
        return;
      }

      await Linking.openURL(event.url);
      setCtaError(null);
    } catch {
      setCtaError('Länken kunde inte öppnas just nu.');
    }
  };
  const venue = getVenueLabel(event);
  const area = getAreaLabel(event);
  const price = formatPrice(event);

  return (
    <SafeAreaView style={styles.detailsContainer}>
      <View style={styles.detailsHeader}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>Tillbaka</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.detailsContent} showsVerticalScrollIndicator={false}>
        {event.imageUrl ? (
          <Image source={{ uri: event.imageUrl }} style={styles.detailsImage} />
        ) : (
          <View style={styles.detailsImageFallback}>
            <Text style={styles.eventImageFallbackText}>Ingen bild från källan</Text>
          </View>
        )}
        
        <View style={styles.detailsIntro}>
          <CategoryBadge category={event.category} />
          <Text style={styles.detailsTitle}>{event.title}</Text>
          {price && <Text style={styles.detailsPrice}>{price}</Text>}
          {event.hasExternalLink ? (
            <>
              <TouchableOpacity
                style={styles.detailsPrimaryCta}
                onPress={handleOpenUrl}
                activeOpacity={0.8}
              >
                <Text style={styles.ctaButtonText}>{event.externalLinkLabel || getCtaText(event.source)}</Text>
              </TouchableOpacity>
              {ctaError && <Text style={styles.ctaErrorText}>{ctaError}</Text>}
            </>
          ) : (
            <View style={styles.detailsPrimaryCtaUnavailable}>
              <Text style={styles.ctaUnavailableText}>Ingen extern eventlänk finns i datan ännu.</Text>
            </View>
          )}
        </View>
        
        <View style={styles.detailsSection}>
          <Text style={styles.detailsLabel}>När</Text>
          <Text style={styles.detailsValue}>
            {event.date ? formatFullDate(event.date) : 'Datum ej angivet'}
          </Text>
          <Text style={styles.detailsSubvalue}>{formatEventTime(event)}</Text>
        </View>
        
        <View style={styles.detailsSection}>
          <Text style={styles.detailsLabel}>Var</Text>
          <Text style={styles.detailsValue}>{venue || 'Plats ej angiven'}</Text>
          {area && <Text style={styles.detailsSubvalue}>{area}</Text>}
          {event.address && <Text style={styles.detailsSubvalue}>{event.address}</Text>}
        </View>
        
        {event.description && (
          <View style={styles.detailsSection}>
            <Text style={styles.detailsLabel}>Om eventet</Text>
            <Text style={styles.detailsDescription}>{event.description}</Text>
          </View>
        )}
        
        <View style={styles.detailsFooter}>
          <Text style={styles.detailsSource}>Källa: {formatProviderLabel(event.source || 'okänd')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const scrollPositionRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleEventPress = (event) => {
    setSelectedEvent(event);
  };

  const handleBack = () => {
    setSelectedEvent(null);
    // Scroll position is automatically preserved because we don't unmount HomeScreen
  };

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        {showSplash ? (
          <SplashScreen />
        ) : selectedEvent ? (
          <DetailsScreen event={selectedEvent} onBack={handleBack} />
        ) : (
          <HomeScreen onEventPress={handleEventPress} scrollPositionRef={scrollPositionRef} />
        )}
        <StatusBar style="light" />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TOKENS.color.appBg,
  },
  splashContainer: {
    flex: 1,
    backgroundColor: TOKENS.color.appBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashText: {
    color: TOKENS.color.text,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1,
  },
  homeContainer: {
    flex: 1,
    backgroundColor: TOKENS.color.appBg,
  },
  header: {
    paddingHorizontal: TOKENS.space.xl,
    paddingTop: TOKENS.space.xl,
    paddingBottom: TOKENS.space.lg,
  },
  appKicker: {
    color: TOKENS.color.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: TOKENS.space.sm,
  },
  appTitle: {
    color: TOKENS.color.text,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -1.2,
    lineHeight: 38,
  },
  appSubtitle: {
    color: TOKENS.color.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: TOKENS.space.sm,
  },
  filtersPanel: {
    paddingBottom: TOKENS.space.md,
    borderBottomWidth: 1,
    borderBottomColor: TOKENS.color.border,
  },
  filterLabel: {
    color: TOKENS.color.textSoft,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: TOKENS.space.xl,
    marginTop: TOKENS.space.sm,
    marginBottom: TOKENS.space.sm,
  },
  filterRow: {
    flexDirection: 'row',
    gap: TOKENS.space.sm,
    paddingHorizontal: TOKENS.space.xl,
    paddingBottom: TOKENS.space.sm,
  },
  filterButton: {
    paddingHorizontal: TOKENS.space.lg,
    paddingVertical: TOKENS.space.sm,
    borderRadius: TOKENS.radius.pill,
    backgroundColor: TOKENS.color.surface,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
  },
  filterButtonActive: {
    backgroundColor: TOKENS.color.accent,
    borderColor: TOKENS.color.accent,
  },
  filterButtonText: {
    color: TOKENS.color.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  filterButtonTextActive: {
    color: TOKENS.color.black,
    fontWeight: '900',
  },
  clearFiltersButton: {
    alignSelf: 'flex-start',
    marginHorizontal: TOKENS.space.xl,
    marginTop: TOKENS.space.xs,
    paddingVertical: TOKENS.space.sm,
  },
  clearFiltersText: {
    color: TOKENS.color.accent,
    fontSize: 13,
    fontWeight: '800',
  },
  listContent: {
    padding: TOKENS.space.lg,
    paddingBottom: TOKENS.space.xxl,
  },
  dayHeader: {
    paddingTop: TOKENS.space.lg,
    paddingBottom: TOKENS.space.sm,
  },
  dayHeaderText: {
    color: TOKENS.color.accent,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  eventCard: {
    backgroundColor: TOKENS.color.surfaceRaised,
    borderRadius: TOKENS.radius.lg,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    marginBottom: TOKENS.space.lg,
    overflow: 'hidden',
  },
  eventImage: {
    width: '100%',
    height: 220,
    backgroundColor: TOKENS.color.surfaceSoft,
  },
  eventImageFallback: {
    height: 180,
    backgroundColor: TOKENS.color.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: TOKENS.color.border,
  },
  eventImageFallbackText: {
    color: TOKENS.color.textSoft,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  eventCardBody: {
    padding: TOKENS.space.lg,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: TOKENS.space.md,
    marginBottom: TOKENS.space.md,
  },
  dateCluster: {
    backgroundColor: TOKENS.color.accentSoft,
    borderRadius: TOKENS.radius.md,
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.sm,
    borderWidth: 1,
    borderColor: 'rgba(255, 180, 84, 0.28)',
  },
  dateClusterDay: {
    color: TOKENS.color.accent,
    fontSize: 11,
    fontWeight: '800',
  },
  dateClusterTime: {
    color: TOKENS.color.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  eventTitle: {
    color: TOKENS.color.text,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  categoryBadge: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: 6,
    borderRadius: TOKENS.radius.pill,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  eventMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: TOKENS.space.md,
  },
  eventVenue: {
    color: TOKENS.color.textMuted,
    fontSize: 12,
    fontWeight: '500',
    maxWidth: '70%',
  },
  eventArea: {
    color: TOKENS.color.textSoft,
    fontSize: 12,
    flexShrink: 1,
  },
  eventFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: TOKENS.space.lg,
    gap: TOKENS.space.md,
  },
  eventPrice: {
    color: TOKENS.color.mint,
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  eventActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
    flexShrink: 1,
    justifyContent: 'flex-end',
  },
  externalLinkChip: {
    color: TOKENS.color.mint,
    backgroundColor: 'rgba(114, 224, 197, 0.12)',
    borderColor: 'rgba(114, 224, 197, 0.28)',
    borderWidth: 1,
    borderRadius: TOKENS.radius.pill,
    paddingHorizontal: TOKENS.space.sm,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
    maxWidth: 110,
  },
  eventOpenText: {
    color: TOKENS.color.accent,
    fontSize: 13,
    fontWeight: '900',
  },
  groupedSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: TOKENS.space.md,
    marginTop: TOKENS.space.sm,
  },
  groupedCount: {
    color: TOKENS.color.textSoft,
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
  groupedTimesContainer: {
    marginTop: TOKENS.space.md,
    gap: TOKENS.space.sm,
  },
  groupedRowContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: TOKENS.color.surface,
    borderRadius: TOKENS.radius.md,
    paddingVertical: TOKENS.space.md,
    paddingHorizontal: TOKENS.space.md,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
  },
  groupedDateText: {
    color: TOKENS.color.textMuted,
    fontSize: 14,
    fontWeight: '800',
  },
  groupedRowArrowText: {
    color: TOKENS.color.accent,
    fontSize: 13,
    fontWeight: '900',
  },
  loadingMore: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: TOKENS.space.lg,
  },
  loadingMoreText: {
    color: TOKENS.color.textMuted,
    marginLeft: TOKENS.space.sm,
    fontSize: 14,
  },
  endOfList: {
    paddingVertical: TOKENS.space.xl,
    alignItems: 'center',
  },
  endOfListText: {
    color: TOKENS.color.textSoft,
    fontSize: 13,
    fontStyle: 'italic',
  },
  skeletonList: {
    padding: TOKENS.space.lg,
    gap: TOKENS.space.lg,
  },
  skeletonCard: {
    backgroundColor: TOKENS.color.surfaceRaised,
    borderRadius: TOKENS.radius.lg,
    padding: TOKENS.space.lg,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
  },
  skeletonImage: {
    height: 120,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.surfaceSoft,
    marginBottom: TOKENS.space.lg,
  },
  skeletonLineWide: {
    height: 18,
    width: '82%',
    borderRadius: TOKENS.radius.pill,
    backgroundColor: TOKENS.color.surfaceSoft,
    marginBottom: TOKENS.space.md,
  },
  skeletonLineShort: {
    height: 14,
    width: '48%',
    borderRadius: TOKENS.radius.pill,
    backgroundColor: TOKENS.color.surfaceSoft,
  },
  stateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: TOKENS.space.xxl,
  },
  stateTitle: {
    color: TOKENS.color.text,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 28,
  },
  stateDetail: {
    color: TOKENS.color.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: TOKENS.space.md,
  },
  stateButton: {
    backgroundColor: TOKENS.color.accent,
    borderRadius: TOKENS.radius.pill,
    paddingHorizontal: TOKENS.space.xl,
    paddingVertical: TOKENS.space.md,
    marginTop: TOKENS.space.xl,
  },
  stateButtonText: {
    color: TOKENS.color.black,
    fontSize: 14,
    fontWeight: '900',
  },
  detailsContainer: {
    flex: 1,
    backgroundColor: TOKENS.color.appBg,
  },
  detailsHeader: {
    paddingHorizontal: TOKENS.space.lg,
    paddingVertical: TOKENS.space.md,
    borderBottomWidth: 1,
    borderBottomColor: TOKENS.color.border,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: TOKENS.space.sm,
    paddingRight: TOKENS.space.lg,
  },
  backButtonText: {
    color: TOKENS.color.accent,
    fontSize: 15,
    fontWeight: '900',
  },
  detailsContent: {
    flex: 1,
  },
  detailsImage: {
    width: '100%',
    height: 240,
    backgroundColor: TOKENS.color.surfaceSoft,
  },
  detailsImageFallback: {
    height: 210,
    backgroundColor: TOKENS.color.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: TOKENS.color.border,
  },
  detailsIntro: {
    padding: TOKENS.space.xl,
  },
  detailsTitle: {
    color: TOKENS.color.text,
    fontSize: 32,
    fontWeight: '900',
    marginTop: TOKENS.space.lg,
    lineHeight: 38,
    letterSpacing: -0.8,
  },
  detailsPrice: {
    color: TOKENS.color.mint,
    fontSize: 15,
    fontWeight: '900',
    marginTop: TOKENS.space.md,
  },
  detailsPrimaryCta: {
    backgroundColor: TOKENS.color.coral,
    borderRadius: TOKENS.radius.lg,
    paddingVertical: TOKENS.space.lg,
    alignItems: 'center',
    marginTop: TOKENS.space.xl,
  },
  detailsPrimaryCtaUnavailable: {
    backgroundColor: TOKENS.color.surface,
    borderRadius: TOKENS.radius.lg,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    padding: TOKENS.space.lg,
    marginTop: TOKENS.space.xl,
  },
  detailsSection: {
    backgroundColor: TOKENS.color.surface,
    borderRadius: TOKENS.radius.lg,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    marginHorizontal: TOKENS.space.xl,
    marginBottom: TOKENS.space.md,
    padding: TOKENS.space.lg,
  },
  detailsLabel: {
    color: TOKENS.color.accent,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: TOKENS.space.sm,
  },
  detailsValue: {
    color: TOKENS.color.text,
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 26,
  },
  detailsSubvalue: {
    color: TOKENS.color.textMuted,
    fontSize: 15,
    marginTop: TOKENS.space.xs,
    lineHeight: 22,
  },
  detailsDescription: {
    color: TOKENS.color.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
  ctaButton: {
    backgroundColor: TOKENS.color.coral,
    borderRadius: TOKENS.radius.lg,
    paddingVertical: TOKENS.space.lg,
    alignItems: 'center',
    marginHorizontal: TOKENS.space.xl,
    marginTop: TOKENS.space.sm,
    marginBottom: TOKENS.space.lg,
  },
  ctaButtonText: {
    color: TOKENS.color.white,
    fontSize: 17,
    fontWeight: '900',
  },
  ctaErrorText: {
    color: TOKENS.color.danger,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: TOKENS.space.sm,
  },
  ctaUnavailable: {
    backgroundColor: TOKENS.color.surface,
    borderRadius: TOKENS.radius.lg,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    padding: TOKENS.space.lg,
    marginHorizontal: TOKENS.space.xl,
    marginTop: TOKENS.space.sm,
    marginBottom: TOKENS.space.lg,
  },
  ctaUnavailableText: {
    color: TOKENS.color.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  detailsFooter: {
    paddingVertical: TOKENS.space.xl,
    marginHorizontal: TOKENS.space.xl,
    borderTopWidth: 1,
    borderTopColor: TOKENS.color.border,
  },
  detailsSource: {
    color: TOKENS.color.textSoft,
    fontSize: 12,
    textAlign: 'center',
  },
});
