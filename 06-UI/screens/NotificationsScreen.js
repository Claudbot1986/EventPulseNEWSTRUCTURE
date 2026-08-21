/**
 * NotificationsScreen placeholder — landed as part of #69 retention work.
 *
 * Full implementation pending: this screen will read from
 * `08-Agent/runtime/notifications.jsonl` (planned) or `agentClient`'s
 * notification endpoint, and group items into:
 *
 *   - "Ny matchning för dig" — agent-flagged events
 *   - "Påminnelse" — events you've saved starting in <2h
 *   - "Kö-svar" — manual-review results (postB-preC items)
 *
 * Until then: a single-line empty state with an opt-in CTA. Pure-black
 * canvas per `docs/UI-DESIGN.md`.
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

export default function NotificationsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>NOTISER</Text>
      <Text style={styles.title}>Inga notiser än</Text>
      <Text style={styles.subtitle}>
        Så snart en ny matchning, påminnelse eller ett kö-svar är klart dyker
        det här. Tips: spara events för att få påminnelser 2 timmar innan.
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