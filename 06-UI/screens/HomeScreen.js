/**
 * HomeScreen — personalized landing surface (#72).
 *
 * Sections (in priority order, top-to-bottom):
 *   0. Din helg — fixed weekly ritual (2026-09-20): top 3–5 of
 *      /agent/recommended filtered to the upcoming Fri–Sun; hides the old
 *      Helgen section while it has cards.
 *   1. Header   — time-aware greeting + subtitle
 *   2. Ikväll   — events tonight (today, start_time_local >= 18:00)
 *   3. Helgen   — this weekend (Sat-Sun); fallback for Din helg
 *   4. Gratis   — free events in the next 7 days
 *   5. Rekommenderat — server-side AI-ranked via fetchRecommendedEvents (T0056);
 *      ranker blends followed venues/artists, stated preferences, and save/reject
 *      priors from record_feedback (rank_events.ts MIN_SAVES / MIN_WEIGHTED_REJECTS).
 *
 * Data flow:
 *   - Each section calls fetchFeed() from services/agentClient (already used
 *     by App.js for the default browse view, so we share the wire contract).
 *   - Client-side filters where the agent API doesn't expose the dimension
 *     (time-of-day, is_free) — keeps the agent API surface unchanged.
 *   - Saved section reads GET /agent/saved (saves via POST /agent/feedback
 *     land there for the current identity — anonymous sessions included).
 *   - Card taps forward to AppShell → explore tab's DetailsScreen (Spara,
 *     Kalender, Dela) via the PENDING_EVENT_KEY hand-off (App.js pattern).
 *
 * Empty state: each section renders its own "— inga evenemang —" line so the
 * user always sees that the section is wired up, not broken.
 *
 * UI design per docs/UI-DESIGN.md:
 *   - pure-black canvas (#000000)
 *   - transparent card surfaces
 *   - accent yellow (#FFB454) for section eyebrows
 *   - inline time / venue / price metadata (no separate "details" screen yet)
 *
 * Caching: in-memory only this session. Section data is refetched on focus;
 * pull-to-refresh is not exposed yet (kept simple until validated).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Image,
} from 'react-native';

import { fetchFeed, fetchSavedEvents, fetchRecommendedEvents, fetchSuggestedPrompts, fetchCachedRecommendations, fetchRecentQueries, fetchCuratedCollections, fetchAiImageSmoketest } from '../services/agentClient';
import { resolveConsumerReasons } from '../utils/rankReasonLabels';
import { compareDayTimeAsc, upcomingWeekendIsoSet } from './home/weekendDates';
import { dayTimeLabel } from './home/cardTimeLabel';
import { pickHappeningNow, happeningTitleParts } from './home/happeningNow';
import { dateNamesFor } from '../i18n/dateNames';
import { useI18n } from '../i18n';

const TOKENS = {
  color: {
    appBg: '#000000',
    surface: '#15151B', // session-raised, used sparingly
    border: '#1A1A1A',
    text: '#F7F2EA',
    textMuted: '#A9B0BE',
    textSoft: '#727B8D',
    accent: '#FFB454',
    accentSoft: '#3B2E1E',
    positive: '#7FD9A4',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  fontSize: { sm: 11, md: 13, lg: 16, xl: 22, xxl: 28 },
  radius: { md: 12, lg: 18 },
};

const SECTION_LIMIT = 12;

// ─── Time helpers (local-time aware) ─────────────────────────────────────────

function todayLocalIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nextSaturdayIso() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun, 6=Sat
  if (day === 0) {
    // Sunday → this week's Saturday (yesterday), not next week.
    d.setDate(d.getDate() - 1);
  } else if (day !== 6) {
    d.setDate(d.getDate() + (6 - day));
  }
  // Saturday: keep today so Helgen shows this weekend.
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}


function localHourFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getHours();
}

function greeting(t) {
  const h = new Date().getHours();
  if (h < 5) return t('home.greeting.night');
  if (h < 11) return t('home.greeting.morning');
  if (h < 18) return t('home.greeting.afternoon');
  return t('home.greeting.evening');
}

function subtitleForHour(h, t) {
  if (h < 5) return t('home.subtitle.night');
  if (h < 11) return t('home.subtitle.morning');
  if (h < 18) return t('home.subtitle.afternoon');
  return t('home.subtitle.evening');
}

// ─── Section data hook ───────────────────────────────────────────────────────

/**
 * Fetches a window via /agent/feed and applies a client-side filter.
 *
 * @param {{ from: string, days: number, filter?: (e: any) => boolean }} opts
 */
function useSection({ from, days, filter }) {
  const [state, setState] = useState({ status: 'loading', events: [], error: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', events: [], error: null });
    try {
      const result = await fetchFeed({ from, days });
      const events = filter ? result.events.filter(filter).slice(0, SECTION_LIMIT) : result.events.slice(0, SECTION_LIMIT);
      setState({ status: 'ready', events, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', events: [], error: msg });
    }
  }, [from, days, filter]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, retry: load };
}

// ─── Card components ─────────────────────────────────────────────────────────

function CardImage({ uri, imageLicense, imageAttribution, imageGenerationStatus }) {
  if (!uri) {
    // BFL har slut på credits — workern markerade eventet med
    // image_generation_status='no_credits'. Visa tydlig text i stället för
    // en generisk placeholder så användaren förstår att det inte är ett
    // vanligt "saknar bild"-fall utan ett externt beroende som behöver
    // laddas. (User request 2026-08-25.)
    if (imageGenerationStatus === 'no_credits') {
      return (
        <View style={styles.cardImageFallback}>
          <Text style={styles.cardImageNoCreditsText}>no credits BFL - recharge</Text>
        </View>
      );
    }
    return <View style={styles.cardImageFallback}><Text style={styles.cardImageFallbackText}>—</Text></View>;
  }
  // T0052 — show attribution overlay only when license actually requires it.
  // 'pressbild' / 'cc0' / null / 'unknown' → suppress badge (no attribution needed or unclassified).
  const showBadge = imageLicense === 'cc-by' || imageLicense === 'copyright-with-attribution';
  const badgeText = imageAttribution || (imageLicense === 'cc-by' ? 'CC BY' : 'Photo');
  return (
    <View style={styles.cardImageWrap}>
      <Image
        source={{ uri }}
        style={styles.cardImage}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
      {showBadge ? (
        <View style={styles.imageAttribution}>
          <Text style={styles.imageAttributionText} numberOfLines={1}>
            {badgeText}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function AvailabilityChip({ event }) {
  const { t } = useI18n();
  const badge = event.availability_badge;
  if (!badge) return null;
  if (badge === 'sold_out') {
    return <Text style={[styles.cardChip, styles.cardChipSoldOut]}>{t('home.soldOut')}</Text>;
  }
  if (badge === 'few_left') {
    return <Text style={[styles.cardChip, styles.cardChipFewLeft]}>{t('home.fewLeft')}</Text>;
  }
  return null;
}

function PriceChip({ event }) {
  const { t } = useI18n();
  if (event.is_free || event.isFree) {
    return <Text style={[styles.cardChip, styles.cardChipFree]}>{t('common.free')}</Text>;
  }
  const min = event.price_min_sek ?? event.priceMin;
  if (min != null) {
    return <Text style={styles.cardChip}>{t('common.priceFrom', { min })}</Text>;
  }
  return null;
}

function EventCardCompact({ event, onPress, showDay = false }) {
  const { t, language } = useI18n();
  const time = event.time || '';
  // showDay sections (2026-09-21 — weekend + GRATIS + För dig on Hem): the
  // time line reads "17:30 • LÖR" so the day travels with every card. The
  // helper also returns a screen-reader variant with the full day name.
  const dayInfo = showDay ? dayTimeLabel(event, language) : null;
  const timeText = dayInfo ? dayInfo.display : time;
  const spokenWhen = dayInfo ? dayInfo.spoken : time;
  // RQ5 (2026-09-20): always-visible "why" chips. Consumer variant filters
  // ops signals ("Gammal data", låg konfidens …) — those never belong on a
  // browsing card (2026-09-21 user feedback). Unknown enums are dropped by
  // the resolver; endpoints without reasons render an empty list.
  const reasons = useMemo(
    () => resolveConsumerReasons(event.reasons, language).slice(0, 2),
    [event.reasons, language],
  );
  const venue = event.venue_name || event.venue || t('common.venueMissing');
  // sv-cardA11y '{title}{when} på {venue}': `when` carries its own leading
  // space so an absent time leaves no double space. Uses the spoken variant
  // so day cards read "…lördag 17:30" instead of the bullet glyph.
  const when = spokenWhen ? ` ${t('common.atTime', { time: spokenWhen })}` : '';
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => onPress?.(event)}
      accessibilityRole="button"
      accessibilityLabel={t('home.cardA11y', { title: event.title, when, venue })}
    >
      <CardImage
        uri={event.image_url || event.imageUrl}
        imageLicense={event.image_license}
        imageAttribution={event.image_attribution}
        imageGenerationStatus={event.image_generation_status}
      />
      <View style={styles.cardBody}>
        <Text style={styles.cardTime}>{timeText || '—'}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{event.title}</Text>
        <Text style={styles.cardVenue} numberOfLines={1}>{venue}</Text>
        <View style={styles.cardChipRow}>
          <AvailabilityChip event={event} />
          <PriceChip event={event} />
          {event.category_slug ? (
            <Text style={[styles.cardChip, styles.cardChipCategory]}>{event.category_slug}</Text>
          ) : null}
        </View>
        {reasons.length > 0 ? (
          <View style={styles.cardReasonRow}>
            {reasons.map((r) => (
              <Text key={r.key} style={styles.cardReasonChip} numberOfLines={1}>
                {r.icon} {r.label}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function EmptyRow() {
  const { t } = useI18n();
  return (
    <View style={styles.emptyRow}>
      <Text style={styles.emptyRowText}>{t('home.empty')}</Text>
    </View>
  );
}

function SectionHeader({ eyebrow, title }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function Section({ eyebrow, title, children }) {
  return (
    <View style={styles.section}>
      <SectionHeader eyebrow={eyebrow} title={title} />
      {children}
    </View>
  );
}

// ─── Händer just nu (user rules 2026-09-20) ─────────────────────────────────
//
// Personalized strip over /agent/recommended — the "handplockade" events:
//   - Today: show events that have not happened yet by clock time
//     (started-but-not-ended counts as not happened). An event disappears
//     3 hours after it ENDED; missing end_time falls back to start time.
//     Overnight events (22:00–02:00) roll the end into the next day.
//   - If nothing remains today, surface the next day that HAS hand-picked
//     events — the title becomes "Imorgon" or the localized weekday
//     ("Onsdag 23 sep") so the section never just goes quiet.
//   - Nothing at all (or load error) → hide the section.
//
// All picking rules live in screens/home/happeningNow.js (pure module,
// vitest-pinned in happeningNow.test.ts). This component only does IO.

const HAPPENING_NOW_FETCH_LIMIT = 20; // server caps at 20; picking is client-side

function useHappeningNow() {
  const [state, setState] = useState({ status: 'loading', events: [], error: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', events: [], error: null });
    try {
      const result = await fetchRecommendedEvents({ limit: HAPPENING_NOW_FETCH_LIMIT });
      setState({ status: 'ready', events: result.events ?? [], error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', events: [], error: msg });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, retry: load };
}

function HappeningNowSection({ onCardPress }) {
  const { t, language } = useI18n();
  const { status, events } = useHappeningNow();

  // Ready-only pick: clock rules are evaluated against "now" at the moment
  // the data lands (pure functions — exact behaviour pinned by tests).
  const pick = useMemo(
    () => (status === 'ready' ? pickHappeningNow(events) : null),
    [status, events],
  );

  if (!pick || pick.kind === 'empty' || pick.events.length === 0) return null;

  const parts = happeningTitleParts(pick);
  let eyebrow = t('home.live.eyebrow'); // "PÅGÅR NU"
  let title = t('home.live.title');     // "Händer just nu"
  if (parts.type === 'tomorrow') {
    // Section name moves up to the eyebrow slot; the day takes the title.
    eyebrow = title.toUpperCase();
    title = t('common.tomorrow');
  } else if (parts.type === 'weekday') {
    const names = dateNamesFor(language);
    eyebrow = title.toUpperCase();
    title = `${names.daysFull[parts.dayIndex]} ${parts.dayOfMonth} ${names.monthsShort[parts.monthIndex]}`;
  }

  return (
    <Section eyebrow={eyebrow} title={title}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardScroll}>
        {pick.events.map((ev) => (
          <EventCardCompact key={ev.id} event={ev} onPress={onCardPress} />
        ))}
      </ScrollView>
    </Section>
  );
}

// ─── Section bodies ──────────────────────────────────────────────────────────

function TonightSection({ onCardPress }) {
  const { t } = useI18n();
  const from = useMemo(() => todayLocalIso(), []);
  // T0088 — filter must be stable across renders. An inline arrow gives
  // useSection's useCallback a new dep each render → new `load` ref →
  // useEffect([load]) re-fires → setState → re-render → new filter → loop.
  // React guards against this with "Maximum update depth exceeded".
  const tonightFilter = useCallback((e) => {
    const h = localHourFromIso(e.start_time);
    return h != null && h >= 18;
  }, []);
  const { status, events, error, retry } = useSection({
    from,
    days: 1,
    filter: tonightFilter,
  });
  return (
    <Section eyebrow={t('home.tonight.eyebrow')} title={t('home.tonight.title')}>
      {status === 'loading' && (
        <View style={styles.loadingRow}><ActivityIndicator color={TOKENS.color.accent} /></View>
      )}
      {status === 'error' && (
        <View style={styles.emptyRow}>
          <Text style={styles.errorText}>{t('common.loadError', { error })}</Text>
          <Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>{t('common.retry')}</Text></Pressable>
        </View>
      )}
      {status === 'ready' && events.length === 0 && <EmptyRow />}
      {status === 'ready' && events.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardScroll}>
          {events.map((ev) => (
            <EventCardCompact key={ev.id} event={ev} onPress={onCardPress} />
          ))}
        </ScrollView>
      )}
    </Section>
  );
}

// ─── AI image smoketest section (Step A, T-AI-IMG) ─────────────────────────
//
// Renders up to 10 events whose images have been AI-generated by
// 08-Agent's gpt-image-1 smoketest pipeline. Each card is identical to
// the regular Tonight/Weekend cards except:
//   - the image URL is the AI-generated static asset
//   - an "AI-genererad" chip is rendered below the venue
//
// The section hides itself silently when:
//   - the agent's smoketest flag is off (returns 404 → empty events)
//   - the batch hasn't run yet (0 entries in index.json)
//   - the request fails for any reason (network, 5xx, parse)
//
// This is a Step A smoketest — once the user signs off, the section
// either graduates to the default image source or gets removed in Step B.

function useAiImageSmoketestEvents() {
  const [state, setState] = useState({
    status: 'loading',
    events: [],
    error: null,
  });

  const load = useCallback(async () => {
    setState({ status: 'loading', events: [], error: null });
    try {
      const result = await fetchAiImageSmoketest({ limit: 10 });
      const events = Array.isArray(result?.events) ? result.events : [];
      setState({
        status: 'ready',
        events,
        error: null,
      });
    } catch (err) {
      const msg = err && typeof err.message === 'string' ? err.message : 'unknown';
      setState({ status: 'error', events: [], error: msg });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, retry: load };
}

function AiImageSmoketestSection({ onCardPress }) {
  const { t } = useI18n();
  const { status, events, error, retry } = useAiImageSmoketestEvents();

  // Silent fallback when the agent smoketest is disabled or empty —
  // matches the HappeningNowSection hide-when-empty pattern. Step A
  // never surfaces a visible "smoketest disabled" badge to the user.
  if (status === 'ready' && events.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEyebrow}>{t('home.ai.eyebrow')}</Text>
        <Text style={styles.sectionTitle}>{t('home.ai.title')}</Text>
      </View>
      {status === 'loading' && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={TOKENS.color.accent} />
        </View>
      )}
      {status === 'error' && (
        <View style={styles.emptyRow}>
          <Text style={styles.errorText}>{t('home.ai.loadError', { error })}</Text>
          <Pressable onPress={retry} style={styles.retryButton}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      )}
      {status === 'ready' && events.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cardScroll}
        >
          {events.map((ev) => (
            <Pressable
              key={ev.id}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => onCardPress?.(ev)}
              accessibilityRole="button"
              accessibilityLabel={t('home.ai.cardA11y', { title: ev.title })}
            >
              <CardImage
                uri={ev.image_url || ev.imageUrl}
                imageGenerationStatus={ev.image_generation_status}
              />
              <View style={styles.cardBody}>
                <Text style={styles.cardTime}>{ev.time || '—'}</Text>
                <Text style={styles.cardTitle} numberOfLines={2}>{ev.title}</Text>
                <Text style={styles.cardVenue} numberOfLines={1}>
                  {ev.venue_name || ev.venue || t('common.venueMissing')}
                </Text>
                <View style={styles.cardChipRow}>
                  <Text style={styles.aiSmoketestChip}>{t('home.ai.chip')}</Text>
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Din helg (fixed weekly ritual, 2026-09-20) ─────────────────────────────
//
// Outcome-first top section: 3–5 cards picked for the upcoming weekend from
// /agent/recommended — the server ranking decides WHICH events qualify, we
// filter on the Fri–Sun date set (client-side filter, no server route in v1)
// and display them chronologically (Fre → Lör → Sön, user request
// 2026-09-21, so the per-card day label reads in order).
// When the section has hits the old Helgen section is hidden (see HomeScreen);
// on loading/error/empty it renders nothing and Helgen stays as fallback.

const DIN_HELG_LIMIT = 5;
// Fetch wider than the display slice — the weekend filter drops most rows.
// The server caps the limit at 20.
const DIN_HELG_FETCH_LIMIT = 20;

function useDinHelgSection() {
  const [state, setState] = useState({ status: 'loading', events: [], error: null });
  const weekendDates = useMemo(() => upcomingWeekendIsoSet(), []);

  const load = useCallback(async () => {
    setState((s) => ({ status: 'loading', events: s.events, error: null }));
    try {
      const result = await fetchRecommendedEvents({ limit: DIN_HELG_FETCH_LIMIT });
      const events = (result.events ?? [])
        .filter((e) => e.date && weekendDates.has(e.date))
        .sort(compareDayTimeAsc) // Fre → Lör → Sön before the display slice
        .slice(0, DIN_HELG_LIMIT);
      setState({ status: 'ready', events, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', events: [], error: msg });
    }
  }, [weekendDates]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, retry: load };
}

function DinHelgSection({ onCardPress, onResolved }) {
  const { t } = useI18n();
  const { status, events } = useDinHelgSection();
  const hasHits = status === 'ready' && events.length > 0;

  // Report hit status up — HomeScreen hides the old Helgen section while we
  // have cards and restores it as soon as we don't (spec 2026-09-20).
  useEffect(() => {
    if (typeof onResolved === 'function') onResolved(hasHits);
  }, [hasHits, onResolved]);

  if (!hasHits) return null;
  return (
    <Section eyebrow={t('home.dinHelg.eyebrow')} title={t('home.dinHelg.title')}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardScroll}>
        {events.map((ev) => (
          <EventCardCompact key={ev.id} event={ev} onPress={onCardPress} showDay />
        ))}
      </ScrollView>
    </Section>
  );
}

function WeekendSection({ onCardPress }) {
  const { t } = useI18n();
  const from = useMemo(() => nextSaturdayIso(), []);
  const { status, events, error, retry } = useSection({ from, days: 2 });
  // Chronological Lör → Sön (user request 2026-09-21) — feed order is not
  // guaranteed across the ascending pages.
  const sortedEvents = useMemo(() => [...events].sort(compareDayTimeAsc), [events]);
  return (
    <Section eyebrow={t('home.weekend.eyebrow')} title={t('home.weekend.title')}>
      {status === 'loading' && (
        <View style={styles.loadingRow}><ActivityIndicator color={TOKENS.color.accent} /></View>
      )}
      {status === 'error' && (
        <View style={styles.emptyRow}>
          <Text style={styles.errorText}>{t('common.loadError', { error })}</Text>
          <Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>{t('common.retry')}</Text></Pressable>
        </View>
      )}
      {status === 'ready' && events.length === 0 && <EmptyRow />}
      {status === 'ready' && events.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardScroll}>
          {sortedEvents.map((ev) => (
            <EventCardCompact key={ev.id} event={ev} onPress={onCardPress} showDay />
          ))}
        </ScrollView>
      )}
    </Section>
  );
}

function FreeSection({ onCardPress }) {
  const { t } = useI18n();
  const from = useMemo(() => todayLocalIso(), []);
  // T0088 — see TonightSection. Inline filter → infinite update loop.
  const freeFilter = useCallback((e) => e.is_free || e.isFree, []);
  const { status, events, error, retry } = useSection({
    from,
    days: 7,
    filter: freeFilter,
  });
  return (
    <Section eyebrow={t('home.free.eyebrow')} title={t('home.free.title')}>
      {status === 'loading' && (
        <View style={styles.loadingRow}><ActivityIndicator color={TOKENS.color.accent} /></View>
      )}
      {status === 'error' && (
        <View style={styles.emptyRow}>
          <Text style={styles.errorText}>{t('common.loadError', { error })}</Text>
          <Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>{t('common.retry')}</Text></Pressable>
        </View>
      )}
      {status === 'ready' && events.length === 0 && <EmptyRow />}
      {status === 'ready' && events.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardScroll}>
          {events.map((ev) => (
            <EventCardCompact key={ev.id} event={ev} onPress={onCardPress} showDay />
          ))}
        </ScrollView>
      )}
    </Section>
  );
}

// ─── Recommended section (T0056) ─────────────────────────────────────────────

function useRecommendedSection() {
  const [state, setState] = useState({ status: 'loading', events: [], error: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', events: [], error: null });
    try {
      const result = await fetchRecommendedEvents({ limit: SECTION_LIMIT });
      setState({ status: 'ready', events: result.events ?? [], error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', events: [], error: msg });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, retry: load };
}

function RecommendedSection({ onCardPress }) {
  const { t } = useI18n();
  const { status, events, error, retry } = useRecommendedSection();
  return (
    <Section eyebrow={t('home.recommended.eyebrow')} title={t('home.recommended.title')}>
      {status === 'loading' && (
        <View style={styles.loadingRow}><ActivityIndicator color={TOKENS.color.accent} /></View>
      )}
      {status === 'error' && (
        <View style={styles.emptyRow}>
          <Text style={styles.errorText}>{t('common.loadError', { error })}</Text>
          <Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>{t('common.retry')}</Text></Pressable>
        </View>
      )}
      {status === 'ready' && events.length === 0 && <EmptyRow />}
      {status === 'ready' && events.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardScroll}>
          {events.map((ev) => (
            <EventCardCompact key={ev.id} event={ev} onPress={onCardPress} showDay />
          ))}
        </ScrollView>
      )}
    </Section>
  );
}

// ─── Suggested prompts section (T0063 — T0057 backend wire) ──────────────────

const SUGGESTED_PROMPTS_LIMIT = 5;

function useSuggestedPrompts() {
  const [state, setState] = useState({ status: 'loading', prompts: [], error: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', prompts: [], error: null });
    try {
      const result = await fetchSuggestedPrompts({ limit: SUGGESTED_PROMPTS_LIMIT });
      setState({ status: 'ready', prompts: result.prompts ?? [], error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', prompts: [], error: msg });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, retry: load };
}

function ChipSkeleton({ label }) {
  return (
    <View style={styles.chipSkeleton} accessibilityLabel={label} />
  );
}

function PromptChip({ prompt, onPress }) {
  const { t } = useI18n();
  return (
    <Pressable
      style={({ pressed }) => [styles.promptChip, pressed && styles.promptChipPressed]}
      onPress={() => onPress?.(prompt)}
      accessibilityRole="button"
      accessibilityLabel={prompt.reason
        ? t('home.promptChipA11yReason', { text: prompt.prompt_text, reason: prompt.reason })
        : t('home.promptChipA11y', { text: prompt.prompt_text })}
    >
      <Text style={styles.promptChipText} numberOfLines={2}>{prompt.prompt_text}</Text>
      {prompt.reason ? (
        <Text style={styles.promptChipReason} numberOfLines={1}>{prompt.reason}</Text>
      ) : null}
    </Pressable>
  );
}

// ─── Curated collections (T0084 — hand-curated "Kuratorens val" lists) ───────

const CURATED_COLLECTIONS_LIMIT = 3;

function useCuratedCollections(locale) {
  const [state, setState] = useState({ status: 'loading', collections: [], error: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', collections: [], error: null });
    try {
      const result = await fetchCuratedCollections({ limit: CURATED_COLLECTIONS_LIMIT, locale });
      setState({
        status: 'ready',
        collections: Array.isArray(result.collections) ? result.collections : [],
        error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', collections: [], error: msg });
    }
  }, [locale]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, retry: load };
}

function CuratedChip({ collection, onPress }) {
  const { t } = useI18n();
  return (
    <Pressable
      style={({ pressed }) => [styles.curatedChip, pressed && styles.curatedChipPressed]}
      // Forward the FULL collection object — the structured intent fields
      // (category_slug / budget / day_filter / time_of_day) are what let
      // Utforska apply the filters this chip's name promises (2026-09-20).
      onPress={() => onPress?.({ ...collection, curated_id: collection.id })}
      accessibilityRole="button"
      accessibilityLabel={t('home.curatedChipA11y', { name: collection.name })}
    >
      <Text style={styles.curatedChipName} numberOfLines={1}>{collection.name}</Text>
      <Text style={styles.curatedChipReason} numberOfLines={2}>{collection.reason}</Text>
    </Pressable>
  );
}

function CuratedCollectionsSection({ onChipPress }) {
  const { t, language } = useI18n();
  // Server picks copy per locale (falls back to en for non-sv until the
  // collections themselves are translated — text selection lives in
  // 08-Agent/tools/curated_collections.ts).
  const { status, collections } = useCuratedCollections(language);
  // Hide the section entirely when the curator has nothing to suggest or the
  // fetch failed (T0084 spec — best-effort, never red).
  if (status === 'ready' && collections.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEyebrow}>{t('home.curated.eyebrow')}</Text>
        <Text style={styles.sectionTitle}>{t('home.curated.title')}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.curatedChipRow}
      >
        {status === 'loading'
          ? Array.from({ length: CURATED_COLLECTIONS_LIMIT }).map((_, i) => <ChipSkeleton key={`c-${i}`} label={t('home.loadingForYou')} />)
          : collections.map((c) => (
              <CuratedChip key={c.id} collection={c} onPress={onChipPress} />
            ))}
      </ScrollView>
    </View>
  );
}

function SuggestedPromptsSection({ onChipPress }) {
  const { t } = useI18n();
  const { status, prompts } = useSuggestedPrompts();
  // Hide section on error / empty (T0063 spec) — failure mode is "no chips" not "red error".
  const visiblePrompts = status === 'ready' ? prompts : [];
  if (status === 'ready' && visiblePrompts.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEyebrow}>{t('home.suggestions.eyebrow')}</Text>
        <Text style={styles.sectionTitle}>{t('home.suggestions.title')}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.promptChipRow}
      >
        {status === 'loading'
          ? Array.from({ length: SUGGESTED_PROMPTS_LIMIT }).map((_, i) => <ChipSkeleton key={`s-${i}`} label={t('home.loadingForYou')} />)
          : visiblePrompts.map((p) => (
              <PromptChip key={p.id} prompt={p} onPress={onChipPress} />
            ))}
      </ScrollView>
    </View>
  );
}

// ─── Recent searches section (T0071 — recent chat queries) ───────────────────

const RECENT_SEARCHES_LIMIT = 5;

function useRecentSearches() {
  const [state, setState] = useState({ status: 'loading', queries: [], error: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', queries: [], error: null });
    try {
      const result = await fetchRecentQueries({ limit: RECENT_SEARCHES_LIMIT });
      setState({ status: 'ready', queries: result.queries ?? [], error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', queries: [], error: msg });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, retry: load };
}

function RecentSearchChip({ query, onPress }) {
  const { t } = useI18n();
  return (
    <Pressable
      style={({ pressed }) => [styles.promptChip, pressed && styles.promptChipPressed]}
      onPress={() => onPress?.(query)}
      accessibilityRole="button"
      accessibilityLabel={t('home.recentChipA11y', { query: query.query_text })}
    >
      <Text style={styles.promptChipText} numberOfLines={2}>{query.query_text}</Text>
    </Pressable>
  );
}

function RecentSearchesSection({ onChipPress }) {
  const { t } = useI18n();
  const { status, queries } = useRecentSearches();
  // T0071 spec: hide the section entirely when there are no recent queries
  // (cold start / brand-new user). The error/loading path also collapses to
  // null so the home surface stays clean.
  const visibleQueries = status === 'ready' ? queries : [];
  if (status === 'ready' && visibleQueries.length === 0) return null;

  // Forward each recent query as a `{prompt_text}` object so AppShell's
  // existing PENDING_AGENT_MESSAGE_KEY handler (T0063) can reuse the
  // exact same chip-tap plumbing without any branching.
  const handleChipPress = (query) => {
    if (typeof onChipPress === 'function' && query && typeof query.query_text === 'string') {
      onChipPress({ prompt_text: query.query_text });
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEyebrow}>{t('home.recent.eyebrow')}</Text>
        <Text style={styles.sectionTitle}>{t('home.recent.title')}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.promptChipRow}
      >
        {status === 'loading'
          ? Array.from({ length: RECENT_SEARCHES_LIMIT }).map((_, i) => <ChipSkeleton key={`s-${i}`} />)
          : visibleQueries.map((q) => (
              <RecentSearchChip key={q.id} query={q} onPress={handleChipPress} />
            ))}
      </ScrollView>
    </View>
  );
}

// ─── Agent suggestions section (T0060) ───────────────────────────────────────

const AGENT_SUGGESTIONS_LIMIT = 3;

function useAgentSuggestions() {
  const [state, setState] = useState({ status: 'loading', slots: [], error: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', slots: [], error: null });
    try {
      const result = await fetchCachedRecommendations({ limit: AGENT_SUGGESTIONS_LIMIT });
      setState({ status: 'ready', slots: result.slots ?? [], error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', slots: [], error: msg });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, retry: load };
}

function IntentCardCompact({ event, onPress }) {
  const { t } = useI18n();
  const time = event.time || '';
  const venue = event.venue_name || event.venue || t('common.venueMissing');
  const when = time ? ` ${t('common.atTime', { time })}` : '';
  return (
    <Pressable
      style={({ pressed }) => [styles.intentCard, pressed && styles.cardPressed]}
      onPress={() => onPress?.(event)}
      accessibilityRole="button"
      accessibilityLabel={t('home.cardA11y', { title: event.title, when, venue })}
    >
      <Text style={styles.cardTime}>{time || '—'}</Text>
      <Text style={styles.intentCardTitle} numberOfLines={2}>{event.title}</Text>
      <Text style={styles.cardVenue} numberOfLines={1}>{venue}</Text>
    </Pressable>
  );
}

function IntentSlotSkeleton() {
  const { t } = useI18n();
  return (
    <View style={styles.intentSlot} accessibilityLabel={t('home.intentLoading')}>
      <View style={styles.intentSlotTitleSkeleton} />
      <View style={styles.intentCardRow}>
        <View style={styles.intentCardSkeleton} />
        <View style={styles.intentCardSkeleton} />
      </View>
    </View>
  );
}

function IntentSlotRow({ slot, onCardPress }) {
  const { t } = useI18n();
  return (
    <View style={styles.intentSlot}>
      <Text style={styles.intentSlotTitle} numberOfLines={1}>{slot.title}</Text>
      {slot.cards.length === 0 ? (
        <Text style={styles.intentSlotEmpty}>{t('home.intentEmpty')}</Text>
      ) : (
        <View style={styles.intentCardRow}>
          {slot.cards.slice(0, 2).map((ev) => (
            <IntentCardCompact key={ev.id} event={ev} onPress={onCardPress} />
          ))}
        </View>
      )}
    </View>
  );
}

function AgentSuggestionsSection({ onCardPress }) {
  const { t } = useI18n();
  const { status, slots } = useAgentSuggestions();
  // T0060 spec: hide section entirely if no cached data (new users, errors).
  // We render skeletons during loading to avoid layout shift, then drop to null
  // once we know the data is empty.
  if (status === 'ready' && slots.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEyebrow}>{t('home.agent.eyebrow')}</Text>
        <Text style={styles.sectionTitle}>{t('home.agent.title')}</Text>
      </View>
      <View style={styles.intentSlotList}>
        {status === 'loading'
          ? Array.from({ length: AGENT_SUGGESTIONS_LIMIT }).map((_, i) => <IntentSlotSkeleton key={`s-${i}`} />)
          : slots.map((slot, i) => (
              <IntentSlotRow key={`slot-${i}`} slot={slot} onCardPress={onCardPress} />
            ))}
      </View>
    </View>
  );
}

// ─── Saved section (T0054) ────────────────────────────────────────────────────

function useSavedSection() {
  const [state, setState] = useState({ status: 'loading', events: [], error: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', events: [], error: null });
    try {
      const result = await fetchSavedEvents({ limit: SECTION_LIMIT });
      setState({ status: 'ready', events: result.events ?? [], error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', events: [], error: msg });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, retry: load };
}

function SavedSection({ onCardPress }) {
  const { t } = useI18n();
  const { status, events, error, retry } = useSavedSection();
  return (
    <Section eyebrow={t('home.saved.eyebrow')} title={t('home.saved.title')}>
      {status === 'loading' && (
        <View style={styles.loadingRow}><ActivityIndicator color={TOKENS.color.accent} /></View>
      )}
      {status === 'error' && (
        <View style={styles.emptyRow}>
          <Text style={styles.errorText}>{t('common.loadError', { error })}</Text>
          <Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>{t('common.retry')}</Text></Pressable>
        </View>
      )}
      {status === 'ready' && events.length === 0 && (
        <View style={styles.emptyRow}>
          <Text style={styles.emptyRowText}>{t('home.savedEmpty')}</Text>
        </View>
      )}
      {status === 'ready' && events.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardScroll}>
          {events.map((ev) => (
            <EventCardCompact key={ev.id} event={ev} onPress={onCardPress} />
          ))}
        </ScrollView>
      )}
    </Section>
  );
}

// ─── Top-level screen ────────────────────────────────────────────────────────
//
// NOW#2: no guest-gating here anymore. AppShell's bootstrapSession()
// guarantees every user — including first-launch guests — carries an
// anonymous Supabase session, so the personalized sections (Senaste,
// Rekommenderat, Förslag, Sparade) work identically for guests and logged-in
// users. Sessions self-hide when their backend has nothing for this identity
// (RecentSearches/AgentSuggestions → null, Saved → "inga sparade ännu").

// ─── ExploreTilesSection (Spotify-smakprofiler, exploratory) ─────────────────
// 2×2 grid of "taste profile" tiles under "Din helg" (docs/EXPLORE-TILES.md).
// Left ~67% solid dark color + word in white (contrast well above 40%),
// right 33% a MiniMax-generated photo with a "/"-diagonal boundary. More
// margin against screen edges (20) than between tiles (6); width-driven
// (flex:1) so they never exceed screen width. Photos are data URLs from
// tiles.data.js (Metro's asset registry refused the PNGs). Gate behind
// EXPO_PUBLIC_EXPLORE_TILES (never in App Store).
//
// Tap wiring (2026-09-21): each tile forwards { prompt_text, ...hints } on
// the SAME wire as curated/suggested chips (AppShell.handleChipPress →
// PENDING_AGENT_MESSAGE_KEY → App.js resolvePromptIntent). The tile must do
// what its label promises: Gratis → budget 'free', Live → category music,
// Skratt → 'skratt' genre search rows (standup/komedi — never other genres),
// Stämningsfullt → banner-only until it gets an honest deterministic path.
function ExploreTilesSection({ onChipPress }) {
  // Hook first — the gate below must never condition hook ordering.
  const { t } = useI18n();
  if (!process.env.EXPO_PUBLIC_EXPLORE_TILES) return null;
  const { GRATIS, LIVE, SKRATT, STAMNING } = require('../assets/exploreTiles/tiles.data.js');
  // Solid colors are dark by design so white text keeps ≥40% contrast.
  // 4 distinct taste-profile colors: smaragd, lila, koppar, vinrött.
  // label = tile word, prompt = Utforska banner text, hints = structured
  // intent on the curated-chip wire (promptIntent.test.ts pins all four).
  const TILES = [
    { label: t('home.explore.gratis.label'), image: GRATIS, color: '#1E6B45', prompt: t('home.explore.gratis.prompt'), hints: { budget: 'free' } },
    { label: t('home.explore.live.label'), image: LIVE, color: '#3B1F66', prompt: t('home.explore.live.prompt'), hints: { category_slug: 'music' } },
    { label: t('home.explore.skratt.label'), image: SKRATT, color: '#6B4226', prompt: t('home.explore.skratt.prompt') },
    { label: t('home.explore.stamning.label'), image: STAMNING, color: '#5C1A2A', prompt: t('home.explore.stamning.prompt') },
  ];
  const rows = [TILES.slice(0, 2), TILES.slice(2, 4)];
  return (
    <View style={styles.exploreSection}>
      <Text style={styles.exploreSectionTitle}>{t('home.explore.title')}</Text>
      {rows.map((row, rowIndex) => (
        <View key={`explore-row-${rowIndex}`} style={styles.exploreRow}>
          {row.map((tile) => (
            <Pressable
              key={tile.label}
              onPress={() => onChipPress({ prompt_text: tile.prompt, ...(tile.hints || {}) })}
              style={({ pressed }) => [
                styles.exploreTile,
                { backgroundColor: tile.color },
                pressed && styles.exploreTilePressed,
              ]}
            >
              {tile.image ? (
                <>
                  <Image
                    source={{ uri: tile.image }}
                    style={styles.exploreTilePhoto}
                    resizeMode="cover"
                  />
                  <View
                    style={[styles.exploreTileDiagonal, { backgroundColor: tile.color }]}
                  />
                </>
              ) : null}
              <Text style={styles.exploreTileLabel}>{tile.label}</Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

export default function HomeScreen({ onChipPress, onCardPress }) {
  const { t } = useI18n();
  // Din helg (2026-09-20): true while the top section has weekend cards —
  // the old Helgen section stays hidden then and returns as fallback.
  const [dinHelgActive, setDinHelgActive] = useState(false);
  const handleCardPress = useCallback((event) => {
    // NOW#2 fix: forward to AppShell, which hands the event to the explore
    // tab's DetailsScreen (same surface as a Utforska card tap — with Spara,
    // Kalender, Dela). Previously a deliberate no-op; read as a dead card.
    if (typeof onCardPress === 'function') onCardPress(event);
  }, [onCardPress]);

  const handlePromptPress = useCallback((prompt) => {
    if (typeof onChipPress === 'function') onChipPress(prompt);
  }, [onChipPress]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.headerEyebrow}>{t('home.cityEyebrow')}</Text>
          <Text style={styles.headerTitle}>{greeting(t)}</Text>
          <Text style={styles.headerSubtitle}>
            {subtitleForHour(new Date().getHours(), t)}
          </Text>
        </View>

        <DinHelgSection onCardPress={handleCardPress} onResolved={setDinHelgActive} />
        <ExploreTilesSection onChipPress={handlePromptPress} />
        <SuggestedPromptsSection onChipPress={handlePromptPress} />
        <CuratedCollectionsSection onChipPress={handlePromptPress} />
        <RecentSearchesSection onChipPress={handlePromptPress} />
        <HappeningNowSection onCardPress={handleCardPress} />

        <AiImageSmoketestSection onCardPress={handleCardPress} />

        <TonightSection onCardPress={handleCardPress} />
        {dinHelgActive ? null : <WeekendSection onCardPress={handleCardPress} />}
        <FreeSection onCardPress={handleCardPress} />
        <RecommendedSection onCardPress={handleCardPress} />
        <AgentSuggestionsSection onCardPress={handleCardPress} />
        <SavedSection onCardPress={handleCardPress} />

        <View style={{ height: 96 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const CARD_WIDTH = 220;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TOKENS.color.appBg,
  },
  scrollContent: {
    paddingTop: TOKENS.space.lg,
  },

  // Header
  header: {
    paddingHorizontal: TOKENS.space.lg,
    paddingBottom: TOKENS.space.lg,
  },
  headerEyebrow: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: TOKENS.space.xs,
  },
  headerTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.xxl,
    fontWeight: '700',
    marginBottom: TOKENS.space.xs,
  },
  headerSubtitle: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.md,
    lineHeight: 20,
  },

  // Section
  section: {
    marginBottom: TOKENS.space.xl,
  },

  sectionHeader: {
    paddingHorizontal: TOKENS.space.lg,
    marginBottom: TOKENS.space.md,
  },
  sectionEyebrow: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 2,
  },
  sectionTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.xl,
    fontWeight: '600',
  },

  // Cards
  cardScroll: {
    paddingHorizontal: TOKENS.space.lg,
    gap: TOKENS.space.md,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: 'transparent',
    borderRadius: TOKENS.radius.md,
    overflow: 'hidden',
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardImage: {
    width: CARD_WIDTH,
    height: 130,
    // Match app canvas (#000) så att ingen grå "marginal" syns runt bilden
    // medan den laddas eller om resizeMode letterboxar i något edge-fall.
    backgroundColor: TOKENS.color.appBg,
  },
  cardImageFallback: {
    width: CARD_WIDTH,
    height: 130,
    backgroundColor: TOKENS.color.appBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // T0052 — wrapper so the attribution overlay can sit absolutely on top
  // of the image. The image retains its own width/height so layout is stable.
  cardImageWrap: {
    position: 'relative',
    width: CARD_WIDTH,
    height: 130,
  },
  imageAttribution: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    maxWidth: '70%',
  },
  imageAttributionText: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '500',
  },
  cardImageFallbackText: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.xl,
  },
  // Användaren bad 2026-08-25 om "no credits BFL - recharge"-text när
  // BFL-kredit är slut. Visas i samma fallback-yta som '—' men med
  // accent-färg och mindre font för att signalera "operatörsmeddelande".
  cardImageNoCreditsText: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: TOKENS.space.xs,
  },
  cardBody: {
    paddingTop: TOKENS.space.sm,
  },
  cardTime: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  cardTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 2,
  },
  cardVenue: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.sm,
    marginBottom: TOKENS.space.xs,
  },
  cardChipRow: {
    flexDirection: 'row',
    gap: TOKENS.space.xs,
  },
  cardChip: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '500',
    paddingHorizontal: TOKENS.space.sm,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    overflow: 'hidden',
  },
  // Always-visible "why" chips (RQ5) — accent-tinted, max 2 per card.
  cardReasonRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: TOKENS.space.xs,
    marginTop: TOKENS.space.xs,
  },
  cardReasonChip: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '600',
    paddingHorizontal: TOKENS.space.sm,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: TOKENS.color.accentSoft,
    overflow: 'hidden',
    flexShrink: 1,
  },
  cardChipFree: {
    color: TOKENS.color.positive,
    borderColor: TOKENS.color.positive,
  },
  cardChipSoldOut: {
    color: '#FF6B6B',
    borderColor: '#FF6B6B',
  },
  cardChipFewLeft: {
    color: '#FFB347',
    borderColor: '#FFB347',
  },
  cardChipCategory: {
    color: TOKENS.color.textMuted,
    borderColor: TOKENS.color.border,
  },

  // AI image smoketest chip (Step A) — EU AI Act §50 disclosure label
  // rendered alongside every AI-generated card so the user always sees
  // the image is synthetic. Color uses the muted surface palette so
  // it does not visually compete with the title.
  aiSmoketestChip: {
    color: TOKENS.color.accent,
    borderColor: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.xs,
    fontWeight: '700',
    paddingHorizontal: TOKENS.space.sm,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
  },

  // States
  loadingRow: {
    paddingHorizontal: TOKENS.space.lg,
    paddingVertical: TOKENS.space.lg,
  },
  emptyRow: {
    paddingHorizontal: TOKENS.space.lg,
    paddingVertical: TOKENS.space.lg,
  },
  emptyRowText: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.md,
  },
  errorText: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.sm,
    marginBottom: TOKENS.space.sm,
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: 6,
    borderRadius: TOKENS.radius.md,
    borderWidth: 1,
    borderColor: TOKENS.color.accent,
  },
  retryText: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '600',
  },

  // Recommended placeholder
  recommendedPlaceholder: {
    marginHorizontal: TOKENS.space.lg,
    padding: TOKENS.space.lg,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    borderRadius: TOKENS.radius.md,
    borderStyle: 'dashed',
  },
  recommendedEyebrow: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: TOKENS.space.sm,
  },
  recommendedBody: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.md,
    lineHeight: 22,
  },

  // Suggested prompts chips (T0063 — T0057 backend wire)
  promptChipRow: {
    paddingHorizontal: TOKENS.space.lg,
    gap: TOKENS.space.sm,
  },
  promptChip: {
    backgroundColor: TOKENS.color.surface,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    borderRadius: TOKENS.radius.lg,
    paddingVertical: TOKENS.space.md,
    paddingHorizontal: TOKENS.space.md,
    minWidth: 180,
    maxWidth: 260,
  },
  promptChipPressed: {
    opacity: 0.7,
    borderColor: TOKENS.color.accent,
  },
  promptChipText: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 2,
  },
  promptChipReason: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
  },
  chipSkeleton: {
    backgroundColor: TOKENS.color.surface,
    borderRadius: TOKENS.radius.lg,
    minWidth: 180,
    height: 60,
    opacity: 0.6,
  },

  // Curated collections (T0084)
  curatedChipRow: {
    paddingHorizontal: TOKENS.space.lg,
    gap: TOKENS.space.md,
  },
  curatedChip: {
    minWidth: 200,
    maxWidth: 240,
    backgroundColor: TOKENS.color.surface,
    borderRadius: TOKENS.radius.lg,
    paddingVertical: TOKENS.space.md,
    paddingHorizontal: TOKENS.space.md,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    borderLeftWidth: 3,
    borderLeftColor: TOKENS.color.accent,
  },
  curatedChipPressed: {
    opacity: 0.7,
  },
  curatedChipName: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '700',
    marginBottom: 4,
  },
  curatedChipReason: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
  },


  // Agent suggestions (T0060)
  intentSlotList: {
    paddingHorizontal: TOKENS.space.lg,
    gap: TOKENS.space.md,
  },
  intentSlot: {
    backgroundColor: TOKENS.color.surface,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    borderRadius: TOKENS.radius.md,
    paddingVertical: TOKENS.space.md,
    paddingHorizontal: TOKENS.space.md,
  },
  intentSlotTitle: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '700',
    marginBottom: TOKENS.space.sm,
  },
  intentSlotTitleSkeleton: {
    backgroundColor: TOKENS.color.border,
    borderRadius: 4,
    height: 14,
    width: '60%',
    marginBottom: TOKENS.space.sm,
    opacity: 0.6,
  },
  intentSlotEmpty: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
    fontStyle: 'italic',
    paddingVertical: TOKENS.space.xs,
  },
  intentCardRow: {
    flexDirection: 'row',
    gap: TOKENS.space.sm,
  },
  intentCard: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: TOKENS.radius.md,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    paddingVertical: TOKENS.space.sm,
    paddingHorizontal: TOKENS.space.sm,
  },
  intentCardTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 2,
  },
  intentCardSkeleton: {
    flex: 1,
    height: 60,
    backgroundColor: TOKENS.color.border,
    borderRadius: TOKENS.radius.md,
    opacity: 0.5,
  },

  // ExploreTilesSection — Spotify-genre-tiles, 2 bredvid varandra.
  // Mer marginal mot skärmkanterna (20) än mellan knapparna (6); svart
  // appBg syns runtom. Breddstyrd (flex:1 + aspectRatio 7/5): knapparna
  // kan aldrig gå ur skärmens bredd. Höger 33% = foto, vänster ~67% enfärg
  // med vit text (mörka färger → kontrasten håller väl över 40%-kravet).
  exploreSection: {
    paddingHorizontal: 20,
    marginBottom: TOKENS.space.xl,
  },
  exploreSectionTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.lg,
    fontWeight: '800',
    marginBottom: TOKENS.space.md,
  },
  exploreRow: {
    flexDirection: 'row',
    gap: 10, // mellan knapparna — ökat från 6 per användare 2026-09-21
    marginBottom: 10, // mellanrum mellan raderna i 2×2-gridden
  },
  exploreTile: {
    flex: 1,
    aspectRatio: 5 / 2, // 7:5 var för hög — 44% kortare per användare 2026-09-21
    borderRadius: TOKENS.radius.md,
    overflow: 'hidden',
  },
  exploreTilePressed: {
    opacity: 0.85,
  },
  exploreTilePhoto: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '40%', // bredare än synliga gränsen — diagonalmasken formar kanten
  },
  exploreTileDiagonal: {
    // Solid-färgsmask med "/"-diagonal högerkant (per användare 2026-09-21).
    // Samma färg som tile-bakgrunden — bara högerkanten syns och klipper
    // fotots vänsterkant diagonalt (nedre-vänster → övre-höger).
    // Roterad 14° medurs: gränsen går från ~62% (botten) till ~72% (topp).
    position: 'absolute',
    top: '-15%',   // sträcker sig utanför tile: rotation exponerar annars hörn
    bottom: '-15%',
    left: '53%',   // vänsterkanten försvinner in i den enfärgade bakgrunden
    width: '14%',  // högerkanten landar ~62–72% (diagonalen)
    transform: [{ rotate: '14deg' }], // "/" — samma riktning som tecknet
  },
  exploreTileLabel: {
    position: 'absolute',
    top: 14,
    left: 16,
    color: TOKENS.color.text,
    fontSize: 16.2, // 19.2/1.2 + 0.2 per användare 2026-09-21 — lg (16) + lite
    fontWeight: '800',
    letterSpacing: -0.4,
  },
});