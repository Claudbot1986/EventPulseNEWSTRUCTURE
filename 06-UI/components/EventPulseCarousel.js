// EventPulseCarousel — horisontellt scrollbar kort-rad i Spotify-stil.
//
// Använder EventPulseCard (samma komponent som återanvänds på Hem) så att
// varje karusell-kort har identisk geometri/typografi. Skillnad mot
// 06-UI/components/EventPulseCarousel.js: prod har en egen intern Card
// (CARD_WIDTH=187) eftersom HomeScreen behöver en annan storlek — här
// i sandboxen återanvänder vi EventPulseCard direkt (CARD_WIDTH=150).
//
// Data: komponenten äger inte innehållet. Anroparen bygger listan:
//
//   const cards = [
//     { id: 'helg', title: 'Helgens alla händelser', subtitle: 'Helg',
//       imageUrl: require('../assets/tile-1.png'),
//       onPress: () => {} },
//     ...
//   ];
//   <EventPulseCarousel cards={cards} headerText="Tid" />
//
// States:
//   - default:   visas om `cards.length > 0` och `loading === false`
//   - loading:   visas bara om `loading === true` OCH `cards.length === 0`
//                (så refresh medan cache lever inte hoppar i layout)
//   - empty:     return null — dölj hela karusellen (Hellre en sektion
//                mindre än en tom rad)
//
// Bildkrav: kvadratisk (1.15 aspect) eller godtycklig — EventPulseCard
// normaliserar redan sträng-URL / require-nummer / null via sourceOf().
//
// i18n: titel + subtitle förväntas vara översatta av anroparen. Ingen
// useI18n-hook inuti.

import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import EventPulseCard from './EventPulseCard';

// 2026-09-25 — tokens från DESIGN_SYSTEM.md (binding). Identiska med
// EventPulseCard förutom `header` (16pt / 800 / text) och `skeleton`.
const TOKENS = {
  color: {
    bg: '#000000',
    border: '#2A2A33',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
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

// Skeleton-kort med samma geometri som EventPulseCard (CARD_WIDTH=150,
// aspectRatio 1.15) så layouten inte hoppar när datan landar. Återger
// inte hela EventPulseCard — skeleton behöver ingen bild/text, bara
// samma "kostym".
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

export default function EventPulseCarousel({
  cards = [],
  headerText = null,
  loading = false,
  emptyText = null,
  skeletonCount = SKELETON_DEFAULT_COUNT,
}) {
  const visibleCards = Array.isArray(cards) ? cards : [];

  // 2026-09-26 — produkt-besked från användaren: hellre synlig section med
  // empty-state än att hela karusellen försvinner (användaren märkte inte
  // att sektionen fanns när den gömdes). Tidigare returnerade vi null här.
  // Behåller headern och visar emptyText inuti. Om emptyText är null
  // faller vi tillbaka till att dölja sektionen (beteendet innan 2026-09-26).
  const isEmpty = !loading && visibleCards.length === 0;
  if (isEmpty && !emptyText) return null;

  // Skelett bara när vi faktiskt inte har något att visa — refresh
  // medan cache lever behåller de riktiga korten så layouten är stabil.
  const showSkeletons = loading && visibleCards.length === 0;

  if (isEmpty && emptyText) {
    return (
      <View
        style={styles.section}
        accessibilityRole="list"
        accessibilityLabel={headerText ? `${headerText} — karusell` : 'Karusell'}
      >
        {headerText ? (
          <Text style={styles.header}>{headerText}</Text>
        ) : null}
        <View style={styles.emptyWrapper}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      </View>
    );
  }

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
                <EventPulseCard
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
    // Spegel av clipWrapper-mönstret nedan — utan detta hade headern
    // legat 20 px inåt jämfört med första kortets bild.
    marginHorizontal: -SCREEN_PADDING,
    paddingHorizontal: SCREEN_PADDING,
    marginBottom: TOKENS.space.headerToRow,
  },
  // -20/+20 edge-bleed så första kortet ligger kant-i-kant med skärmen,
  // men texten (header) behåller 20 px padding. Standard EventPulse-mönster.
  clipWrapper: {
    marginHorizontal: -SCREEN_PADDING,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: SCREEN_PADDING,
    gap: TOKENS.space.cardGap,
  },
  emptyWrapper: {
    // Tom-wrapper utan padding-top så texten ligger i linje med första
    // kortets vänsterkant. paddingHorizontal matchar SCREEN_PADDING så
    // texten inte klistras mot kanten.
    paddingHorizontal: SCREEN_PADDING,
    paddingVertical: 8,
  },
  emptyText: {
    color: TOKENS.color.textMuted,
    fontSize: 13,
    fontWeight: '400',
  },
});

const skeletonStyles = StyleSheet.create({
  card: {
    width: 150, // måste matcha EventPulseCard.CARD_WIDTH exakt
    gap: 8,
  },
  image: {
    width: '100%',
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
    width: '55%',
    height: 11,
    borderRadius: 4,
    backgroundColor: TOKENS.color.skeleton,
  },
});
