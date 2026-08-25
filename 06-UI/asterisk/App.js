import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, Image, ActivityIndicator,
  StyleSheet, SafeAreaView,
} from 'react-native';

// autoGenServer (port 7790) är kontrollerad miljö — proxar events eftersom
// Supabase RLS blockerar anon SELECT på `events`. Klienten ska INTE nå
// Supabase direkt härifrån.
const AUTOGEN_SERVER = 'http://localhost:7790';

// Cache-bust query-param per sidmontering — Supabase Storage sätter
// cacheControl=31536000 (1 år) på uppladdade bilder, så samma URL serveras
// från webbläsarens disk-cache. Date.now() ger en unik ?v= per session.
const CACHE_BUST = `?v=${Date.now()}`;

export default function AsteriskApp() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${AUTOGEN_SERVER}/events-first?limit=10`);
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        if (cancelled) return;
        setEvents(data.events || []);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Kunde inte hämta events från autoGenServer.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>EventPulse — Hem-sektionen</Text>
        <Text style={styles.subtitle}>
          De 3 första publicerade eventsen • bilder genererade av BFL Flux
        </Text>

        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#888" />
            <Text style={styles.loadingText}>Hämtar events från autoGenServer...</Text>
          </View>
        )}

        {error && !loading && (
          <Text style={styles.errorText}>Fel: {error}</Text>
        )}

        {!loading && !error && events.length === 0 && (
          <Text style={styles.emptyText}>Inga events hittades.</Text>
        )}

        {!loading && !error && events.length > 0 && (
          <View style={styles.grid}>
            {events.map((ev) => (
              <View key={ev.id} style={styles.card}>
                {ev.image_url ? (
                  <Image
                    source={{ uri: `${ev.image_url}${CACHE_BUST}` }}
                    style={styles.cardImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.cardImage, styles.cardPlaceholder]}>
                    <Text style={styles.placeholderText}>ingen bild</Text>
                  </View>
                )}
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {ev.title || 'Titel saknas'}
                  </Text>
                  {ev.venue_name && (
                    <Text style={styles.cardVenue} numberOfLines={1}>
                      {ev.venue_name}
                    </Text>
                  )}
                  {ev.start_time && (
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {new Date(ev.start_time).toLocaleDateString('sv-SE', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footer}>
          Läsläge — bilder genereras via autoGenServer (port 7790), kontrollerad miljö
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 24 },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  loadingText: { color: '#888', fontSize: 13 },
  errorText: { color: '#ff8888', fontSize: 13, paddingVertical: 12 },
  emptyText: { color: '#888', fontSize: 14, paddingVertical: 24, textAlign: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  card: {
    width: '48%',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
  },
  cardImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#222',
  },
  cardPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { color: '#666', fontSize: 12 },
  cardBody: { padding: 10 },
  cardTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cardVenue: { color: '#888', fontSize: 12, marginTop: 4 },
  cardMeta: { color: '#22cc88', fontSize: 11, marginTop: 6, fontWeight: '600' },
  footer: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 32,
    fontStyle: 'italic',
  },
});