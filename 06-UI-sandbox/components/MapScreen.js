// MapScreen.js — root för kartan-sandbox i 06-UI-sandbox.
//
// Vad det gör (minimal layout):
//   1. Hämtar future events från events_public (Supabase).
//   2. MapFilterBar (Idag / Helgen / Nästa helg / Alla) byter
//      tidsfönster och visar antal events som matchar.
//   3. MapCanvas renderar filtrerade events med klustring + pinch/pan.
//   4. Event-counts (TOTAL / VISIBLE) under kartan.
//   5. Loading / error / empty states med minimal text.
//
// Layout: kartan fyller tillgänglig höjd, filter + counts under.
// App.js använder `fullscreen: true` på denna entry för att ta bort
// den yttre ScrollView-wrappern så panorering inte störs av vertikal
// scroll från sandbox-listan.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../services/supabaseClient';
import { isFutureEvent, computeTimeWindow } from './mapTime';
import MapCanvas from './MapCanvas';
import MapFilterBar from './MapFilterBar';

const TOKENS = {
  color: {
    bg: '#000000',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
  },
  font: {
    status: { size: 13, weight: '500' },
    meta: { size: 11, weight: '700', letterSpacing: 0.4 },
  },
  space: {
    padX: 20,
    metaGap: 16,
  },
};

const FETCH_PAGE_SIZE = 1000;
const FETCH_MAX_PAGES = 10;
const FETCH_SELECT =
  'id, title_sv, title_en, start_time, lat, lng, category_slug, is_free, confidence_score';

function MapScreen() {
  const [status, setStatus] = useState('loading');
  const [errorMsg, setErrorMsg] = useState(null);
  const [events, setEvents] = useState([]);
  const [activeMode, setActiveMode] = useState('weekend');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const all = [];
        for (let page = 0; page < FETCH_MAX_PAGES; page++) {
          const from = page * FETCH_PAGE_SIZE;
          const to = from + FETCH_PAGE_SIZE - 1;
          const { data, error } = await supabase
            .from('events_public')
            .select(FETCH_SELECT)
            .gte('start_time', new Date().toISOString())
            .order('start_time', { ascending: true })
            .range(from, to);
          if (cancelled) return;
          if (error) {
            setStatus('error');
            setErrorMsg(error.message);
            return;
          }
          const rows = data || [];
          all.push(...rows);
          if (rows.length < FETCH_PAGE_SIZE) break;
        }
        if (cancelled) return;
        setEvents(all);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(e?.message || 'okänt fel');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = (() => {
    const now = new Date();
    const out = {};
    for (const mode of ['today', 'weekend', 'next_weekend', 'all']) {
      const win = computeTimeWindow(mode, now);
      out[mode] = events.filter((e) => {
        if (!isFutureEvent(e, now)) return false;
        if (!win || (win.from == null && win.to == null)) return true;
        const t = new Date(e.start_time).getTime();
        if (win.from && t < win.from.getTime()) return false;
        if (win.to && t > win.to.getTime()) return false;
        return true;
      }).length;
    }
    return out;
  })();

  const win = computeTimeWindow(activeMode, new Date());
  const filteredEvents = events.filter((e) => {
    if (!isFutureEvent(e, new Date())) return false;
    if (!win || (win.from == null && win.to == null)) return true;
    const t = new Date(e.start_time).getTime();
    if (win.from && t < win.from.getTime()) return false;
    if (win.to && t > win.to.getTime()) return false;
    return true;
  });

  // Minimal status-rad för loading/error/empty — INGEN rubrik, INGEN dev-banner.
  if (status === 'loading') {
    return (
      <View style={styles.screen} testID="map-screen-loading">
        <Text style={styles.status}>Hämtar events…</Text>
      </View>
    );
  }
  if (status === 'error') {
    return (
      <View style={styles.screen} testID="map-screen-error">
        <Text style={styles.status}>Supabase-fel: {errorMsg}</Text>
      </View>
    );
  }
  if (events.length === 0) {
    return (
      <View style={styles.screen} testID="map-screen-empty">
        <Text style={styles.status}>Inga framtida events.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="map-screen-ready">
      <MapCanvas
        events={filteredEvents}
        testID="map-screen-canvas"
        style={styles.canvas}
      />
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

// Exportera helpers för test-hookning.
MapScreen.__computeTimeWindow = computeTimeWindow;
MapScreen.__FETCH_PAGE_SIZE = FETCH_PAGE_SIZE;
MapScreen.__FETCH_MAX_PAGES = FETCH_MAX_PAGES;
MapScreen.__FETCH_SELECT = FETCH_SELECT;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: TOKENS.color.bg,
    paddingHorizontal: TOKENS.space.padX,
    // Ingen paddingTop: App.js:s fullscreen-wrapper ger SafeArea-top
    // och vi vill att kartan ska börja direkt under status-baren.
  },
  canvas: {
    flex: 1,
  },
  status: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.status.size,
    fontWeight: TOKENS.font.status.weight,
    padding: 24,
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

export default MapScreen;