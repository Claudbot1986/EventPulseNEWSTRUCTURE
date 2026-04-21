import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, SectionList, FlatList, SafeAreaView, ActivityIndicator, TouchableOpacity, ScrollView, Linking, Dimensions } from 'react-native';
import { fetchEvents } from './services/eventServiceClient';

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
  { key: 'denna_vecka', label: 'Denna vecka' },
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

// Format date for display in Swedish (e.g., "Lör 21 mars")
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const daysSwedish = ['Sön', 'Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör'];
  const monthsSwedish = ['jan', 'feb', 'mars', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return `${daysSwedish[date.getDay()]} ${date.getDate()} ${monthsSwedish[date.getMonth()]}`;
}

// Format full date for details (e.g., "Friday, March 20, 2026")
function formatFullDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

// Format time for display in 24-hour Swedish format (e.g., "19:30")
function formatTime(timeString) {
  if (!timeString) return '';
  const [hours, minutes] = timeString.split(':');
  return `${hours}:${minutes}`;
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

function EventItem({ event, onPress }) {
  return (
    <TouchableOpacity style={styles.eventCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.eventHeader}>
        <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
        <CategoryBadge category={event.category} />
      </View>
      <View style={styles.eventInfo}>
        <View style={styles.eventDateTime}>
          <Text style={styles.eventDate}>{formatDate(event.date)}</Text>
          <Text style={styles.eventSeparator}>•</Text>
          <Text style={styles.eventTime}>{formatTime(event.time)}</Text>
        </View>
        <View style={styles.eventLocation}>
          <Text style={styles.eventVenue}>{event.venue}</Text>
          <Text style={styles.eventArea}>• {event.area}</Text>
        </View>
      </View>
      <View style={styles.eventArrow}>
        <Text style={styles.eventArrowText}>→</Text>
      </View>
    </TouchableOpacity>
  );
}

function GroupedEventItem({ groupedEvent, onEventPress }) {
  return (
    <TouchableOpacity style={styles.eventCard} onPress={() => onEventPress(groupedEvent.events[0])} activeOpacity={0.7}>
      <View style={styles.eventHeader}>
        <Text style={styles.eventTitle} numberOfLines={2}>{groupedEvent.title}</Text>
        <CategoryBadge category={groupedEvent.category} />
      </View>
      <View style={styles.groupedTimesContainer}>
        {groupedEvent.events.map((event, index) => (
          <TouchableOpacity 
            key={`${event.id || event.start_time || index}`} 
            style={styles.groupedRowContainer}
            onPress={() => onEventPress(event)}
            activeOpacity={0.7}
          >
            <View style={styles.groupedTimeRow}>
              <Text style={styles.groupedDateText}>
                {formatDate(event.date)} • {formatTime(event.time)}
              </Text>
            </View>
            <View style={styles.groupedRowArrow}>
              <Text style={styles.groupedRowArrowText}>→</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </TouchableOpacity>
  );
}

function LoadingMore() {
  return (
    <View style={styles.loadingMore}>
      <ActivityIndicator size="small" color="#BB86FC" />
      <Text style={styles.loadingMoreText}>Loading more...</Text>
    </View>
  );
}

function HomeScreen({ onEventPress, scrollPositionRef }) {
  const [events, setEvents] = useState([]);
  const [availableSources, setAvailableSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [timeFilter, setTimeFilter] = useState(null);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);
  const sectionListRef = useRef(null);
  const scrollPositionRefLocal = useRef(0);
  // Track if a fetch is already in progress to prevent double fetches
  const isFetchingRef = useRef(false);

  const loadEvents = useCallback(async (pageNum = 0, isLoadMore = false) => {
    // Prevent double fetches - if already fetching, skip
    if (isFetchingRef.current) {
      return;
    }
    isFetchingRef.current = true;
    
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    
    try {
      // Fetch events from Supabase (production only)
      const result = await fetchEvents();
      const data = result.events || [];
      const sources = result.sources || [];
      
      // ALWAYS deduplicate incoming data to prevent duplicates
      const uniqueData = deduplicateEvents(data);
      
      if (isLoadMore) {
        // Deduplicate against existing events before appending
        setEvents(prev => {
          const combined = [...prev, ...uniqueData];
          return deduplicateEvents(combined);
        });
      } else {
        setEvents(uniqueData);
        setAvailableSources(sources);
      }
      setPage(pageNum);
    } catch (err) {
      setError(err.message);
      console.error('Failed to load events:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadEvents(0);
  }, [loadEvents]);

  const handleLoadMore = useCallback(() => {
    // Only allow loading more when NO filters are active
    // This prevents API calls when user scrolls to end of filtered list
    // NOTE: When filters are active, we show a subset of the full dataset
    // so pagination is not needed - the full data is already loaded
    if (!loadingMore && !loading && !timeFilter && selectedCategories.length === 0 && !selectedProvider) {
      loadEvents(page + 1, true);
    }
  }, [loadingMore, loading, loadEvents, page, timeFilter, selectedCategories, selectedProvider]);

  const handleTimeFilterPress = useCallback((filterKey) => {
    setTimeFilter(prev => prev === filterKey ? null : filterKey);
  }, []);

  const handleCategoryFilterPress = useCallback((categoryKey) => {
    setSelectedCategories(prev => {
      if (prev.includes(categoryKey)) {
        return prev.filter(c => c !== categoryKey);
      } else {
        return [...prev, categoryKey];
      }
    });
  }, []);

  // Apply filters to events - memoized to prevent unnecessary recalculations
  const filteredEvents = useMemo(() => {
    let result = events;
    
    // First filter by category
    if (selectedCategories.length > 0) {
      result = result.filter(event => selectedCategories.includes(event.category));
    }
    
    // Then filter by time
    if (timeFilter) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      result = result.filter(event => {
        if (!event.date) return false;
        
        const eventDate = new Date(event.date + 'T' + (event.time || '00:00'));
        const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
        
        switch (timeFilter) {
          case 'ikvall': {
            const isToday = eventDay.getTime() === today.getTime();
            return isToday && eventDate > now;
          }
          case 'imorgon': {
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            return eventDay.getTime() === tomorrow.getTime();
          }
          case 'helgen': {
            const dayOfWeek = eventDay.getDay();
            return dayOfWeek === 0 || dayOfWeek === 6;
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
    
    // Finally filter by provider
    if (selectedProvider) {
      result = result.filter(event => event.source === selectedProvider);
    }
    
    return result;
  }, [events, timeFilter, selectedCategories, selectedProvider]);

  // Group filtered events by day
  const groupedEvents = useMemo(() => {
    return groupEventsByDay(filteredEvents);
  }, [filteredEvents]);

  // Build PROVIDERS dynamically from available sources
  const PROVIDERS = useMemo(() => {
    return buildProviders(availableSources);
  }, [availableSources]);

  if (loading) {
    return (
      <SafeAreaView style={styles.homeContainer}>
        <View style={styles.header}>
          <Text style={styles.appTitle}>EventPulse</Text>
          <Text style={styles.appSubtitle}>Events in Sweden</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#BB86FC" />
          <Text style={styles.loadingText}>Loading events...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.homeContainer}>
        <View style={styles.header}>
          <Text style={styles.appTitle}>EventPulse</Text>
          <Text style={styles.appSubtitle}>Events in Sweden</Text>
        </View>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load events</Text>
          <Text style={styles.errorDetail}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.homeContainer}>
      <View style={styles.header}>
        <Text style={styles.appTitle}>EventPulse</Text>
        <Text style={styles.appSubtitle}>Events in Sweden</Text>
      </View>
      
      {/* Time Filter Row */}
      <View style={styles.filterRow}>
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
      </View>
      
      {/* Category Filter Row */}
      <View style={styles.filterRow}>
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
      </View>
      
      {/* Provider Filter Row */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[
            styles.filterButton,
            styles.providerFilterButton,
            selectedProvider && styles.filterButtonActive
          ]}
          onPress={() => setShowProviderDropdown(!showProviderDropdown)}
        >
          <Text style={[
            styles.filterButtonText,
            selectedProvider && styles.filterButtonTextActive
          ]}>
            {selectedProvider ? PROVIDERS.find(p => p.key === selectedProvider)?.label || 'Arrangör' : 'Arrangör'}
          </Text>
          <Text style={styles.dropdownArrow}> ▼</Text>
        </TouchableOpacity>
      </View>
      
      {/* Provider Dropdown */}
      {showProviderDropdown && (
        <View style={styles.providerDropdown}>
          <TouchableOpacity
            style={styles.providerDropdownOverlay}
            onPress={() => setShowProviderDropdown(false)}
            activeOpacity={1}
          />
          <View style={styles.providerDropdownContent}>
            <ScrollView 
              style={styles.providerScrollView}
              showsVerticalScrollIndicator={true}
              bounces={true}
            >
              {PROVIDERS.map(provider => (
                <TouchableOpacity
                  key={provider.key}
                  style={[
                    styles.providerOption,
                    selectedProvider === provider.key && styles.providerOptionActive
                  ]}
                  onPress={() => {
                    setSelectedProvider(provider.key === 'all' ? null : provider.key);
                    setShowProviderDropdown(false);
                  }}
                >
                  <Text style={[
                    styles.providerOptionText,
                    selectedProvider === provider.key && styles.providerOptionTextActive
                  ]}>
                    {provider.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      )}
      
      {groupedEvents.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No events found</Text>
        </View>
      ) : (
        <SectionList
          ref={sectionListRef}
          sections={groupedEvents.map(group => ({
            title: group.title,
            data: group.events,
          }))}
          keyExtractor={(item, index) => {
            // Use stable key: id for events, title+date for grouped items
            if (item.isGrouped) {
              return `grouped-${item.title}-${item.date}`;
            }
            // For regular events, use id or stable composite key
            return item.id ? `event-${item.id}` : `event-${item.source || 'unknown'}-${item.title}-${item.date || ''}`;
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
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <LoadingMore /> : null}
          stickySectionHeadersEnabled={false}
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
  const handleOpenUrl = () => {
    if (event.url) {
      Linking.openURL(event.url);
    }
  };

  return (
    <SafeAreaView style={styles.detailsContainer}>
      <View style={styles.detailsHeader}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.detailsContent} showsVerticalScrollIndicator={false}>
        <CategoryBadge category={event.category} />
        
        <Text style={styles.detailsTitle}>{event.title}</Text>
        
        <View style={styles.detailsSection}>
          <Text style={styles.detailsLabel}>Date & Time</Text>
          <Text style={styles.detailsValue}>
            {formatFullDate(event.date)}
            {event.time && ` at ${formatTime(event.time)}`}
          </Text>
        </View>
        
        <View style={styles.detailsSection}>
          <Text style={styles.detailsLabel}>Venue</Text>
          <Text style={styles.detailsValue}>{event.venue}</Text>
          {event.area && <Text style={styles.detailsSubvalue}>{event.area}</Text>}
          {event.address && <Text style={styles.detailsSubvalue}>{event.address}</Text>}
        </View>
        
        {event.description && (
          <View style={styles.detailsSection}>
            <Text style={styles.detailsLabel}>About</Text>
            <Text style={styles.detailsDescription}>{event.description}</Text>
          </View>
        )}
        
        {event.url && (
          <TouchableOpacity 
            style={styles.ctaButton}
            onPress={handleOpenUrl}
            activeOpacity={0.8}
          >
            <Text style={styles.ctaButtonText}>{getCtaText(event.source)}</Text>
          </TouchableOpacity>
        )}
        
        <View style={styles.detailsFooter}>
          <Text style={styles.detailsSource}>Source: {event.source}</Text>
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  splashContainer: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashText: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: 'bold',
  },
  homeContainer: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  // Filter styles
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  // Day header styles
  dayHeader: {
    paddingHorizontal: 4,
    paddingVertical: 12,
    marginBottom: 8,
  },
  dayHeaderText: {
    color: '#BB86FC',
    fontSize: 16,
    fontWeight: '600',
  },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: '#3A3A3A',
  },
  filterButtonActive: {
    backgroundColor: '#BB86FC',
    borderColor: '#BB86FC',
  },
  filterButtonText: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '500',
  },
  filterButtonTextActive: {
    color: '#000000',
    fontWeight: '600',
  },
  appTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: -0.5,
  },
  appSubtitle: {
    color: '#888888',
    fontSize: 16,
    marginTop: 4,
  },
  listContent: {
    padding: 16,
  },
  eventCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  eventTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginRight: 12,
    lineHeight: 24,
  },
  categoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  eventInfo: {
    gap: 6,
  },
  eventDateTime: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventDate: {
    color: '#BB86FC',
    fontSize: 14,
    fontWeight: '500',
  },
  eventSeparator: {
    color: '#555555',
    marginHorizontal: 8,
  },
  eventTime: {
    color: '#BB86FC',
    fontSize: 14,
    fontWeight: '500',
  },
  eventLocation: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventVenue: {
    color: '#AAAAAA',
    fontSize: 14,
  },
  eventArea: {
    color: '#666666',
    fontSize: 14,
  },
  eventArrow: {
    position: 'absolute',
    bottom: 16,
    right: 16,
  },
  eventArrowText: {
    color: '#555555',
    fontSize: 16,
    fontWeight: '300',
  },
  groupedTimesContainer: {
    marginTop: 4,
    gap: 4,
  },
  groupedRowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingRight: 8,
  },
  groupedTimeRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupedDateText: {
    color: '#BB86FC',
    fontSize: 14,
    fontWeight: '500',
  },
  groupedRowArrow: {
    marginLeft: 8,
  },
  groupedRowArrowText: {
    color: '#555555',
    fontSize: 14,
    fontWeight: '300',
  },
  // Loading state
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888888',
    marginTop: 12,
    fontSize: 16,
  },
  // Error state
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: '#FF7597',
    fontSize: 16,
    fontWeight: '600',
  },
  errorDetail: {
    color: '#666666',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#888888',
    fontSize: 16,
  },
  // Loading more
  loadingMore: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  loadingMoreText: {
    color: '#888888',
    marginLeft: 8,
    fontSize: 14,
  },
  // Details screen
  detailsContainer: {
    flex: 1,
    backgroundColor: '#121212',
  },
  detailsHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButtonText: {
    color: '#BB86FC',
    fontSize: 16,
    fontWeight: '500',
  },
  detailsContent: {
    flex: 1,
    padding: 20,
  },
  detailsTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 24,
    lineHeight: 36,
  },
  detailsSection: {
    marginBottom: 24,
  },
  detailsLabel: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  detailsValue: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 26,
  },
  detailsSubvalue: {
    color: '#AAAAAA',
    fontSize: 16,
    marginTop: 4,
  },
  detailsDescription: {
    color: '#B0B0B0',
    fontSize: 16,
    lineHeight: 24,
  },
  detailsLinkButton: {
    backgroundColor: '#BB86FC',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  detailsLinkText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
  },
  // CTA Button - Large pink button for event URL
  ctaButton: {
    backgroundColor: '#FF7597',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  ctaButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  detailsFooter: {
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
  },
  detailsSource: {
    color: '#666666',
    fontSize: 12,
    textAlign: 'center',
  },
  providerFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdownArrow: {
    color: '#888888',
    fontSize: 10,
    marginLeft: 4,
  },
  providerDropdown: {
    position: 'relative',
    zIndex: 1000,
  },
  providerDropdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  providerDropdownContent: {
    position: 'absolute',
    top: 48,
    left: 16,
    right: 16,
    marginTop: 4,
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    overflow: 'hidden',
    zIndex: 1001,
    maxHeight: 280,
  },
  providerScrollView: {
    maxHeight: 250,
  },
  providerOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#3A3A3A',
  },
  providerOptionActive: {
    backgroundColor: '#BB86FC',
  },
  providerOptionText: {
    color: '#B0B0B0',
    fontSize: 14,
  },
  providerOptionTextActive: {
    color: '#000000',
    fontWeight: '600',
  },
});
