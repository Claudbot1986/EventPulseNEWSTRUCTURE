// HemSupabase — sandbox-version av Hem* med RIKTIGA Supabase-data.
//
// Spegel av Hem* (HemStar.js, mock) men istället för hårdkodade listor
// läser vi events_public direkt via supabase-js. Sektioner, ordning,
// typografi och minnes-funktion är identiska med Hem* — detta är en
// "data-source swap", inte en UI-pivot.
//
// Sandbox-regelbrott (medvetet, Hem-supabase markerar detta undantag):
//   - Supabase-anrop — sandbox tillåter normalt inte detta, men Hem-supabase
//     är ett explicit undantag som validerar hur riktiga events filtreras.
//   - HemStar.js (mock) bevaras som historisk demo bredvid denna.
//
// Vad som INTE ändrats:
//   - Sektionsordning (användarens val 2026-09-25): För dig → Senaste →
//     Ikväll → Helgen → Upptäck.
//   - Minnes-funktion (×3 read_more / ×2 click / ×1 impression) — samma
//     scoreFor som HemStar.js. Read_more-affordance finns inte (togs bort
//     på användarens begäran), men vikten lever kvar i scoreFor.
//   - AsyncStorage används INTE — useState räcker för sandbox-demo.
//   - Tap på kort = lokal placeholder (konsol-logg), ingen navigering.
//
// queries: events_public view (anon-läsbar). Inget auth-flöde.
//
// Root: <View>, inte <ScrollView> — App.js:s ComponentDetail-vy äger
// redan vertikal scroll, en nested ScrollView äter gesterna (samma
// fälla som HemStar.js 2026-09-25).

import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../services/supabaseClient';
import EventPulseCarousel from './EventPulseCarousel';
import EventPulseSenaste from './EventPulseSenaste';

const TOKENS = {
  color: {
    bg: '#000000',
    eyebrow: '#FFB454',
    title: '#F7F2EA',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
    bannerBg: '#1A1108',
    bannerBorder: '#FFB454',
    reset: '#FFB454',
    errorBg: '#2A0E0E',
    errorBorder: '#A8484B',
    divider: '#1A1A1A',
  },
  font: {
    eyebrow: { size: 11, weight: '800', letterSpacing: 1.6 },
    title: { size: 28, weight: '900', letterSpacing: -0.8 },
    banner: { size: 12, weight: '500' },
    reset: { size: 11, weight: '700', letterSpacing: 0.6 },
    error: { size: 12, weight: '600' },
  },
  space: {
    screenTop: 48,
    eyebrowToTitle: 4,
    titleToSubtitle: 8,
    subtitleToBanner: 20,
    bannerToFirst: 24,
    sectionGap: 24,
    padX: 20,
    bannerPad: 14,
    bannerRadius: 10,
  },
};

// Vikter (samma som HemStar.js). I Hem-supabase används bara ×2 (click)
// eftersom vi inte har riktiga användarsignaler och read_more-affordance
// är borttagen (användarens begäran 2026-09-25).
const W_READ_MORE = 3;
const W_CLICK = 2;
const W_IMPRESSION = 1;

const SENASTE_LIMIT = 5;
const FORDIG_LIMIT = 10;
const IKVALL_HOUR = 18;
const UPPTACK_LIMIT = 5;
const IMAGE_REQUIRED_DEFAULT = require('../assets/tile-1.png');

// Swedish weekday short (lowercase).
const SWEDISH_WEEKDAY = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];

function pickTitle(event) {
  return event?.title_sv || event?.title_en || 'Evenemang';
}

// Pool-poster för Senaste: title, subtitle, imageUrl (krävs av
// EventPulseSenasteCard.sourceOf()).
function toSenasteCard(event) {
  return {
    id: event.id,
    title: pickTitle(event),
    subtitle: formatSenasteSubtitle(event),
    imageUrl: event.image_url || IMAGE_REQUIRED_DEFAULT,
  };
}

function toCarouselCard(event, subtitle) {
  return {
    id: event.id,
    title: pickTitle(event),
    subtitle,
    imageUrl: event.image_url || IMAGE_REQUIRED_DEFAULT,
  };
}

// Senaste-subtitle: "igår", "i förrgår", "i dag", "fre", "lör", etc.
// Poolen spänner -7d → +14d så vi visar relativ position om nära, annars
// veckodag + datum.
function formatSenasteSubtitle(event) {
  const t = new Date(event.start_time);
  if (Number.isNaN(t.getTime())) return '';

  const today = startOfDay(new Date());
  const eventDay = startOfDay(t);
  const diffDays = Math.round((eventDay.getTime() - today.getTime()) / 86400000);

  if (diffDays === 0) return 'i dag';
  if (diffDays === 1) return 'i morgon';
  if (diffDays === -1) return 'igår';
  if (diffDays === -2) return 'i förrgår';

  return `${SWEDISH_WEEKDAY[t.getDay()]} ${t.getDate()}/${t.getMonth() + 1}`;
}

function formatIkvallSubtitle(event) {
  const t = new Date(event.start_time);
  if (Number.isNaN(t.getTime())) return 'Ikväll';
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  return `Ikväll ${hh}:${mm}`;
}

function formatHelgenSubtitle(event) {
  const t = new Date(event.start_time);
  if (Number.isNaN(t.getTime())) return 'Helgen';
  const wd = SWEDISH_WEEKDAY[t.getDay()];
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  return `${wd} ${hh}:${mm}`;
}

// För dig-subtitle: venue-fält finns inte i events_public (anon-viewn
// projicerar inte venue-info), så vi använder category_slug som proxy.
// Fallback till "rekommenderad" om category_slug saknas.
function formatFordigSubtitle(event) {
  if (event.category_slug) return event.category_slug;
  if (event.is_free) return 'Gratis';
  return 'Rekommenderad';
}

// Upptäck har fast subtitle (K3-reserv — opåverkad av smakboost).
const UPPTACK_SUBTITLE = 'Bortom din bubbla';

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

function signalCountFor(signals, id) {
  const s = signals[id];
  if (!s) return 0;
  return (s.readMoreClicks || 0) + (s.clicks || 0) + (s.impressions || 0);
}

function HemSupabase() {
  const [signals, setSignals] = useState({});
  const [fordig, setFordig] = useState({ status: 'loading', data: [], error: null });
  const [senastePool, setSenastePool] = useState({ status: 'loading', data: [], error: null });
  const [ikvall, setIkvall] = useState({ status: 'loading', data: [], error: null });
  const [helgen, setHelgen] = useState({ status: 'loading', data: [], error: null });
  const [upptack, setUpptack] = useState({ status: 'loading', data: [], error: null });

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
        if (!cancelled) setFordig({ status: 'error', data: [], error: e?.message || 'okänt fel' });
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
        if (!cancelled) setSenastePool({ status: 'error', data: [], error: e?.message || 'okänt fel' });
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
            const t = new Date(e.start_time);
            return !Number.isNaN(t.getTime()) && t.getHours() >= IKVALL_HOUR;
          });
          setIkvall({ status: 'ready', data: filtered, error: null });
        }
      } catch (e) {
        if (!cancelled) setIkvall({ status: 'error', data: [], error: e?.message || 'okänt fel' });
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
        if (!cancelled) setHelgen({ status: 'error', data: [], error: e?.message || 'okänt fel' });
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
        if (!cancelled) setUpptack({ status: 'error', data: [], error: e?.message || 'okänt fel' });
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  // Senaste-rail: rangordna pool efter signal-score, ta topp 5.
  // Kallstart (alla scores = 0) ⇒ ursprunglig ordning (nyaste först).
  const senaste = useMemo(() => {
    if (senastePool.status !== 'ready') return [];
    const ranked = senastePool.data
      .map((event) => ({ ...event, _score: scoreFor(signals[event.id]) }))
      .sort((a, b) => b._score - a._score);
    return ranked.slice(0, SENASTE_LIMIT).map(toSenasteCard);
  }, [senastePool, signals]);

  const totalSignals = useMemo(
    () => Object.values(signals).reduce((acc, s) => acc + signalCountFor(s), 0),
    [signals],
  );

  // Card-press = sandbox-placeholder. Logga event-id + titel för att
  // visa att hookarna fungerar; ingen navigering (06-UI/Hem* kommer
  // ta över detta i Fas B).
  const handleCardPress = (event) => () => {
    setSignals((prev) => ({
      ...prev,
      [event.id]: {
        ...(prev[event.id] || {}),
        clicks: (prev[event.id]?.clicks || 0) + 1,
      },
    }));
    // eslint-disable-next-line no-console
    console.log('[Hem-supabase] card press:', { id: event.id, title: event.title });
  };

  const handleResetSignals = () => setSignals({});

  // Inject onPress per kort (samma wrapper som HemStar.js).
  const senasteWithHandlers = senaste.map((card) => ({
    ...card,
    onPress: () => handleCardPress({ id: card.id, title: card.title })(),
  }));

  const fordigCards = fordig.status === 'ready'
    ? fordig.data.map((e) => ({ ...toCarouselCard(e, formatFordigSubtitle(e)), onPress: handleCardPress({ id: e.id, title: pickTitle(e) }) }))
    : [];
  const ikvallCards = ikvall.status === 'ready'
    ? ikvall.data.map((e) => ({ ...toCarouselCard(e, formatIkvallSubtitle(e)), onPress: handleCardPress({ id: e.id, title: pickTitle(e) }) }))
    : [];
  const helgenCards = helgen.status === 'ready'
    ? helgen.data.map((e) => ({ ...toCarouselCard(e, formatHelgenSubtitle(e)), onPress: handleCardPress({ id: e.id, title: pickTitle(e) }) }))
    : [];
  const upptackCards = upptack.status === 'ready'
    ? upptack.data.map((e) => ({ ...toCarouselCard(e, UPPTACK_SUBTITLE), onPress: handleCardPress({ id: e.id, title: pickTitle(e) }) }))
    : [];

  // Aggregera felmeddelanden så dev-banner kan sammanfatta.
  const errorMessages = [fordig, senastePool, ikvall, helgen, upptack]
    .filter((s) => s.status === 'error')
    .map((s) => s.error);

  return (
    <View style={styles.scroll} testID="hem-supabase-screen">
      <Text style={styles.eyebrow}>PERSONLIG HEMSEKTION</Text>
      <Text style={styles.title}>Hem-supabase</Text>
      <Text style={styles.subtitle}>
        Riktig Supabase-data från events_public. Sektionerna i ordning
        {' '}För dig → Senaste → Ikväll → Helgen → Upptäck
        {' '}(användarens val 2026-09-25, n={totalSignals} signaler just nu).
      </Text>

      <View style={styles.devBanner} accessibilityRole="text" testID="hem-supabase-banner">
        <Text style={styles.devBannerText}>
          SANDBOX-PREVIEW (riktig data). Klicka Senaste-kort för att se
          rangordningen förändras. Minne nollställs vid omladdning.
          {' '}↻ återställer direkt.
        </Text>
      </View>

      {errorMessages.length > 0 ? (
        <View style={styles.errorBanner} accessibilityRole="text" testID="hem-supabase-errors">
          <Text style={styles.errorTitle}>Supabase-fel ({errorMessages.length})</Text>
          {errorMessages.map((msg, i) => (
            <Text key={i} style={styles.errorLine} numberOfLines={3}>
              • {msg}
            </Text>
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={handleResetSignals}
        accessibilityRole="button"
        accessibilityLabel="Återställ signaler"
        style={({ pressed }) => [styles.resetButton, pressed && styles.resetButtonPressed]}
      >
        <Text style={styles.resetText}>↻ Återställ signaler ({totalSignals} st)</Text>
      </Pressable>

      {/* Sektioner i ordning enligt användarens val 2026-09-25 — Jevs
          memory_first (Senaste först) överskriven. Först = personlig
          rekommendation, sedan Senaste (memory), sedan Ikväll/Helgen,
          sist K3-reserv. */}
      <EventPulseCarousel
        headerText="För dig"
        cards={fordigCards}
        loading={fordig.status === 'loading'}
      />

      <EventPulseSenaste
        headerText="Senaste"
        cards={senasteWithHandlers}
        loading={senastePool.status === 'loading'}
      />

      <EventPulseCarousel
        headerText="Ikväll"
        cards={ikvallCards}
        loading={ikvall.status === 'loading'}
      />

      <EventPulseCarousel
        headerText="Helgen"
        cards={helgenCards}
        loading={helgen.status === 'loading'}
      />

      <EventPulseCarousel
        headerText="Upptäck"
        cards={upptackCards}
        loading={upptack.status === 'loading'}
      />
    </View>
  );
}

// Exportera helpers för test/QA-hookning.
HemSupabase.__scoreFor = scoreFor;
HemSupabase.__formatSenasteSubtitle = formatSenasteSubtitle;
HemSupabase.__formatIkvallSubtitle = formatIkvallSubtitle;
HemSupabase.__formatHelgenSubtitle = formatHelgenSubtitle;
HemSupabase.__upcomingWeekend = upcomingWeekend;
HemSupabase.__W_READ_MORE = W_READ_MORE;
HemSupabase.__W_CLICK = W_CLICK;
HemSupabase.__W_IMPRESSION = W_IMPRESSION;

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
    borderRadius: TOKENS.space.bannerRadius,
    padding: TOKENS.space.bannerPad,
    marginBottom: 16,
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
    borderRadius: TOKENS.space.bannerRadius,
    padding: TOKENS.space.bannerPad,
    marginBottom: 16,
  },
  errorTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.banner.size,
    fontWeight: '800',
    marginBottom: 6,
  },
  errorLine: {
    color: TOKENS.color.text,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 15,
  },
  resetButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: TOKENS.space.bannerToFirst,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: TOKENS.color.divider,
  },
  resetButtonPressed: {
    opacity: 0.6,
  },
  resetText: {
    color: TOKENS.color.reset,
    fontSize: TOKENS.font.reset.size,
    fontWeight: TOKENS.font.reset.weight,
    letterSpacing: TOKENS.font.reset.letterSpacing,
  },
});

export default HemSupabase;
