// EventPulseCarousel — horisontellt scrollbar kort-rad i Spotify-författar-
// stil (kvadratisk bild + titel + subtitle, mörk bakgrund).
//
// Bildformat: 187×187px kvadratisk (`aspectRatio: 1`). Korten är 187px breda
// med 16px gap, wrappern har -20px marginal så första kortet ligger kant-i-
// kant med skärmen (samma känsla som Spotify, Audible, etc.).
//
// Data är en dynamisk array — komponenten äger inte innehållet. Användaren
// av komponenten bygger listan och skickar in den:
//
//   const cards = [
//     { id: 'helg', title: 'Helgens alla händelser', subtitle: 'Helg',
//       imageUrl: require('../assets/exploreTiles/helg.png'),
//       onPress: () => openUtforska({ prompt_text: 'Helgens evenemang', dayFilter: 'weekend' }) },
//     ...
//   ];
//   <EventPulseCarousel cards={cards} headerText="Tid" />
//
// Bildkrav: 1:1 (kvadratisk), AI-genererade bilder förväntas vara stämplade
// med "● AI-genererad" i nedre-vänstra hörnet (samma pipeline som prod).
// Om imageUrl saknas renderas en placeholder (mörk View med subtitle-text).
//
// Loading: om `loading` är true visas `skeletonCount` (default 4) skeleton-
// kort i samma storlek så layouten är stabil medan datan hämtas.
//
// i18n: titel + subtitle förväntas redan vara översatta av anroparen. Ingen
// useI18n-hook inuti — komponenten är ren.
//
// Format-spec från sandbox: 06-UI-sandbox/components/HorizontalCardCarousel.js
// (skillnad: sandbox använder konstanter i CARDS/CARD_SOURCES, denna är
// datadriven).

import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
} from 'react-native';

const TOKENS = {
  color: {
    bg: '#000000',
    border: '#1A1A1A',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
    placeholder: '#3A4254',
    skeleton: '#15151B',
  },
};

const CARD_WIDTH = 187;
const SKELETON_DEFAULT_COUNT = 4;

function Card({ title, subtitle, imageUrl, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${subtitle} — ${title}`}
    >
      <View style={styles.imageWrap}>
        {imageUrl ? (
          <Image source={imageUrl} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>{subtitle}</Text>
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
        {title}
      </Text>
      <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="tail">
        {subtitle}
      </Text>
    </Pressable>
  );
}

function SkeletonCard() {
  return (
    <View style={styles.card} accessibilityLabel="loading">
      <View style={[styles.imageWrap, styles.skeletonImage]} />
      <View style={styles.skeletonTitle} />
      <View style={styles.skeletonSubtitle} />
    </View>
  );
}

export default function EventPulseCarousel({
  cards = [],
  headerText = null,
  loading = false,
  skeletonCount = SKELETON_DEFAULT_COUNT,
}) {
  const visibleCards = Array.isArray(cards) ? cards : [];

  if (!loading && visibleCards.length === 0) return null;

  // Visas bara skelett när vi faktiskt inte har något att visa — om data
  // redan finns (refresh medan cache lever) behåller vi de riktiga korten
  // så layouten inte hoppar.
  const showSkeletons = loading && visibleCards.length === 0;

  return (
    <View style={styles.section}>
      {headerText ? (
        <Text style={styles.header}>{headerText}</Text>
      ) : null}
      <View style={styles.clipWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {showSkeletons
            ? Array.from({ length: skeletonCount }).map((_, i) => (
                <SkeletonCard key={`skeleton-${i}`} />
              ))
            : visibleCards.map((card) => (
                <Card
                  key={card.id}
                  title={card.title}
                  subtitle={card.subtitle}
                  imageUrl={card.imageUrl}
                  onPress={card.onPress}
                />
              ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 24, // TOKENS.space.xl
  },
  header: {
    color: TOKENS.color.text,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    paddingHorizontal: 20,
    marginBottom: 12, // TOKENS.space.md
  },
  clipWrapper: {
    marginHorizontal: -20,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 20,
    gap: 16,
  },
  card: {
    width: CARD_WIDTH,
    gap: 8,
  },
  cardPressed: {
    opacity: 0.85,
  },
  imageWrap: {
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
    backgroundColor: TOKENS.color.bg,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TOKENS.color.bg,
  },
  placeholderText: {
    color: TOKENS.color.placeholder,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  title: {
    color: TOKENS.color.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  subtitle: {
    color: TOKENS.color.textMuted,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  // Skeleton (loading state) — sama geometri som riktiga kortet så layouten
  // hoppar inte när datan landar. Färgen är `--surface` (#15151B) från
  // HomeScreen.js TOKENS — samma som övriga skeletons i appen.
  skeletonImage: {
    backgroundColor: TOKENS.color.skeleton,
  },
  skeletonTitle: {
    width: '85%',
    height: 14,
    borderRadius: 4,
    backgroundColor: TOKENS.color.skeleton,
  },
  skeletonSubtitle: {
    width: '55%',
    height: 11,
    borderRadius: 4,
    backgroundColor: TOKENS.color.skeleton,
  },
});
