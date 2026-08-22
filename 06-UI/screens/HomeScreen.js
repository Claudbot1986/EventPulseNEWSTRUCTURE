/**
 * HomeScreen — personalized landing surface (#72).
 *
 * Sections (in priority order, top-to-bottom):
 *   1. Header   — time-aware greeting + subtitle
 *   2. Ikväll   — events tonight (today, start_time_local >= 18:00)
 *   3. Helgen   — this weekend (Sat-Sun)
 *   4. Gratis   — free events in the next 7 days
 *   5. Rekommenderat — placeholder pending #73 (AI preference ranking)
 *
 * Data flow:
 *   - Each section calls fetchFeed() from services/agentClient (already used
 *     by App.js for the default browse view, so we share the wire contract).
 *   - Client-side filters where the agent API doesn't expose the dimension
 *     (time-of-day, is_free) — keeps the agent API surface unchanged.
 *   - Saved section is deferred (no GET /agent/saved endpoint yet; saves are
 *     stored via POST /agent/feedback). When a list-saves endpoint lands, it
 *     slots in here without touching other sections.
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
  Animated,
} from 'react-native';

import { fetchFeed, fetchSavedEvents, fetchRecommendedEvents, fetchSuggestedPrompts, fetchCachedRecommendations, fetchRecentQueries, fetchCuratedCollections, fetchLiveEvents } from '../services/agentClient';

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

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'God natt, Stockholm';
  if (h < 11) return 'God morgon, Stockholm';
  if (h < 18) return 'God eftermiddag, Stockholm';
  return 'God kväll, Stockholm';
}

function subtitleForHour(h) {
  if (h < 5) return 'Nu är det lugnt — kolla in helgens händelser.';
  if (h < 11) return 'Vad vill du göra i Stockholm idag?';
  if (h < 18) return 'Har du några planer för kvällen?';
  return 'Stockholm har massor på gång ikväll.';
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

function CardImage({ uri, imageLicense, imageAttribution }) {
  if (!uri) {
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
  const badge = event.availability_badge;
  if (!badge) return null;
  if (badge === 'sold_out') {
    return <Text style={[styles.cardChip, styles.cardChipSoldOut]}>Slutsåld</Text>;
  }
  if (badge === 'few_left') {
    return <Text style={[styles.cardChip, styles.cardChipFewLeft]}>Få kvar</Text>;
  }
  return null;
}

function PriceChip({ event }) {
  if (event.is_free || event.isFree) {
    return <Text style={[styles.cardChip, styles.cardChipFree]}>Gratis</Text>;
  }
  const min = event.price_min_sek ?? event.priceMin;
  if (min != null) {
    return <Text style={styles.cardChip}>{min} kr</Text>;
  }
  return null;
}

function EventCardCompact({ event, onPress }) {
  const time = event.time || '';
  const venue = event.venue_name || event.venue || 'Plats ej angiven';
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => onPress?.(event)}
      accessibilityRole="button"
      accessibilityLabel={`${event.title} ${time ? 'klockan ' + time : ''} på ${venue}`}
    >
      <CardImage
        uri={event.image_url || event.imageUrl}
        imageLicense={event.image_license}
        imageAttribution={event.image_attribution}
      />
      <View style={styles.cardBody}>
        <Text style={styles.cardTime}>{time || '—'}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{event.title}</Text>
        <Text style={styles.cardVenue} numberOfLines={1}>{venue}</Text>
        <View style={styles.cardChipRow}>
          <AvailabilityChip event={event} />
          <PriceChip event={event} />
          {event.category_slug ? (
            <Text style={[styles.cardChip, styles.cardChipCategory]}>{event.category_slug}</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function EmptyRow() {
  return (
    <View style={styles.emptyRow}>
      <Text style={styles.emptyRowText}>— inga evenemang just nu —</Text>
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

// ─── Live now strip (T0083 / MVP-gap §77) ───────────────────────────────────
//
// Shows up to 3 LIVE cards with a pulsing red dot when events are currently
// in progress (start_time <= now <= end_time, with a 30-min grace past
// end_time). The strip is only rendered between 18:00 and 02:00 Stockholm
// time — outside that window there is no point hitting the agent backend.
//
// Why the 18:00–02:00 window: Stockholm nightlife runs 18:00 → past
// midnight; live events between 02:00 and 18:00 are essentially zero in
// the event graph (a Tuesday 10:00 yoga class is in progress but it's
// not "live now" in the nightlife sense the user expects). The 02:00
// boundary gives late-night events a grace tail.
//
// React Native `Animated` drives the pulse: opacity oscillates 1.0 → 0.4
// → 1.0 on a 1.2-second loop. We use `useNativeDriver: true` so the
// animation runs on the UI thread and does not block the JS bridge.

const LIVE_WINDOW_START_HOUR = 18; // 18:00 local
const LIVE_WINDOW_END_HOUR   = 2;  // 02:00 local (next day)
const LIVE_NOW_LIMIT = 3;

/**
 * Return the Stockholm-local hour for the given date. Europe/Stockholm is
 * fixed at UTC+1 (CET) / UTC+2 (CEST); we compute the offset using
 * Intl.DateTimeFormat so DST is handled correctly without shipping
 * date-fns-tz to the client bundle.
 */
function stockholmHour(d) {
  // Intl gives us the named-timezone hour directly. Falls back to local
  // device hour if the runtime cannot resolve 'Europe/Stockholm' (older
  // Android emulators sometimes can't), keeping the strip functional on
  // every device.
  try {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      hour: '2-digit',
      hour12: false,
      timeZone: 'Europe/Stockholm',
    }).formatToParts(d);
    const hourPart = parts.find((p) => p.type === 'hour');
    const h = hourPart ? parseInt(hourPart.value, 10) : NaN;
    if (!Number.isNaN(h)) return h;
  } catch (_e) {
    // fall through
  }
  return d.getHours();
}

/** True when the strip should render. 18:00–02:00 wraps midnight. */
function isLiveWindowOpen(d) {
  const h = stockholmHour(d);
  if (h >= LIVE_WINDOW_START_HOUR) return true;  // 18..23
  if (h < LIVE_WINDOW_END_HOUR)   return true;  // 0..1
  return false;                                  // 2..17
}

function useLiveEvents() {
  const [state, setState] = useState({ status: 'idle', events: [], error: null });

  const load = useCallback(async () => {
    // Gate client-side: outside the window, do not even hit the network.
    if (!isLiveWindowOpen(new Date())) {
      setState({ status: 'ready', events: [], error: null });
      return;
    }
    setState({ status: 'loading', events: [], error: null });
    try {
      const result = await fetchLiveEvents({ limit: LIVE_NOW_LIMIT });
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

function LiveBadge() {
  // Pulsing red dot + "LIVE" label. Animated opacity 1.0 → 0.4 → 1.0 on a
  // 1.2s loop. Uses native driver — never touches the JS bridge during
  // the animation.
  const opacity = React.useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1.0,  duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <View style={styles.liveBadge}>
      <Animated.View style={[styles.liveDot, { opacity }]} />
      <Text style={styles.liveBadgeText}>LIVE</Text>
    </View>
  );
}

function LiveEventCard({ event, onPress }) {
  const time = event.time || '';
  const venue = event.venue_name || event.venue || 'Plats ej angiven';
  return (
    <Pressable
      style={({ pressed }) => [styles.liveCard, pressed && styles.cardPressed]}
      onPress={() => onPress?.(event)}
      accessibilityRole="button"
      accessibilityLabel={`Pågår nu: ${event.title} ${time ? 'klockan ' + time : ''} på ${venue}`}
    >
      <CardImage
        uri={event.image_url || event.imageUrl}
        imageLicense={event.image_license}
        imageAttribution={event.image_attribution}
      />
      <View style={styles.liveCardBody}>
        <View style={styles.liveCardTopRow}>
          <Text style={styles.liveCardTime}>{time || '—'}</Text>
          <LiveBadge />
        </View>
        <Text style={styles.liveCardTitle} numberOfLines={2}>{event.title}</Text>
        <Text style={styles.liveCardVenue} numberOfLines={1}>{venue}</Text>
      </View>
    </Pressable>
  );
}

function LiveNowStrip({ onCardPress }) {
  const { status, events, error, retry } = useLiveEvents();

  // Window closed: do not render at all. The user is not going to see
  // "happening now" events between 02:00 and 18:00 anyway, and the
  // backend is gated to match.
  if (!isLiveWindowOpen(new Date())) return null;

  // Error / loading: render a minimal placeholder strip with skeleton
  // cards so the section "exists" but does not commit to content.
  const isLoading = status === 'loading' || status === 'idle';
  const hasError = status === 'error';
  const visible = status === 'ready' ? events : [];

  if (status === 'ready' && visible.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEyebrow}>PÅGÅR NU</Text>
        <Text style={styles.sectionTitle}>Händer just nu</Text>
      </View>
      {hasError ? (
        <Pressable
          onPress={retry}
          style={styles.liveErrorRow}
          accessibilityRole="button"
          accessibilityLabel="Kunde inte ladda händelser. Tryck för att försöka igen."
        >
          <Text style={styles.liveErrorText}>
            Kunde inte ladda — tryck för att försöka igen
          </Text>
        </Pressable>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.liveCardRow}
        >
          {isLoading
            ? Array.from({ length: LIVE_NOW_LIMIT }).map((_, i) => (
                <View key={`live-skel-${i}`} style={styles.liveCardSkeleton} />
              ))
            : visible.map((e) => (
                <LiveEventCard key={e.id} event={e} onPress={onCardPress} />
              ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Section bodies ──────────────────────────────────────────────────────────

function TonightSection({ onCardPress }) {
  const from = useMemo(() => todayLocalIso(), []);
  const { status, events, error, retry } = useSection({
    from,
    days: 1,
    filter: (e) => {
      const h = localHourFromIso(e.start_time);
      return h != null && h >= 18;
    },
  });
  return (
    <Section eyebrow="IKVÄLL" title="Händer ikväll">
      {status === 'loading' && (
        <View style={styles.loadingRow}><ActivityIndicator color={TOKENS.color.accent} /></View>
      )}
      {status === 'error' && (
        <View style={styles.emptyRow}>
          <Text style={styles.errorText}>Kunde inte hämta: {error}</Text>
          <Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>Försök igen</Text></Pressable>
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

function WeekendSection({ onCardPress }) {
  const from = useMemo(() => nextSaturdayIso(), []);
  const { status, events, error, retry } = useSection({ from, days: 2 });
  return (
    <Section eyebrow="HELGEN" title="Denna helg">
      {status === 'loading' && (
        <View style={styles.loadingRow}><ActivityIndicator color={TOKENS.color.accent} /></View>
      )}
      {status === 'error' && (
        <View style={styles.emptyRow}>
          <Text style={styles.errorText}>Kunde inte hämta: {error}</Text>
          <Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>Försök igen</Text></Pressable>
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

function FreeSection({ onCardPress }) {
  const from = useMemo(() => todayLocalIso(), []);
  const { status, events, error, retry } = useSection({
    from,
    days: 7,
    filter: (e) => e.is_free || e.isFree,
  });
  return (
    <Section eyebrow="GRATIS" title="Gratis evenemang">
      {status === 'loading' && (
        <View style={styles.loadingRow}><ActivityIndicator color={TOKENS.color.accent} /></View>
      )}
      {status === 'error' && (
        <View style={styles.emptyRow}>
          <Text style={styles.errorText}>Kunde inte hämta: {error}</Text>
          <Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>Försök igen</Text></Pressable>
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
  const { status, events, error, retry } = useRecommendedSection();
  return (
    <Section eyebrow="REKOMMENDERAT" title="För dig">
      {status === 'loading' && (
        <View style={styles.loadingRow}><ActivityIndicator color={TOKENS.color.accent} /></View>
      )}
      {status === 'error' && (
        <View style={styles.emptyRow}>
          <Text style={styles.errorText}>Kunde inte hämta: {error}</Text>
          <Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>Försök igen</Text></Pressable>
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

function ChipSkeleton() {
  return (
    <View style={styles.chipSkeleton} accessibilityLabel="Laddar förslag" />
  );
}

function PromptChip({ prompt, onPress }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.promptChip, pressed && styles.promptChipPressed]}
      onPress={() => onPress?.(prompt)}
      accessibilityRole="button"
      accessibilityLabel={prompt.reason ? `${prompt.prompt_text}. ${prompt.reason}` : prompt.prompt_text}
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

function useCuratedCollections() {
  const [state, setState] = useState({ status: 'loading', collections: [], error: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', collections: [], error: null });
    try {
      const result = await fetchCuratedCollections({ limit: CURATED_COLLECTIONS_LIMIT });
      setState({
        status: 'ready',
        collections: Array.isArray(result.collections) ? result.collections : [],
        error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', collections: [], error: msg });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, retry: load };
}

function CuratedChip({ collection, onPress }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.curatedChip, pressed && styles.curatedChipPressed]}
      onPress={() => onPress?.({ prompt_text: collection.prompt_text, curated_id: collection.id })}
      accessibilityRole="button"
      accessibilityLabel={`Kuratorens val: ${collection.name}`}
    >
      <Text style={styles.curatedChipName} numberOfLines={1}>{collection.name}</Text>
      <Text style={styles.curatedChipReason} numberOfLines={2}>{collection.reason}</Text>
    </Pressable>
  );
}

function CuratedCollectionsSection({ onChipPress }) {
  const { status, collections } = useCuratedCollections();
  // Hide the section entirely when the curator has nothing to suggest or the
  // fetch failed (T0084 spec — best-effort, never red).
  if (status === 'ready' && collections.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEyebrow}>KURATORENS VAL</Text>
        <Text style={styles.sectionTitle}>Handplockade listor</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.curatedChipRow}
      >
        {status === 'loading'
          ? Array.from({ length: CURATED_COLLECTIONS_LIMIT }).map((_, i) => <ChipSkeleton key={`c-${i}`} />)
          : collections.map((c) => (
              <CuratedChip key={c.id} collection={c} onPress={onChipPress} />
            ))}
      </ScrollView>
    </View>
  );
}

function SuggestedPromptsSection({ onChipPress }) {
  const { status, prompts } = useSuggestedPrompts();
  // Hide section on error / empty (T0063 spec) — failure mode is "no chips" not "red error".
  const visiblePrompts = status === 'ready' ? prompts : [];
  if (status === 'ready' && visiblePrompts.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEyebrow}>FÖRSLAG</Text>
        <Text style={styles.sectionTitle}>Vad vill du göra?</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.promptChipRow}
      >
        {status === 'loading'
          ? Array.from({ length: SUGGESTED_PROMPTS_LIMIT }).map((_, i) => <ChipSkeleton key={`s-${i}`} />)
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
  return (
    <Pressable
      style={({ pressed }) => [styles.promptChip, pressed && styles.promptChipPressed]}
      onPress={() => onPress?.(query)}
      accessibilityRole="button"
      accessibilityLabel={`Upprepa sökning: ${query.query_text}`}
    >
      <Text style={styles.promptChipText} numberOfLines={2}>{query.query_text}</Text>
    </Pressable>
  );
}

function RecentSearchesSection({ onChipPress }) {
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
        <Text style={styles.sectionEyebrow}>SENASTE</Text>
        <Text style={styles.sectionTitle}>Dina senaste sökningar</Text>
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
  const time = event.time || '';
  const venue = event.venue_name || event.venue || 'Plats ej angiven';
  return (
    <Pressable
      style={({ pressed }) => [styles.intentCard, pressed && styles.cardPressed]}
      onPress={() => onPress?.(event)}
      accessibilityRole="button"
      accessibilityLabel={`${event.title} ${time ? 'klockan ' + time : ''} på ${venue}`}
    >
      <Text style={styles.cardTime}>{time || '—'}</Text>
      <Text style={styles.intentCardTitle} numberOfLines={2}>{event.title}</Text>
      <Text style={styles.cardVenue} numberOfLines={1}>{venue}</Text>
    </Pressable>
  );
}

function IntentSlotSkeleton() {
  return (
    <View style={styles.intentSlot} accessibilityLabel="Laddar agentförslag">
      <View style={styles.intentSlotTitleSkeleton} />
      <View style={styles.intentCardRow}>
        <View style={styles.intentCardSkeleton} />
        <View style={styles.intentCardSkeleton} />
      </View>
    </View>
  );
}

function IntentSlotRow({ slot, onCardPress }) {
  return (
    <View style={styles.intentSlot}>
      <Text style={styles.intentSlotTitle} numberOfLines={1}>{slot.title}</Text>
      {slot.cards.length === 0 ? (
        <Text style={styles.intentSlotEmpty}>— inga matchningar ännu —</Text>
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
  const { status, slots } = useAgentSuggestions();
  // T0060 spec: hide section entirely if no cached data (new users, errors).
  // We render skeletons during loading to avoid layout shift, then drop to null
  // once we know the data is empty.
  if (status === 'ready' && slots.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEyebrow}>AGENT</Text>
        <Text style={styles.sectionTitle}>Förslag från din agent</Text>
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
  const { status, events, error, retry } = useSavedSection();
  return (
    <Section eyebrow="SPARRADE" title=" Dina sparade evenemang">
      {status === 'loading' && (
        <View style={styles.loadingRow}><ActivityIndicator color={TOKENS.color.accent} /></View>
      )}
      {status === 'error' && (
        <View style={styles.emptyRow}>
          <Text style={styles.errorText}>Kunde inte hämta: {error}</Text>
          <Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>Försök igen</Text></Pressable>
        </View>
      )}
      {status === 'ready' && events.length === 0 && (
        <View style={styles.emptyRow}>
          <Text style={styles.emptyRowText}>— inga sparade evenemang ännu —</Text>
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

export default function HomeScreen({ onChipPress }) {
  const handleCardPress = useCallback((event) => {
    // The browse tab owns external-link handling via sourceLinks.js.
    // HomeScreen stays declarative until a details screen lands (Phase 2 retention).
    void event;
  }, []);

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
          <Text style={styles.headerEyebrow}>STOCKHOLM</Text>
          <Text style={styles.headerTitle}>{greeting()}</Text>
          <Text style={styles.headerSubtitle}>
            {subtitleForHour(new Date().getHours())}
          </Text>
        </View>

        <SuggestedPromptsSection onChipPress={handlePromptPress} />
        <CuratedCollectionsSection onChipPress={handlePromptPress} />
        <RecentSearchesSection onChipPress={handlePromptPress} />
        <LiveNowStrip onCardPress={handleCardPress} />

        <TonightSection onCardPress={handleCardPress} />
        <WeekendSection onCardPress={handleCardPress} />
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
    backgroundColor: TOKENS.color.surface,
  },
  cardImageFallback: {
    width: CARD_WIDTH,
    height: 130,
    backgroundColor: TOKENS.color.surface,
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

  // Live now strip (T0083)
  liveCardRow: {
    paddingHorizontal: TOKENS.space.lg,
    gap: TOKENS.space.md,
  },
  liveCard: {
    width: 240,
    backgroundColor: TOKENS.color.surface,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    borderLeftWidth: 3,
    borderLeftColor: TOKENS.color.accent,
    borderRadius: TOKENS.radius.md,
    overflow: 'hidden',
  },
  liveCardSkeleton: {
    width: 240,
    height: 200,
    backgroundColor: TOKENS.color.surface,
    borderRadius: TOKENS.radius.md,
    opacity: 0.6,
  },
  liveCardBody: {
    padding: TOKENS.space.md,
  },
  liveCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: TOKENS.space.sm,
  },
  liveCardTime: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.lg,
    fontWeight: '700',
  },
  liveCardTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 4,
  },
  liveCardVenue: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
    lineHeight: 16,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF3B30',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: TOKENS.radius.sm,
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  liveBadgeText: {
    color: '#FFFFFF',
    fontSize: TOKENS.fontSize.xs,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  liveErrorRow: {
    paddingHorizontal: TOKENS.space.lg,
    paddingVertical: TOKENS.space.md,
  },
  liveErrorText: {
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
});