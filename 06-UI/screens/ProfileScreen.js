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

const FOLLOW_PUSH_ENABLED_KEY = 'eventpulse.follow_push_enabled';

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
function FollowedRow({ entityType, items, busyKey, onLongPressItem }) {
  if (!items || items.length === 0) {
    return (
      <Text style={styles.placeholder}>
        {entityType === 'venue'
          ? 'Inga följda platser än.'
          : 'Inga följda artister än.'}
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
            onLongPress={() => onLongPressItem?.(entityType, id, formatChipLabel(entityType, id))}
            delayLongPress={350}
            disabled={busy}
            style={({ pressed }) => [
              styles.chip,
              (pressed || busy) && styles.chipBusy,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Följer ${entityType === 'venue' ? 'plats' : 'artist'} ${formatChipLabel(entityType, id)} — lång-tryck för att sluta följa`}
            accessibilityHint="Lång-tryck för att sluta följa"
            testID={`followed-chip-${entityType}-${id}`}
          >
            <Text style={styles.chipText} numberOfLines={1}>
              {formatChipLabel(entityType, id)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function formatChipLabel(entityType, id) {
  if (!id) return entityType === 'venue' ? 'Plats' : 'Artist';
  // API returns opaque IDs (uuid for venues, slug for artists). Show a
  // humanised slice until a name-lookup endpoint exists. Truncate from the
  // front so the leading chars (most identifying for uuids) stay readable.
  const trimmed = String(id);
  const tail = trimmed.length > 8 ? trimmed.slice(0, 8) : trimmed;
  const prefix = entityType === 'venue' ? 'Plats ' : 'Artist ';
  return `${prefix}${tail}…`;
}

export default function ProfileScreen({ onLoggedOut, onOpenLogin }) {
  const [followPushEnabled, setFollowPushEnabled] = useState(false);
  const [followPushLoaded, setFollowPushLoaded] = useState(false);
  const [followPushBusy, setFollowPushBusy] = useState(false);

  // Konto — the Supabase auth session (magic link / Apple). Null means
  // guest mode: the personalized sections below are all requireUser-gated
  // server-side, so guests get a login nudge instead of empty/error lists.
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
          const warning = res?.warning ?? 'okänt fel';
          Alert.alert('Kunde inte sluta följa', warning);
        }
      } catch (_err) {
        setFollowedVenues(prevVenues);
        setFollowedArtists(prevArtists);
        Alert.alert('Kunde inte sluta följa', 'nätverksfel');
      } finally {
        setFollowedBusyKey(null);
      }
    },
    [followedVenues, followedArtists]
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
        const warning = res?.warning ?? 'nätverksfel';
        Alert.alert('Kunde inte spara notis-inställningen', warning);
      }
    },
    []
  );

  // T0087 — derive notification level label for display
  const levelLabel = (lvl) => ({ all: 'Alla notiser', new_only: 'Nya händelser', off: 'Av' }[lvl] ?? 'Alla notiser');

  const showUnfollowSheet = useCallback(
    (entityType, entityId, displayName) => {
      const title = displayName || (entityType === 'venue' ? 'Plats' : 'Artist');
      const key = `${entityType}:${entityId}`;
      const currentLevel = notificationPrefs[key] ?? 'all';
      const cancelLabel = 'Avbryt';
      const unfollowLabel = 'Sluta följ';
      const iosOptions = ['Alla notiser', 'Nya händelser', 'Av', unfollowLabel, cancelLabel];
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
          { text: 'Alla notiser', onPress: () => handleSetNotifLevel(entityType, entityId, 'all') },
          { text: 'Nya händelser', onPress: () => handleSetNotifLevel(entityType, entityId, 'new_only') },
          { text: 'Av', onPress: () => handleSetNotifLevel(entityType, entityId, 'off') },
          { text: unfollowLabel, style: 'destructive', onPress: () => handleUnfollow(entityType, entityId) },
          { text: cancelLabel, style: 'cancel' },
        ]);
      }
    },
    [handleUnfollow, notificationPrefs]
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
          ? `Kunde inte spara notis-inställningen (${result.warning}).`
          : 'Kunde inte spara notis-inställningen just nu.';
        Alert.alert('EventPulse', msg);
        // Roll back optimistic flip if the server rejected it.
        setFollowPushEnabled(!next);
        await saveFollowPushEnabledLocal(!next);
      }
    },
    []
  );

  // Logout — wipes the Supabase Bearer, drains the analytics queue and
  // stops the flush loop, then hands control to the shell which drops to
  // the guest surface. No confirmation dialog: logging back in is one tap.
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
    onLoggedOut?.();
  }, [onLoggedOut]);

  // Fas 2.5 / Apple §5.1.1(v) — Radera konto.
  //
  // Two-step UX: first tap → Alert.alert with confirm/cancel. On confirm
  // we open a Modal with a TextInput where the user must type the literal
  // string "RADERA" before the submit button enables. The Modal also
  // sends `confirmation: 'DELETE'` on the wire, so the server enforces
  // the same check independently.
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
    if (deleteConfirmText !== 'RADERA') return;
    setDeleteBusy(true);
    setDeleteError('');
    const result = await deleteAccount();
    setDeleteBusy(false);
    if (!result.ok) {
      // Keep the modal open so the user can retry. The server may have
      // already wiped the row in some failure modes — surface a clear
      // "the deletion may have already happened" hint if status is 401
      // (auth.users gone) so we don't trap the user in a retry loop.
      const baseMsg = 'Kunde inte radera kontot';
      const detail = result.error || `okänt fel (status ${result.status ?? '?'})`;
      setDeleteError(`${baseMsg}: ${detail}`);
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
    onLoggedOut?.();
  }, [deleteConfirmText, onLoggedOut]);

  const handleDeleteFirstTap = useCallback(() => {
    Alert.alert(
      'Radera konto?',
      'Det här tar bort ditt konto och allt du har sparat — sparade events, ' +
        'följda platser, notis-inställningar. Åtgärden går inte att ångra.',
      [
        { text: 'Avbryt', style: 'cancel' },
        { text: 'Fortsätt', style: 'destructive', onPress: openDeleteModal },
      ]
    );
  }, [openDeleteModal]);

  const canSubmitDelete = deleteConfirmText === 'RADERA' && !deleteBusy;

  const totalFollowed = followedVenues.length + followedArtists.length;

  // Guest mode: no auth session → nothing on this screen can load or save
  // (every endpoint here is requireUser-gated), so show a login nudge and
  // stop. Keep rendering the header so the tab feels intentional, not broken.
  if (authSessionLoaded && !authSession) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={styles.eyebrow}>PROFIL</Text>
        <Text style={styles.title}>Sparade & inställningar</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Konto</Text>
          <Text style={[styles.placeholder, styles.guestLoginText]}>
            Logga in för att spara events, följa platser och artister och
            ställa in notiser. Du kan fortsätta utforska utan konto.
          </Text>
          {typeof onOpenLogin === 'function' ? (
            <Pressable
              style={({ pressed }) => [
                styles.loginButton,
                pressed && styles.linkButtonPressed,
              ]}
              onPress={onOpenLogin}
              accessibilityRole="button"
              accessibilityLabel="Logga in"
            >
              <Text style={styles.loginButtonText}>Logga in</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          style={({ pressed }) => [styles.linkButton, pressed && styles.linkButtonPressed]}
          accessibilityRole="link"
          accessibilityLabel="Om EventPulse"
        >
          <Text style={styles.linkButtonText}>Om EventPulse</Text>
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
      <Text style={styles.eyebrow}>PROFIL</Text>
      <Text style={styles.title}>Sparade & inställningar</Text>
      <Text style={styles.subtitle}>
        Dina sparade events, kategorival och notis-inställningar hamnar här.
      </Text>

      {authSessionLoaded && authSession ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Konto</Text>
          <View style={styles.row}>
            <View style={styles.rowTextWrap}>
              <Text style={styles.rowLabel}>Inloggad</Text>
              <Text style={styles.rowDescription}>
                {authSession.user?.email ?? 'Apple-inloggning'}
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.logoutButton, pressed && styles.linkButtonPressed]}
              onPress={handleLogout}
              accessibilityRole="button"
              accessibilityLabel="Logga ut"
            >
              <Text style={styles.logoutButtonText}>Logga ut</Text>
            </Pressable>
          </View>
          <View style={styles.deleteRow}>
            <Text style={styles.deleteRowDescription}>
              Tar bort kontot permanent — allt du sparat, följt och alla
              notis-inställningar försvinner.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.deleteButton,
                pressed && styles.linkButtonPressed,
              ]}
              onPress={handleDeleteFirstTap}
              accessibilityRole="button"
              accessibilityLabel="Radera konto"
              testID="delete-account-button"
            >
              <Text style={styles.deleteButtonText}>Radera konto</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.section}>
          <ActivityIndicator color={TOKENS.color.accent} />
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Följer</Text>
        <Text style={styles.sectionDescription}>
          Här är det du följer just nu. Lång-tryck på en chip för att sluta följa.
        </Text>
        {followedLoaded ? (
          totalFollowed === 0 ? (
            <Text style={styles.placeholder}>
              Du följer inga platser eller artister än. Längst ner på ett
              event-kort finns ★-knappen — lång-tryck för att följa en plats.
            </Text>
          ) : (
            <>
              <Text style={styles.subsectionLabel}>Platser ({followedVenues.length})</Text>
              <FollowedRow
                entityType="venue"
                items={followedVenues}
                busyKey={followedBusyKey}
                onLongPressItem={showUnfollowSheet}
              />
              <Text style={[styles.subsectionLabel, styles.subsectionLabelSpaced]}>
                Artister ({followedArtists.length})
              </Text>
              <FollowedRow
                entityType="artist"
                items={followedArtists}
                busyKey={followedBusyKey}
                onLongPressItem={showUnfollowSheet}
              />
            </>
          )
        ) : (
          <ActivityIndicator color={TOKENS.color.accent} style={styles.loadingSpinner} />
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifieringar</Text>
        <View style={styles.row}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>Push för följda venues</Text>
            <Text style={styles.rowDescription}>
              Få en notis när en venue du följer lägger till ett nytt event.
              Dela din enhets push-token under Inställningar → Notiser →
              EventPulse för att aktivera leverans.
            </Text>
          </View>
          {followPushLoaded ? (
            <Switch
              value={followPushEnabled}
              onValueChange={handleToggleFollowPush}
              disabled={followPushBusy}
              trackColor={{ false: TOKENS.color.border, true: TOKENS.color.accent }}
              thumbColor={followPushEnabled ? '#1A1206' : TOKENS.color.textMuted}
              accessibilityLabel="Push-notiser för följda venues"
              testID="follow-push-switch"
            />
          ) : (
            <ActivityIndicator color={TOKENS.color.accent} />
          )}
        </View>
        {followPushBusy ? (
          <Text style={styles.statusLine}>Sparar…</Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Fler val kommer snart</Text>
        <Text style={styles.placeholder}>
          Sparade events, kategorier och eventuell inloggning (Google/Facebook)
          landar här i nästa steg.
        </Text>
      </View>

      <Pressable
        style={({ pressed }) => [styles.linkButton, pressed && styles.linkButtonPressed]}
        accessibilityRole="link"
        accessibilityLabel="Om EventPulse"
      >
        <Text style={styles.linkButtonText}>Om EventPulse</Text>
      </Pressable>

      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Radera konto permanent?</Text>
            <Text style={styles.modalBody}>
              Skriv RADERA med stora bokstäver för att bekräfta. Det går inte
              att ångra — allt du sparat försvinner.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="RADERA"
              placeholderTextColor={TOKENS.color.textSoft}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deleteBusy}
              accessibilityLabel="Bekräftelsetecken"
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
                <Text style={styles.modalSecondaryLabel}>Avbryt</Text>
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
                accessibilityLabel="Bekräfta radering"
                testID="delete-account-confirm-button"
              >
                {deleteBusy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalDangerLabel}>Radera</Text>
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
    paddingBottom: TOKENS.space.xxl,
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
