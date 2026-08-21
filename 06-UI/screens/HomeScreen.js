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
} from 'react-native';

import { fetchFeed, fetchSavedEvents, fetchRecommendedEvents, fetchSuggestedPrompts, fetchCachedRecommendations } from '../services/agentClient';

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
  const daysUntilSat = (6 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilSat);
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
  if (h < 5) return 'God natt';
  if (h < 11) return 'God morgon';
  if (h < 18) return 'God eftermiddag';
  return 'God kväll';
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
          <Text style={styles.headerEyebrow}>HEM</Text>
          <Text style={styles.headerTitle}>{greeting()}</Text>
          <Text style={styles.headerSubtitle}>
            Personlig feed — uppdaterad just nu från live data.
          </Text>
        </View>

        <SuggestedPromptsSection onChipPress={handlePromptPress} />

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