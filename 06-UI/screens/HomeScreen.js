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
import { formatLocalTime } from '../services/localTime';

const TOKENS = {
  color: {
    bg: '#000000',
  },
  space: {
    screenTop: 52, // +4 vs baseline 48 (2026-09-28) — hela Hem-sidan skjuts ner 4 pt
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
// 2026-09-26 — grace-period: events som startade upp till 20 minuter
// innan "nu" räknas fortfarande som ikväll. Användaren hinner dit eller
// kan hoppa in i pågående föreställning.
const IKVALL_GRACE_MS = 20 * 60 * 1000;
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

// Normaliserar en Supabase-rad (events_public) till den shape DetailsScreen
// (App.js) läser: event.id, event.title, event.url, event.hasExternalLink,
// event.date, event.time, event.description, event.category, event.source,
// event.image_url/imageUrl, event.image_ai_*. venue_name finns inte i
// events_public (endast venue_id + lat/lng) — DetailsScreen visar då
// "Plats ej angiven" via getVenueLabel-fallback.
//
// start_time är ISO-timestamp; splittas till date (YYYY-MM-DD) + time
// (HH:MM) eftersom DetailsScreen läser dem separat via formatDate/formatTime.
function toDetailsScreenEvent(row) {
  if (!row || !row.id) return null;
  const start = row.start_time ? new Date(row.start_time) : null;
  const valid = !!start && !Number.isNaN(start.getTime());
  // Lokala datum-komponenter — start_time är UTC (Supabase-konvention),
  // DetailsScreen.renderar dag via date.getDay()/getDate() som är lokala.
  // toISOString().slice(0,10) skulle ge UTC-datum → 1 dag fel för kvälls-events.
  const date = valid
    ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
    : null;
  const time = valid
    ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
    : null;
  const title = row.title_sv || row.title_en || 'Evenemang';
  const description = row.description_sv || row.description_en || null;
  const ticketUrl = row.ticket_url || null;
  return {
    id: row.id,
    title,
    url: ticketUrl,
    hasExternalLink: Boolean(ticketUrl),
    date,
    time,
    description,
    category: row.category_slug || null,
    source: row.source || null,
    image_url: row.image_url || null,
    imageUrl: row.image_url || null,
    image_ai_generated: row.image_ai_generated === true,
    image_ai_optout: row.image_ai_optout === true,
    image_generation_status: row.image_generation_status || null,
    is_free: row.is_free === true,
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
  // 2026-09-26 — 4 nya karuseller enligt docs/HOME-CAROUSELS-PLAN.md
  // (Online parkerad som future build — se docs/future-builds/online-carousel-2026-09-26.md).
  // Slutlig ordning i HomeScreen: För dig → Senaste → Ikväll → Imorgon →
  // Helgen → Foodies → Gratis → Nytt på Eventpulse → Upptäck.
  const [imorgon, setImorgon] = useState({ status: 'loading', data: [], error: null });
  const [foodies, setFoodies] = useState({ status: 'loading', data: [], error: null });
  const [gratis, setGratis] = useState({ status: 'loading', data: [], error: null });
  const [nyttEventpulse, setNyttEventpulse] = useState({ status: 'loading', data: [], error: null });

  const unknownError = t('home.subtitle.errorUnknown');

  // Hämta alla 5 sektioner parallellt vid mount. Ofullständigt fel på en
  // sektion kraschar inte de andra — varje sektion har egen loading/error.
  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      // ── För dig ────────────────────────────────────────────────
      try {
        // 2026-09-26 — filtrera bort redan-startade events (Chicago-musikalens
        // 02:00-Stockholm-events har hög confidence_score och skulle annars
        // fylla top-10). Visa bara framtida rekommendationer.
        const { data, error } = await supabase
          .from('events_public')
          .select('id, title_sv, title_en, description_sv, description_en, start_time, image_url, image_ai_generated, image_ai_optout, image_generation_status, ticket_url, source, category_slug, is_free, confidence_score, freshness_at')
          .gte('start_time', new Date().toISOString())
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
          .select('id, title_sv, title_en, description_sv, description_en, start_time, image_url, image_ai_generated, image_ai_optout, image_generation_status, ticket_url, source, category_slug, confidence_score')
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
        // 2026-09-26 — användarens val: "visa events -20 min från nu och
        // framåt". 20-minuters-grace fångar events som just har börjat
        // (användaren hinner fortfarande dit / kan hoppa in i pågående
        // föreställning). Hård `now`-gräns kändes för snäv.
        const now = new Date();
        const windowStart = new Date(now.getTime() - IKVALL_GRACE_MS);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const { data, error } = await supabase
          .from('events_public')
          .select('id, title_sv, title_en, description_sv, description_en, start_time, image_url, image_ai_generated, image_ai_optout, image_generation_status, ticket_url, source, category_slug')
          // 2026-09-26 — tidigare .gte(todayStart) som innebar midnatt, så
          // Chicago-events (02:00-Stockholm-tid pga ingestion-bugg) fyllde
          // limit(40) och de riktiga ikväll-eventsen (18:00+) kom aldrig
          // fram. .gte(windowStart) exkluderar både garbage och äkta
          // förbi-events direkt i SQL — förutom grace-perioden på 20 min.
          .gte('start_time', windowStart.toISOString())
          .lte('start_time', todayEnd.toISOString())
          .order('start_time', { ascending: true })
          .limit(40);
        if (cancelled) return;
        if (error) {
          setIkvall({ status: 'error', data: [], error: error.message });
        } else {
          // Klient-filter: ikväll = start_time med Stockholm-timme ≥
          // IKVALL_HOUR (18). formatLocalTime ger Europe/Stockholm-timme
          // oavsett device-tidszon (getHours() var device-lokal och kunde
          // ge fel timme om t.ex. simulator kör UTC).
          const filtered = (data || []).filter((e) => {
            const hh = Number(formatLocalTime(e.start_time).slice(0, 2));
            return Number.isFinite(hh) && hh >= IKVALL_HOUR;
          });
          setIkvall({ status: 'ready', data: filtered, error: null });
        }
      } catch (e) {
        if (!cancelled) setIkvall({ status: 'error', data: [], error: e?.message || unknownError });
      }

      // ── Helgen ────────────────────────────────────────────────
      try {
        const { from, to } = upcomingWeekend();
        // 2026-09-26 — samma bugg som Ikväll: limit(40)+asc-sort fylldes av
        // Chicago-events (02:00 Stockholm-tid) och andra redan-passrade
        // events. .gte(now) släpper bara igenom framtida helg-events.
        const { data, error } = await supabase
          .from('events_public')
          .select('id, title_sv, title_en, description_sv, description_en, start_time, image_url, image_ai_generated, image_ai_optout, image_generation_status, ticket_url, source, category_slug')
          .gte('start_time', new Date().toISOString())
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
          .select('id, title_sv, title_en, description_sv, description_en, start_time, image_url, image_ai_generated, image_ai_optout, image_generation_status, ticket_url, source, category_slug')
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

      // ── Imorgon (start_time imorgon Stockholm) ────────────────
      try {
        const tomorrowStart = new Date();
        tomorrowStart.setDate(tomorrowStart.getDate() + 1);
        tomorrowStart.setHours(0, 0, 0, 0);
        const tomorrowEnd = new Date(tomorrowStart);
        tomorrowEnd.setHours(23, 59, 59, 999);
        const { data, error } = await supabase
          .from('events_public')
          .select('id, title_sv, title_en, description_sv, description_en, start_time, image_url, image_ai_generated, image_ai_optout, image_generation_status, ticket_url, source, category_slug')
          .gte('start_time', tomorrowStart.toISOString())
          .lte('start_time', tomorrowEnd.toISOString())
          .order('start_time', { ascending: true })
          .limit(20);
        if (cancelled) return;
        if (error) {
          setImorgon({ status: 'error', data: [], error: error.message });
        } else {
          setImorgon({ status: 'ready', data: data || [], error: null });
        }
      } catch (e) {
        if (!cancelled) setImorgon({ status: 'error', data: [], error: e?.message || unknownError });
      }

      // ── Foodies (category_slug=food) ──────────────────────────
      try {
        const { data, error } = await supabase
          .from('events_public')
          .select('id, title_sv, title_en, description_sv, description_en, start_time, image_url, image_ai_generated, image_ai_optout, image_generation_status, ticket_url, source, category_slug')
          .eq('category_slug', 'food')
          .gte('start_time', new Date().toISOString())
          .order('start_time', { ascending: true })
          .limit(20);
        if (cancelled) return;
        if (error) {
          setFoodies({ status: 'error', data: [], error: error.message });
        } else {
          setFoodies({ status: 'ready', data: data || [], error: null });
        }
      } catch (e) {
        if (!cancelled) setFoodies({ status: 'error', data: [], error: e?.message || unknownError });
      }

      // ── Gratis (is_free=true) ─────────────────────────────────
      try {
        const { data, error } = await supabase
          .from('events_public')
          .select('id, title_sv, title_en, description_sv, description_en, start_time, image_url, image_ai_generated, image_ai_optout, image_generation_status, ticket_url, source, category_slug, is_free')
          .eq('is_free', true)
          .gte('start_time', new Date().toISOString())
          .order('start_time', { ascending: true })
          .limit(FORDIG_LIMIT);
        if (cancelled) return;
        if (error) {
          setGratis({ status: 'error', data: [], error: error.message });
        } else {
          setGratis({ status: 'ready', data: data || [], error: null });
        }
      } catch (e) {
        if (!cancelled) setGratis({ status: 'error', data: [], error: e?.message || unknownError });
      }

      // ── Nytt på Eventpulse (freshness_at 48h, klient-fallback 7d) ──
      // Jev 0.20 confidence på 48h-fönstret (smalt). Klient-side utökar
      // automatiskt till 7 dagar om <3 events returneras — säkrar tom-state.
      try {
        const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const { data, error } = await supabase
          .from('events_public')
          .select('id, title_sv, title_en, description_sv, description_en, start_time, image_url, image_ai_generated, image_ai_optout, image_generation_status, ticket_url, source, category_slug, freshness_at')
          .gte('freshness_at', fortyEightHoursAgo.toISOString())
          .gte('start_time', new Date().toISOString())
          .order('freshness_at', { ascending: false })
          .limit(15);
        if (cancelled) return;
        let finalData = data || [];
        if (finalData.length < 3) {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const { data: dataWide, error: errorWide } = await supabase
            .from('events_public')
            .select('id, title_sv, title_en, description_sv, description_en, start_time, image_url, image_ai_generated, image_ai_optout, image_generation_status, ticket_url, source, category_slug, freshness_at')
            .gte('freshness_at', sevenDaysAgo.toISOString())
            .gte('start_time', new Date().toISOString())
            .order('freshness_at', { ascending: false })
            .limit(15);
          if (cancelled) return;
          if (!errorWide) finalData = dataWide || [];
        }
        if (error) {
          setNyttEventpulse({ status: 'error', data: [], error: error.message });
        } else {
          setNyttEventpulse({ status: 'ready', data: finalData, error: null });
        }
      } catch (e) {
        if (!cancelled) setNyttEventpulse({ status: 'error', data: [], error: e?.message || unknownError });
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [unknownError]);

  // Senaste-rail: rangordna pool efter signal-score, ta topp 5.
  // Kallstart (alla scores = 0) ⇒ ursprunglig ordning (nyaste först).
  // Behåller original-raderna (inte bara carousel-shape) så handleCardPress
  // kan skicka hela Supabase-raden till DetailsScreen via AppShell.
  const senaste = useMemo(() => {
    if (senastePool.status !== 'ready') return [];
    const ranked = senastePool.data
      .map((event) => ({ ...event, _score: scoreFor(signals[event.id]) }))
      .sort((a, b) => b._score - a._score);
    return ranked.slice(0, SENASTE_LIMIT);
  }, [senastePool, signals]);

  // Card-press: öka signal-score (för Senaste-omordning) + anropa
  // AppShell.handleHomeCardPress (öppnar DetailsScreen i Utforska).
  // Skickar HELA Supabase-raden (normaliserad via toDetailsScreenEvent) så
  // DetailsScreen får url/hasExternalLink/date/time/source/description etc.
  // — inte bara id+title (det gjorde hela DetailsScreen tom i v1).
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
      const payload = toDetailsScreenEvent(event);
      if (payload) onCardPress(payload);
    }
  };

  const senasteWithHandlers = senaste.map((event) => ({
    ...toSenasteCard(event, daysShort),
    onPress: handleCardPress(event),
  }));

  const fordigCards = fordig.status === 'ready'
    ? fordig.data.map((e) => ({
        ...toCarouselCard(e, formatFordigSubtitle(e, t)),
        onPress: handleCardPress(e),
      }))
    : [];
  const ikvallCards = ikvall.status === 'ready'
    ? ikvall.data.map((e) => ({
        ...toCarouselCard(e, formatIkvallSubtitle(e, t)),
        onPress: handleCardPress(e),
      }))
    : [];
  const helgenCards = helgen.status === 'ready'
    ? helgen.data.map((e) => ({
        ...toCarouselCard(e, formatHelgenSubtitle(e, daysShort, t)),
        onPress: handleCardPress(e),
      }))
    : [];
  const upptackCards = upptack.status === 'ready'
    ? upptack.data.map((e) => ({
        ...toCarouselCard(e, t('home.subtitle.upptack')),
        onPress: handleCardPress(e),
      }))
    : [];
  // 2026-09-26 — 5 nya karuseller (se HOME-CAROUSELS-PLAN.md).
  // Gratis: subtitle = category_slug om satt, annars "Gratis"-tag.
  // Övriga (Imorgon/Foodies/Online/Nytt): veckodag + tid (samma som Helgen).
  const imorgonCards = imorgon.status === 'ready'
    ? imorgon.data.map((e) => ({
        ...toCarouselCard(e, formatHelgenSubtitle(e, daysShort, t)),
        onPress: handleCardPress(e),
      }))
    : [];
  const foodiesCards = foodies.status === 'ready'
    ? foodies.data.map((e) => ({
        ...toCarouselCard(e, formatHelgenSubtitle(e, daysShort, t)),
        onPress: handleCardPress(e),
      }))
    : [];
  const gratisCards = gratis.status === 'ready'
    ? gratis.data.map((e) => ({
        ...toCarouselCard(e, e.category_slug || t('home.subtitle.free')),
        onPress: handleCardPress(e),
      }))
    : [];
  const nyttEventpulseCards = nyttEventpulse.status === 'ready'
    ? nyttEventpulse.data.map((e) => ({
        ...toCarouselCard(e, formatHelgenSubtitle(e, daysShort, t)),
        onPress: handleCardPress(e),
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
        emptyText={t('home.emptySection')}
      />

      <EventPulseSenaste
        headerText={t('home.sections.senaste')}
        cards={senasteWithHandlers}
        loading={senastePool.status === 'loading'}
        emptyText={t('home.emptySection')}
      />

      <EventPulseCarousel
        headerText={t('home.sections.ikvall')}
        cards={ikvallCards}
        loading={ikvall.status === 'loading'}
        emptyText={t('home.emptySection')}
      />

      <EventPulseCarousel
        headerText={t('home.sections.imorgon')}
        cards={imorgonCards}
        loading={imorgon.status === 'loading'}
        emptyText={t('home.emptySection')}
      />

      <EventPulseCarousel
        headerText={t('home.sections.helgen')}
        cards={helgenCards}
        loading={helgen.status === 'loading'}
        emptyText={t('home.emptySection')}
      />

      <EventPulseCarousel
        headerText={t('home.sections.foodies')}
        cards={foodiesCards}
        loading={foodies.status === 'loading'}
        emptyText={t('home.emptySection')}
      />

      <EventPulseCarousel
        headerText={t('home.sections.gratis')}
        cards={gratisCards}
        loading={gratis.status === 'loading'}
        emptyText={t('home.emptySection')}
      />

      <EventPulseCarousel
        headerText={t('home.sections.nyttEventpulse')}
        cards={nyttEventpulseCards}
        loading={nyttEventpulse.status === 'loading'}
        emptyText={t('home.emptySection')}
      />

      <EventPulseCarousel
        headerText={t('home.sections.upptack')}
        cards={upptackCards}
        loading={upptack.status === 'loading'}
        emptyText={t('home.emptySection')}
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
HomeScreen.__toDetailsScreenEvent = toDetailsScreenEvent;
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
    // innehållet. paddingBottom = TAB_BAR_CLEARANCE (96) så sista
    // karusellens titel inte skyms av BottomTabBar — samma konstant
    // som ProfileScreen.js använder (rad 60).
    paddingTop: TOKENS.space.screenTop,
    paddingBottom: 96,
    paddingHorizontal: TOKENS.space.padX,
  },
});
