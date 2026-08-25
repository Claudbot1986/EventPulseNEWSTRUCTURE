/**
 * HemStarScreen — dedikerad `hem*`-flik i Expo Go.
 *
 * Visar de 10 första publicerade eventen från autoGenServer (port 7790) —
 * `/events-first?limit=10` returnerar events med redan AI-genererade
 * image_url:er i Supabase Storage (BFL Flux-dev / 1024x1024).
 *
 * För VARJE event visas:
 *   - AI-genererad bild (från events.image_url)
 *   - Titeln (title_sv || title_en)
 *   - Venue (venue_name)
 *   - Starttid (formaterad sv-SE)
 *   - AI-prompten som användes (rekonstruerad via summarizePrompt)
 *   - Modell-chip ("flux-dev")
 *   - "AI-genererad"-chip (EU AI Act §50)
 *
 * PROXY ANLEDNING: Direkt Supabase-anrop (eventServiceClient.fetchEvents)
 * ger HTTP 401 — anon key saknar SELECT på `events`-tabellen (RLS).
 * autoGenServer kör med SUPABASE_SERVICE_ROLE_KEY och proxy:ar events till
 * Expo. Samma mönster som hemknappen gör mot agentClient.
 *
 * Cache-bust: `?v=${Date.now()}` på image_url kringgår Supabase Storage
 * cacheControl=31536000 (1 år).
 *
 * Wire-flöde:
 *   1. Mount → fetch http://localhost:7790/events-first?limit=10
 *   2. Loading / error / empty / ready-states
 *   3. Varje event renderas med AI-bild + metadata + rekonstruerad prompt
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { summarizePrompt } from '../services/aiPromptClient';

// autoGenServer kör lokalt på 7790 på dev-maskinen.
// På Expo Go (native) är localhost = telefonen, så vi pekar mot Mac:ens
// LAN-IP. På web (port 8081 i browser) funkar localhost.
// För att overrida: sätt EXPO_PUBLIC_AUTOGEN_HOST i .env.local.
const AUTOGEN_HOST =
  Platform.OS === 'web'
    ? 'localhost'
    : (process.env.EXPO_PUBLIC_AUTOGEN_HOST || '192.168.68.110');
const AUTOGEN_URL = `http://${AUTOGEN_HOST}:7790`;

// Cache-bust query-param per sidmontering — Supabase Storage sätter
// cacheControl=31536000 (1 år) på uppladdade bilder, så samma URL serveras
// från webbläsarens disk-cache. Date.now() ger en unik ?v= per session.
const CACHE_BUST = `?v=${Date.now()}`;

// Säkerhetsgräns — även om autoGenServer defaultar till limit=20 vill vi visa
// exakt 20 (UI-design-spec — samma ordning som utforska-sektionen).
const MAX_EVENTS = 20;

// ─── TOKENS — mirrored from docs/UI-DESIGN.md (samma palett som HomeScreen) ─
const TOKENS = {
  color: {
    appBg: '#000000',
    surface: '#15151B',
    surfaceSoft: '#202635',
    surfaceCard: '#0E0E12',          // subtle card-bg för läsbarhet
    border: '#1A1A1A',
    borderStrong: '#2A2A33',
    text: '#FFFFFF',                // pure white — max kontrast mot svart
    textMuted: '#C4C9D4',           // ljusare muted (var #A9B0BE)
    textSoft: '#9CA3B0',
    accent: '#FFB454',
    accentSoft: '#3B2E1E',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { md: 12, lg: 18 },
};

export default function HemStarScreen({ onEventPress }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'empty' | 'error'
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch(`${AUTOGEN_URL}/events-first?limit=${MAX_EVENTS}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText || ''}`);
      }
      const body = await res.json();
      const list = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS) : [];
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
        <Text style={styles.title}>hem*</Text>
        <Text style={styles.subtitle}>
          10 första events med AI-genererade prompts och bilder (BFL Flux)
        </Text>
        <Text style={styles.eyebrow}>HEM* · AI-IMAGE PIPELINE</Text>

        {status === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator color={TOKENS.color.accent} />
          </View>
        )}

        {status === 'error' && (
          <View style={styles.center}>
            <Text style={styles.errorText}>Kunde inte hämta events: {error}</Text>
            <Pressable style={styles.retryBtn} onPress={load} accessibilityRole="button">
              <Text style={styles.retryText}>Försök igen</Text>
            </Pressable>
          </View>
        )}

        {status === 'empty' && (
          <View style={styles.center}>
            <Text style={styles.mutedText}>Inga publicerade events just nu.</Text>
            <Text style={styles.mutedTextSmall}>
              Kör ingestion-pipelinen och ladda om.
            </Text>
          </View>
        )}

        {status === 'ready' && events.map((ev) => {
          const imageUri = ev.image_url || ev.imageUrl;
          // Rekonstruera prompten från samma logik som autoGenServer.
          // Deterministiskt — samma event → samma prompt.
          const prompt = summarizePrompt(ev);
          return (
            <View key={ev.id} style={styles.card}>
              {imageUri ? (
                <Image
                  source={{ uri: `${imageUri}${CACHE_BUST}` }}
                  style={styles.cardImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
                  <Text style={styles.placeholderText}>ingen AI-bild</Text>
                </View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.cardTime}>{formatTime(ev.start_time)}</Text>
                <Pressable
                  onPress={() => onEventPress?.(ev)}
                  accessibilityRole="button"
                  accessibilityLabel={`${ev.title || 'Event'} — AI-genererad bild`}
                >
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {ev.title || ev.title_sv || 'Titel saknas'}
                  </Text>
                  <Text style={styles.cardVenue} numberOfLines={1}>
                    {ev.venue_name || 'Plats ej angiven'}
                  </Text>
                </Pressable>

                <View style={styles.chipRow}>
                  <Text style={styles.aiChip}>AI-genererad</Text>
                  <Text style={styles.modelChip}>flux-dev</Text>
                  <Text style={styles.categoryChip}>{prompt.category}</Text>
                </View>

                <View style={styles.promptBlock}>
                  <Text style={styles.promptLabel}>PROMPT</Text>
                  <Text style={styles.promptScene} numberOfLines={2}>
                    {prompt.scene}
                  </Text>
                  {prompt.venueHint ? (
                    <Text style={styles.promptHint} numberOfLines={1}>
                      📍 {prompt.venueHint}
                    </Text>
                  ) : null}
                  <Text style={styles.promptHint} numberOfLines={1}>
                    🎨 "{prompt.themeHint}"
                  </Text>
                </View>
              </View>
            </View>
          );
        })}

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
    lineHeight: 18,  // RN Web: number = px (INTE multiplikator). 18 ≈ 1.4× fontSize 13.
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
    backgroundColor: TOKENS.color.surfaceCard,
    borderWidth: 1,
    borderColor: TOKENS.color.borderStrong,
    borderRadius: TOKENS.radius.md,
    overflow: 'hidden',
    marginBottom: TOKENS.space.lg,
  },
  cardImage: {
    width: '100%',
    height: 280,
    backgroundColor: TOKENS.color.surfaceSoft,
  },
  cardImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: TOKENS.color.textSoft,
    fontSize: 12,
  },
  cardBody: {
    padding: TOKENS.space.lg,
  },
  cardTime: {
    color: TOKENS.color.accent,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: TOKENS.space.sm,
    letterSpacing: 0.06,
    textTransform: 'uppercase',
  },
  cardTitle: {
    color: TOKENS.color.text,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,  // RN Web: number = px (INTE multiplikator). 26 ≈ 1.3× fontSize 20.
    marginBottom: TOKENS.space.xs,
  },
  cardVenue: {
    color: TOKENS.color.textMuted,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  chipRow: {
    flexDirection: 'row',
    marginTop: TOKENS.space.md,
    flexWrap: 'wrap',
  },
  aiChip: {
    color: TOKENS.color.appBg,
    backgroundColor: TOKENS.color.accent,
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: TOKENS.space.sm + 2,
    paddingVertical: 4,
    borderRadius: 10,
    marginRight: TOKENS.space.sm,
    marginBottom: TOKENS.space.xs,
  },
  modelChip: {
    color: TOKENS.color.text,
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: TOKENS.space.sm + 2,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TOKENS.color.borderStrong,
    backgroundColor: TOKENS.color.surface,
    marginRight: TOKENS.space.sm,
    marginBottom: TOKENS.space.xs,
  },
  categoryChip: {
    color: TOKENS.color.textMuted,
    fontSize: 11,
    fontWeight: '500',
    paddingHorizontal: TOKENS.space.sm + 2,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TOKENS.color.borderStrong,
    backgroundColor: TOKENS.color.surface,
    marginBottom: TOKENS.space.xs,
    fontFamily: 'ui-monospace, Menlo, monospace',
  },
  promptBlock: {
    marginTop: TOKENS.space.md + 2,
    paddingTop: TOKENS.space.md,
    paddingBottom: TOKENS.space.xs,
    borderTopWidth: 1,
    borderTopColor: TOKENS.color.borderStrong,
  },
  promptLabel: {
    color: TOKENS.color.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.1,
    marginBottom: TOKENS.space.sm,
  },
  promptScene: {
    color: TOKENS.color.text,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,  // RN Web: number = px (INTE multiplikator). 22 ≈ 1.45× fontSize 15.
    marginBottom: TOKENS.space.sm,
  },
  promptHint: {
    color: TOKENS.color.text,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
    opacity: 0.85,
  },
  bottomSpacer: {
    height: 48,
  },
});