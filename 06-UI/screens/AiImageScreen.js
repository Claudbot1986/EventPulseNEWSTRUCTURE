/**
 * AiImageScreen — dedikerad `*`-flik i Expo Go.
 *
 * Visar de 10 AI-genererade eventbilderna vertikalt (BFL Flux 2 [klein] 4B
 * pinned via `?provider=flux-2-klein-4b`). Smoketest-granskning är
 * huvudsyftet just nu — HomeScreen-sektionen `AiImageSmoketestSection` är
 * oförändrad och tas bort i separat commit senare.
 *
 * Wire-flöde:
 *   1. Mount → fetchAiImageSmoketest({ limit: 10, provider: 'flux-2-klein-4b' })
 *   2. Loading / error / empty / ready-states
 *   3. Tap på kort → onEventPress(event) → App.js öppnar DetailsScreen
 *
 * EU AI Act Art. 50-disclosure: varje kort visar
 *   - "AI-genererad"-chip
 *   - modell-chip ("flux-2-klein-4b")
 *   - prompt_hash (för verifierbarhet)
 *
 * Säker promptning/PII-städning sker på serversidan
 * (`08-Agent/middleware/ai_image_static.ts` + `scripts/build_safe_prompt.ts`).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchAiImageSmoketest } from '../services/agentClient';

// ─── TOKENS — mirrored from docs/UI-DESIGN.md (samma palett som HomeScreen) ─
const TOKENS = {
  color: {
    appBg: '#000000',
    surface: '#15151B',
    surfaceSoft: '#202635',
    border: '#1A1A1A',
    text: '#F7F2EA',
    textMuted: '#A9B0BE',
    textSoft: '#727B8D',
    accent: '#FFB454',
    accentSoft: '#3B2E1E',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { md: 12, lg: 18 },
};

export default function AiImageScreen({ onEventPress }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'empty' | 'error'
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await fetchAiImageSmoketest({
        limit: 10,
        provider: 'flux-2-klein-4b',
      });
      const list = Array.isArray(res?.events) ? res.events : [];
      setEvents(list);
      setStatus(list.length > 0 ? 'ready' : 'empty');
    } catch (err) {
      const msg = err && typeof err.message === 'string' ? err.message : 'okänt fel';
      setError(msg);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>*</Text>
        <Text style={styles.subtitle}>
          10 AI-genererade bilder från BFL Flux 2 [klein] 4B
        </Text>
        <Text style={styles.eyebrow}>SMOKETEST · EU AI ACT §50</Text>

        {status === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator color={TOKENS.color.accent} />
          </View>
        )}

        {status === 'error' && (
          <View style={styles.center}>
            <Text style={styles.errorText}>Kunde inte hämta AI-bilder: {error}</Text>
            <Pressable style={styles.retryBtn} onPress={load} accessibilityRole="button">
              <Text style={styles.retryText}>Försök igen</Text>
            </Pressable>
          </View>
        )}

        {status === 'empty' && (
          <View style={styles.center}>
            <Text style={styles.mutedText}>Inga bilder genererade ännu.</Text>
            <Text style={styles.mutedTextSmall}>
              Kör generator-scriptet och ladda om.
            </Text>
          </View>
        )}

        {status === 'ready' && events.map((ev) => (
          <Pressable
            key={ev.id}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => onEventPress?.(ev)}
            accessibilityRole="button"
            accessibilityLabel={`${ev.title || 'AI-genererat event'} (AI-genererad bild)`}
          >
            {ev.image_url || ev.imageUrl ? (
              <Image
                source={{ uri: ev.image_url || ev.imageUrl }}
                style={styles.cardImage}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
                {/* Användaren bad 2026-08-25 om "no credits BFL - recharge"-
                    text när BFL-kredit är slut (status='no_credits').
                    Visar samma placeholder-yta som annars saknar bild. */}
                <Text style={styles.placeholderText}>
                  {ev.image_generation_status === 'no_credits'
                    ? 'no credits BFL - recharge'
                    : 'ingen AI-bild'}
                </Text>
              </View>
            )}
            <View style={styles.cardBody}>
              <Text style={styles.cardTime}>{formatTime(ev.start_time)}</Text>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {ev.title || 'Untitled'}
              </Text>
              <Text style={styles.cardVenue} numberOfLines={1}>
                {ev.venue_name || 'Plats ej angiven'}
              </Text>
              <View style={styles.chipRow}>
                <Text style={styles.aiChip}>AI-genererad</Text>
                <Text style={styles.modelChip}>{ev.model || 'flux-2-klein-4b'}</Text>
                {ev.prompt_hash ? (
                  <Text style={styles.hashChip}>hash {ev.prompt_hash.slice(0, 8)}…</Text>
                ) : null}
              </View>
            </View>
          </Pressable>
        ))}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('sv-SE', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: TOKENS.color.appBg,
  },
  scroll: {
    paddingHorizontal: TOKENS.space.xl,
    paddingTop: TOKENS.space.xl,
  },
  title: {
    color: TOKENS.color.text,
    fontSize: 64,
    fontWeight: '300',
    letterSpacing: -2,
    marginBottom: TOKENS.space.sm,
  },
  subtitle: {
    color: TOKENS.color.textMuted,
    fontSize: 13,
    marginBottom: TOKENS.space.xs,
    lineHeight: 1.4,
  },
  eyebrow: {
    color: TOKENS.color.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.08,
    textTransform: 'uppercase',
    marginBottom: TOKENS.space.xl,
  },
  center: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  errorText: {
    color: TOKENS.color.text,
    fontSize: 14,
    marginBottom: TOKENS.space.md,
    textAlign: 'center',
    paddingHorizontal: TOKENS.space.lg,
  },
  retryBtn: {
    paddingHorizontal: TOKENS.space.lg,
    paddingVertical: TOKENS.space.sm,
    borderRadius: TOKENS.radius.md - 4,
    borderWidth: 1,
    borderColor: TOKENS.color.accent,
  },
  retryText: {
    color: TOKENS.color.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  mutedText: {
    color: TOKENS.color.textMuted,
    fontSize: 14,
  },
  mutedTextSmall: {
    color: TOKENS.color.textSoft,
    fontSize: 11,
    marginTop: TOKENS.space.xs,
  },
  card: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    borderRadius: TOKENS.radius.md,
    overflow: 'hidden',
    marginBottom: TOKENS.space.lg,
  },
  cardPressed: {
    borderColor: TOKENS.color.accent,
  },
  cardImage: {
    width: '100%',
    height: 280,
    backgroundColor: TOKENS.color.surfaceSoft,
  },
  // Användaren bad 2026-08-25 om "no credits BFL - recharge"-text vid BFL-
  // kredit slut. Samma placeholder-yta som HemStarScreen.
  cardImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: TOKENS.color.accent,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: TOKENS.space.md,
  },
  cardBody: {
    padding: TOKENS.space.md + 2,
  },
  cardTime: {
    color: TOKENS.color.accent,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: TOKENS.space.xs,
    letterSpacing: 0.04,
    textTransform: 'uppercase',
  },
  cardTitle: {
    color: TOKENS.color.text,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 1.25,
    marginBottom: TOKENS.space.xs,
  },
  cardVenue: {
    color: TOKENS.color.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  chipRow: {
    flexDirection: 'row',
    marginTop: TOKENS.space.md - 2,
    flexWrap: 'wrap',
  },
  aiChip: {
    color: TOKENS.color.accent,
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: TOKENS.space.sm,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    marginRight: TOKENS.space.sm,
    marginBottom: TOKENS.space.xs,
  },
  modelChip: {
    color: TOKENS.color.textSoft,
    fontSize: 10,
    fontWeight: '500',
    paddingHorizontal: TOKENS.space.sm,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    marginRight: TOKENS.space.sm,
    marginBottom: TOKENS.space.xs,
  },
  hashChip: {
    color: TOKENS.color.textSoft,
    fontSize: 10,
    fontWeight: '400',
    paddingHorizontal: TOKENS.space.sm,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    marginBottom: TOKENS.space.xs,
    fontFamily: 'ui-monospace, Menlo, monospace',
  },
  bottomSpacer: {
    height: 48,
  },
});
