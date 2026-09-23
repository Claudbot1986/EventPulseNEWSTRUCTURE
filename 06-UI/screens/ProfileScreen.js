/**
 * ProfileScreen — sparade events, kategorier, följer och notis-inställningar.
 *
 * Phase 1 retention-spec (2026-08-21):
 *   - Sparade events (redan persisterade via /agent/feedback interaction='save')
 *   - Kategorier från onboarding (redan persisterade lokalt + server)
 *   - Push-notiser för följda venues (T0059): toggle som persisterar
 *     follow_push_enabled till user_preferences.preferences via
 *     POST /agent/push-token
 *
 * T0072 / MVP-gap §79 (2026-08-22): "Följer"-sektion som visar vad användaren
 * följer (venues + artister), lång-tryck → action sheet "Sluta följ".
 * Bygger på agentClient.getFollowedEntities() + followEntity() som shippades
 * i T0050. Optimistisk UI: chip tas bort direkt, server bekräftar i bakgrunden.
 *
 * Phase 2 = wire `expo-notifications` för riktig push-leverans;
 * togglen idag lagrar enbart opt-in-flaggan (Phase 1 retention-spec).
 *
 * Pure-black canvas enligt `docs/UI-DESIGN.md`.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  Pressable,
  Alert,
  ActivityIndicator,
  ScrollView,
  Platform,
  ActionSheetIOS,
  Modal,
  TextInput,
} from 'react-native';

import { getItem, setItem, loadAuthSession, clearAuthSession } from '../services/storage';
import { analyticsClient } from '../services/analyticsClient';
import {
  registerPushToken,
  getFollowedEntities,
  followEntity,
  getNotificationPrefs,
  setNotificationPrefs,
  deleteAccount,
} from '../services/agentClient';
import { enableDinHelgPush, disableDinHelgPush } from '../services/pushTokenClient';
import { useI18n } from '../i18n';
import { LANGUAGES } from '../i18n/languages';

const FOLLOW_PUSH_ENABLED_KEY = 'eventpulse.follow_push_enabled';
const DIN_HELG_PUSH_ENABLED_KEY = 'eventpulse.din_helg_push_enabled';

/** BottomTabBar är position absolute över innehållet (AppShell barWrapper).
 *  Spegla dess mått — bar.paddingTop(8) + tabButton-icon/label(~50) +
 *  iOS home-inset(24) — plus luft, så sista raden ("Om EventPulse")
 *  scrollar fri från baren istället för att hamna under den.
 *  Källa: components/BottomTabBar.js styles.bar. */
const TAB_BAR_CLEARANCE = 96;

const TOKENS = {
  color: {
    appBg: '#000000',
    surface: '#0B0B0B',
    border: '#1A1A1A',
    text: '#F7F2EA',
    textMuted: '#A9B0BE',
    textSoft: '#727B8D',
    accent: '#FFB454',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  fontSize: { sm: 11, md: 13, lg: 16, xl: 22 },
  radius: { md: 12 },
};

async function loadFollowPushEnabled() {
  try {
    const v = await getItem(FOLLOW_PUSH_ENABLED_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

async function saveFollowPushEnabledLocal(enabled) {
  try {
    await setItem(FOLLOW_PUSH_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // Best-effort — server mirror is the source of truth across devices.
  }
}

async function loadDinHelgPushEnabled() {
  try {
    const v = await getItem(DIN_HELG_PUSH_ENABLED_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

async function saveDinHelgPushEnabledLocal(enabled) {
  try {
    await setItem(DIN_HELG_PUSH_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // Best-effort — server mirror is the source of truth across devices.
  }
}

/**
 * T0072 — render a horizontal row of follow chips for one entity type
 * (venue or artist). The API only returns IDs/slugs, so we show a short
 * truncated form for now — a future task (T0073?) can hydrate display
 * names from a venue/artist lookup endpoint.
 *
 * Long-press on a chip opens the OS action sheet "Sluta följ" via the
 * parent callback. The chip itself is also Pressable so VoiceOver/TalkBack
 * users reach the affordance through a regular long-press.
 */
function FollowedRow({ entityType, items, busyKey, onLongPressItem, t }) {
  if (!items || items.length === 0) {
    return (
      <Text style={styles.placeholder}>
        {entityType === 'venue'
          ? t('profile.followsEmptyVenues')
          : t('profile.followsEmptyArtists')}
      </Text>
    );
  }
  return (
    <View style={styles.chipsRow}>
      {items.map((id) => {
        const key = `${entityType}:${id}`;
        const busy = busyKey === key;
        return (
          <Pressable
            key={key}
            onLongPress={() => onLongPressItem?.(entityType, id, formatChipLabel(entityType, id, t))}
            delayLongPress={350}
            disabled={busy}
            style={({ pressed }) => [
              styles.chip,
              (pressed || busy) && styles.chipBusy,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('profile.followChipA11y', {
              entity: t(entityType === 'venue' ? 'profile.entity.venue' : 'profile.entity.artist'),
              label: formatChipLabel(entityType, id, t),
            })}
            accessibilityHint={t('profile.longPressHint')}
            testID={`followed-chip-${entityType}-${id}`}
          >
            <Text style={styles.chipText} numberOfLines={1}>
              {formatChipLabel(entityType, id, t)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function formatChipLabel(entityType, id, t) {
  if (!id) return t(entityType === 'venue' ? 'profile.venueFallback' : 'profile.artistFallback');
  // API returns opaque IDs (uuid for venues, slug for artists). Show a
  // humanised slice until a name-lookup endpoint exists. Truncate from the
  // front so the leading chars (most identifying for uuids) stay readable.
  const trimmed = String(id);
  const tail = trimmed.length > 8 ? trimmed.slice(0, 8) : trimmed;
  return t(entityType === 'venue' ? 'profile.venueChip' : 'profile.artistChip', { id: tail });
}

/**
 * Språksektion (Språkstöd 2026-09-20): the 10 data-backed languages as
 * selectable chips, nativeName labels, active chip highlighted. Rendered in
 * both the guest and signed-in branches — tourists are guests and must be
 * able to switch language without an account. setLanguage persists locally
 * + mirrors to the server best-effort inside the i18n provider.
 */
function LanguageSection({ t, language, setLanguage }) {
  return (
    <View style={styles.section} testID="language-section">
      <Text style={styles.sectionTitle}>{t('profile.language')}</Text>
      <Text style={styles.sectionDescription}>{t('profile.languageDesc')}</Text>
      <View style={styles.languageGrid}>
        {LANGUAGES.map((lang) => {
          const active = lang.tag === language;
          return (
            <Pressable
              key={lang.tag}
              style={({ pressed }) => [
                styles.chip,
                active && styles.languageChipActive,
                pressed && styles.linkButtonPressed,
              ]}
              onPress={() => setLanguage(lang.tag)}
              accessibilityRole="button"
              accessibilityLabel={lang.nativeName}
              accessibilityState={{ selected: active }}
              testID={`language-option-${lang.tag}`}
            >
              <Text style={[styles.chipText, active && styles.languageChipTextActive]}>
                {lang.nativeName}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function ProfileScreen({ onLoggedOut, onOpenLogin }) {
  const { t, language, setLanguage } = useI18n();
  const [followPushEnabled, setFollowPushEnabled] = useState(false);
  const [followPushLoaded, setFollowPushLoaded] = useState(false);
  const [followPushBusy, setFollowPushBusy] = useState(false);
  // S5 (2026-09-20): Din helg weekly push — separate toggle from the
  // follow-venue push above. OFF → server flag only; ON → OS permission +
  // Expo token + server flag (via enableDinHelgPush).
  const [dinHelgPushEnabled, setDinHelgPushEnabled] = useState(false);
  const [dinHelgPushLoaded, setDinHelgPushLoaded] = useState(false);
  const [dinHelgPushBusy, setDinHelgPushBusy] = useState(false);
  // GDPR consent surface (Fas B, 2026-09-22): analyticsClient drops every
  // event until setConsent(true) — this switch is the missing half of the
  // consent gate. Without it no usage data can ever leave the app.
  const [analyticsConsent, setAnalyticsConsentState] = useState(false);
  const [analyticsConsentLoaded, setAnalyticsConsentLoaded] = useState(false);

  // Konto — the Supabase auth session (magic link / Apple). Null OR
  // anonymous (NOW#2 bootstrap session with user.is_anonymous) means guest
  // mode: guests see a sync/backup nudge instead of account management.
  const [authSession, setAuthSession] = useState(null);
  const [authSessionLoaded, setAuthSessionLoaded] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // T0072 — followed venues/artists state. Refreshed on mount; long-press
  // on a chip opens the OS action sheet with "Sluta följ". Optimistic UI:
  // chip vanishes immediately, server confirms in the background and rolls
  // back on failure.
  const [followedVenues, setFollowedVenues] = useState([]);
  const [followedArtists, setFollowedArtists] = useState([]);
  const [followedLoaded, setFollowedLoaded] = useState(false);
  // T0087 — per-entity notification granularity
  const [notificationPrefs, setNotificationPrefsState] = useState({});
  const [followedBusyKey, setFollowedBusyKey] = useState(null);

  useEffect(() => {
    let alive = true;
    loadFollowPushEnabled().then((v) => {
      if (!alive) return;
      setFollowPushEnabled(v);
      setFollowPushLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    loadDinHelgPushEnabled().then((v) => {
      if (!alive) return;
      setDinHelgPushEnabled(v);
      setDinHelgPushLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // GDPR consent — read the persisted flag on mount so the switch shows
  // the truth before the user touches it.
  useEffect(() => {
    let alive = true;
    analyticsClient.getConsent().then((granted) => {
      if (!alive) return;
      setAnalyticsConsentState(!!granted);
      setAnalyticsConsentLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ON → setConsent(true) opens the gate. OFF → the full setOptOut() so the
  // backend records the opt-out (and any queued events are flushed first).
  // Optimistic UI: the switch flips immediately, persistence is best-effort.
  const handleToggleAnalyticsConsent = useCallback(async (next) => {
    setAnalyticsConsentState(next);
    try {
      if (next) {
        await analyticsClient.setConsent(true);
      } else {
        await analyticsClient.setOptOut();
      }
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[profile] analytics consent toggle failed', err?.message || err);
      }
    }
  }, []);

  // Load the persisted Supabase auth session (if any). When the user
  // signed in via magic link or Apple, this is non-null and we render the
  // Konto section with "Logga ut" + "Radera konto".
  useEffect(() => {
    let alive = true;
    loadAuthSession()
      .then((s) => {
        if (!alive) return;
        setAuthSession(s);
        setAuthSessionLoaded(true);
      })
      .catch(() => {
        if (alive) setAuthSessionLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // aliveRef tracks component mounted state across async refresh callbacks
  // without re-running the useEffect. (Cheaper than adding `mounted` to deps.)
  const aliveRef = useRef(true);

  const refreshFollowed = useCallback(async () => {
    try {
      const [entitiesRes, prefsRes] = await Promise.all([
        getFollowedEntities({ timeoutMs: 4_000 }),
        getNotificationPrefs({ timeoutMs: 4_000 }),
      ]);
      if (!aliveRef.current) return;
      if (entitiesRes && entitiesRes.ok) {
        setFollowedVenues(Array.isArray(entitiesRes.venueIds) ? entitiesRes.venueIds : []);
        setFollowedArtists(Array.isArray(entitiesRes.artistSlugs) ? entitiesRes.artistSlugs : []);
      }
      if (prefsRes && prefsRes.notification_prefs) {
        setNotificationPrefsState(prefsRes.notification_prefs);
      }
      // Silent on failure — empty lists render the "Du följer inget än" hint.
    } catch (_err) {
      // Never throw into the profile render path.
    } finally {
      if (aliveRef.current) setFollowedLoaded(true);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    refreshFollowed();
    return () => {
      aliveRef.current = false;
    };
  }, [refreshFollowed]);

  const handleUnfollow = useCallback(
    async (entityType, entityId) => {
      // Optimistic UI: remove the chip first, then sync to server. Roll back
      // if the server rejects (e.g. network down) so the user can retry.
      const key = `${entityType}:${entityId}`;
      setFollowedBusyKey(key);
      const prevVenues = followedVenues;
      const prevArtists = followedArtists;
      if (entityType === 'venue') {
        setFollowedVenues((cur) => cur.filter((id) => id !== entityId));
      } else if (entityType === 'artist') {
        setFollowedArtists((cur) => cur.filter((slug) => slug !== entityId));
      }
      try {
        const res = await followEntity({
          entityType,
          entityId,
          action: 'unfollow',
        });
        if (!res || res.ok !== true) {
          // Roll back.
          setFollowedVenues(prevVenues);
          setFollowedArtists(prevArtists);
          const warning = res?.warning ?? t('common.unknownError');
          Alert.alert(t('profile.unfollowFail'), warning);
        }
      } catch (_err) {
        setFollowedVenues(prevVenues);
        setFollowedArtists(prevArtists);
        Alert.alert(t('profile.unfollowFail'), t('common.networkError'));
      } finally {
        setFollowedBusyKey(null);
      }
    },
    [followedVenues, followedArtists, t]
  );

  // T0087 — update per-entity notification level (optimistic UI)
  const handleSetNotifLevel = useCallback(
    async (entityType, entityId, level) => {
      const key = `${entityType}:${entityId}`;
      // Optimistic update — reflect the change immediately
      setNotificationPrefsState((cur) => ({ ...cur, [key]: level }));
      const res = await setNotificationPrefs({ entityType, entityId, level });
      if (!res || res.ok !== true) {
        // Roll back on server rejection
        setNotificationPrefsState((cur) => {
          const next = { ...cur };
          delete next[key];
          return next;
        });
        const warning = res?.warning ?? t('common.networkError');
        Alert.alert(t('profile.notifSaveFail'), warning);
      }
    },
    [t]
  );

  const showUnfollowSheet = useCallback(
    (entityType, entityId, displayName) => {
      const title = displayName || t(entityType === 'venue' ? 'profile.venueFallback' : 'profile.artistFallback');
      const key = `${entityType}:${entityId}`;
      const currentLevel = notificationPrefs[key] ?? 'all';
      const cancelLabel = t('common.cancel');
      const unfollowLabel = t('profile.unfollow');
      const iosOptions = [t('profile.notif.all'), t('profile.notif.newOnly'), t('profile.notif.off'), unfollowLabel, cancelLabel];
      const iosHandlers = [
        () => handleSetNotifLevel(entityType, entityId, 'all'),
        () => handleSetNotifLevel(entityType, entityId, 'new_only'),
        () => handleSetNotifLevel(entityType, entityId, 'off'),
        () => handleUnfollow(entityType, entityId),
        () => {},
      ];
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title,
            options: iosOptions,
            cancelButtonIndex: iosOptions.indexOf(cancelLabel),
            destructiveButtonIndex: iosOptions.indexOf(unfollowLabel),
          },
          (idx) => { if (iosHandlers[idx]) iosHandlers[idx](); }
        );
      } else {
        Alert.alert(title, undefined, [
          { text: t('profile.notif.all'), onPress: () => handleSetNotifLevel(entityType, entityId, 'all') },
          { text: t('profile.notif.newOnly'), onPress: () => handleSetNotifLevel(entityType, entityId, 'new_only') },
          { text: t('profile.notif.off'), onPress: () => handleSetNotifLevel(entityType, entityId, 'off') },
          { text: unfollowLabel, style: 'destructive', onPress: () => handleUnfollow(entityType, entityId) },
          { text: cancelLabel, style: 'cancel' },
        ]);
      }
    },
    [handleUnfollow, notificationPrefs, t]
  );

  const handleToggleFollowPush = useCallback(
    async (next) => {
      // Optimistic UI — flip local state immediately, persist, then sync server.
      setFollowPushEnabled(next);
      setFollowPushBusy(true);
      await saveFollowPushEnabledLocal(next);
      const result = await registerPushToken({ followPushEnabled: next });
      setFollowPushBusy(false);
      if (!result || result.ok !== true) {
        const msg = result?.warning
          ? t('profile.notifSaveFailWarning', { warning: result.warning })
          : t('profile.notifSaveFailNow');
        Alert.alert('EventPulse', msg);
        // Roll back optimistic flip if the server rejected it.
        setFollowPushEnabled(!next);
        await saveFollowPushEnabledLocal(!next);
      }
    },
    [t]
  );

  // S5 (2026-09-20): Din helg weekly push toggle. ON differs from the
  // follow-push toggle: it runs the real OS permission flow + Expo token
  // fetch first (enableDinHelgPush), and only persists the flag when that
  // chain succeeds. In Expo Go the runtime is unavailable — the toggle
  // rolls back with the standard save-fail alert instead of pretending.
  const handleToggleDinHelgPush = useCallback(
    async (next) => {
      setDinHelgPushEnabled(next);
      setDinHelgPushBusy(true);
      await saveDinHelgPushEnabledLocal(next);
      const result = next ? await enableDinHelgPush() : await disableDinHelgPush();
      setDinHelgPushBusy(false);
      if (!result || result.ok !== true) {
        const msg = result?.warning
          ? t('profile.notifSaveFailWarning', { warning: result.warning })
          : t('profile.notifSaveFailNow');
        Alert.alert('EventPulse', msg);
        setDinHelgPushEnabled(!next);
        await saveDinHelgPushEnabledLocal(!next);
      }
    },
    [t]
  );

  // Logout — wipes the Supabase Bearer, drains the analytics queue and
  // stops the flush loop, drops the LOCAL session snapshot (without it the
  // mounted screen keeps rendering the logged-in Konto section and the
  // user perceives logout as broken — live report 2026-09-20), then hands
  // control to the shell which drops to the guest surface. No confirmation
  // dialog: logging back in is one tap.
  const handleLogout = useCallback(async () => {
    try {
      await clearAuthSession();
    } catch (_err) {
      // Storage hiccup — still flip the gate; the wiped in-memory tree
      // cannot send the old Bearer anymore.
    }
    try {
      await analyticsClient.logout();
    } catch (_err) {
      // Best-effort drain — hand control to the shell's user gate anyway.
    }
    setAuthSession(null);
    onLoggedOut?.();
  }, [onLoggedOut]);

  // Fas 2.5 / Apple §5.1.1(v) — Radera konto.
  //
  // Two-step UX: first tap → Alert.alert with confirm/cancel. On confirm
  // we open a Modal with a TextInput where the user must type the localised
  // gate word (i18n profile.deleteGateWord, 'RADERA' in sv) before the
  // submit button enables. The Modal also sends `confirmation: 'DELETE'`
  // on the wire, so the server enforces the same check independently.
  const deleteGateWord = t('profile.deleteGateWord');
  //
  // On success: clearAuthSession (wipe Bearer) → analyticsClient.logout
  // (drain queue) → onLoggedOut (flip shell to guest). The cascading
  // DB deletes on the server have already wiped user-scoped data.
  const openDeleteModal = useCallback(() => {
    setDeleteConfirmText('');
    setDeleteError('');
    setDeleteModalVisible(true);
  }, []);

  const closeDeleteModal = useCallback(() => {
    if (deleteBusy) return; // ignore dismiss while the request is in flight
    setDeleteModalVisible(false);
    setDeleteConfirmText('');
    setDeleteError('');
  }, [deleteBusy]);

  const handleDeleteAccount = useCallback(async () => {
    if (deleteConfirmText !== deleteGateWord) return;
    setDeleteBusy(true);
    setDeleteError('');
    const result = await deleteAccount();
    setDeleteBusy(false);
    if (!result.ok) {
      // Keep the modal open so the user can retry. The server may have
      // already wiped the row in some failure modes — surface a clear
      // "the deletion may have already happened" hint if status is 401
      // (auth.users gone) so we don't trap the user in a retry loop.
      const detail = result.error || t('profile.deleteFailedDetail', { status: result.status ?? '?' });
      setDeleteError(t('profile.deleteFailed', { detail }));
      return;
    }
    setDeleteModalVisible(false);
    setDeleteConfirmText('');
    try {
      await clearAuthSession();
    } catch (_err) {
      // Wipe the in-memory state regardless so the Bearer cannot haunt
      // a re-render. Storage hiccup is logged silently; the user is
      // about to be sent to UserPicker anyway.
    }
    try {
      await analyticsClient.logout();
    } catch (_err) {
      // Best-effort drain.
    }
    // Same live-report fix as handleLogout: drop the local snapshot so the
    // guest branch renders immediately after account deletion.
    setAuthSession(null);
    onLoggedOut?.();
  }, [deleteConfirmText, deleteGateWord, onLoggedOut, t]);

  const handleDeleteFirstTap = useCallback(() => {
    Alert.alert(
      t('profile.deleteAlertTitle'),
      t('profile.deleteAlertBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.continue'), style: 'destructive', onPress: openDeleteModal },
      ]
    );
  }, [openDeleteModal, t]);

  const canSubmitDelete = deleteConfirmText === deleteGateWord && !deleteBusy;

  const totalFollowed = followedVenues.length + followedArtists.length;

  // Guest mode: no session, or an ANONYMOUS one (NOW#2 bootstrap) → the
  // account-management rows (Logga ut / Radera konto) are meaningless for a
  // throwaway identity, so guests get a sync/backup nudge instead. Taste
  // itself already accumulates server-side for anonymous sessions — the
  // nudge sells multi-device continuity, not access. Keep rendering the
  // header so the tab feels intentional, not broken.
  const isGuest = !authSession || authSession.user?.is_anonymous === true;
  if (authSessionLoaded && isGuest) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={styles.eyebrow}>{t('profile.eyebrow')}</Text>
        <Text style={styles.title}>{t('profile.title')}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.account')}</Text>
          <Text style={[styles.placeholder, styles.guestLoginText]}>
            {t('profile.guestNudge')}
          </Text>
          {typeof onOpenLogin === 'function' ? (
            <Pressable
              style={({ pressed }) => [
                styles.loginButton,
                pressed && styles.linkButtonPressed,
              ]}
              onPress={onOpenLogin}
              accessibilityRole="button"
              accessibilityLabel={t('common.addEmail')}
            >
              <Text style={styles.loginButtonText}>{t('common.addEmail')}</Text>
            </Pressable>
          ) : null}
        </View>

        <LanguageSection t={t} language={language} setLanguage={setLanguage} />

        <Pressable
          style={({ pressed }) => [styles.linkButton, pressed && styles.linkButtonPressed]}
          accessibilityRole="link"
          accessibilityLabel={t('profile.about')}
        >
          <Text style={styles.linkButtonText}>{t('profile.about')}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.eyebrow}>{t('profile.eyebrow')}</Text>
      <Text style={styles.title}>{t('profile.title')}</Text>
      <Text style={styles.subtitle}>
        {t('profile.subtitle')}
      </Text>

      {authSessionLoaded && authSession ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.account')}</Text>
          <View style={styles.row}>
            <View style={styles.rowTextWrap}>
              <Text style={styles.rowLabel}>{t('profile.signedIn')}</Text>
              <Text style={styles.rowDescription}>
                {authSession.user?.email ?? t('profile.appleSignIn')}
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.logoutButton, pressed && styles.linkButtonPressed]}
              onPress={handleLogout}
              accessibilityRole="button"
              accessibilityLabel={t('common.logOut')}
            >
              <Text style={styles.logoutButtonText}>{t('common.logOut')}</Text>
            </Pressable>
          </View>
          <View style={styles.deleteRow}>
            <Text style={styles.deleteRowDescription}>
              {t('profile.deleteDesc')}
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.deleteButton,
                pressed && styles.linkButtonPressed,
              ]}
              onPress={handleDeleteFirstTap}
              accessibilityRole="button"
              accessibilityLabel={t('profile.delete')}
              testID="delete-account-button"
            >
              <Text style={styles.deleteButtonText}>{t('profile.delete')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.section}>
          <ActivityIndicator color={TOKENS.color.accent} />
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile.following')}</Text>
        <Text style={styles.sectionDescription}>
          {t('profile.followingDesc')}
        </Text>
        {followedLoaded ? (
          totalFollowed === 0 ? (
            <Text style={styles.placeholder}>
              {t('profile.noFollows')}
            </Text>
          ) : (
            <>
              <Text style={styles.subsectionLabel}>{t('profile.venuesCount', { count: followedVenues.length })}</Text>
              <FollowedRow
                entityType="venue"
                items={followedVenues}
                busyKey={followedBusyKey}
                onLongPressItem={showUnfollowSheet}
                t={t}
              />
              <Text style={[styles.subsectionLabel, styles.subsectionLabelSpaced]}>
                {t('profile.artistsCount', { count: followedArtists.length })}
              </Text>
              <FollowedRow
                entityType="artist"
                items={followedArtists}
                busyKey={followedBusyKey}
                onLongPressItem={showUnfollowSheet}
                t={t}
              />
            </>
          )
        ) : (
          <ActivityIndicator color={TOKENS.color.accent} style={styles.loadingSpinner} />
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile.notifications')}</Text>
        <View style={styles.row}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>{t('profile.pushVenues')}</Text>
            <Text style={styles.rowDescription}>
              {t('profile.pushVenuesDesc')}
            </Text>
          </View>
          {followPushLoaded ? (
            <Switch
              value={followPushEnabled}
              onValueChange={handleToggleFollowPush}
              disabled={followPushBusy}
              trackColor={{ false: TOKENS.color.border, true: TOKENS.color.accent }}
              thumbColor={followPushEnabled ? '#1A1206' : TOKENS.color.textMuted}
              accessibilityLabel={t('profile.pushSwitchA11y')}
              testID="follow-push-switch"
            />
          ) : (
            <ActivityIndicator color={TOKENS.color.accent} />
          )}
        </View>
        {followPushBusy ? (
          <Text style={styles.statusLine}>{t('profile.saving')}</Text>
        ) : null}
        <View style={styles.row}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>{t('profile.pushDinHelg')}</Text>
            <Text style={styles.rowDescription}>
              {t('profile.pushDinHelgDesc')}
            </Text>
          </View>
          {dinHelgPushLoaded ? (
            <Switch
              value={dinHelgPushEnabled}
              onValueChange={handleToggleDinHelgPush}
              disabled={dinHelgPushBusy}
              trackColor={{ false: TOKENS.color.border, true: TOKENS.color.accent }}
              thumbColor={dinHelgPushEnabled ? '#1A1206' : TOKENS.color.textMuted}
              accessibilityLabel={t('profile.pushDinHelgSwitchA11y')}
              testID="din-helg-push-switch"
            />
          ) : (
            <ActivityIndicator color={TOKENS.color.accent} />
          )}
        </View>
        {dinHelgPushBusy ? (
          <Text style={styles.statusLine}>{t('profile.saving')}</Text>
        ) : null}
      </View>

      {/* GDPR consent surface (Fas B, 2026-09-22) — the analyticsClient
          gate drops every event until this is turned on. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile.privacy')}</Text>
        <View style={styles.row}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>{t('profile.analyticsConsent')}</Text>
            <Text style={styles.rowDescription}>
              {t('profile.analyticsConsentDesc')}
            </Text>
          </View>
          {analyticsConsentLoaded ? (
            <Switch
              value={analyticsConsent}
              onValueChange={handleToggleAnalyticsConsent}
              trackColor={{ false: TOKENS.color.border, true: TOKENS.color.accent }}
              thumbColor={analyticsConsent ? '#1A1206' : TOKENS.color.textMuted}
              accessibilityLabel={t('profile.analyticsSwitchA11y')}
              testID="analytics-consent-switch"
            />
          ) : (
            <ActivityIndicator color={TOKENS.color.accent} />
          )}
        </View>
      </View>

      <LanguageSection t={t} language={language} setLanguage={setLanguage} />

      <Pressable
        style={({ pressed }) => [styles.linkButton, pressed && styles.linkButtonPressed]}
        accessibilityRole="link"
        accessibilityLabel={t('profile.about')}
      >
        <Text style={styles.linkButtonText}>{t('profile.about')}</Text>
      </Pressable>

      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('profile.deleteModalTitle')}</Text>
            <Text style={styles.modalBody}>
              {t('profile.deleteModalBody', { word: deleteGateWord })}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder={deleteGateWord}
              placeholderTextColor={TOKENS.color.textSoft}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deleteBusy}
              accessibilityLabel={t('profile.deleteInputA11y')}
              testID="delete-account-confirm-input"
            />
            {deleteError ? (
              <Text style={styles.modalError}>{deleteError}</Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalSecondary,
                  pressed && styles.linkButtonPressed,
                ]}
                onPress={closeDeleteModal}
                disabled={deleteBusy}
                accessibilityRole="button"
              >
                <Text style={styles.modalSecondaryLabel}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalDanger,
                  !canSubmitDelete && styles.modalDangerDisabled,
                  pressed && canSubmitDelete && styles.linkButtonPressed,
                ]}
                onPress={handleDeleteAccount}
                disabled={!canSubmitDelete}
                accessibilityRole="button"
                accessibilityLabel={t('profile.deleteConfirmA11y')}
                testID="delete-account-confirm-button"
              >
                {deleteBusy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalDangerLabel}>{t('profile.deleteConfirm')}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
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
    paddingBottom: TAB_BAR_CLEARANCE,
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
    marginBottom: TOKENS.space.xl,
  },
  section: {
    backgroundColor: TOKENS.color.surface,
    borderColor: TOKENS.color.border,
    borderWidth: 1,
    borderRadius: TOKENS.radius.md,
    padding: TOKENS.space.lg,
    marginBottom: TOKENS.space.lg,
  },
  sectionTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.lg,
    fontWeight: '600',
    marginBottom: TOKENS.space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: TOKENS.space.lg,
  },
  rowTextWrap: {
    flex: 1,
    paddingRight: TOKENS.space.sm,
  },
  rowLabel: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '600',
    marginBottom: TOKENS.space.xs,
  },
  rowDescription: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
    lineHeight: 18,
  },
  statusLine: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.sm,
    marginTop: TOKENS.space.sm,
  },
  placeholder: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.md,
    lineHeight: 22,
  },
  linkButton: {
    paddingVertical: TOKENS.space.md,
    alignItems: 'center',
  },
  linkButtonPressed: {
    opacity: 0.7,
  },
  linkButtonText: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '600',
  },
  // T0072 — Följer-sektionens chips-rad.
  sectionDescription: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
    lineHeight: 18,
    marginBottom: TOKENS.space.md,
  },
  subsectionLabel: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginBottom: TOKENS.space.sm,
  },
  subsectionLabelSpaced: {
    marginTop: TOKENS.space.md,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TOKENS.space.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: TOKENS.color.border,
    borderRadius: 999,
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.xs + 2,
  },
  chipText: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '600',
  },
  chipBusy: {
    opacity: 0.5,
  },
  // Språksektion — accent-fylld chip för det aktiva språket.
  languageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TOKENS.space.sm,
  },
  languageChipActive: {
    backgroundColor: TOKENS.color.accent,
  },
  languageChipTextActive: {
    color: '#1A1206',
  },
  loadingSpinner: {
    marginTop: TOKENS.space.sm,
  },
  // Gäst-läge: login-knapp i Konto-kortet (accent, samma form som Radera).
  guestLoginText: {
    marginBottom: TOKENS.space.lg,
  },
  loginButton: {
    backgroundColor: TOKENS.color.accent,
    paddingVertical: TOKENS.space.md,
    paddingHorizontal: TOKENS.space.lg,
    borderRadius: TOKENS.radius.md,
    alignItems: 'center',
  },
  loginButtonText: {
    color: '#1A1206',
    fontSize: TOKENS.fontSize.md,
    fontWeight: '700',
  },
  // Konto-sektionens logga ut-knapp (samma form som chips, accent-text).
  logoutButton: {
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    borderRadius: 999,
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.xs + 2,
  },
  logoutButtonText: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '600',
  },
  // Fas 2.5 — Radera konto. Röd knapp för att signalera irreversibel
  // åtgärd, separerad från Logga ut med ett tunt mellanrum.
  deleteRow: {
    marginTop: TOKENS.space.lg,
    paddingTop: TOKENS.space.lg,
    borderTopWidth: 1,
    borderTopColor: TOKENS.color.border,
  },
  deleteRowDescription: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.sm,
    lineHeight: 18,
    marginBottom: TOKENS.space.md,
  },
  deleteButton: {
    backgroundColor: '#B23A48',
    paddingVertical: TOKENS.space.md,
    paddingHorizontal: TOKENS.space.lg,
    borderRadius: TOKENS.radius.md,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontSize: TOKENS.fontSize.md,
    fontWeight: '700',
  },
  // Fas 2.5 — Radera-bekräftelsemodal.
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: TOKENS.space.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: TOKENS.color.surface,
    borderColor: TOKENS.color.border,
    borderWidth: 1,
    borderRadius: TOKENS.radius.md,
    padding: TOKENS.space.lg,
  },
  modalTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.lg,
    fontWeight: '700',
    marginBottom: TOKENS.space.sm,
  },
  modalBody: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.md,
    lineHeight: 22,
    marginBottom: TOKENS.space.md,
  },
  modalInput: {
    backgroundColor: TOKENS.color.appBg,
    borderColor: TOKENS.color.border,
    borderWidth: 1,
    borderRadius: TOKENS.radius.md,
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.sm,
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.md,
    letterSpacing: 2,
    marginBottom: TOKENS.space.md,
  },
  modalError: {
    color: '#FF6B6B',
    fontSize: TOKENS.fontSize.sm,
    marginBottom: TOKENS.space.sm,
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: TOKENS.space.sm,
  },
  modalSecondary: {
    paddingVertical: TOKENS.space.sm,
    paddingHorizontal: TOKENS.space.md,
    borderRadius: TOKENS.radius.md,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    alignItems: 'center',
    minWidth: 88,
  },
  modalSecondaryLabel: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '600',
  },
  modalDanger: {
    backgroundColor: '#B23A48',
    paddingVertical: TOKENS.space.sm,
    paddingHorizontal: TOKENS.space.lg,
    borderRadius: TOKENS.radius.md,
    alignItems: 'center',
    minWidth: 88,
  },
  modalDangerDisabled: {
    backgroundColor: '#3A1E22',
    opacity: 0.6,
  },
  modalDangerLabel: {
    color: '#FFFFFF',
    fontSize: TOKENS.fontSize.md,
    fontWeight: '700',
  },
});
