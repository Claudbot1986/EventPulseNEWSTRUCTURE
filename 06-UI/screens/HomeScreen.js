/**
 * HomeScreen — home-tab i 06-UI (2026-09-25).
 *
 * Hem-supabase-logik flyttad hit från 06-UI-sandbox/components/HemSupabase.js:
 *   5 sektioner (För dig → Senaste → Ikväll → Helgen → Upptäck) som läser
 *   riktiga events från Supabase events_public-viewn.
 *
 * Tap på kort = navigering till Utforska via AppShell.handleHomeCardPress
 * (App.js drain-effect öppnar DetailsScreen för pending event-id).
 *
 * Strippat vid flytten (användarens krav "bara karusellerna"): ingen
 * eyebrow/title/subtitle, ingen dev-banner, ingen error-banner, ingen
 * reset-knapp. Resterande stil-definitioner är raderade.
 *
 * i18n: alla user-facing strängar går via t()/useI18n() — sektioner,
 * Senaste-subtitles (i dag, i morgon, igår, i förrgår), För-dig-fallbacks
 * (Gratis, Rekommenderad), Upptäck-tagline, felmeddelanden. Veckodags-
 * förkortningar i subtitles hämtas via dateNamesFor(language).daysShort
 * (befintlig modul, samma kedja som Hem*-hjälparen cardTimeLabel).
 *
 * Memory-funktionen (×3 read_more / ×2 click / ×1 impression) är oförändrad —
 * samma scoreFor som HemStar-mock i sandbox. Read_more-affordance finns inte
 * (togs bort på användarens begäran), men vikten lever kvar för symmetri.
 *
 * Ingen AsyncStorage — useState räcker för v1. Persistent memory i Fas B.
 *
 * Root: <View>, inte <ScrollView> — AppShell äger vertikal scroll, en nested
 * ScrollView äter gesterna.
 */

import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { supabase } from '../services/supabaseClient';
import EventPulseCarousel from '../components/EventPulseCarousel';
import EventPulseSenaste from '../components/EventPulseSenaste';
import { useI18n } from '../i18n';
import { dateNamesFor } from '../i18n/dateNames';

const TOKENS = {
  color: {
    bg: '#000000',
  },
  space: {
    screenTop: 48,
    padX: 20,
  },
};

// Vikter (samma som HemStar-mock). I home-tab används bara ×2 (click) eftersom
// read_more-affordance är borttagen (användarens begäran 2026-09-25).
const W_READ_MORE = 3;
const W_CLICK = 2;
const W_IMPRESSION = 1;

const SENASTE_LIMIT = 5;
const FORDIG_LIMIT = 10;
const IKVALL_HOUR = 18;
const UPPTACK_LIMIT = 5;

function pickTitle(event) {
  return event?.title_sv || event?.title_en || 'Evenemang';
}

// Pool-poster för Senaste: title, subtitle, imageUrl. imageUrl=null tillåter
// EventPulseSenasteCard's inbyggda placeholder (View med titel-text).
function toSenasteCard(event, daysShort) {
  return {
    id: event.id,
    title: pickTitle(event),
    subtitle: formatSenasteSubtitle(event, daysShort),
    imageUrl: event.image_url || null,
  };
}

function toCarouselCard(event, subtitle) {
  return {
    id: event.id,
    title: pickTitle(event),
    subtitle,
    imageUrl: event.image_url || null,
  };
}

// Senaste-subtitle: "today", "tomorrow", "yesterday", "day before yesterday"
// eller kort veckodag + datum om längre bort. daysShort kommer från
// dateNamesFor(language) — samma modul som Hem*-helpers använder.
function formatSenasteSubtitle(event, daysShort, t) {
  const t0 = new Date(event.start_time);
  if (Number.isNaN(t0.getTime())) return '';

  const today = startOfDay(new Date());
  const eventDay = startOfDay(t0);
  const diffDays = Math.round((eventDay.getTime() - today.getTime()) / 86400000);

  if (diffDays === 0) return t('home.subtitle.today');
  if (diffDays === 1) return t('home.subtitle.tomorrow');
  if (diffDays === -1) return t('home.subtitle.yesterday');
  if (diffDays === -2) return t('home.subtitle.dayBeforeYesterday');

  return `${daysShort[t0.getDay()]} ${t0.getDate()}/${t0.getMonth() + 1}`;
}

function formatIkvallSubtitle(event, t) {
  const t0 = new Date(event.start_time);
  if (Number.isNaN(t0.getTime())) return t('home.sections.ikvall');
  const hh = String(t0.getHours()).padStart(2, '0');
  const mm = String(t0.getMinutes()).padStart(2, '0');
  return `${t('home.sections.ikvall')} ${hh}:${mm}`;
}

function formatHelgenSubtitle(event, daysShort, t) {
  const t0 = new Date(event.start_time);
  if (Number.isNaN(t0.getTime())) return t('home.sections.helgen');
  const wd = daysShort[t0.getDay()];
  const hh = String(t0.getHours()).padStart(2, '0');
  const mm = String(t0.getMinutes()).padStart(2, '0');
  return `${wd} ${hh}:${mm}`;
}

// För dig-subtitle: venue-fält finns inte i events_public (anon-viewn
// projicerar inte venue-info), så vi använder category_slug som proxy.
// Fallback till "Rekommenderad"/"Gratis" om category_slug saknas.
function formatFordigSubtitle(event, t) {
  if (event.category_slug) return event.category_slug;
  if (event.is_free) return t('home.subtitle.free');
  return t('home.subtitle.recommended');
}

function startOfDay(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

// Beräkna helgfönstret (fre 00:00 → sön 23:59). Mon–tor → kommande helg,
// fre → dagens helg (fre 00:00 → sön 23:59), lör–sön → innevarande helg.
function upcomingWeekend() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 5=Fri, 6=Sat
  let daysToFri;
  if (day === 0) daysToFri = -2; // sön → förra fre (innevarande helg)
  else if (day === 5) daysToFri = 0; // fre → idag
  else if (day === 6) daysToFri = -1; // lör → förra fre
  else daysToFri = 5 - day; // mån–tor → denna veckas fre (4..1)

  const fri = new Date(now);
  fri.setDate(now.getDate() + daysToFri);
  fri.setHours(0, 0, 0, 0);

  const son = new Date(fri);
  son.setDate(fri.getDate() + 2);
  son.setHours(23, 59, 59, 999);

  return { from: fri, to: son };
}

function scoreFor(signalsForId) {
  if (!signalsForId) return 0;
  return (
    W_READ_MORE * (signalsForId.readMoreClicks || 0)
    + W_CLICK * (signalsForId.clicks || 0)
    + W_IMPRESSION * (signalsForId.impressions || 0)
  );
}

/**
 * @param {{ onCardPress?: (event: { id: string, title: string }) => void }} props
 *   onCardPress: triggas vid tryck på För-dig/Ikväll/Helgen/Upptäck-kort och
 *     Senaste-kort. AppShell kopplar detta till handleHomeCardPress som
 *     öppnar DetailsScreen i Utforska.
 */
export default function HomeScreen({ onCardPress }) {
  const { t, language } = useI18n();
  const daysShort = dateNamesFor(language).daysShort;
  const [signals, setSignals] = useState({});
  const [fordig, setFordig] = useState({ status: 'loading', data: [], error: null });
  const [senastePool, setSenastePool] = useState({ status: 'loading', data: [], error: null });
  const [ikvall, setIkvall] = useState({ status: 'loading', data: [], error: null });
  const [helgen, setHelgen] = useState({ status: 'loading', data: [], error: null });
  const [upptack, setUpptack] = useState({ status: 'loading', data: [], error: null });

  const unknownError = t('home.subtitle.errorUnknown');

  // Hämta alla 5 sektioner parallellt vid mount. Ofullständigt fel på en
  // sektion kraschar inte de andra — varje sektion har egen loading/error.
  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      // ── För dig ────────────────────────────────────────────────
      try {
        const { data, error } = await supabase
          .from('events_public')
          .select('id, title_sv, title_en, start_time, image_url, category_slug, is_free, confidence_score, freshness_at')
          .order('confidence_score', { ascending: false })
          .order('freshness_at', { ascending: false })
          .limit(FORDIG_LIMIT);
        if (cancelled) return;
        if (error) {
          setFordig({ status: 'error', data: [], error: error.message });
        } else {
          setFordig({ status: 'ready', data: data || [], error: null });
        }
      } catch (e) {
        if (!cancelled) setFordig({ status: 'error', data: [], error: e?.message || unknownError });
      }

      // ── Senaste-pool (sorteras klient-side efter signal-score) ─
      try {
        const today = startOfDay(new Date());
        today.setDate(today.getDate() - 7);
        const future = new Date(today);
        future.setDate(today.getDate() + 21);
        const { data, error } = await supabase
          .from('events_public')
          .select('id, title_sv, title_en, start_time, image_url, category_slug, confidence_score')
          .gte('start_time', today.toISOString())
          .lte('start_time', future.toISOString())
          .order('start_time', { ascending: false })
          .limit(50);
        if (cancelled) return;
        if (error) {
          setSenastePool({ status: 'error', data: [], error: error.message });
        } else {
          setSenastePool({ status: 'ready', data: data || [], error: null });
        }
      } catch (e) {
        if (!cancelled) setSenastePool({ status: 'error', data: [], error: e?.message || unknownError });
      }

      // ── Ikväll ────────────────────────────────────────────────
      try {
        const todayStart = startOfDay(new Date());
        const todayEnd = new Date(todayStart);
        todayEnd.setHours(23, 59, 59, 999);
        const { data, error } = await supabase
          .from('events_public')
          .select('id, title_sv, title_en, start_time, image_url, category_slug')
          .gte('start_time', todayStart.toISOString())
          .lte('start_time', todayEnd.toISOString())
          .order('start_time', { ascending: true })
          .limit(40);
        if (cancelled) return;
        if (error) {
          setIkvall({ status: 'error', data: [], error: error.message });
        } else {
          // Klient-filter: ikväll = start_time med timme ≥ IKVALL_HOUR (18).
          const filtered = (data || []).filter((e) => {
            const tt = new Date(e.start_time);
            return !Number.isNaN(tt.getTime()) && tt.getHours() >= IKVALL_HOUR;
          });
          setIkvall({ status: 'ready', data: filtered, error: null });
        }
      } catch (e) {
        if (!cancelled) setIkvall({ status: 'error', data: [], error: e?.message || unknownError });
      }

      // ── Helgen ────────────────────────────────────────────────
      try {
        const { from, to } = upcomingWeekend();
        const { data, error } = await supabase
          .from('events_public')
          .select('id, title_sv, title_en, start_time, image_url, category_slug')
          .gte('start_time', from.toISOString())
          .lte('start_time', to.toISOString())
          .order('start_time', { ascending: true })
          .limit(40);
        if (cancelled) return;
        if (error) {
          setHelgen({ status: 'error', data: [], error: error.message });
        } else {
          setHelgen({ status: 'ready', data: data || [], error: null });
        }
      } catch (e) {
        if (!cancelled) setHelgen({ status: 'error', data: [], error: e?.message || unknownError });
      }

      // ── Upptäck (K3 reserv) ───────────────────────────────────
      try {
        const { data, error } = await supabase
          .from('events_public')
          .select('id, title_sv, title_en, start_time, image_url, category_slug')
          .order('confidence_score', { ascending: true })
          .limit(UPPTACK_LIMIT);
        if (cancelled) return;
        if (error) {
          setUpptack({ status: 'error', data: [], error: error.message });
        } else {
          setUpptack({ status: 'ready', data: data || [], error: null });
        }
      } catch (e) {
        if (!cancelled) setUpptack({ status: 'error', data: [], error: e?.message || unknownError });
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [unknownError]);

  // Senaste-rail: rangordna pool efter signal-score, ta topp 5.
  // Kallstart (alla scores = 0) ⇒ ursprunglig ordning (nyaste först).
  const senaste = useMemo(() => {
    if (senastePool.status !== 'ready') return [];
    const ranked = senastePool.data
      .map((event) => ({ ...event, _score: scoreFor(signals[event.id]) }))
      .sort((a, b) => b._score - a._score);
    return ranked.slice(0, SENASTE_LIMIT).map((e) => toSenasteCard(e, daysShort));
  }, [senastePool, signals, daysShort]);

  // Card-press: öka signal-score (för Senaste-omordning) + anropa
  // AppShell.handleHomeCardPress (öppnar DetailsScreen i Utforska).
  // onCardPress är valfri prop — om AppShell inte skickar med den loggar
  // vi tyst (förhindrar krasch i tester / fristående demo).
  const handleCardPress = (event) => () => {
    setSignals((prev) => ({
      ...prev,
      [event.id]: {
        ...(prev[event.id] || {}),
        clicks: (prev[event.id]?.clicks || 0) + 1,
      },
    }));
    if (typeof onCardPress === 'function') {
      onCardPress({ id: event.id, title: event.title });
    }
  };

  const senasteWithHandlers = senaste.map((card) => ({
    ...card,
    onPress: handleCardPress({ id: card.id, title: card.title }),
  }));

  const fordigCards = fordig.status === 'ready'
    ? fordig.data.map((e) => ({
        ...toCarouselCard(e, formatFordigSubtitle(e, t)),
        onPress: handleCardPress({ id: e.id, title: pickTitle(e) }),
      }))
    : [];
  const ikvallCards = ikvall.status === 'ready'
    ? ikvall.data.map((e) => ({
        ...toCarouselCard(e, formatIkvallSubtitle(e, t)),
        onPress: handleCardPress({ id: e.id, title: pickTitle(e) }),
      }))
    : [];
  const helgenCards = helgen.status === 'ready'
    ? helgen.data.map((e) => ({
        ...toCarouselCard(e, formatHelgenSubtitle(e, daysShort, t)),
        onPress: handleCardPress({ id: e.id, title: pickTitle(e) }),
      }))
    : [];
  const upptackCards = upptack.status === 'ready'
    ? upptack.data.map((e) => ({
        ...toCarouselCard(e, t('home.subtitle.upptack')),
        onPress: handleCardPress({ id: e.id, title: pickTitle(e) }),
      }))
    : [];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="home-screen"
      showsVerticalScrollIndicator={false}
    >
      {/* Sektioner i ordning enligt användarens val 2026-09-25 — Först =
          personlig rekommendation, sedan Senaste (memory), sedan
          Ikväll/Helgen, sist K3-reserv. Inget ovanför karusellerna. */}
      <EventPulseCarousel
        headerText={t('home.sections.fordig')}
        cards={fordigCards}
        loading={fordig.status === 'loading'}
      />

      <EventPulseSenaste
        headerText={t('home.sections.senaste')}
        cards={senasteWithHandlers}
        loading={senastePool.status === 'loading'}
      />

      <EventPulseCarousel
        headerText={t('home.sections.ikvall')}
        cards={ikvallCards}
        loading={ikvall.status === 'loading'}
      />

      <EventPulseCarousel
        headerText={t('home.sections.helgen')}
        cards={helgenCards}
        loading={helgen.status === 'loading'}
      />

      <EventPulseCarousel
        headerText={t('home.sections.upptack')}
        cards={upptackCards}
        loading={upptack.status === 'loading'}
      />
    </ScrollView>
  );
}

// Exportera helpers för test/QA-hookning.
HomeScreen.__scoreFor = scoreFor;
HomeScreen.__formatSenasteSubtitle = formatSenasteSubtitle;
HomeScreen.__formatIkvallSubtitle = formatIkvallSubtitle;
HomeScreen.__formatHelgenSubtitle = formatHelgenSubtitle;
HomeScreen.__upcomingWeekend = upcomingWeekend;
HomeScreen.__W_READ_MORE = W_READ_MORE;
HomeScreen.__W_CLICK = W_CLICK;
HomeScreen.__W_IMPRESSION = W_IMPRESSION;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: TOKENS.color.bg,
  },
  content: {
    // Padding ligger på contentContainerStyle så det skrollar med
    // innehållet — sista sektionen har full paddingBottom och inte
    // kapad av BottomTabBar.
    paddingTop: TOKENS.space.screenTop,
    paddingBottom: 48,
    paddingHorizontal: TOKENS.space.padX,
  },
});
