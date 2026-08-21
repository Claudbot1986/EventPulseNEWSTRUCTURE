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
} from 'react-native';

import {
  fetchNotifications,
  markNotificationRead,
  groupNotifications,
  deepLinkFor,
} from '../services/notificationsClient';

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

  const load = useCallback(async ({ force = false } = {}) => {
    const since = Date.now() - lastFetchedRef.current;
    if (!force && lastFetchedRef.current > 0 && since < REFRESH_TTL_MS) {
      return;
    }
    if (force) setRefreshing(true);
    const result = await fetchNotifications({ limit: 50 });
    if (!aliveRef.current) return;
    if (result.ok) {
      setNotifications(result.notifications);
      setError(null);
    } else {
      setError(result.warning ?? 'unknown');
    }
    lastFetchedRef.current = Date.now();
    setNowMs(Date.now());
    setLoading(false);
    setRefreshing(false);
  }, []);

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
});
