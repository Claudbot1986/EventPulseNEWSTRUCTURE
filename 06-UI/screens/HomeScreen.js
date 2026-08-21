/**
 * HomeScreen placeholder — full implementation lands in #72.
 *
 * Currently shows a "Coming soon" state with the categories the user
 * will be able to opt into (Ikväll / Denna helg / Rekommenderat /
 * Gratis). The real version (see task #72) will:
 *
 *   - Use AI-personalized ranking wired into the agent (#73)
 *   - Surface events the user has saved (favorites from /agent/feedback)
 *   - Show "Tonight", "This Weekend", "Free", "Editor's picks" rows
 *     backed by research in memory `feedback_ux_research_first.md`
 *
 * Visible from tab bar; needs to look intentional, not broken.
 * Pure-black canvas + accent yellow per `docs/UI-DESIGN.md`.
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

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>SNART TILLGÄNGLIGT</Text>
      <Text style={styles.title}>Personlig feed</Text>
      <Text style={styles.subtitle}>
        En AI-driven hemvy som lär sig dina intressen över tid. Tills dess —
        använd Utforska för att bläddra bland alla events.
      </Text>

      <View style={styles.rowsPreview}>
        {['Ikväll', 'Denna helg', 'Sparade', 'Gratis', 'Rekommenderat'].map(
          (label) => (
            <View key={label} style={styles.rowChip}>
              <Text style={styles.rowLabel}>{label}</Text>
            </View>
          ),
        )}
      </View>
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
    marginBottom: TOKENS.space.lg,
  },
  rowsPreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TOKENS.space.sm,
  },
  rowChip: {
    paddingVertical: 6,
    paddingHorizontal: TOKENS.space.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    backgroundColor: 'transparent',
  },
  rowLabel: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '500',
  },
});