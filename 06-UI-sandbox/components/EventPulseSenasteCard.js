// EventPulseSenasteCard — Spotify-stil tile med avklippt botten.
//
// Används i "Senaste"-sektionen: avkapad bild + bold rubrik + muted
// subtitle (t.ex. "Spellista • Anastasia"). Spegel av Spotifys
// "Senaste"-rail i Hem-vyn.
//
// Skillnad mot EventPulseCard:
// - Kortet är 91 px (130 * 0.7 — bildstorleken minskad 30 % 2026-09-25)
// - Bild: aspectRatio 1.15 + cover (samma kapning som EventPulseCard —
//   bilden kapas upptill och nedtill, vilket ger "avklippt botten"-
//   utseendet som är binding för EventPulse-kort)
// - Rubrik: 14pt / 800 istället för 13pt / 700 (tyngre, tydligare)
// - Subtitle: 12pt / 500 istället för 13pt / 600 (metadata-känsla)
// - Title numberOfLines=2 (samma som EventPulseCard), subtitle=1
//
// Tokens från DESIGN_SYSTEM.md (binding 2026-09-25). Spacing från
// SPACING.md: imageToTitle=8 (på skala), titleToSubtitle=4 (på skala).
// CARD_WIDTH=91 är off-scale — undantag för denna kort-variant.

import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

const TOKENS = {
  color: {
    bg: '#000000',
    border: '#2A2A33',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
    placeholder: '#1F1F26',
    placeholderText: '#8B92A1',
  },
  font: {
    title: { size: 14, weight: '800', letterSpacing: -0.2, lineHeight: 18 },
    subtitle: { size: 12, weight: '500', letterSpacing: 0 },
    placeholder: { size: 13, weight: '900', letterSpacing: 0.4 },
  },
  space: {
    imageToTitle: 8,
    titleToSubtitle: 4,
  },
};

const CARD_WIDTH = 96; // 91 * 1.05 ≈ 96 — bildstorlek +5 % (2026-09-25)

// Normaliserar imageSource till ett format <Image> accepterar.
// Samma hjälpfunktion som EventPulseCard — duplicerad här för att
// sandbox-komponenterna är fristående (ej delad modul ännu).
function sourceOf(imageSource) {
  if (imageSource == null) return null;
  if (typeof imageSource === 'number') return imageSource;
  if (typeof imageSource === 'string' && imageSource.length > 0) {
    return { uri: imageSource };
  }
  if (typeof imageSource === 'object' && imageSource.uri) return imageSource;
  return null;
}

export default function EventPulseSenasteCard({
  title,
  subtitle,
  imageSource,
  onPress,
  accessibilityLabel,
}) {
  const source = sourceOf(imageSource);
  const a11yLabel = accessibilityLabel ?? `${title} — ${subtitle}`;

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
            <Text style={styles.placeholderText}>{title}</Text>
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
  },
  cardPressed: {
    opacity: 0.7,
  },
  imageWrap: {
    width: '100%',
    // Binding (DESIGN_SYSTEM.md § Canonical card anatomy): aspectRatio
    // 1.15 + resizeMode cover kapar bilden upptill/nedtill — detta är
    // "avklippt botten"-mönstret. Samma behandling som EventPulseCard.
    aspectRatio: 1.15,
    overflow: 'hidden',
    backgroundColor: TOKENS.color.bg,
    borderWidth: 0.5,
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
    marginTop: TOKENS.space.imageToTitle,
  },
  subtitle: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.subtitle.size,
    fontWeight: TOKENS.font.subtitle.weight,
    letterSpacing: TOKENS.font.subtitle.letterSpacing,
    marginTop: TOKENS.space.titleToSubtitle,
  },
});
