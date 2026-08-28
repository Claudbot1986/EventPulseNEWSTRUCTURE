/**
 * NotificationsScreen — T0048 / MVP-gap §77.
 *
 * Replaces the #69 placeholder with a real, live view of the user's
 * notification feed. The screen:
 *
 *   1. Fetches notifications from `GET /agent/notifications` on mount and
 *      on focus (60s soft TTL — see `useFocus`).
 *   2. Groups them into three buckets via `groupNotifications`:
 *        - Påminnelser (reminders)  — saved events starting in <2h
 *        - Nya matchningar (matches)
 *        - Svar (responses)
 *   3. Renders each bucket as a section with an eyebrow + count badge,
 *      and each row as a pressable card. A row tap calls the optional
 *      `onOpenEvent(id)` prop (AppShell wires this when navigation
 *      exists) and optimistically marks the notification read.
 *   4. Falls back to the original empty-state copy when the fetch fails
 *      or returns nothing — never renders a blank screen.
 *
 * Design: pure-black canvas per docs/UI-DESIGN.md. Cards are transparent
 * with a 1px border. Unread rows have a left-edge accent. Time labels
 * are relative ("om 1 h 30 min" / "för 3 min sedan") so the screen
 * stays legible without locale formatting.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Alert,
} from 'react-native';

import {
  fetchNotifications,
  markNotificationRead,
  groupNotifications,
  deepLinkFor,
  fetchUnratedSavedEvents,
} from '../services/notificationsClient';
import {
  recordAttendance,
  recordRating,
} from '../services/agentClient';

const TOKENS = {
  color: {
    appBg: '#000000',
    surface: '#15151B',
    border: '#1A1A1A',
    text: '#F7F2EA',
    textMuted: '#A9B0BE',
    textSoft: '#727B8D',
    accent: '#FFB454',
    accentSoft: '#3B2E1E',
    positive: '#7FD9A4',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  fontSize: { sm: 11, md: 13, lg: 16, xl: 22 },
  radius: { md: 12 },
};

const REFRESH_TTL_MS = 60_000;
const KIND_LABEL = {
  reminder: 'Påminnelse',
  match: 'Ny matchning för dig',
  response: 'Svar',
};
const KIND_EYEBROW = {
  reminder: 'PÅMINNELSER',
  match: 'NYA MATCHNINGAR',
  response: 'SVAR',
};

/** Pure helper: turn an ISO timestamp into a Swedish relative label.
 *  Kept inside the file so the screen is fully self-contained — no
 *  locale dep needed for Phase 1. */
function relativeLabel(iso, nowMs) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const deltaMs = t - nowMs;
  const absMs = Math.abs(deltaMs);
  const past = deltaMs < 0;
  const minutes = Math.round(absMs / 60_000);
  if (minutes < 1) return past ? 'just nu' : 'nu';
  if (minutes < 60) return past ? `för ${minutes} min` : `om ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) {
    if (mins === 0) return past ? `för ${hours} h` : `om ${hours} h`;
    return past ? `för ${hours} h ${mins} min` : `om ${hours} h ${mins} min`;
  }
  const days = Math.floor(hours / 24);
  return past ? `för ${days} d` : `om ${days} d`;
}

export default function NotificationsScreen({ onOpenEvent }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lastFetchedRef = useRef(0);
  const aliveRef = useRef(true);

  // ─── T0082 attended-events state ─────────────────────────────────────────
  const [attendedEvents, setAttendedEvents] = useState([]);
  const [attendedLoading, setAttendedLoading] = useState(false);
  // Per-event rating draft. Keys are event ids; values are { rating, note }.
  // Local to the screen so navigating away doesn't lose the in-progress input.
  const [ratingDrafts, setRatingDrafts] = useState({});
  // eventId currently being submitted. null when nothing is in flight.
  const [submittingId, setSubmittingId] = useState(null);

  const loadAttended = useCallback(async () => {
    setAttendedLoading(true);
    const result = await fetchUnratedSavedEvents({ limit: 25 });
    if (!aliveRef.current) return;
    if (result.ok) {
      setAttendedEvents(result.events);
    }
    // Best-effort: silently swallow non-ok results — the section just
    // renders empty. The agent URL being misconfigured shows up elsewhere.
    setAttendedLoading(false);
  }, []);

  const load = useCallback(async ({ force = false } = {}) => {
    const since = Date.now() - lastFetchedRef.current;
    if (!force && lastFetchedRef.current > 0 && since < REFRESH_TTL_MS) {
      return;
    }
    if (force) setRefreshing(true);
    const [notifResult] = await Promise.all([
      fetchNotifications({ limit: 50 }),
      loadAttended(),
    ]);
    if (!aliveRef.current) return;
    if (notifResult.ok) {
      setNotifications(notifResult.notifications);
      setError(null);
    } else {
      setError(notifResult.warning ?? 'unknown');
    }
    lastFetchedRef.current = Date.now();
    setNowMs(Date.now());
    setLoading(false);
    setRefreshing(false);
  }, [loadAttended]);

  useEffect(() => {
    aliveRef.current = true;
    load({ force: true });
    const tick = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => {
      aliveRef.current = false;
      clearInterval(tick);
    };
  }, [load]);

  const groups = useMemo(() => groupNotifications(notifications), [notifications]);
  const total = groups.total;
  const isEmpty = total === 0 && !loading && !error;

  const handleOpen = useCallback(async (notification) => {
    if (!notification) return;
    // Optimistic local flip so the unread dot disappears immediately.
    setNotifications((prev) => prev.map((n) =>
      n.id === notification.id ? { ...n, status: 'read' } : n
    ));
    // Fire-and-forget: best-effort persistence on the server.
    markNotificationRead({ notificationId: notification.id });
    if (typeof onOpenEvent === 'function') {
      onOpenEvent(notification.event_id);
      return;
    }
    // No navigation hook wired in yet — at least log the deep-link target
    // so we can verify it is well-formed in dev.
    const link = deepLinkFor(notification);
    if (link && __DEV__) {
      // eslint-disable-next-line no-console
      console.log('[NotificationsScreen] would deep-link to', link);
    }
  }, [onOpenEvent]);

  // ─── T0082 attended-section helpers ──────────────────────────────────────
  const setDraft = useCallback((eventId, patch) => {
    setRatingDrafts((prev) => {
      const current = prev[eventId] || { rating: 0, note: '' };
      return { ...prev, [eventId]: { ...current, ...patch } };
    });
  }, []);

  const handleSubmitRating = useCallback(async (event) => {
    if (!event || !event.id) return;
    const draft = ratingDrafts[event.id] || { rating: 0, note: '' };
    if (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5) {
      Alert.alert('Välj ett betyg', 'Tryck på en stjärna för att betygsätta.');
      return;
    }
    const trimmedNote = (draft.note || '').trim();
    if (trimmedNote.length > 140) {
      // Should never happen because the TextInput caps at 140, but defend
      // server-side as a guardrail — better than crashing.
      Alert.alert('För långt', 'Anteckningen får vara max 140 tecken.');
      return;
    }
    setSubmittingId(event.id);
    // Step 1: mark attendance. Best-effort — failure does not block the
    // rating submission, the two interactions are independent signals.
    try {
      await recordAttendance({ eventId: event.id });
    } catch (_err) {
      // Swallow — recordRating below is the user-visible signal.
    }
    // Step 2: persist the rating + note.
    const ratingResult = await recordRating({
      eventId: event.id,
      rating: draft.rating,
      note: trimmedNote.length > 0 ? trimmedNote : undefined,
    });
    if (!aliveRef.current) return;
    setSubmittingId(null);
    if (ratingResult.ok) {
      // Optimistic removal from the unrated list — the next refresh will
      // confirm by not returning this event.
      setAttendedEvents((prev) => prev.filter((e) => e.id !== event.id));
      setRatingDrafts((prev) => {
        const next = { ...prev };
        delete next[event.id];
        return next;
      });
    } else {
      Alert.alert(
        'Kunde inte skicka betyg',
        ratingResult.warning ?? 'Prova igen om en stund.'
      );
    }
  }, [ratingDrafts]);

  const renderRow = useCallback((notification) => {
    const unread = notification.status !== 'read';
    const when = relativeLabel(notification.created_at, nowMs);
    return (
      <Pressable
        key={notification.id}
        accessibilityRole="button"
        accessibilityLabel={`${KIND_LABEL[notification.kind] || 'Notis'}: ${notification.title}`}
        onPress={() => handleOpen(notification)}
        style={({ pressed }) => [
          styles.row,
          unread && styles.rowUnread,
          pressed && styles.rowPressed,
        ]}
      >
        {unread ? <View style={styles.unreadDot} /> : null}
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {notification.title || '—'}
          </Text>
          {notification.body ? (
            <Text style={styles.rowBody2} numberOfLines={2}>
              {notification.body}
            </Text>
          ) : null}
          <View style={styles.rowMeta}>
            {when ? <Text style={styles.rowWhen}>{when}</Text> : null}
            <Text style={styles.rowCta}>Öppna</Text>
          </View>
        </View>
      </Pressable>
    );
  }, [handleOpen, nowMs]);

  const renderSection = useCallback((kind, items) => {
    if (!items || items.length === 0) return null;
    return (
      <View key={kind} style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionEyebrow}>{KIND_EYEBROW[kind]}</Text>
          <Text style={styles.sectionCount}>{items.length}</Text>
        </View>
        <View style={styles.cardList}>
          {items.map(renderRow)}
        </View>
      </View>
    );
  }, [renderRow]);

  // ─── T0082 attended-section render ───────────────────────────────────────
  const renderAttendedSection = useCallback(() => {
    if (attendedLoading && attendedEvents.length === 0) {
      return (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionEyebrow}>DELTAGIT</Text>
          </View>
          <View style={styles.cardList}>
            <View style={styles.attendedLoadingBlock}>
              <ActivityIndicator color={TOKENS.color.accent} />
            </View>
          </View>
        </View>
      );
    }
    if (attendedEvents.length === 0) return null;
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionEyebrow}>DELTAGIT</Text>
          <Text style={styles.sectionCount}>{attendedEvents.length}</Text>
        </View>
        <View style={styles.cardList}>
          {attendedEvents.map((event) => {
            const draft = ratingDrafts[event.id] || { rating: 0, note: '' };
            const isSubmitting = submittingId === event.id;
            return (
              <View key={event.id} style={styles.attendedCard}>
                <Text style={styles.attendedTitle} numberOfLines={2}>
                  {event.title || '—'}
                </Text>
                <Text style={styles.attendedMeta} numberOfLines={1}>
                  {[
                    event.venue_name,
                    event.start_time ? relativeLabel(event.start_time, nowMs) : null,
                  ].filter(Boolean).join(' · ')}
                </Text>
                {/* 5-star widget — tappable, single-row. */}
                <View style={styles.starRow}>
                  {[1, 2, 3, 4, 5].map((star) => {
                    const filled = star <= draft.rating;
                    return (
                      <Pressable
                        key={star}
                        accessibilityRole="button"
                        accessibilityLabel={`${star} ${star === 1 ? 'stjärna' : 'stjärnor'}`}
                        hitSlop={8}
                        disabled={isSubmitting}
                        onPress={() => setDraft(event.id, { rating: star })}
                        style={({ pressed }) => [
                          styles.starButton,
                          pressed && !isSubmitting ? styles.starButtonPressed : null,
                        ]}
                      >
                        <Text style={[styles.starGlyph, filled ? styles.starGlyphFilled : null]}>
                          {filled ? '★' : '☆'}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Text style={styles.starHint}>
                    {draft.rating > 0
                      ? `${draft.rating}/5`
                      : 'Tryck för att betygsätta'}
                  </Text>
                </View>
                <TextInput
                  style={styles.noteInput}
                  value={draft.note}
                  editable={!isSubmitting}
                  maxLength={140}
                  placeholder="Skriv en kort anteckning (max 140 tecken, inga personuppgifter)"
                  placeholderTextColor={TOKENS.color.textSoft}
                  multiline
                  onChangeText={(text) => setDraft(event.id, { note: text })}
                />
                <View style={styles.attendedFooter}>
                  <Text style={styles.charCount}>
                    {(draft.note || '').length}/140
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Skicka betyg"
                    disabled={isSubmitting || draft.rating < 1}
                    onPress={() => handleSubmitRating(event)}
                    style={({ pressed }) => [
                      styles.submitButton,
                      (isSubmitting || draft.rating < 1) ? styles.submitButtonDisabled : null,
                      pressed && draft.rating >= 1 && !isSubmitting ? styles.submitButtonPressed : null,
                    ]}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color={TOKENS.color.appBg} />
                    ) : (
                      <Text style={styles.submitButtonText}>Skicka betyg</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    );
  }, [
    attendedLoading,
    attendedEvents,
    ratingDrafts,
    submittingId,
    nowMs,
    setDraft,
    handleSubmitRating,
  ]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load({ force: true })}
            tintColor={TOKENS.color.accent}
          />
        }
      >
        <Text style={styles.eyebrow}>NOTISER</Text>
        <Text style={styles.title}>Dina påminnelser och svar</Text>
        <Text style={styles.subtitle}>
          Så snart en ny matchning, påminnelse eller ett svar är klart dyker
          det här. Tips: spara events för att få påminnelser 2 timmar innan.
        </Text>

        {loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={TOKENS.color.accent} />
          </View>
        ) : null}

        {!loading && error ? (
          <View style={styles.warningBlock}>
            <Text style={styles.warningText}>
              Kunde inte hämta notiser just nu ({error}). Dra ner för att försöka igen.
            </Text>
          </View>
        ) : null}

        {!loading && !error ? (
          <>
            {renderSection('reminder', groups.reminders)}
            {renderSection('match', groups.matches)}
            {renderSection('response', groups.responses)}
            {renderAttendedSection()}

            {isEmpty ? (
              <View style={styles.emptyBlock}>
                <Text style={styles.emptyText}>
                  Inga notiser än. Spara ett evenemang så får du en påminnelse
                  2 timmar innan det börjar.
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TOKENS.color.appBg,
  },
  scrollContent: {
    paddingHorizontal: TOKENS.space.lg,
    paddingTop: TOKENS.space.lg,
    paddingBottom: TOKENS.space.xl * 2,
  },
  eyebrow: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: TOKENS.space.sm,
  },
  title: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.xl,
    fontWeight: '600',
    marginBottom: TOKENS.space.sm,
  },
  subtitle: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.md,
    lineHeight: 22,
    marginBottom: TOKENS.space.lg,
  },
  section: {
    marginBottom: TOKENS.space.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: TOKENS.space.sm,
  },
  sectionEyebrow: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  sectionCount: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
    fontVariant: ['tabular-nums'],
  },
  cardList: {
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.surface,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: TOKENS.space.md,
    paddingHorizontal: TOKENS.space.md,
    borderBottomWidth: 1,
    borderBottomColor: TOKENS.color.border,
    backgroundColor: 'transparent',
  },
  rowUnread: {
    backgroundColor: TOKENS.color.accentSoft,
  },
  rowPressed: {
    opacity: 0.65,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TOKENS.color.accent,
    marginRight: TOKENS.space.md,
    marginTop: 6,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '600',
    marginBottom: TOKENS.space.xs,
  },
  rowBody2: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.md,
    lineHeight: 19,
    marginBottom: TOKENS.space.xs,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: TOKENS.space.xs,
  },
  rowWhen: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
  },
  rowCta: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '600',
  },
  loadingBlock: {
    paddingVertical: TOKENS.space.xl,
    alignItems: 'center',
  },
  warningBlock: {
    padding: TOKENS.space.md,
    borderRadius: TOKENS.radius.md,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    backgroundColor: TOKENS.color.surface,
  },
  warningText: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.md,
    lineHeight: 20,
  },
  emptyBlock: {
    padding: TOKENS.space.lg,
    borderRadius: TOKENS.radius.md,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    backgroundColor: TOKENS.color.surface,
  },
  emptyText: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.md,
    lineHeight: 22,
  },
  // ─── T0082 attended-section styles ──────────────────────────────────────
  attendedLoadingBlock: {
    paddingVertical: TOKENS.space.lg,
    alignItems: 'center',
  },
  attendedCard: {
    padding: TOKENS.space.md,
    borderBottomWidth: 1,
    borderBottomColor: TOKENS.color.border,
    backgroundColor: 'transparent',
  },
  attendedTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '600',
    marginBottom: TOKENS.space.xs,
  },
  attendedMeta: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
    marginBottom: TOKENS.space.sm,
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: TOKENS.space.sm,
  },
  starButton: {
    paddingHorizontal: TOKENS.space.xs,
    paddingVertical: TOKENS.space.xs,
  },
  starButtonPressed: {
    opacity: 0.6,
  },
  starGlyph: {
    color: TOKENS.color.textSoft,
    fontSize: 24,
    lineHeight: 28,
  },
  starGlyphFilled: {
    color: TOKENS.color.accent,
  },
  starHint: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
    marginLeft: TOKENS.space.sm,
  },
  noteInput: {
    backgroundColor: TOKENS.color.appBg,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    borderRadius: TOKENS.radius.md,
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.md,
    lineHeight: 20,
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.sm,
    minHeight: 60,
    maxHeight: 120,
    textAlignVertical: 'top',
    marginBottom: TOKENS.space.sm,
  },
  attendedFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: TOKENS.space.xs,
  },
  charCount: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
    fontVariant: ['tabular-nums'],
  },
  submitButton: {
    paddingHorizontal: TOKENS.space.lg,
    paddingVertical: TOKENS.space.sm,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.accent,
    minWidth: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonPressed: {
    opacity: 0.7,
  },
  submitButtonDisabled: {
    backgroundColor: TOKENS.color.border,
  },
  submitButtonText: {
    color: TOKENS.color.appBg,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '700',
  },
});
