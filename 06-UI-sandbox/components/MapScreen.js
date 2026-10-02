// MapScreen.js — root för kartan-sandbox i 06-UI-sandbox.
//
// Vad det gör:
//   1. Hämtar ALLA future events (≤5000 för safety) från events_public
//      via samma supabase-klient som HemSupabase.
//   2. Filter-knappar (Idag / Helgen / Nästa helg / Alla) byter
//      tidsfönster och visar antal events som matchar.
//   3. MapCanvas renderar filtrerade events med klustring.
//   4. Loading / error / empty states per samma mönster som HemSupabase.
//
// Data-kontrakt (events_public, anon-läsbar):
//   id, title_sv, title_en, start_time, lat, lng, category_slug,
//   is_free, image_url, confidence_score
//
// State-modeller: useState (sandbox-konventionen).
// Inga providers, inga hooks-bibliotek, inga services från 06-UI/.
//
// Root: <View>, inte <ScrollView> — App.js:s ComponentDetail-vy
// äger redan vertikal scroll, en nested ScrollView äter gesterna.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../services/supabaseClient';
import { isFutureEvent, computeTimeWindow } from './mapTime';
import { STOCKHOLM_FALLBACK } from './mapProjection';
import MapCanvas from './MapCanvas';
import MapFilterBar from './MapFilterBar';

const TOKENS = {
  color: {
    bg: '#000000',
    eyebrow: '#FFB454',
    title: '#F7F2EA',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
    bannerBg: '#1A1108',
    bannerBorder: '#FFB454',
    errorBg: '#2A0E0E',
    errorBorder: '#A8484B',
    divider: '#1A1A1A',
  },
  font: {
    eyebrow: { size: 11, weight: '800', letterSpacing: 1.6 },
    title: { size: 28, weight: '900', letterSpacing: -0.8 },
    banner: { size: 12, weight: '500' },
    error: { size: 12, weight: '600' },
    meta: { size: 11, weight: '700', letterSpacing: 0.4 },
  },
  space: {
    screenTop: 48,
    padX: 20,
    eyebrowToTitle: 4,
    titleToSubtitle: 8,
    subtitleToBanner: 20,
    canvasGap: 16,
    barGap: 8,
    metaGap: 16,
  },
};

const FETCH_PAGE_SIZE = 1000;
const FETCH_MAX_PAGES = 10;
const FETCH_SELECT =
  'id, title_sv, title_en, start_time, lat, lng, category_slug, is_free, confidence_score';

function pickTitle(event) {
  return event?.title_sv || event?.title_en || 'Evenemang';
}

function MapScreen() {
  const [status, setStatus] = useState('loading');
  const [errorMsg, setErrorMsg] = useState(null);
  const [events, setEvents] = useState([]);
  const [activeMode, setActiveMode] = useState('weekend');

  // Hämta ALLA future events med paginerat sidbyte (PostgREST default
  // max = 1000 rader per request). Förväntat ~3611 rader baserat på
  // gap-analys 2026-10-02; vi kapar vid FETCH_MAX_PAGES för safety.
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

  // Räkna per filterläge (för filter-barens count-pillor).
  const counts = (() => {
    const now = new Date();
    const out = {};
    for (const mode of ['today', 'weekend', 'next_weekend', 'all']) {
      const window = computeTimeWindow(mode, now);
      out[mode] = events.filter((e) => {
        if (!isFutureEvent(e, now)) return false;
        if (!window || (window.from == null && window.to == null)) return true;
        const t = new Date(e.start_time).getTime();
        if (window.from && t < window.from.getTime()) return false;
        if (window.to && t > window.to.getTime()) return false;
        return true;
      }).length;
    }
    return out;
  })();

  // Filtrerad vy som MapCanvas får.
  const window = computeTimeWindow(activeMode, new Date());
  const filteredEvents = events.filter((e) => {
    if (!isFutureEvent(e, new Date())) return false;
    if (!window || (window.from == null && window.to == null)) return true;
    const t = new Date(e.start_time).getTime();
    if (window.from && t < window.from.getTime()) return false;
    if (window.to && t > window.to.getTime()) return false;
    return true;
  });

  const fallbackCount = filteredEvents.filter(
    (e) => Math.abs(e.lat - STOCKHOLM_FALLBACK.lat) < 1e-6,
  ).length;
  const realGeoCount = filteredEvents.length - fallbackCount;

  if (status === 'loading') {
    return (
      <View style={styles.scroll} testID="map-screen-loading">
        <Text style={styles.eyebrow}>KARTA</Text>
        <Text style={styles.title}>Stockholm karta</Text>
        <Text style={styles.subtitle}>Hämtar events från Supabase…</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.scroll} testID="map-screen-error">
        <Text style={styles.eyebrow}>KARTA</Text>
        <Text style={styles.title}>Stockholm karta</Text>
        <View style={styles.errorBanner}>
          <Text style={styles.errorTitle}>Supabase-fel</Text>
          <Text style={styles.errorLine}>{errorMsg}</Text>
        </View>
      </View>
    );
  }

  if (events.length === 0) {
    return (
      <View style={styles.scroll} testID="map-screen-empty">
        <Text style={styles.eyebrow}>KARTA</Text>
        <Text style={styles.title}>Stockholm karta</Text>
        <Text style={styles.subtitle}>Inga framtida events hittades.</Text>
      </View>
    );
  }

  return (
    <View style={styles.scroll} testID="map-screen-ready">
      <Text style={styles.eyebrow}>KARTA</Text>
      <Text style={styles.title}>Stockholm karta</Text>
      <Text style={styles.subtitle}>
        {events.length} events i databasen just nu. {filteredEvents.length} matchar
        filtret '{activeMode === 'today' ? 'Idag' : activeMode === 'weekend' ? 'Helgen' : activeMode === 'next_weekend' ? 'Nästa helg' : 'Alla'}'.
        Av dem är {realGeoCount} geokodade och {fallbackCount} använder
        Stockholm-fallback (döljer en lokal gömma).
      </Text>

      <View style={styles.devBanner}>
        <Text style={styles.devBannerText}>
          SANDBOX-PREVIEW (riktig Supabase-data via events_public).
          Kartan är SVG-fri och renderad med React Native Views (kräver
          ingen extern tile-tjänst). Tryckertiden ska flyttas ut efter
          sandbox-validering.
        </Text>
      </View>

      <MapCanvas events={filteredEvents} testID="map-screen-canvas" />

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
          <Text style={styles.metaLabel}>SYNLIGA</Text>
          <Text style={styles.metaValue}>{filteredEvents.length}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>RIKTIG GEO</Text>
          <Text style={styles.metaValue}>{realGeoCount}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>FALLBACK</Text>
          <Text style={styles.metaValue}>{fallbackCount}</Text>
        </View>
      </View>

      <View style={styles.legend}>
        <Text style={styles.legendTitle}>FÄRGER</Text>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#5BC85B' }]} />
          <Text style={styles.legendText}>Gratis</Text>
          <View style={[styles.legendDot, { backgroundColor: '#FFB454' }]} />
          <Text style={styles.legendText}>Musik</Text>
          <View style={[styles.legendDot, { backgroundColor: '#9CB8FF' }]} />
          <Text style={styles.legendText}>Klassiskt</Text>
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
  scroll: {
    paddingTop: TOKENS.space.screenTop,
    paddingBottom: 48,
    paddingHorizontal: TOKENS.space.padX,
    backgroundColor: TOKENS.color.bg,
  },
  eyebrow: {
    color: TOKENS.color.eyebrow,
    fontSize: TOKENS.font.eyebrow.size,
    fontWeight: TOKENS.font.eyebrow.weight,
    letterSpacing: TOKENS.font.eyebrow.letterSpacing,
    textTransform: 'uppercase',
    marginBottom: TOKENS.space.eyebrowToTitle,
  },
  title: {
    color: TOKENS.color.title,
    fontSize: TOKENS.font.title.size,
    fontWeight: TOKENS.font.title.weight,
    letterSpacing: TOKENS.font.title.letterSpacing,
    marginBottom: TOKENS.space.titleToSubtitle,
  },
  subtitle: {
    color: TOKENS.color.textMuted,
    fontSize: 13,
    fontWeight: '500',
    marginBottom: TOKENS.space.subtitleToBanner,
    lineHeight: 18,
  },
  devBanner: {
    backgroundColor: TOKENS.color.bannerBg,
    borderWidth: 1,
    borderColor: TOKENS.color.bannerBorder,
    borderRadius: 10,
    padding: 14,
    marginBottom: TOKENS.space.canvasGap,
  },
  devBannerText: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.banner.size,
    fontWeight: TOKENS.font.banner.weight,
    lineHeight: 17,
  },
  errorBanner: {
    backgroundColor: TOKENS.color.errorBg,
    borderWidth: 1,
    borderColor: TOKENS.color.errorBorder,
    borderRadius: 10,
    padding: 14,
    marginBottom: TOKENS.space.canvasGap,
  },
  errorTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.banner.size,
    fontWeight: '800',
    marginBottom: 6,
  },
  errorLine: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.error.size,
    fontWeight: TOKENS.font.error.weight,
    lineHeight: 15,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: TOKENS.space.canvasGap,
    marginHorizontal: 0,
    paddingHorizontal: TOKENS.space.padX,
    gap: TOKENS.space.metaGap,
  },
  metaItem: {
    flex: 1,
  },
  metaLabel: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.meta.size,
    fontWeight: TOKENS.font.meta.weight,
    letterSpacing: TOKENS.font.meta.letterSpacing,
    marginBottom: 4,
  },
  metaValue: {
    color: TOKENS.color.text,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  legend: {
    paddingHorizontal: TOKENS.space.padX,
    marginTop: TOKENS.space.canvasGap,
  },
  legendTitle: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.meta.size,
    fontWeight: TOKENS.font.meta.weight,
    letterSpacing: TOKENS.font.meta.letterSpacing,
    marginBottom: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  legendText: {
    color: TOKENS.color.text,
    fontSize: 12,
    fontWeight: '500',
    marginRight: 12,
  },
});

export default MapScreen;