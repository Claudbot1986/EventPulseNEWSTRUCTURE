// AppleMapsScreen.js — NY sektion (06-UI-sandbox/components).
//
// Helt fristående från MapScreen.js / MapCanvas.js / MapBaseLayer.js.
// Använder react-native-maps + react-native-map-clustering på riktiga
// Apple Maps (PROVIDER_DEFAULT = MapKit på iOS).
//
// Layout:
//   1. fetchFutureEvents() från helpers — paginerat, 3494+ events.
//   2. MapFilterBar (Idag / Helgen / Nästa helg / Alla) byter tidsfönster.
//   3. ClusteredMapView renderar markers med auto-klustring.
//   4. Event-counts (TOTAL / VISIBLE) under kartan.
//   5. Loading / error / empty states enligt SCREEN_STATES.md.
//
// App.js använder `fullscreen: true` på registry-entryn så panorering
// inte störs av vertikal scroll från sandbox-listan.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PROVIDER_DEFAULT, Marker } from 'react-native-maps';
import MapView from 'react-native-map-clustering';
import { supabase } from '../services/supabaseClient';
import MapFilterBar from './MapFilterBar';
import MapEventCard from './MapEventCard';
import {
  FILTER_MODES,
  INITIAL_REGION,
  fetchFutureEvents,
  filterEventsByMode,
  computeCountsByMode,
  translateError,
} from './AppleMapsScreen.helpers';

const TOKENS = {
  color: {
    bg: '#000000',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
    accent: '#FFB454',
  },
  font: {
    status: { size: 13, weight: '500' },
    meta: { size: 11, weight: '700', letterSpacing: 0.4 },
    retry: { size: 13, weight: '700', letterSpacing: 0.4 },
  },
  space: {
    padX: 20,
    metaGap: 16,
    retryButtonPad: 12,
    retryButtonRadius: 8,
  },
};

export default function AppleMapsScreen() {
  const [status, setStatus] = useState('loading');
  const [errorMsg, setErrorMsg] = useState(null);
  const [events, setEvents] = useState([]);
  const [activeMode, setActiveMode] = useState('weekend');
  const [selectedEvent, setSelectedEvent] = useState(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMsg(null);
    const { events: rows, error } = await fetchFutureEvents(supabase);
    if (error) {
      // Logga rå fel för dev-tools — UI visar bara översatt text.
      if (typeof console !== 'undefined' && console.error) {
        console.error('[AppleMapsScreen] fetch error:', error);
      }
      setStatus('error');
      setErrorMsg(translateError(error));
      return;
    }
    setEvents(rows);
    setStatus('ready');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleMarkerPress = useCallback((event) => {
    setSelectedEvent(event);
  }, []);

  const handleMapPress = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  const handleCardClose = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  const handleCardReadMore = useCallback((event) => {
    // Sandbox: bara logga. I 06-UI/ skulle detta öppna EventDetailScreen.
    if (typeof console !== 'undefined' && console.info) {
      console.info('[AppleMapsScreen] Läs mer för event', event.id);
    }
  }, []);

  const counts = computeCountsByMode(events, FILTER_MODES);
  const filteredEvents = filterEventsByMode(events, activeMode);

  // Loading / error / empty enligt SCREEN_STATES.md — ingen rubrik, minimal text.
  if (status === 'loading') {
    return (
      <View style={styles.screen} testID="apple-maps-screen-loading">
        <Text style={styles.status}>Hämtar events…</Text>
      </View>
    );
  }
  if (status === 'error') {
    return (
      <View style={styles.screen} testID="apple-maps-screen-error">
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{errorMsg || 'Kunde inte hämta events. Försök igen.'}</Text>
          <Pressable
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.retryButtonPressed,
            ]}
            onPress={load}
            accessibilityRole="button"
            accessibilityLabel="Försök igen"
            testID="apple-maps-screen-retry"
          >
            <Text style={styles.retryButtonText}>Försök igen</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  if (events.length === 0) {
    return (
      <View style={styles.screen} testID="apple-maps-screen-empty">
        <Text style={styles.status}>Inga framtida events.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="apple-maps-screen-ready">
      <View style={styles.mapWrap}>
        <MapView
          provider={PROVIDER_DEFAULT}
          style={StyleSheet.absoluteFill}
          initialRegion={INITIAL_REGION}
          showsCompass
          showsScale
          rotateEnabled
          pitchEnabled
          onPress={handleMapPress}
          accessibilityLabel="Apple Maps-karta med Stockholm-events"
          testID="apple-maps-canvas"
          clusterColor={TOKENS.color.accent}
          clusterTextColor={TOKENS.color.bg}
        >
          {filteredEvents.map((e) => (
            <Marker
              key={e.id}
              coordinate={{ latitude: e.lat, longitude: e.lng }}
              title={e.title_sv || e.title_en || 'Event'}
              description={e.start_time}
              onPress={() => handleMarkerPress(e)}
            />
          ))}
        </MapView>
        {selectedEvent ? (
          <View style={styles.cardOverlay} pointerEvents="box-none">
            <MapEventCard
              event={selectedEvent}
              onClose={handleCardClose}
              onReadMore={handleCardReadMore}
            />
          </View>
        ) : null}
      </View>
      <MapFilterBar
        activeMode={activeMode}
        onChange={setActiveMode}
        counts={counts}
      />
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>TOTAL</Text>
          <Text style={styles.metaValue}>{events.length}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>VISIBLE</Text>
          <Text style={styles.metaValue}>{filteredEvents.length}</Text>
        </View>
      </View>
    </View>
  );
}

// Exportera helpers + region för test-hookning.
// (INITIAL_REGION bor i helpers.js eftersom testet inte kan importera JSX.)
AppleMapsScreen.__helpers = {
  FILTER_MODES,
  INITIAL_REGION,
  fetchFutureEvents,
  filterEventsByMode,
  computeCountsByMode,
  translateError,
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: TOKENS.color.bg,
    paddingHorizontal: TOKENS.space.padX,
  },
  map: {
    flex: 1,
  },
  mapWrap: {
    flex: 1,
    position: 'relative',
  },
  cardOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
  },
  status: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.status.size,
    fontWeight: TOKENS.font.status.weight,
    padding: 24,
  },
  errorWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: TOKENS.space.padX,
  },
  errorText: {
    color: TOKENS.color.text,
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 22,
  },
  retryButton: {
    minHeight: 44,
    paddingHorizontal: TOKENS.space.retryButtonPad,
    paddingVertical: 8,
    borderRadius: TOKENS.space.retryButtonRadius,
    borderWidth: 1,
    borderColor: TOKENS.color.accent,
    backgroundColor: 'rgba(255,180,84,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryButtonPressed: {
    opacity: 0.6,
  },
  retryButtonText: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.font.retry.size,
    fontWeight: TOKENS.font.retry.weight,
    letterSpacing: TOKENS.font.retry.letterSpacing,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingVertical: 12,
    gap: TOKENS.space.metaGap,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  metaLabel: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.meta.size,
    fontWeight: TOKENS.font.meta.weight,
    letterSpacing: TOKENS.font.meta.letterSpacing,
  },
  metaValue: {
    color: TOKENS.color.text,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
});