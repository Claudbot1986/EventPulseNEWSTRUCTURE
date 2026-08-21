/**
 * ProfileScreen placeholder — landed as part of #69 retention work.
 *
 * Full implementation pending. Once auth lands (Google/Facebook login was
 * discussed in this session's retention message; not yet implemented), this
 * screen will surface:
 *
 *   - Sparade events (favorites — already persisted via /agent/feedback
 *     with interaction='save')
 *   - Inställningar (kategorier från onboarding)
 *   - "Logga in" CTA when auth is implemented
 *
 * Until then: a minimal placeholder. Pure-black canvas per
 * `docs/UI-DESIGN.md`.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const TOKENS = {
  color: {
    appBg: '#000000',
    surface: '#000000',
    border: '#1A1A1A',
    text: '#F7F2EA',
    textMuted: '#A9B0BE',
    textSoft: '#727B8D',
    accent: '#FFB454',
  },
  space: { sm: 8, md: 12, lg: 16 },
  fontSize: { sm: 11, md: 13, lg: 16, xl: 22 },
};

export default function ProfileScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>PROFIL</Text>
      <Text style={styles.title}>Sparade & inställningar</Text>
      <Text style={styles.subtitle}>
        Här hamnar dina sparade events, dina kategorival och — i en framtida
        version — inloggning via Google eller Facebook.
      </Text>
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
  },
});