/**
 * OnboardingScreen — first-run preference capture (#71).
 *
 * Shown immediately after splash on cold start. Single full-screen question:
 * "Vad är du intresserad av?" with multi-select chips.
 *
 * Categories chosen per the user's 2026-08-21 retention spec:
 *   - konserter, utställningar, sport, barn & familj, gratis, kväll, helg
 *
 * Why one question instead of a wizard:
 *   - Apple HIG + NN-g retention research both flag onboarding fatigue as
 *     the #1 cause of first-session drop-off. One question, max 7 chips,
 *     "Hoppa över" CTA. The user can always refine categories later from
 *     ProfileScreen.
 *
 * Storage:
 *   - `eventpulse.onboarding_complete` = '1' (boolean-as-string)
 *   - `eventpulse.preferences.categories` = JSON array of selected slugs
 *   Both via the existing storage abstraction (`services/storage.js`),
 *   which falls back to in-memory if AsyncStorage is unavailable.
 *
 * No Supabase write today: preferences live client-side only. The agent's
 * personalization experiment (#73) will read these locally before adding
 * server-side persistence. No premature DB schema additions.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';

import { getItem, setItem } from '../services/storage';

const ONBOARDING_COMPLETE_KEY = 'eventpulse.onboarding_complete';
const PREFERENCES_KEY = 'eventpulse.preferences.categories';

const CATEGORIES = [
  { slug: 'music', label: 'Konserter' },
  { slug: 'exhibitions', label: 'Utställningar' },
  { slug: 'sports', label: 'Sport' },
  { slug: 'family', label: 'Barn & familj' },
  { slug: 'free', label: 'Gratis' },
  { slug: 'nightlife', label: 'Kvällar' },
  { slug: 'weekend', label: 'Helger' },
];

const TOKENS = {
  color: {
    appBg: '#000000',
    border: '#1A1A1A',
    borderActive: '#FFB454',
    text: '#F7F2EA',
    textMuted: '#A9B0BE',
    textSoft: '#727B8D',
    accent: '#FFB454',
    chipBgActive: '#FFB45422',
    chipTextActive: '#FFB454',
    chipBg: 'transparent',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  fontSize: { sm: 11, md: 13, lg: 16, xl: 22, xxl: 28 },
  radius: { md: 12, lg: 999 },
};

async function loadPreferences() {
  try {
    const raw = await getItem(PREFERENCES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

async function savePreferences(slugs) {
  try {
    await setItem(PREFERENCES_KEY, JSON.stringify(slugs));
    await setItem(ONBOARDING_COMPLETE_KEY, '1');
  } catch {
    // Best-effort: onboarding still completes in-memory this session.
  }
}

export default function OnboardingScreen({ onComplete }) {
  const [selected, setSelected] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPreferences().then((prefs) => {
      if (!alive) return;
      setSelected(prefs);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback((slug) => {
    setSelected((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  }, []);

  const complete = useCallback(async () => {
    await savePreferences(selected);
    onComplete?.(selected);
  }, [selected, onComplete]);

  const skip = useCallback(async () => {
    await savePreferences([]);
    onComplete?.([]);
  }, [onComplete]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>VÄLKOMMEN TILL EVENTPULSE</Text>
        <Text style={styles.title}>Vad är du intresserad av?</Text>
        <Text style={styles.subtitle}>
          Välj en eller flera kategorier. Vi använder dem för att visa relevanta
          evenemang först i din hemvy. Du kan ändra när som helst under
          Profil.
        </Text>

        {!ready ? (
          <Text style={styles.loadingHint}>Laddar…</Text>
        ) : (
          <View style={styles.chips}>
            {CATEGORIES.map((cat) => {
              const isOn = selected.includes(cat.slug);
              return (
                <Pressable
                  key={cat.slug}
                  onPress={() => toggle(cat.slug)}
                  style={({ pressed }) => [
                    styles.chip,
                    isOn && styles.chipActive,
                    pressed && styles.chipPressed,
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isOn }}
                  accessibilityLabel={cat.label}
                >
                  <Text style={[styles.chipText, isOn && styles.chipTextActive]}>{cat.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={skip} style={styles.skipButton} accessibilityRole="button">
          <Text style={styles.skipText}>Hoppa över</Text>
        </Pressable>
        <Pressable
          onPress={complete}
          disabled={!ready}
          style={({ pressed }) => [
            styles.continueButton,
            pressed && styles.continueButtonPressed,
            !ready && styles.continueButtonDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Fortsätt till EventPulse"
        >
          <Text style={styles.continueText}>{selected.length > 0 ? 'Fortsätt' : 'Fortsätt utan val'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TOKENS.color.appBg,
  },
  scrollContent: {
    paddingHorizontal: TOKENS.space.xl,
    paddingTop: TOKENS.space.xxl * 2,
    paddingBottom: TOKENS.space.xxl,
  },
  eyebrow: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.fontSize.sm,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginBottom: TOKENS.space.md,
  },
  title: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.xxl,
    fontWeight: '700',
    marginBottom: TOKENS.space.md,
  },
  subtitle: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.md,
    lineHeight: 22,
    marginBottom: TOKENS.space.xl,
  },
  loadingHint: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.fontSize.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TOKENS.space.md,
  },
  chip: {
    paddingVertical: TOKENS.space.md,
    paddingHorizontal: TOKENS.space.lg,
    borderRadius: TOKENS.radius.lg,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    backgroundColor: TOKENS.color.chipBg,
  },
  chipActive: {
    borderColor: TOKENS.color.borderActive,
    backgroundColor: TOKENS.color.chipBgActive,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipText: {
    color: TOKENS.color.text,
    fontSize: TOKENS.fontSize.lg,
    fontWeight: '500',
  },
  chipTextActive: {
    color: TOKENS.color.chipTextActive,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: TOKENS.space.xl,
    paddingTop: TOKENS.space.md,
    paddingBottom: TOKENS.space.xl,
    borderTopWidth: 1,
    borderTopColor: TOKENS.color.border,
    backgroundColor: TOKENS.color.appBg,
  },
  skipButton: {
    paddingVertical: TOKENS.space.md,
    paddingHorizontal: TOKENS.space.md,
  },
  skipText: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.fontSize.md,
    fontWeight: '500',
  },
  continueButton: {
    paddingVertical: TOKENS.space.md,
    paddingHorizontal: TOKENS.space.xl,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.accent,
  },
  continueButtonPressed: {
    opacity: 0.85,
  },
  continueButtonDisabled: {
    opacity: 0.5,
  },
  continueText: {
    color: '#1A1206',
    fontSize: TOKENS.fontSize.lg,
    fontWeight: '700',
  },
});