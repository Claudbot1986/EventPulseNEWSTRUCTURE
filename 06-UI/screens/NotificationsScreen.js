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
 *   5. When the client reports warning 'auth' (no Supabase session — the
 *      endpoints are requireUser-gated), a login prompt replaces the error
 *      block; the optional `onOpenLogin` prop (wired by AppShell to
 *      LoginScreen via setShowLogin) makes it actionable.
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
import { useI18n } from '../i18n';

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
// Kind → i18n key suffix under notifications.kind.* / notifications.eyebrow.*
const KINDS = ['reminder', 'match', 'response'];

/** Relative time label via i18n (Språkstöd 2026-09-20). `t` comes from
 *  useI18n(); templates live under notifications.time.* with {n}/{h}/{m}/{d}
 *  so word order can differ per language. */
function relativeLabel(iso, nowMs, t) {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const deltaMs = ts - nowMs;
  const absMs = Math.abs(deltaMs);
  const past = deltaMs < 0;
  const minutes = Math.round(absMs / 60_000);
  if (minutes < 1) return t(past ? 'notifications.time.nowPast' : 'notifications.time.nowFuture');
  if (minutes < 60) {
    return t(past ? 'notifications.time.pastMin' : 'notifications.time.futureMin', { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) {
    if (mins === 0) {
      return t(past ? 'notifications.time.pastHours' : 'notifications.time.futureHours', { h: hours });
    }
    return t(past ? 'notifications.time.pastHoursMin' : 'notifications.time.futureHoursMin', { h: hours, m: mins });
  }
  const days = Math.floor(hours / 24);
  return t(past ? 'notifications.time.pastDays' : 'notifications.time.futureDays', { d: days });
}

export default function NotificationsScreen({ onOpenEvent, onOpenLogin, isActive = true }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lastFetchedRef = useRef(0);
  const aliveRef = useRef(true);
  const inFlightRef = useRef(false);

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
    const result = await fetchUnratedSavedEvents({ limit: 25, t });
    if (!aliveRef.current) return;
    if (result.ok) {
      setAttendedEvents(result.events);
    }
    // Best-effort: silently swallow non-ok results — the section just
    // renders empty. The agent URL being misconfigured shows up elsewhere.
    setAttendedLoading(false);
  }, [t]);

  const load = useCallback(async ({ force = false } = {}) => {
    const since = Date.now() - lastFetchedRef.current;
    if (!force && lastFetchedRef.current > 0 && since < REFRESH_TTL_MS) {
      return;
    }
    // A load already in flight (mount effect + focus edge can race at first
    // mount, pull-to-refresh can double-tap) — never fire concurrent fetches.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (force) setRefreshing(true);
    try {
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
    } finally {
      inFlightRef.current = false;
    }
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

  // Keep-alive tabs (2026-09-20): AppShell keeps this screen mounted with
  // display:none when another tab is active, so freshness no longer comes
  // from remounting. Refetch on the focus edge instead — TTL-gated via
  // `load()` so a quick tab hop within 60s costs no network. This finally
  // wires the focus behavior the header comment has always documented.
  useEffect(() => {
    if (isActive) load();
  }, [isActive, load]);

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
      Alert.alert(t('notifications.pickRating'), t('notifications.pickRatingBody'));
      return;
    }
    const trimmedNote = (draft.note || '').trim();
    if (trimmedNote.length > 140) {
      // Should never happen because the TextInput caps at 140, but defend
      // server-side as a guardrail — better than crashing.
      Alert.alert(t('notifications.tooLong'), t('notifications.tooLongBody'));
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
        t('notifications.ratingFailed'),
        ratingResult.warning ?? t('notifications.ratingFailedBody')
      );
    }
  }, [ratingDrafts, t]);

  const renderRow = useCallback((notification) => {
    const unread = notification.status !== 'read';
    const when = relativeLabel(notification.created_at, nowMs, t);
    const kindLabel = KINDS.includes(notification.kind)
      ? t(`notifications.kind.${notification.kind}`)
      : t('notifications.kind.fallback');
    return (
      <Pressable
        key={notification.id}
        accessibilityRole="button"
        accessibilityLabel={t('notifications.rowA11y', { kind: kindLabel, title: notification.title })}
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
            <Text style={styles.rowCta}>{t('common.open')}</Text>
          </View>
        </View>
      </Pressable>
    );
  }, [handleOpen, nowMs, t]);

  const renderSection = useCallback((kind, items) => {
    if (!items || items.length === 0) return null;
    return (
      <View key={kind} style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionEyebrow}>{t(`notifications.eyebrow.${kind}`)}</Text>
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
            <Text style={styles.sectionEyebrow}>{t('notifications.attended.eyebrow')}</Text>
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
          <Text style={styles.sectionEyebrow}>{t('notifications.attended.eyebrow')}</Text>
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
                    event.start_time ? relativeLabel(event.start_time, nowMs, t) : null,
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
                        accessibilityLabel={t('notifications.starA11y', {
                          count: star,
                          unit: t(star === 1 ? 'notifications.starOne' : 'notifications.starMany'),
                        })}
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
                      : t('notifications.rateHint')}
                  </Text>
                </View>
                <TextInput
                  style={styles.noteInput}
                  value={draft.note}
                  editable={!isSubmitting}
                  maxLength={140}
                  placeholder={t('notifications.notePlaceholder')}
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
                    accessibilityLabel={t('notifications.submitRating')}
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
                      <Text style={styles.submitButtonText}>{t('notifications.submitRating')}</Text>
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
    t,
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
        <Text style={styles.eyebrow}>{t('notifications.eyebrow')}</Text>
        <Text style={styles.title}>{t('notifications.title')}</Text>
        <Text style={styles.subtitle}>
          {t('notifications.subtitle')}
        </Text>

        {loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={TOKENS.color.accent} />
          </View>
        ) : null}

        {!loading && error === 'auth' ? (
          <View style={styles.warningBlock}>
            <Text style={styles.warningText}>
              {t('notifications.authBody')}
            </Text>
            {typeof onOpenLogin === 'function' ? (
              <Pressable
                onPress={onOpenLogin}
                accessibilityLabel={t('common.logIn')}
                style={({ pressed }) => [
                  styles.loginButton,
                  pressed ? styles.loginButtonPressed : null,
                ]}
              >
                <Text style={styles.loginButtonText}>{t('common.logIn')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!loading && error && error !== 'auth' ? (
          <View style={styles.warningBlock}>
            <Text style={styles.warningText}>
              {t('notifications.fetchError', { error })}
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
                  {t('notifications.empty')}
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
  loginButton: {
    marginTop: TOKENS.space.md,
    paddingHorizontal: TOKENS.space.lg,
    paddingVertical: TOKENS.space.sm,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.accent,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginButtonPressed: {
    opacity: 0.7,
  },
  loginButtonText: {
    color: TOKENS.color.appBg,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '700',
  },
});
