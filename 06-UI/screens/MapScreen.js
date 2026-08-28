/**
 * MapScreen — T0078 / Phase 1 retention.
 *
 * Pure-black map surface (per docs/UI-DESIGN.md) with a transparent
 * bottom-sheet card showing the tapped venue's upcoming events. Pins are
 * derived from the events already fetched from the agent feed (`/agent/feed`)
 * plus a small static coordinate lookup for the named Stockholm venues
 * called out in the brief (Debaser, Kvarnen, Södra Teatern, Stora Teatern,
 * Fasching). Events without a coordinate AND without a name match are
 * silently skipped (graceful degradation — never crash).
 *
 * Why no third-party clustering library:
 *   The Stockholm dataset has < 20 venues with pins; visible clustering is
 *   trivially handled by zoom-level rounding in `clusterKeyFor`. Pulling
 *   in `react-native-map-clustering` adds a native module + bridge cost
 *   for a one-screen feature that doesn't need it.
 *
 * Why no automatic user-location dot:
 *   The map centers on Stockholm by default. Showing the user's blue dot
 *   requires an `NSLocationWhenInUseUsageDescription` prompt — out of
 *   scope for the T0078 brief (the iOS Info.plist key is present so the
 *   dot *can* be enabled later, but the MapView is rendered with
 *   `showsUserLocation={false}` for now).
 *
 * Empty state (no fetches succeeded, no events, no venues with pins):
 *   "— inga evenemang på kartan —" — never fabricated pins.
 *
 * Tap flow:
 *   Pin tap → set selected venue → bottom sheet slides up with events
 *   at that venue, sorted by start_time ascending. "Öppna" CTA in the
 *   sheet calls `onEventPress(event)` so the parent's DetailsScreen /
 *   tab navigator can route to it.
 *
 * Props:
 *   - onEventPress: (event) => void   — required, opens the event detail
 *   - events: array (optional)        — pre-fetched events from parent;
 *                                       when omitted we fetch from
 *                                       `fetchFeed` directly.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

import { fetchFeed } from '../services/agentClient';

// ─── TOKENS — mirrored from docs/UI-DESIGN.md ────────────────────────────────
const TOKENS = {
  color: {
    appBg: '#000000',
    surface: '#000000',
    surfaceRaised: 'transparent',
    surfaceSoft: '#202635',
    border: '#1A1A1A',
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
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 },
  radius: { sm: 10, md: 16, lg: 22, pill: 999 },
};

// Stockholm center (Sergels Torg). Used as the map's initialRegion AND
// as the fallback region when no venue pins are present.
const STOCKHOLM_REGION = {
  latitude: 59.3326,
  longitude: 18.0649,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

// Well-known Stockholm venue coordinates. Keys are normalized (lowercased,
// trimmed, no diacritics on the user-facing label so accents don't break
// the match). These cover the venues called out in the brief and let
// the map render pins even when the upstream event payload omits lat/lng.
const KNOWN_VENUES = [
  { key: 'debaser',          name: 'Debaser',         lat: 59.3211, lng: 18.0786 },
  { key: 'debaser strand',   name: 'Debaser Strand',  lat: 59.3170, lng: 18.0840 },
  { key: 'kvarnen',          name: 'Kvarnen',         lat: 59.3170, lng: 18.0790 },
  { key: 'sodra teatern',    name: 'Södra Teatern',   lat: 59.3191, lng: 18.0795 },
  { key: 'stora teatern',    name: 'Stora Teatern',   lat: 59.3361, lng: 18.0793 },
  { key: 'fasching',         name: 'Fasching',        lat: 59.3349, lng: 18.0791 },
  { key: 'kulturhuset',      name: 'Kulturhuset',     lat: 59.3326, lng: 18.0649 },
  { key: 'kungstradgarden',  name: 'Kungsträdgården', lat: 59.3306, lng: 18.0719 },
  { key: 'gota lejon',       name: 'Göta Lejon',      lat: 59.3186, lng: 18.0810 },
];

function normalizeVenueKey(label) {
  if (!label || typeof label !== 'string') return '';
  return label
    .toLowerCase()
    .trim()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/é/g, 'e')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ');
}

function knownCoordsFor(venueLabel) {
  const key = normalizeVenueKey(venueLabel);
  if (!key) return null;
  // Exact match first.
  const exact = KNOWN_VENUES.find((v) => normalizeVenueKey(v.name) === key);
  if (exact) return exact;
  // Then a startsWith() match for compound labels ("Debaser Strand" etc.)
  const startsWith = KNOWN_VENUES.find((v) => key.startsWith(normalizeVenueKey(v.name)));
  return startsWith || null;
}

// ─── Date/time formatting (mirrors App.js so labels read identically) ───────
function formatTime(timeString) {
  if (!timeString) return '';
  return String(timeString).slice(0, 5);
}

function formatDateShort(dateString) {
  if (!dateString) return '';
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  const days = ['Sön', 'Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör'];
  const months = ['jan', 'feb', 'mars', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
}

// ─── Venue aggregation ───────────────────────────────────────────────────────
// Turn a list of event cards into one pin per venue. Each pin gets a
// `eventCount` and the next upcoming event so the bottom sheet has a
// default preview without needing a tap to open it.
//
// Events with no venue name AND no `lat`/`lng` are dropped (graceful).
// Events with a venue name but no coords get coords from KNOWN_VENUES.
// Events with `lat`/`lng` (already on the Supabase payload) override the
// static lookup so coordinates stay accurate.
function aggregateVenues(events) {
  if (!Array.isArray(events)) return [];
  const now = new Date();
  const byVenue = new Map();

  for (const event of events) {
    const venueName = event.venue || event.venue_name || null;
    if (!venueName) continue;

    const known = knownCoordsFor(venueName);
    const lat = Number.isFinite(event.lat) ? event.lat : known?.lat;
    const lng = Number.isFinite(event.lng) ? event.lng : known?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const upcoming = event.start_time ? new Date(event.start_time) : null;
    const isUpcoming = upcoming && !Number.isNaN(upcoming.getTime()) && upcoming >= now;

    if (!byVenue.has(key)) {
      byVenue.set(key, {
        key,
        lat,
        lng,
        venueName,
        events: [],
        upcomingCount: 0,
      });
    }
    const bucket = byVenue.get(key);
    bucket.events.push(event);
    if (isUpcoming) bucket.upcomingCount += 1;
  }

  const venues = Array.from(byVenue.values());
  // Sort each bucket by upcoming-ness (soonest first) then alphabetical.
  venues.forEach((v) => {
    v.events.sort((a, b) => {
      const aTime = a.start_time ? new Date(a.start_time).getTime() : Infinity;
      const bTime = b.start_time ? new Date(b.start_time).getTime() : Infinity;
      const aFuture = Number.isFinite(aTime) && aTime >= now.getTime();
      const bFuture = Number.isFinite(bTime) && bTime >= now.getTime();
      if (aFuture && !bFuture) return -1;
      if (!aFuture && bFuture) return 1;
      if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime;
      return 0;
    });
  });
  return venues;
}

// Cluster key for two nearby pins at the same zoom level — used so
// Södermalm's three venues don't render as three identical dots when
// the user zooms out. We render the cluster as a single Marker whose
// title carries the count; tapping it selects the first venue in the
// cluster so the bottom sheet still has something to show.
function clusterKeyFor(venue, zoomDelta) {
  const factor = Math.max(1, Math.round(zoomDelta * 1000));
  return `${Math.round(venue.lat * factor)}:${Math.round(venue.lng * factor)}`;
}

// ─── Loading skeleton ───────────────────────────────────────────────────────
function MapLoading() {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="small" color={TOKENS.color.accent} />
      <Text style={styles.loadingText}>Hämtar venues…</Text>
    </View>
  );
}

// ─── Empty state — never fabricated ──────────────────────────────────────────
function MapEmpty({ onRetry }) {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyEyebrow}>KARTA</Text>
      <Text style={styles.emptyTitle}>— inga evenemang på kartan —</Text>
      <Text style={styles.emptyDetail}>
        När det finns venues med koordinater visas de som pins här.
      </Text>
      <TouchableOpacity
        style={styles.emptyButton}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Hämta igen"
      >
        <Text style={styles.emptyButtonText}>Hämta igen</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Bottom sheet — transparent card, accent eyebrow, "Öppna" CTA ───────────
function VenueSheet({ venue, onEventPress, onClose }) {
  if (!venue) return null;
  const upcoming = venue.events.slice(0, 5);

  return (
    <View style={styles.sheet} pointerEvents="box-none">
      <View style={styles.sheetCard}>
        <View style={styles.sheetHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetEyebrow}>VENUE</Text>
            <Text style={styles.sheetTitle} numberOfLines={2}>{venue.venueName}</Text>
            <Text style={styles.sheetMeta}>
              {venue.upcomingCount > 0
                ? `${venue.upcomingCount} kommande event`
                : `${venue.events.length} event hittade`}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.sheetClose}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Stäng"
          >
            <Text style={styles.sheetCloseText}>Stäng</Text>
          </TouchableOpacity>
        </View>

        {upcoming.length === 0 ? (
          <Text style={styles.sheetEmpty}>Inga kommande event för den här platsen.</Text>
        ) : (
          upcoming.map((event, idx) => (
            <TouchableOpacity
              key={event.id || `${venue.key}-${idx}`}
              style={styles.sheetRow}
              activeOpacity={0.7}
              onPress={() => onEventPress(event)}
              accessibilityRole="button"
              accessibilityLabel={`Öppna ${event.title || 'event'}`}
            >
              <View style={styles.sheetDateCol}>
                <Text style={styles.sheetDateDay}>{formatDateShort(event.date)}</Text>
                <Text style={styles.sheetDateTime}>{formatTime(event.time) || '—'}</Text>
              </View>
              <View style={styles.sheetRowBody}>
                <Text style={styles.sheetRowTitle} numberOfLines={2}>
                  {event.title || 'Titel saknas'}
                </Text>
                <Text style={styles.sheetOpenCta}>Öppna →</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>
    </View>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────
export default function MapScreen({ onEventPress, events: eventsProp }) {
  const [internalEvents, setInternalEvents] = useState(null);
  const [error, setError] = useState(null);
  const [selectedVenue, setSelectedVenue] = useState(null);

  // Allow the parent to pass pre-fetched events so the same feed powers
  // the Home list AND the map (no double network round-trip).
  useEffect(() => {
    if (Array.isArray(eventsProp)) {
      setInternalEvents(eventsProp);
    }
  }, [eventsProp]);

  const loadEvents = useCallback(async () => {
    setError(null);
    try {
      const from = new Date().toISOString().slice(0, 10);
      const page = await fetchFeed({ from, days: 7 });
      setInternalEvents(page.events || []);
    } catch (err) {
      setError(err?.message || 'Kunde inte hämta venues');
      setInternalEvents([]);
    }
  }, []);

  useEffect(() => {
    if (Array.isArray(eventsProp)) return; // parent controls the data
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const venues = useMemo(() => aggregateVenues(internalEvents), [internalEvents]);

  // Pick the region. If we have at least one pin, frame all of them;
  // otherwise fall back to Stockholm city center.
  const initialRegion = useMemo(() => {
    if (venues.length === 0) return STOCKHOLM_REGION;
    const lats = venues.map((v) => v.lat);
    const lngs = venues.map((v) => v.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const pad = (a, b) => Math.max(0.02, (b - a) * 0.6);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: pad(minLat, maxLat),
      longitudeDelta: pad(minLng, maxLng),
    };
  }, [venues]);

  // Build cluster view for the current zoom. We compute on every render
  // because zoom changes are frequent and the dataset is tiny (< 20).
  const clustered = useMemo(() => {
    const zoomDelta = initialRegion.latitudeDelta;
    const groups = new Map();
    for (const venue of venues) {
      const key = clusterKeyFor(venue, zoomDelta);
      if (!groups.has(key)) groups.set(key, venue);
      else groups.get(key).events.push(...venue.events);
    }
    return Array.from(groups.values());
  }, [venues, initialRegion]);

  if (internalEvents === null && !error) {
    return (
      <SafeAreaView style={styles.container}>
        <MapLoading />
      </SafeAreaView>
    );
  }

  const isEmpty = !error && venues.length === 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.appKicker}>City discovery</Text>
        <Text style={styles.appTitle}>Karta</Text>
        <Text style={styles.appSubtitle}>
          {venues.length > 0
            ? `${venues.length} venue${venues.length === 1 ? '' : 's'} med kommande event.`
            : 'Utforska Stockholm – en pin per venue.'}
        </Text>
      </View>

      <View style={styles.mapWrapper}>
        <MapView
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          initialRegion={initialRegion}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
          movePadding={{ top: 0, right: 0, bottom: 220, left: 0 }}
        >
          {clustered.map((venue) => (
            <Marker
              key={venue.key}
              coordinate={{ latitude: venue.lat, longitude: venue.lng }}
              onPress={() => setSelectedVenue(venue)}
              tracksViewChanges={false}
              accessibilityLabel={`${venue.venueName} – ${venue.upcomingCount || venue.events.length} event`}
            >
              <View style={styles.pin}>
                <Text style={styles.pinCount}>
                  {venue.upcomingCount > 0 ? venue.upcomingCount : venue.events.length}
                </Text>
              </View>
            </Marker>
          ))}
        </MapView>

        {/* Dark overlay tint so the map reads on a pure-black canvas.
            Keeps the standard Apple/Google basemap legible without
            fighting the brand. */}
        <View pointerEvents="none" style={styles.mapTint} />

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>

      {isEmpty ? (
        <MapEmpty onRetry={loadEvents} />
      ) : (
        <VenueSheet
          venue={selectedVenue}
          onEventPress={(event) => {
            if (typeof onEventPress === 'function') onEventPress(event);
          }}
          onClose={() => setSelectedVenue(null)}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles — locked to docs/UI-DESIGN.md tokens ────────────────────────────
const styles = StyleSheet.create({
  container: {
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

  mapWrapper: {
    flex: 1,
    backgroundColor: TOKENS.color.appBg,
  },
  map: {
    flex: 1,
  },
  mapTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
  },

  pin: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: TOKENS.color.accent,
    borderWidth: 2,
    borderColor: TOKENS.color.black,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: TOKENS.space.xs,
  },
  pinCount: {
    color: TOKENS.color.black,
    fontSize: 12,
    fontWeight: '900',
  },

  errorBanner: {
    position: 'absolute',
    top: TOKENS.space.md,
    left: TOKENS.space.md,
    right: TOKENS.space.md,
    padding: TOKENS.space.md,
    borderRadius: TOKENS.radius.md,
    borderWidth: 1,
    borderColor: TOKENS.color.danger,
    backgroundColor: 'rgba(255, 117, 151, 0.16)',
  },
  errorText: {
    color: TOKENS.color.danger,
    fontSize: 13,
    fontWeight: '700',
  },

  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TOKENS.color.appBg,
  },
  loadingText: {
    color: TOKENS.color.textMuted,
    marginTop: TOKENS.space.sm,
    fontSize: 14,
  },

  emptyContainer: {
    paddingHorizontal: TOKENS.space.xxl,
    paddingVertical: TOKENS.space.xxl,
    alignItems: 'center',
  },
  emptyEyebrow: {
    color: TOKENS.color.accent,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: TOKENS.space.sm,
  },
  emptyTitle: {
    color: TOKENS.color.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: TOKENS.space.sm,
  },
  emptyDetail: {
    color: TOKENS.color.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: TOKENS.space.lg,
  },
  emptyButton: {
    backgroundColor: TOKENS.color.accent,
    borderRadius: TOKENS.radius.pill,
    paddingHorizontal: TOKENS.space.xl,
    paddingVertical: TOKENS.space.md,
  },
  emptyButtonText: {
    color: TOKENS.color.black,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
  },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: TOKENS.space.md,
  },
  sheetCard: {
    backgroundColor: TOKENS.color.surfaceRaised,
    borderWidth: 1,
    borderColor: TOKENS.color.borderStrong,
    borderRadius: TOKENS.radius.lg,
    padding: TOKENS.space.md,
    gap: TOKENS.space.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: TOKENS.space.md,
    marginBottom: TOKENS.space.sm,
  },
  sheetEyebrow: {
    color: TOKENS.color.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: TOKENS.space.xs,
  },
  sheetTitle: {
    color: TOKENS.color.text,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  sheetMeta: {
    color: TOKENS.color.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: TOKENS.space.xs,
  },
  sheetClose: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.sm,
    borderRadius: TOKENS.radius.pill,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
  },
  sheetCloseText: {
    color: TOKENS.color.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  sheetEmpty: {
    color: TOKENS.color.textSoft,
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: TOKENS.space.sm,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.md,
    paddingVertical: TOKENS.space.sm,
    borderTopWidth: 1,
    borderTopColor: TOKENS.color.border,
  },
  sheetDateCol: {
    minWidth: 56,
    paddingVertical: TOKENS.space.xs,
    paddingHorizontal: TOKENS.space.sm,
    borderRadius: TOKENS.radius.sm,
    backgroundColor: TOKENS.color.accentSoft,
    alignItems: 'center',
  },
  sheetDateDay: {
    color: TOKENS.color.accent,
    fontSize: 11,
    fontWeight: '800',
  },
  sheetDateTime: {
    color: TOKENS.color.textMuted,
    fontSize: 10,
    marginTop: 2,
    fontWeight: '600',
  },
  sheetRowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
  },
  sheetRowTitle: {
    flex: 1,
    color: TOKENS.color.text,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  sheetOpenCta: {
    color: TOKENS.color.accent,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
});

// Export pure helpers so the unit test can exercise them without
// spinning up the full MapView (which has no headless test path).
export const __test__ = {
  aggregateVenues,
  normalizeVenueKey,
  knownCoordsFor,
  clusterKeyFor,
  KNOWN_VENUES,
  formatDateShort,
  formatTime,
};