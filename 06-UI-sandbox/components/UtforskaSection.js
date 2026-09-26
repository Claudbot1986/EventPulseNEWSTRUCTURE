// UtforskaSection — sandbox-version av Utforska-flödet, Spotify-stil.
//
// Design 2026-09-26: användaren visade Spotify-musiklistan som referens
// och bad om "såhär" — kompakta rader med thumbnail + titel/subtitle +
// 3-dot-meny, svart bakgrund, ingen dag-gruppering (datum i radens
// subtitle istället för dag-header ovanför).
//
// Sandbox-regler respekterade:
//   - Inga providers, ingen auth, ingen analytics.
//   - Mock-data istället för Supabase / agent-feed.
//   - paddingTop 48 (SPACING.md binding).
//   - Komponenten är Runnable-as-Is: `npx expo start` räcker i 06-UI-sandbox/.
//
// När den slutgiltiga varianten är klar: ersätt SectionList-blocket i
// 06-UI/App.js med denna komponent + flytta originalet (rad ~1165–1268
// inkl. EventItem/GroupedEventItem/LoadingMore) till 06-UI/utforska-section/.

import { Fragment, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import UtforskaEventActionSheet from './UtforskaEventActionSheet';

const TOKENS = {
  color: {
    bg: '#000000',
    thumbBg: '#1A1A1A',
    text: '#FFFFFF',
    textMuted: '#A9B0BE',
    textSoft: '#6F7785',
    placeholder: '#1F1F26',
    placeholderText: '#8B92A1',
    accent: '#FFB454',
    accentSoft: 'rgba(255, 180, 84, 0.18)',
  },
  font: {
    title:         { size: 17, weight: '600', letterSpacing: -0.2 },
    subtitle:      { size: 13, weight: '500' },
    badge:         { size: 11, weight: '800', letterSpacing: 0.5 },
    thumbFallback: { size: 18, weight: '900', letterSpacing: 0.5 },
    menu:          { size: 14, weight: '900' },
    eyebrow:       { size: 11, weight: '800', letterSpacing: 1.6 },
    heading:       { size: 28, weight: '900', letterSpacing: -0.8 },
    subhead:       { size: 13, weight: '500' },
  },
  space: {
    padX: 8,              // liten marginal på både höger och vänster
                         // (användarens val 2026-09-27 — helt flush var
                         // för mycket, men 16 var för mycket indrag)
    padTop: 48,           // SPACING.md binding
    padBottom: 32,
    rowGap: 0,            // separeras med rowHeight + border
    rowPadV: 10,
    thumbSize: 56,
    thumbRadius: 6,
    middleGap: 12,
    subtitleGap: 4,
    menuHit: 18,          // ⋯ knappens träffyta (användarens val
                         // 2026-09-27 — "avsevärt mindre" från 24)
  },
};

// Mock-events som ett platt fält (Spotify-stil — ingen dag-gruppering).
// Subtitle-fälten slås ihop till "datum · tid · venue · area" med
// valfri badge först (motsvarar Spotifys E/Video-pillar).
//
// Extra fält driver villkorliga actions i UtforskaEventActionSheet:
//   - hasTickets: true ⇒ "Öppna biljetter" visas
//   - venueName: icke-null ⇒ "Följ <venue>" visas
//   - artistName: icke-null ⇒ "Följ <artist>" visas
//   - category: icke-null ⇒ "Mindre av <kategori>" visas
//   - saved: true ⇒ "Spara" togglar från "Spara" till "Ta bort sparning"
//
// Bytas mot riktiga events_public-rader när komponenten flyttas in i 06-UI/.
const MOCK_EVENTS = [
  {
    id: 'u-1',
    title: 'Krogshow — Norra Latin',
    badge: 'MUSIK',
    subtitleParts: ['Lör 26 sep', '20:00', 'Norra Latin', 'Drottninggatan'],
    imageUrl: require('../assets/tile-1.png'),
    hasTickets: true,
    venueName: 'Norra Latin',
    artistName: null,
    category: 'MUSIK',
    saved: false,
  },
  {
    id: 'u-2',
    title: 'Standup — Norra Bantorget',
    badge: 'STANDUP',
    subtitleParts: ['Lör 26 sep', '19:00', 'Norra Bantorget', 'Norrmalm'],
    imageUrl: require('../assets/tile-3.png'),
    hasTickets: true,
    venueName: 'Norra Bantorget',
    artistName: 'John Moberg',
    category: 'STANDUP',
    saved: false,
  },
  {
    id: 'u-3',
    title: 'Festival i Tantolunden',
    badge: 'FESTIVAL',
    subtitleParts: ['Sön 27 sep', '12:00 + 15:00', 'Tantolunden', 'Södermalm'],
    imageUrl: require('../assets/tile-4.png'),
    hasTickets: true,
    venueName: 'Tantolunden',
    artistName: null,
    category: 'FESTIVAL',
    saved: true,
  },
  {
    id: 'u-4',
    title: 'Jazz på Fasching',
    badge: 'MUSIK',
    subtitleParts: ['Sön 27 sep', '20:00', 'Fasching', 'Kungsgatan'],
    imageUrl: require('../assets/tile-5.png'),
    hasTickets: true,
    venueName: 'Fasching',
    artistName: 'Ernst Rolf-jazzkvartett',
    category: 'MUSIK',
    saved: false,
  },
  {
    id: 'u-5',
    title: 'Teater — Gröna Tehuset',
    badge: 'TEATER',
    subtitleParts: ['Sön 27 sep', '18:00', 'Gröna Tehuset', 'Södermalm'],
    imageUrl: require('../assets/tile-2.png'),
    hasTickets: false,
    venueName: 'Gröna Tehuset',
    artistName: null,
    category: 'TEATER',
    saved: false,
  },
  {
    id: 'u-6',
    title: 'Brunch på Kontrast',
    badge: 'MAT',
    subtitleParts: ['Lör 26 sep', '11:00', 'Kontrast', 'Södermalm'],
    imageUrl: require('../assets/tile-1.png'),
    hasTickets: true,
    venueName: 'Kontrast',
    artistName: null,
    category: 'MAT',
    saved: false,
  },
  {
    id: 'u-7',
    title: 'Pubhäng — Pelikan',
    badge: null,
    subtitleParts: ['Lör 26 sep', '18:00', 'Pelikan', 'Södermalm'],
    imageUrl: require('../assets/tile-2.png'),
    hasTickets: false,
    venueName: 'Pelikan',
    artistName: null,
    category: null,
    saved: false,
  },
  {
    id: 'u-8',
    title: 'DJ-kväll på Berns',
    badge: 'MUSIK',
    subtitleParts: ['Lör 26 sep', '22:00', 'Berns', 'Berzelii Park'],
    imageUrl: require('../assets/tile-5.png'),
    hasTickets: true,
    venueName: 'Berns',
    artistName: 'DJ Formal',
    category: 'MUSIK',
    saved: false,
  },
];

function EventRow({ event, onPress, onMenuPress }) {
  const parts = event.subtitleParts.filter(Boolean);
  const line1 = parts.slice(0, 2).join(' · ');   // datum · tid
  const line2 = parts.slice(2).join(' · ');      // venue · area
  const subtitleText = [line1, line2].filter(Boolean).join(' · ');
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onPress?.(event)}
      accessibilityRole="button"
      accessibilityLabel={`${event.title} — ${subtitleText}`}
    >
      {event.imageUrl ? (
        <Image
          source={{ uri: event.imageUrl }}
          style={styles.thumb}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={styles.thumbFallback}>
          <Text style={styles.thumbFallbackText}>
            {(event.title || '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.middle}>
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
          {event.title}
        </Text>
        {(line1 || line2) ? (
          <View style={styles.subtitleColumn}>
            {line1 ? (
              <Text
                style={styles.subtitle}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {line1}
              </Text>
            ) : null}
            {line2 ? (
              <Text
                style={styles.subtitle}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {line2}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <Pressable
        onPress={() => onMenuPress?.(event)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Fler alternativ"
        style={({ pressed }) => [styles.menuBtn, pressed && styles.menuBtnPressed]}
      >
        <Text style={styles.menuDots}>⋯</Text>
      </Pressable>
    </Pressable>
  );
}

export default function UtforskaSection() {
  const [sheetEvent, setSheetEvent] = useState(null);

  const handlePress = (_event) => {
    // Sandbox-stub. I 06-UI/ ersätts detta med onEventPress → DetailsScreen.
  };
  const handleMenuPress = (event) => {
    setSheetEvent(event);
  };
  const closeSheet = () => {
    setSheetEvent(null);
  };
  const handleAction = (actionId, event, payload) => {
    // Sandbox-stub. I 06-UI/ ersätts detta med agentClient.recordEventInteraction /
    // shareSession / Linking.openURL enligt plan §10.
    // Parametrarna finns kvar så onboarding till 06-UI/ bara behöver
    // byta ut funktionskroppen, inte signaturen.
    void actionId;
    void event;
    void payload;
  };

  return (
    <Fragment>
      <ScrollView
        contentContainerStyle={styles.scroll}
        testID="utforska-section-screen"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headingRow}>
          <Text style={styles.eyebrow}>UTFORSKA · SANDBOX-PREVIEW</Text>
          <Text style={styles.heading}>Utforska-flödet</Text>
        </View>
        <Text style={styles.subhead}>
          Spotify-stil kompakta rader · {MOCK_EVENTS.length} mock-event · mock-data
          bytas mot riktig feed när komponenten flyttas in i 06-UI/.
        </Text>

        {MOCK_EVENTS.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            onPress={handlePress}
            onMenuPress={handleMenuPress}
          />
        ))}
      </ScrollView>

      <UtforskaEventActionSheet
        visible={sheetEvent !== null}
        event={sheetEvent}
        onClose={closeSheet}
        onAction={handleAction}
      />
    </Fragment>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: TOKENS.space.padTop,
    paddingHorizontal: TOKENS.space.padX,    // liten marginal båda sidor
                                              // (användarens val 2026-09-27
                                              // — helt flush var för mycket)
    paddingBottom: TOKENS.space.padBottom,
    backgroundColor: TOKENS.color.bg,
  },
  eyebrow: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.font.eyebrow.size,
    fontWeight: TOKENS.font.eyebrow.weight,
    letterSpacing: TOKENS.font.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  // headingRow — eyebrow + heading ligger på samma rad (användarens
  // val 2026-09-27: "den gula delen bör ligga vid rubriken"). Baseline-
  // alignment så det lilla eyebrow-texten sitter naturligt ihop med
  // den stora heading-texten.
  headingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  heading: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.heading.size,
    fontWeight: TOKENS.font.heading.weight,
    letterSpacing: TOKENS.font.heading.letterSpacing,
  },
  subhead: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.subhead.size,
    fontWeight: TOKENS.font.subhead.weight,
    lineHeight: 18,
    marginBottom: 20,
  },

  // Spotify-stil rad
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: TOKENS.space.rowPadV,
    borderBottomWidth: 0,
    gap: TOKENS.space.middleGap,
  },
  rowPressed: {
    opacity: 0.6,
  },
  thumb: {
    width: TOKENS.space.thumbSize,
    height: TOKENS.space.thumbSize,
    borderRadius: TOKENS.space.thumbRadius,
    backgroundColor: TOKENS.color.thumbBg,
  },
  thumbFallback: {
    width: TOKENS.space.thumbSize,
    height: TOKENS.space.thumbSize,
    borderRadius: TOKENS.space.thumbRadius,
    backgroundColor: TOKENS.color.placeholder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFallbackText: {
    color: TOKENS.color.placeholderText,
    fontSize: TOKENS.font.thumbFallback.size,
    fontWeight: TOKENS.font.thumbFallback.weight,
    letterSpacing: TOKENS.font.thumbFallback.letterSpacing,
  },
  middle: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  title: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.title.size,
    fontWeight: TOKENS.font.title.weight,
    letterSpacing: TOKENS.font.title.letterSpacing,
  },
  subtitleColumn: {
    flexDirection: 'column',
    marginTop: TOKENS.space.subtitleGap,
    gap: 2,
  },
  subtitle: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.subtitle.size,
    fontWeight: TOKENS.font.subtitle.weight,
    flexShrink: 1,
  },
  menuBtn: {
    width: TOKENS.space.menuHit,
    height: TOKENS.space.menuHit,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: TOKENS.space.menuHit / 2,
  },
  menuBtnPressed: {
    opacity: 0.5,
  },
  menuDots: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.font.menu.size,
    fontWeight: TOKENS.font.menu.weight,
    lineHeight: TOKENS.font.menu.size,
  },
});
