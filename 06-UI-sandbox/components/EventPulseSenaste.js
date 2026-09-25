// EventPulseSenaste — "Senaste"-sektion med Spotify-stil tiles.
//
// Horisontellt scrollbar rad med kvadratiska EventPulseSenasteCard.
// Spegel av EventPulseCarousel: samma edge-bleed-mönster, samma
// skeleton/empty-logik, samma header-stil. Skillnaden är bara kortet —
// Senaste använder mindre kvadratiska tiles istället för avlånga.
//
// Användning:
//   const cards = [
//     { id: 's-1', title: 'Peaceful Piano', subtitle: 'Spellista • Spotify',
//       imageUrl: require('../assets/tile-1.png') },
//     ...
//   ];
//   <EventPulseSenaste cards={cards} headerText="Senaste" />
//
// States:
//   - default: cards.length > 0 && !loading
//   - loading: loading=true && cards.length===0 (skelett)
//   - empty:   return null (Hellre färre sektioner än tomma rader)

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import EventPulseSenasteCard from './EventPulseSenasteCard';

const TOKENS = {
  color: {
    bg: '#000000',
    border: '#2A2A33',
    text: '#F7F2EA',
    skeleton: '#15151B',
  },
  font: {
    header: { size: 16, weight: '800', letterSpacing: -0.2 },
  },
  space: {
    headerToRow: 12,
    sectionGap: 24,
    cardGap: 16,
  },
};

const SKELETON_DEFAULT_COUNT = 4;
const SCREEN_PADDING = 20;

// Skelett-kort med samma geometri som EventPulseSenasteCard
// (CARD_WIDTH=96, aspectRatio 1.15). Spegel av EventPulseCarousel/SkeletonCard.
function SkeletonCard() {
  return (
    <View
      style={skeletonStyles.card}
      accessibilityLabel="loading"
      accessible
    >
      <View style={skeletonStyles.image} />
      <View style={skeletonStyles.titleLine} />
      <View style={skeletonStyles.subtitleLine} />
    </View>
  );
}

export default function EventPulseSenaste({
  cards = [],
  headerText = null,
  loading = false,
  skeletonCount = SKELETON_DEFAULT_COUNT,
}) {
  const visibleCards = Array.isArray(cards) ? cards : [];

  if (!loading && visibleCards.length === 0) return null;
  const showSkeletons = loading && visibleCards.length === 0;

  return (
    <View
      style={styles.section}
      accessibilityRole="list"
      accessibilityLabel={headerText ? `${headerText} — karusell` : 'Karusell'}
    >
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
                <EventPulseSenasteCard
                  key={card.id}
                  title={card.title}
                  subtitle={card.subtitle}
                  imageSource={card.imageUrl}
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
    marginBottom: TOKENS.space.sectionGap,
  },
  header: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.header.size,
    fontWeight: TOKENS.font.header.weight,
    letterSpacing: TOKENS.font.header.letterSpacing,
    // Edge-bleed så headern ligger i linje med kortens vänsterkant.
    marginHorizontal: -SCREEN_PADDING,
    paddingHorizontal: SCREEN_PADDING,
    marginBottom: TOKENS.space.headerToRow,
  },
  clipWrapper: {
    marginHorizontal: -SCREEN_PADDING,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: SCREEN_PADDING,
    gap: TOKENS.space.cardGap,
  },
});

const skeletonStyles = StyleSheet.create({
  card: {
    width: 96, // måste matcha EventPulseSenasteCard.CARD_WIDTH exakt
    gap: 8,
  },
  image: {
    width: '100%',
    // Måste matcha EventPulseSenasteCard imageWrap — annars hoppar
    // layouten när datan landar.
    aspectRatio: 1.15,
    backgroundColor: TOKENS.color.skeleton,
    borderWidth: 0.5,
    borderColor: TOKENS.color.border,
  },
  titleLine: {
    width: '85%',
    height: 14,
    borderRadius: 4,
    backgroundColor: TOKENS.color.skeleton,
  },
  subtitleLine: {
    width: '65%',
    height: 11,
    borderRadius: 4,
    backgroundColor: TOKENS.color.skeleton,
  },
});
