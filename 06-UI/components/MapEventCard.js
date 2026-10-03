// MapEventCard.js — klickbar popup-ruta som visas när man trycker på en
// event-marker i Apple-kartan. Fristående komponent — kan också previewas
// i sandboxen utan karta via registry-entryn.
//
// UX:
//   - Visar samma info som EventPulseCard (titel + meta-rad + ev. bild)
//     men UTÖKAT med:
//       * X-knapp (top-right) → onClose
//       * "Läs mer"-knapp (bottom-right) → onReadMore
//   - Kallas från AppleMapsScreen: marker.onPress → setSelectedEvent,
//     MapView.onPress (tap utanför marker) → setSelectedEvent(null).
//
// Stil: dark surface, orange accent, samma tokens som AppleMapsScreen.

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  pickTitle,
  formatMetaLine,
  pickFreeLabel,
  pickImageUrl,
} from './MapEventCard.helpers.js';

const TOKENS = {
  color: {
    bg: '#0A0A0A',
    surface: '#14110C',
    border: '#2A2A33',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
    accent: '#FFB454',
    placeholder: '#1F1F26',
    placeholderText: '#8B92A1',
  },
  font: {
    title: { size: 15, weight: '800', letterSpacing: -0.2 },
    meta: { size: 12, weight: '500' },
    freePill: { size: 10, weight: '700', letterSpacing: 0.6 },
    closeIcon: { size: 18, weight: '500' },
    readMore: { size: 13, weight: '700', letterSpacing: 0.4 },
  },
  space: {
    cardRadius: 12,
    cardPadding: 12,
    imageSize: 72,
    imageRadius: 8,
    closeHitSize: 24,
    readMoreRadius: 8,
    readMorePad: 12,
    titleToMeta: 4,
    metaToFree: 8,
  },
};

function sourceOf(imageSource) {
  if (imageSource == null) return null;
  if (typeof imageSource === 'number') return imageSource;
  if (typeof imageSource === 'string' && imageSource.length > 0) {
    return { uri: imageSource };
  }
  if (typeof imageSource === 'object' && imageSource.uri) return imageSource;
  return null;
}

export default function MapEventCard({
  event,
  onClose,
  onReadMore,
  testID = 'map-event-card',
}) {
  const slideAnim = useRef(new Animated.Value(0)).current;
  // 2026-10-03 — image-load-state. En del image_url:er pekar på trasiga
  // WebP-filer (t.ex. import-stamped/.../wintervikenlive.webp för Robert
  // Wells-eventet — fel venue-namn i URL). På iOS kan en korrupt WebP
  // krascha den native image-decode-pipelinen. Vi fångar felet och
  // visar placeholder istället.
  const [imageBroken, setImageBroken] = useState(false);
  useEffect(() => {
    setImageBroken(false);
  }, [event?.id]);

  // Slide-up + fade-in när kortet mountas (dvs ny event vald).
  useEffect(() => {
    if (!event) return;
    slideAnim.setValue(0);
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [event?.id, event, slideAnim]);

  if (!event) return null;

  const title = pickTitle(event);
  const meta = formatMetaLine(event);
  const freeLabel = pickFreeLabel(event);
  const imageUri = pickImageUrl(event);
  const imageSource = sourceOf(imageUri);

  const handleClose = () => {
    if (typeof onClose === 'function') onClose();
  };
  const handleReadMore = () => {
    if (typeof onReadMore === 'function') onReadMore(event);
  };

  // Animation-transformation: slide från 60px nerifrån + opacity 0 → 1.
  const animatedStyle = {
    opacity: slideAnim,
    transform: [
      {
        translateY: slideAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [60, 0],
        }),
      },
    ],
  };

  return (
    <Animated.View
      style={[styles.card, animatedStyle]}
      testID={testID}
      accessibilityLabel={`Event-kort: ${title}`}
    >
      <Pressable
        style={({ pressed }) => [
          styles.closeButton,
          pressed && styles.closeButtonPressed,
        ]}
        onPress={handleClose}
        accessibilityRole="button"
        accessibilityLabel="Stäng"
        testID={`${testID}-close`}
        hitSlop={8}
      >
        <Text style={styles.closeIcon}>✕</Text>
      </Pressable>

      <View style={styles.row}>
        <View style={styles.imageWrap}>
          {imageSource && !imageBroken ? (
            <Image
              source={imageSource}
              style={styles.image}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
              onError={() => {
                if (typeof console !== 'undefined' && console.warn) {
                  console.warn('[MapEventCard] image onError — falling back to placeholder for', event?.id);
                }
                setImageBroken(true);
              }}
            />
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>EVENT</Text>
            </View>
          )}
        </View>

        <View style={styles.content}>
          <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
            {title}
          </Text>
          {meta ? (
            <Text style={styles.meta} numberOfLines={1} ellipsizeMode="tail">
              {meta}
            </Text>
          ) : null}
          {freeLabel ? (
            <View style={styles.freePill}>
              <Text style={styles.freePillText}>{freeLabel}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.readMore,
            pressed && styles.readMorePressed,
          ]}
          onPress={handleReadMore}
          accessibilityRole="button"
          accessibilityLabel={`Läs mer om ${title}`}
          testID={`${testID}-read-more`}
        >
          <Text style={styles.readMoreText}>Läs mer</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

MapEventCard.__helpers = {
  TOKENS,
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: TOKENS.color.bg,
    borderRadius: TOKENS.space.cardRadius,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    padding: TOKENS.space.cardPadding,
    position: 'relative',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  closeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: TOKENS.space.closeHitSize,
    height: TOKENS.space.closeHitSize,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  closeButtonPressed: {
    opacity: 0.5,
  },
  closeIcon: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.closeIcon.size,
    fontWeight: TOKENS.font.closeIcon.weight,
    lineHeight: TOKENS.font.closeIcon.size,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  imageWrap: {
    width: TOKENS.space.imageSize,
    height: TOKENS.space.imageSize,
    borderRadius: TOKENS.space.imageRadius,
    overflow: 'hidden',
    backgroundColor: TOKENS.color.placeholder,
    flexShrink: 0,
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
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  content: {
    flex: 1,
    paddingRight: TOKENS.space.closeHitSize,
  },
  title: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.title.size,
    fontWeight: TOKENS.font.title.weight,
    letterSpacing: TOKENS.font.title.letterSpacing,
    lineHeight: 19,
  },
  meta: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.meta.size,
    fontWeight: TOKENS.font.meta.weight,
    marginTop: TOKENS.space.titleToMeta,
  },
  freePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,180,84,0.12)',
    borderColor: TOKENS.color.accent,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: TOKENS.space.metaToFree,
  },
  freePillText: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.font.freePill.size,
    fontWeight: TOKENS.font.freePill.weight,
    letterSpacing: TOKENS.font.freePill.letterSpacing,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  readMore: {
    minHeight: 36,
    paddingHorizontal: TOKENS.space.readMorePad,
    paddingVertical: 6,
    borderRadius: TOKENS.space.readMoreRadius,
    borderWidth: 1,
    borderColor: TOKENS.color.accent,
    backgroundColor: 'rgba(255,180,84,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  readMorePressed: {
    opacity: 0.6,
  },
  readMoreText: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.font.readMore.size,
    fontWeight: TOKENS.font.readMore.weight,
    letterSpacing: TOKENS.font.readMore.letterSpacing,
  },
});