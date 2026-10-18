import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useImageAspect } from '../hooks/useImageAspect.js';

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
    title: { size: 13, weight: '700', letterSpacing: -0.3, lineHeight: 18 },
    subtitle: { size: 13, weight: '600', letterSpacing: 0.1 },
    placeholder: { size: 13, weight: '900', letterSpacing: 0.4 },
  },
  space: {
    imageToTitle: 6,
    titleToSubtitle: 4,
  },
};

const CARD_WIDTH = 150;

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
  // 2026-10-18 — multi-date: antal andra förekomster av samma event
  // (samma title + venue). 0 = single, n = "+(n) andra datum".
  // Computedas via utils/eventGrouping.groupOccurrences() i parent.
  extraDatesCount = 0,
}) {
  const source = sourceOf(imageSource);
  const showExtra = typeof extraDatesCount === 'number' && extraDatesCount > 0;
  const a11yLabel = accessibilityLabel ?? (showExtra
    ? `${subtitle} — ${title} — ${extraDatesCount} andra datum`
    : `${subtitle} — ${title}`);
  // 2026-10-07 — wrap-aspect sätts till bildens naturliga aspect så bilden
  // visas helt utan crop. Tidigare användes fast aspectRatio 1.15 +
  // resizeMode cover — crop:ade bilden upptill/nedtill. Användaren
  // klagade: "bilderna i eventcard måste vara helt synliga, inget
  // inzopmat, ramen runt bilden / framen som bilden sitter mountad i
  // behöver vara samma aspect ratio".
  const { aspect: imageAspect } = useImageAspect(imageSource);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      <View style={[styles.imageWrap, { aspectRatio: imageAspect }]}>
        {source ? (
          <Image
            source={source}
            style={styles.image}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>{subtitle}</Text>
          </View>
        )}
        {/* 2026-10-18: liten chip i övre höger hörn om eventet har
            ytterligare datum. Visuellt subtilt — bara en accent-färgad
            "+N datum"-label. Användaren ska se "det här är inte ensamt"
            utan att kortet blir plottrigt. */}
        {showExtra ? (
          <View style={styles.extraBadge} accessibilityElementsHidden importantForAccessibility="no">
            <Text style={styles.extraBadgeText}>+{extraDatesCount}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
        {title}
      </Text>
      <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="tail">
        {subtitle}
      </Text>
      {showExtra ? (
        <Text style={styles.extraCaption} numberOfLines={1}>
          {`+${extraDatesCount} andra datum`}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
  },
  cardPressed: {
    opacity: 0.7,
  },
  // 2026-10-07 — wrap-aspect sätts dynamiskt från useImageAspect().
  // Inget hård aspectRatio här — bilden ska få wrap:en att följa sina
  // egna proportioner så hela bilden syns (contain-resize).
  imageWrap: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: TOKENS.color.bg,
    borderWidth: 0.5,
    borderColor: TOKENS.color.border,
  },
  // 2026-10-18 — multi-date-badge. Absolut-positionerad chip i övre höger
  // hörn av bilden. Syns bara när extraDatesCount > 0.
  extraBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: TOKENS.color.text,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  extraBadgeText: {
    color: TOKENS.color.bg,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
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
    marginTop: TOKENS.space.imageToTitle,
  },
  subtitle: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.subtitle.size,
    fontWeight: TOKENS.font.subtitle.weight,
    letterSpacing: TOKENS.font.subtitle.letterSpacing,
    marginTop: TOKENS.space.titleToSubtitle,
  },
  // 2026-10-18 — text-rad under subtitle som förklarar "+N andra datum".
  // Muted, liten — ska inte konkurrera med titel/subtitle.
  extraCaption: {
    color: TOKENS.color.textMuted,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
    letterSpacing: 0.2,
  },
});
