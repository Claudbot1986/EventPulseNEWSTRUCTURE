// EventPulseCard — återanvändbart kort som används i EventPulse-karuseller.
// Bild (eller placeholder) + titel + subtitle. En storlek (md). Opacity-press.
//
// Sandbox-konventioner: inga providers, ingen auth, ingen data-state.
// Anroparen äger data och översättning (i18n). Komponenten är helt
// presentationsinriktad.
//
// Props:
//   title         {string}   — obligatorisk. Visas med numberOfLines={2}.
//   subtitle      {string}   — obligatorisk. Visas med numberOfLines={1}.
//   imageSource   {?require|string|{uri}} — valfri. Saknas → placeholder.
//   onPress       {Function} — valfri. Triggas vid tryck.
//   accessibilityLabel {string} — valfri. Default: "${subtitle} — ${title}".
//
// Icke-uppenbara val:
//   - 187 px bredd: ärvt från HorizontalCardCarousel (samma Spotify-rad-känsla).
//   - opacity 0.7 på press: vi valde detta över scale 0.98 för konsistens
//     med 06-UI/HomeScreen.js EventCardCompact.
//   - placeholder = mörk ruta med subtitle i mitten: enkelt att se i
//     sandbox, ingen blank-bild-bug.
//
// Sandbox-referens: components/HorizontalCardCarousel.js
// Produktions-referens: 06-UI/components/EventPulseCarousel.js (Card, ej exporterad)
// A11y-mönster: ACCESSIBILITY.md § Labels.

import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

// Tokens från DESIGN_SYSTEM.md (binding-värden 2026-09-24).
const TOKENS = {
  color: {
    bg: '#000000',
    surface: '#0A0A0A',
    border: '#2A2A33',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
    placeholder: '#1F1F26',
    placeholderText: '#8B92A1',
  },
  font: {
    title: { size: 15, weight: '800', letterSpacing: -0.2, lineHeight: 20 },
    subtitle: { size: 13, weight: '600', letterSpacing: 0.1 },
    placeholder: { size: 13, weight: '900', letterSpacing: 0.4 },
  },
  space: {
    imageToText: 8,
  },
};

const CARD_WIDTH = 187;

// Normaliserar imageSource till ett format <Image> accepterar.
// Krävs eftersom <Image source="https://..."> INTE renderar — det måste
// vara { uri: '...' } eller ett require()-nummer. Se COMPONENT_RULES.md
// § Image handling.
function sourceOf(imageSource) {
  if (imageSource == null) return null;
  if (typeof imageSource === 'number') return imageSource;
  if (typeof imageSource === 'string' && imageSource.length > 0) {
    return { uri: imageSource };
  }
  if (typeof imageSource === 'object' && imageSource.uri) return imageSource;
  return null;
}

export default function EventPulseCard({
  title,
  subtitle,
  imageSource,
  onPress,
  accessibilityLabel,
}) {
  const source = sourceOf(imageSource);
  const a11yLabel = accessibilityLabel ?? `${subtitle} — ${title}`;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      <View style={styles.imageWrap}>
        {source ? (
          <Image
            source={source}
            style={styles.image}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
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

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    gap: TOKENS.space.imageToText,
  },
  cardPressed: {
    opacity: 0.7,
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
    backgroundColor: TOKENS.color.placeholder,
  },
  placeholderText: {
    color: TOKENS.color.placeholderText,
    fontSize: TOKENS.font.placeholder.size,
    fontWeight: TOKENS.font.placeholder.weight,
    letterSpacing: TOKENS.font.placeholder.letterSpacing,
  },
  title: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.title.size,
    fontWeight: TOKENS.font.title.weight,
    letterSpacing: TOKENS.font.title.letterSpacing,
    lineHeight: TOKENS.font.title.lineHeight,
  },
  subtitle: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.subtitle.size,
    fontWeight: TOKENS.font.subtitle.weight,
    letterSpacing: TOKENS.font.subtitle.letterSpacing,
  },
});
