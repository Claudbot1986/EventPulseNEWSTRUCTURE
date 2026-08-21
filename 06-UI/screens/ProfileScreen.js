/**
 * ProfileScreen — sparade events, kategorier och notis-inställningar.
 *
 * Phase 1 retention-spec (2026-08-21):
 *   - Sparade events (redan persisterade via /agent/feedback interaction='save')
 *   - Kategorier från onboarding (redan persisterade lokalt + server)
 *   - Push-notiser för följda venues (T0059): toggle som persisterar
 *     follow_push_enabled till user_preferences.preferences via
 *     POST /agent/push-token
 *
 * Phase 2 = wire `expo-notifications` för riktig push-leverans;
 * togglen idag lagrar enbart opt-in-flaggan (Phase 1 retention-spec).
 *
 * Pure-black canvas enligt `docs/UI-DESIGN.md`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';

import { getItem, setItem } from '../services/storage';
import { registerPushToken } from '../services/agentClient';

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

export default function ProfileScreen() {
  const [followPushEnabled, setFollowPushEnabled] = useState(false);
  const [followPushLoaded, setFollowPushLoaded] = useState(false);
  const [followPushBusy, setFollowPushBusy] = useState(false);

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

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>PROFIL</Text>
      <Text style={styles.title}>Sparade & inställningar</Text>
      <Text style={styles.subtitle}>
        Dina sparade events, kategorival och notis-inställningar hamnar här.
      </Text>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TOKENS.color.appBg,
    paddingHorizontal: TOKENS.space.lg,
    paddingTop: TOKENS.space.lg,
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
});
