// UtforskaSection — port från 06-UI-sandbox (2026-09-27). Samma stil och
// utförande som sandbox-versionen, UI-only — MOCK_EVENTS och
// actions-stubbar bytas mot riktiga flöden i en senare integrationsomgång.
//
// Design 2026-09-26: användaren visade Spotify-musiklistan som referens
// och bad om "såhär" — kompakta rader med thumbnail + titel/subtitle +
// 3-dot-meny, svart bakgrund, ingen dag-gruppering (datum i radens
// subtitle istället för dag-header ovanför).

import { Fragment, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import UtforskaEventActionSheet from './UtforskaEventActionSheet';
// 2026-10-02 — UI-preview för description (5.1). Använd samma helper som
// DetailsScreen för att hålla beskrivnings-källan konsistent (description-,
// description_sv-, description_en-fälten) och ignorera placeholder-text.
import { getRowDescriptionPreview } from '../utils/descriptionFallback';

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
    heading:       { size: 24, weight: '900', letterSpacing: -0.6 },
    subhead:       { size: 13, weight: '500' },
  },
  space: {
    padX: 4,              // minimal marginal — listan nästan kant-till-kant
                         // (användarens val 2026-09-27 — "lite mer svart"
                         // önskas nu när sandbox-wrapper-marginalen är borta)
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
// Bytas mot riktiga events_public-rader i en senare integrationsomgång.
const MOCK_EVENTS = [
  {
    id: 'u-1',
    title: 'Krogshow — Norra Latin',
    badge: 'MUSIK',
    subtitleParts: ['LÖR 26 sep', '20:00', 'Norra Latin', 'Drottninggatan'],
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
    subtitleParts: ['LÖR 26 sep', '19:00', 'Norra Bantorget', 'Norrmalm'],
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
    subtitleParts: ['SÖN 27 sep', '12:00 + 15:00', 'Tantolunden', 'Södermalm'],
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
    subtitleParts: ['SÖN 27 sep', '20:00', 'Fasching', 'Kungsgatan'],
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
    subtitleParts: ['SÖN 27 sep', '18:00', 'Gröna Tehuset', 'Södermalm'],
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
    subtitleParts: ['LÖR 26 sep', '11:00', 'Kontrast', 'Södermalm'],
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
    subtitleParts: ['LÖR 26 sep', '18:00', 'Pelikan', 'Södermalm'],
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
    subtitleParts: ['LÖR 26 sep', '22:00', 'Berns', 'Berzelii Park'],
    imageUrl: require('../assets/tile-5.png'),
    hasTickets: true,
    venueName: 'Berns',
    artistName: 'DJ Formal',
    category: 'MUSIK',
    saved: false,
  },
];

// SkeletonRow (2026-10-01): spegelbild av EventRow:s layout (56×56 tumme,
// titel-rad, undertext-rad, 18×18 ⋯-knapp). Används i loading-tillstånd
// så rullistan visar rätt form innan data landar — samma princip som
// LoadingSkeleton speglar HomeScreen:s utforska-layout. Bakgrundsfärg
// matchar thumb- och text-bakgrunderna så det visuella språket är
// konsistent.
function SkeletonRow() {
  return (
    <View
      style={styles.row}
      accessibilityRole="none"
      importantForAccessibility="no"
    >
      <View style={[styles.thumb, styles.skeletonThumb]} />
      <View style={styles.middle}>
        <View style={styles.skeletonTitle} />
        <View style={styles.skeletonSubtitle} />
      </View>
      <View style={[styles.menuBtn, styles.skeletonMenu]} />
    </View>
  );
}

function EventRow({ event, onPress, onMenuPress }) {
  const parts = event.subtitleParts.filter(Boolean);
  const line1 = parts.slice(0, 2).join(' · ');   // datum · tid
  const line2 = parts.slice(2).join(' · ');      // venue · area
  const subtitleText = [line1, line2].filter(Boolean).join(' · ');
  // 2026-10-02 — preview-rad (5.1): visa 2 rader av beskrivningen under
  // subtitle om den finns. Använd getRowDescriptionPreview så samma regler
  // för placeholders och språk-fallback som DetailsScreen gäller.
  const preview = getRowDescriptionPreview(event);
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
        {preview ? (
          // 2026-10-02 — description-preview-rad (5.1). numberOfLines={2}
          // ellipsizeMode="tail" så långa beskrivningar inte trycker
          // undan resten av listan.
          <Text
            style={styles.preview}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {preview}
          </Text>
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

export default function UtforskaSection({
  events = null,
  emptyState = null,
  emptyText = null,
  eyebrowText = null,
  // 2026-10-01: Tap på en event-rad öppnar samma DetailsScreen som Hem
  // använder (via App.js handleEventPress). Propageras från
  // ExploreDetailScreen så ALLA rullistor i Utforska (kategori-tiles,
  // 18 v2-knappar, mock-sandbox) får identiskt beteende — inga nya
  // eventkort-typer skapas. Default null = sandbox-default där tap
  // är no-op (befintligt beteende innan integration).
  onEventPress = null,
  // 2026-10-01: totalCount är antalet events i DB för aktuell route (t.ex.
  // opera), returnerat av feed_events.total. När satt används det i eyebrow-
  // rubriken ("8 EVENEMANG") istället för items.length — annars skulle
  // headern visa 15 (den lokala sid-längden) även när DB har 200 events i
  // kategorin eller 3. null = "laddar fortfarande" eller sandbox-preview.
  totalCount = null,
  // raisedFromBottom (2026-09-28): Lyft listan från nederkanten så den inte
  // sitter helt plant mot skärmens botten. Används av ALLA utforska-tiles
  // via ExploreDetailScreen (+8 pt). Default false så fristående bruk
  // (mock-preview) behåller baseline.
  raisedFromBottom = false,
  // Infinite scroll (2026-09-28): ExploreDetailScreen skickar in en callback
  // som triggas när ScrollView når slutet av innehållet. loadingMore styr
  // om en "Laddar fler…"-rad ska visas längst ner. Default null innebär
  // fristående bruk (mock-preview / tester) — ingen scroll-hämtning.
  onEndReached = null,
  loadingMore = false,
  // loadingSkeletonCount (2026-10-01): antal SkeletonRow-platser som
  // visas när emptyState === 'loading' och items.length === 0. Spegelbild
  // av EventRow:s layout (56×56 tumme + titel + undertext + ⋯). Default
  // 6 — tillräckligt för att fylla första skärmbilden utan att kännas
  // överväldigande. Sätts av ExploreDetailScreen för att kunna justeras
  // per route om det behövs.
  loadingSkeletonCount = 6,
}) {
  // events=null innebär sandbox-default (mock). Annars riktig data från
  // ExploreDetailScreen via mapAgentEventToRow.
  const items = events ?? MOCK_EVENTS;
  const isMock = events === null;
  const [sheetEvent, setSheetEvent] = useState(null);

  // Infinite-scroll-detektor (2026-09-28): mäter avstånd till botten i pt
  // via ScrollView:s onScroll-event. 200 pt (~2 rader) är tröskeln.
  // Använder en ref-skyddad flagga så callback inte bränns av flera
  // onScroll-händelser i rad innan föräldern hunnit uppdatera state.
  const endReachedLockRef = useRef(false);
  const handleScroll = (e) => {
    if (!onEndReached || endReachedLockRef.current || !items.length) return;
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height
      - (contentOffset.y + layoutMeasurement.height);
    if (distanceFromBottom < 200) {
      endReachedLockRef.current = true;
      onEndReached();
      // Lås upp efter en kort stund så nästa page (om någon) kan trigga
      // nästa händelse. Förälderns setLoadingMore håller redan dubbel-
      // fetch borta via sin egen loadingMore-state, detta är bara en
      // scroll-event-dämpare.
      setTimeout(() => { endReachedLockRef.current = false; }, 500);
    }
  };

  const handlePress = (event) => {
    // 2026-10-01: Rad-tap öppnar samma DetailsScreen som Hem använder
    // (App.js handleEventPress → setSelectedEvent). Föräldern ansvarar
    // för att skicka in onEventPress; sandbox-default (null) bevarar
    // no-op-beteendet tills integrationen är påkopplad.
    onEventPress?.(event);
  };
  const handleMenuPress = (event) => {
    setSheetEvent(event);
  };
  const closeSheet = () => {
    setSheetEvent(null);
  };
  const handleAction = (actionId, event, payload) => {
    // UI-only port från sandbox — actions är no-op tills riktiga
    // agentClient.recordEventInteraction / shareSession / Linking.openURL
    // kopplas in. Parametrarna finns kvar så onboarding bara kräver
    // funktionskropps-bytet, inte signatur-ändring.
    void actionId;
    void event;
    void payload;
  };

  // Rubrik: dynamisk när riktig data visas (t.ex. "IMORGON · 8 EVENEMANG" när
  // 8 imorgon-events finns i DB), oförändrad sandbox-marker när mock-events
  // används.
  //
  // 2026-10-01: antal i headern kommer från totalCount (DB-count från feed_events
  // serversidan) när proppen är satt. Innan första fetch landat (totalCount
  // === null) faller vi tillbaka till items.length så användaren aldrig ser
  // "0 EVENEMANG" mitt i en pågående laddning. items.length som fallback är
  // ett tillfälligt "vi vet inte ännu"-värde, inte önskat sluttilstånd.
  const eyebrowCount = totalCount ?? items.length;
  const eyebrow = isMock
    ? 'UTFORSKA · SANDBOX-PREVIEW'
    : (eyebrowText || 'UTFORSKA').toUpperCase() + ' · ' + eyebrowCount + ' EVENEMANG';
  const heading = isMock ? 'Utforska-flödet' : (eyebrowText || 'Utforska');
  const subhead = isMock
    ? `Spotify-stil kompakta rader · ${MOCK_EVENTS.length} mock-event · mock-data bytas mot riktig feed i senare integrationsomgång.`
    : null;
  const emptyTextResolved = emptyText || (
    emptyState === 'loading' ? 'Laddar…'
      : emptyState === 'error' ? 'Kunde inte hämta evenemang. Försök igen.'
        : emptyState === 'empty' ? 'Inga evenemang just nu.'
          : null
  );

  return (
    <Fragment>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          raisedFromBottom && styles.scrollRaised,
        ]}
        testID="utforska-section-screen"
        showsVerticalScrollIndicator={false}
        onScroll={onEndReached ? handleScroll : undefined}
        scrollEventThrottle={onEndReached ? 64 : undefined}
      >
        <View style={styles.headingRow}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.heading}>{heading}</Text>
        </View>
        {subhead ? (
          <Text style={styles.subhead}>{subhead}</Text>
        ) : null}

        {items.length === 0 ? (
          // Loading (2026-10-01): spegelbild av EventRow:s layout istället
          // för "Laddar…"-text — samma princip som LoadingSkeleton speglar
          // HomeScreen:s utforska-layout. Användaren ser rätt form direkt
          // utan layout-hop när datan landar. Error/empty behåller text.
          emptyState === 'loading' ? (
            Array.from({ length: loadingSkeletonCount }).map((_, idx) => (
              <SkeletonRow key={`skel-${idx}`} />
            ))
          ) : emptyTextResolved ? (
            <Text style={styles.subhead}>{emptyTextResolved}</Text>
          ) : null
        ) : null}

        {items.map((event, idx) => (
          // 2026-10-02 (key collision safety): även om backend returnerar
          // dubletter av samma event-id så kan React annars varna "two
          // children with the same key" i dev. Index-prefix garanterar
          // unika keys även när event.id kolliderar mellan syskon-rader.
          <EventRow
            key={event.id ? `${idx}-${event.id}` : `idx-${idx}`}
            event={event}
            onPress={handlePress}
            onMenuPress={handleMenuPress}
          />
        ))}

        {loadingMore ? (
          <Text style={styles.subhead}>Laddar fler…</Text>
        ) : null}
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
    paddingHorizontal: TOKENS.space.padX,    // padX=4 → 4px luft på varje sida
                                              // (användarens val 2026-09-27)
    paddingBottom: TOKENS.space.padBottom,
    backgroundColor: TOKENS.color.bg,
  },
  // raisedFromBottom override (2026-09-28): +8 pt paddingBottom (4 + 4
  // extra efter andra designrundan) så listan inte ligger helt plant mot
  // skärmkanten. Tillämpas på ALLA utforska-tiles via ExploreDetailScreen.
  scrollRaised: {
    paddingBottom: TOKENS.space.padBottom + 8,
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
  // 2026-10-02 — preview-rad (5.1): mjukare färg än subtitle, mindre
  // font, några extra pixlar ovanför för separation.
  preview: {
    color: TOKENS.color.textSoft,
    fontSize: TOKENS.font.subtitle.size - 1,
    fontWeight: '400',
    marginTop: 6,
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

  // Skeleton (2026-10-01): placeholders som ärver samma stil som sina
  // motsvarigheter (thumb, title, subtitle, menuBtn) och bara lägger på
  // en grå bakgrund (TOKENS.color.thumbBg). Formen (storlek/radie/
  // marginal) matchar 1:1 så SkeletonRow ser identisk ut som en riktig
  // EventRow fast med grå rutor istället för text/bild.
  skeletonThumb: {
    backgroundColor: TOKENS.color.thumbBg,
  },
  skeletonTitle: {
    height: TOKENS.font.title.size, // 17 — matchar titel-radens fontSize
    width: '70%',
    backgroundColor: TOKENS.color.thumbBg,
    borderRadius: 4,
    marginBottom: TOKENS.space.subtitleGap, // 4 — matchar subtitleGap
  },
  skeletonSubtitle: {
    height: TOKENS.font.subtitle.size, // 13 — matchar subtitle fontSize
    width: '50%',
    backgroundColor: TOKENS.color.thumbBg,
    borderRadius: 4,
  },
  skeletonMenu: {
    backgroundColor: TOKENS.color.thumbBg,
  },
});