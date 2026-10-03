// KartaScreen.js — Apple Maps-vy för EventPulse.
//
// IDENTISK med 06-UI-sandbox/components/AppleMapsScreen.js, men flyttad
// in i 06-UI/ för att kunna monteras som ett eget flikval ("Karta") i
// AppShell. Vi rör inte designen — sandbox-versionen är redan
// verifierad mot Apple HIG + Ticketmaster UX-praxis.
//
// Vad som skiljer mot sandbox-versionen:
//   1. Import-paths pekar på 06-UI/components + 06-UI/services.
//   2. Skärmen får paddingBottom: 96 (TAB_BAR_CLEARANCE) så
//      BottomTabBar inte skymmer filter-bar eller meta-rad.
//   3. "Läs mer" loggar bara i nuläget — kan kopplas till
//      PENDING_EVENT_KEY + Utforska-switch när detaljvy skall öppnas
//      (samma hand-off-mönster som HomeScreen → Utforska använder).
//
// Vad den gör:
//   1. fetchFutureEvents() — paginerat, 3 600+ events via events_public.
//   2. MapFilterBar (Idag / Helgen / Nästa helg / Alla) byter tidsfönster.
//   3. ClusteredMapView renderar markers med auto-klustring på riktiga
//      Apple Maps (PROVIDER_DEFAULT = MapKit på iOS).
//   4. Event-counts (TOTAL / VISIBLE) under kartan.
//   5. Loading / error / empty states enligt SCREEN_STATES.md.
//
// AppShell mountar denna komponent för `activeTab === 'map'`.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PROVIDER_DEFAULT, Marker } from 'react-native-maps';
import MapView from 'react-native-map-clustering';

import { projectViewport, viewportFromCenter } from '../components/mapProjection.js';
import { supabase } from '../services/supabaseClient';
import MapFilterBar from '../components/MapFilterBar';
import MapEventCard from '../components/MapEventCard';
import { toDetailsScreenEvent } from './HomeScreen';
import {
  FILTER_MODES,
  INITIAL_REGION,
  fetchFutureEvents,
  filterEventsByMode,
  computeCountsByMode,
  translateError,
} from '../components/KartaScreen.helpers';

// Samma TAB_BAR_CLEARANCE-konstant som HomeScreen / ProfileScreen —
// BottomTabBar är position:absolute, bottom:0 och måste skuggas av
// innehållet så filter-knappar och meta-rad inte blir oåtkomliga.
const TAB_BAR_CLEARANCE = 96;

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

export default function KartaScreen({ onEventPress }) {
  const [status, setStatus] = useState('loading');
  const [errorMsg, setErrorMsg] = useState(null);
  const [events, setEvents] = useState([]);
  const [activeMode, setActiveMode] = useState('weekend');
  const [selectedEvent, setSelectedEvent] = useState(null);
  // Hit-detection-overlay behöver känna till region + storlek för att
  // kunna projicera lat/lng → skärm-koordinater.
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [region, setRegion] = useState(INITIAL_REGION);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMsg(null);
    if (typeof console !== 'undefined' && console.info) {
      console.info('[KartaScreen] load() start');
    }
    let result;
    try {
      // 2026-10-03 — progressiv laddning: onBatch flippar status='ready'
      // efter första 500 events (≈ 1.76s cold) så kartan blir interaktiv
      // direkt. Resterande sidor appendas i bakgrunden (~0.7-1.3s styck).
      // Tidigare: status='ready' först efter ALL events hämtade (~7s).
      result = await fetchFutureEvents(supabase, (batch) => {
        if (typeof console !== 'undefined' && console.info) {
          console.info('[KartaScreen] batch arrived, size=', batch.length);
        }
        setEvents(batch);
        // Första batch: status='ready' så kartan renderas. setStatus
        // är stabil — upprepade batch-callbacks är no-ops efter första.
        setStatus((prev) => (prev === 'ready' ? prev : 'ready'));
      });
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[KartaScreen] fetch threw:', err);
      }
      setStatus('error');
      setErrorMsg(translateError(err));
      return;
    }
    const { events: rows, error } = result || {};
    if (error) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[KartaScreen] fetch error:', error);
      }
      setStatus('error');
      setErrorMsg(translateError(error));
      return;
    }
    if (typeof console !== 'undefined' && console.info) {
      console.info('[KartaScreen] load() done, total rows=', Array.isArray(rows) ? rows.length : 0);
    }
    // Säkerställ att slutgiltig events-lista är satt (även om sista
    // onBatch redan skickade allt — ingen risk att det vi inte gör).
    setEvents(rows || []);
    setStatus('ready');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleMarkerPress = useCallback((event) => {
    if (typeof console !== 'undefined' && console.info) {
      console.info('[KartaScreen] marker press:', event?.id);
    }
    if (event) setSelectedEvent(event);
  }, []);

  // Tomt kart-tryck → stäng kort.
  // (react-native-maps MapView.onPress fyrar BARA för tomma tryck,
  // inte för marker-tryck — de går via vår hit-detection-overlay.)
  const handleMapPress = useCallback(() => {
    if (typeof console !== 'undefined' && console.info) {
      console.info('[KartaScreen] map press (empty) — closing card');
    }
    setSelectedEvent(null);
  }, []);

  const handleMapLayout = useCallback((event) => {
    const { width, height } = event.nativeEvent.layout;
    setMapSize((prev) =>
      prev.width === width && prev.height === height
        ? prev
        : { width, height },
    );
  }, []);

  const handleRegionChange = useCallback((newRegion) => {
    // 2026-10-03 — defensiv cap på min zoom (latitudeDelta >= 0.005,
    // dvs ca 500m). Under detta tenderar react-native-map-clustering
    // + vår hit-detection-overlay (en Pressable per marker) att prestera
    // dåligt när 100+ Stockholm-fallback-events projiceras till samma pixel.
    if (
      newRegion &&
      Number.isFinite(newRegion.latitudeDelta) &&
      newRegion.latitudeDelta < 0.005
    ) {
      return;
    }
    setRegion(newRegion);
  }, []);

  const handleCardClose = useCallback(() => {
    if (typeof console !== 'undefined' && console.info) {
      console.info('[KartaScreen] card close (X) — clearing selectedEvent');
    }
    setSelectedEvent(null);
  }, []);

  const handleCardReadMore = useCallback((event) => {
    // 2026-10-03 — samma flow som HomeScreen → Utforska → DetailsScreen.
    // toDetailsScreenEvent (importerad från HomeScreen.js) producerar
    // exakt samma payload-shape som Hem-karusellen skickar via
    // handleHomeCardPress → PENDING_EVENT_KEY → App.js drain →
    // DetailsScreen. Inga specialfall — samma pipeline, samma fält,
    // samma UX.
    if (typeof onEventPress !== 'function') return;
    const payload = toDetailsScreenEvent(event);
    if (payload) onEventPress(payload);
  }, [onEventPress]);

  const counts = computeCountsByMode(events, FILTER_MODES);
  const filteredEvents = filterEventsByMode(events, activeMode);

  // Projicera lat/lng → skärm-koordinater för hit-detection-overlay.
  // Bounds-baserad projektion gör att zoom-värdet inte spelar roll —
  // det är bounds (region) som ger korrekt pixel-position.
  // 2026-10-03 — hård cap på antal hit-detection-Pressables som renderas.
// Vid extremt liten latitudeDelta kan 200+ markers projiceras inom view;
// react-native-map-clustering klarar det visuellt, men vår overlay med
// en <Pressable> per marker kraschar layouten / RN-bryggan. Vi cappar
// på 80 — tillräckligt för att täcka alla rimligt synliga events i
// viewport, men stoppar OOM/UI-tråd-krasch vid super-zoom.
const HIT_OVERLAY_CAP = 80;

const projectedMarkers = useMemo(() => {
    if (!mapSize.width || !mapSize.height) return [];
    const customViewport = {
      ...viewportFromCenter(
        region.latitude,
        region.longitude,
        11, // godtycklig zoom — bounds styr projektionen
        mapSize,
      ),
      bounds: {
        minLat: region.latitude - region.latitudeDelta / 2,
        maxLat: region.latitude + region.latitudeDelta / 2,
        minLng: region.longitude - region.longitudeDelta / 2,
        maxLng: region.longitude + region.longitudeDelta / 2,
      },
    };
    const out = [];
    for (const e of filteredEvents) {
      if (!Number.isFinite(e.lat) || !Number.isFinite(e.lng)) continue;
      const p = projectViewport(e.lat, e.lng, customViewport);
      if (!p.visible) continue;
      out.push({ event: e, x: p.x, y: p.y });
      if (out.length >= HIT_OVERLAY_CAP) break;
    }
    return out;
  }, [filteredEvents, region, mapSize]);

  // Loading / error / empty enligt SCREEN_STATES.md — ingen rubrik, minimal text.
  if (status === 'loading') {
    return (
      <View style={styles.screen} testID="karta-screen-loading">
        <Text style={styles.status}>Hämtar events…</Text>
      </View>
    );
  }
  if (status === 'error') {
    return (
      <View style={styles.screen} testID="karta-screen-error">
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
            testID="karta-screen-retry"
          >
            <Text style={styles.retryButtonText}>Försök igen</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  if (events.length === 0) {
    return (
      <View style={styles.screen} testID="karta-screen-empty">
        <Text style={styles.status}>Inga framtida events.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="karta-screen-ready">
      <View style={styles.mapWrap} onLayout={handleMapLayout}>
        <MapView
          provider={PROVIDER_DEFAULT}
          style={StyleSheet.absoluteFill}
          initialRegion={INITIAL_REGION}
          showsCompass
          showsScale
          rotateEnabled
          pitchEnabled
          onPress={handleMapPress}
          onRegionChange={handleRegionChange}
          accessibilityLabel="Apple Maps-karta med Stockholm-events"
          testID="karta-canvas"
          clusterColor={TOKENS.color.accent}
          clusterTextColor={TOKENS.color.bg}
        >
          {filteredEvents.map((e) => (
            <Marker
              key={e.id}
              coordinate={{ latitude: e.lat, longitude: e.lng }}
              identifier={e.id}
              // title/description AVSIKTLIGT utelämnade — de triggar
              // Apple Maps' default-vita callout.
            />
          ))}
        </MapView>
        {/* Hit-detection overlay — osynliga Pressables på varje markers
            projicerade skärm-koordinat. Detta fångar taps även om
            <Marker onPress> inte fyrar (vilket är fallet på iOS / RN 0.86
            New Architecture + react-native-maps 1.27.2 just nu). */}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {projectedMarkers.map(({ event, x, y }) => (
            <Pressable
              key={event.id}
              style={[
                styles.markerHit,
                { left: x - 22, top: y - 22 },
              ]}
              onPress={() => handleMarkerPress(event)}
              accessibilityRole="button"
              accessibilityLabel={`Öppna ${event.title_sv || event.title_en || 'event'}`}
              testID={`marker-hit-${event.id}`}
            />
          ))}
        </View>
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
KartaScreen.__helpers = {
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
    // TAB_BAR_CLEARANCE så filter-rad + meta-rad inte täcks av
    // BottomTabBar (position:absolute, bottom:0).
    paddingBottom: TAB_BAR_CLEARANCE,
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
  markerHit: {
    position: 'absolute',
    width: 44, // iOS minimum touch-target
    height: 44,
    backgroundColor: 'transparent',
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