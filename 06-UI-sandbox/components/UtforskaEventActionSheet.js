// UtforskaEventActionSheet — Spotify-stil bottom-sheet för ⋯-menyn
// i UtforskaSection. Sandbox-version, props-driven, console.log-stubbar.
//
// Design 2026-09-26 (användarens Spotify-referens): drag handle, slide-up,
// 8 actions med togglebar Save, conditional Follow-rader, två taste-negativ
// (Inte intresserad / Mindre av kategori) separerade av en divider.
// Sedan 2026-09-26 tillägg: drag-to-dismiss på drag-handle + backdrop-tap.
//
// Sandbox-regler respekterade:
//   - Inga providers, ingen auth, ingen analytics.
//   - Inga riktiga agent-/Supabase-anrop — alla actions console.log-stubbas.
//   - Inte registrerad i registry.js (testas fristående via UtforskaSection).
//   - Drag-handle enligt användarens val 2026-09-26.
//   - Drag-to-dismiss + backdrop-tap enligt användarens val 2026-09-26.
//
// I 06-UI/ ersätts onAction-callbacken av riktiga
// agentClient.recordEventInteraction / shareSession / Linking.openURL
// (se plan §10).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const TOKENS = {
  color: {
    sheet: '#1A1A1A',
    handle: '#3A3A3A',
    divider: '#2A2A2A',
    backdropOpacity: 0.6,
    text: '#FFFFFF',
    textMuted: '#A9B0BE',
    textSoft: '#727B8D',
    accent: '#FFB454',
    destructive: '#FF759E',
    thumbBg: '#1F1F26',
    placeholderText: '#8B92A1',
  },
  space: {
    handleW: 36,
    handleH: 4,
    padX: 16,
    handleGap: 8,
    headerToActions: 0,
    actionRowH: 48,
    iconSize: 20,
    headerGap: 12,
    thumb: 40,
    thumbRadius: 4,
    dividerPad: 4,
    sheetBottomPad: 32,
    sheetMaxHeightPct: 0.85,
  },
  radius: {
    sheet: 16,
    handle: 2,
    thumb: 4,
  },
  font: {
    heroTitle: { size: 17, weight: '700', letterSpacing: -0.2 },
    heroSub:   { size: 13, weight: '500' },
    label:     { size: 15, weight: '600' },
    icon:      { size: 19, weight: '600' },
    thumbFallback: { size: 18, weight: '900' },
  },
};

// All actions använder samma textfärg — användaren vill ha enkel,
// monokrom Spotify-stil (ingen gul/röd variantmarkering). Den enda
// visuella grupperingen mellan primary/neutral och destructive
// är dividern ovanför "Inte intresserad".
const VARIANT_COLOR = {
  primary: TOKENS.color.text,
  neutral: TOKENS.color.text,
  destructive: TOKENS.color.text,
};

// Textbaserade ikoner för sandbox-enkelhet. I 06-UI/ ersätts dessa
// av Ionicons / SVG-ikoner med tydlig semantik.
const ICON = {
  share: '↗',
  save: '♡',
  saved: '♥',
  tickets: '◇',
  calendar: '◷',
  remind: '◔',
  follow: '＋',
  not_interested: '×',
  less_category: '↓',
};

// Bygger actions-listan baserat på event-state. Returnerar en array
// av entries — antingen en action-rad eller en divider-markering.
function buildActions(event, savedState) {
  const actions = [];

  // Tier 1 — primary affordances
  actions.push({
    id: 'share',
    label: 'Dela',
    variant: 'primary',
    icon: ICON.share,
  });
  actions.push({
    id: 'save',
    label: savedState ? 'Ta bort sparning' : 'Spara',
    variant: 'primary',
    icon: savedState ? ICON.saved : ICON.save,
  });
  if (event.hasTickets) {
    actions.push({
      id: 'open_tickets',
      label: 'Öppna biljetter',
      variant: 'primary',
      icon: ICON.tickets,
    });
  }

  // Tier 2 — organizational
  actions.push({
    id: 'add_calendar',
    label: 'Lägg till i kalender',
    variant: 'neutral',
    icon: ICON.calendar,
  });
  actions.push({
    id: 'remind',
    label: 'Påminn mig',
    variant: 'neutral',
    icon: ICON.remind,
  });

  // Tier 3 — follow (conditional)
  if (event.venueName) {
    actions.push({
      id: 'follow_venue',
      label: `Följ ${event.venueName}`,
      variant: 'neutral',
      icon: ICON.follow,
    });
  }
  if (event.artistName) {
    actions.push({
      id: 'follow_artist',
      label: `Följ ${event.artistName}`,
      variant: 'neutral',
      icon: ICON.follow,
    });
  }

  // Taste-negativ divider
  actions.push({ id: '__divider__' });

  // Tier 4 — taste negatives
  actions.push({
    id: 'reject_not_interested',
    label: 'Inte intresserad',
    variant: 'destructive',
    icon: ICON.not_interested,
  });
  if (event.category) {
    actions.push({
      id: 'reject_less_category',
      label: `Mindre av ${event.category}`,
      variant: 'destructive',
      icon: ICON.less_category,
    });
  }

  return actions;
}

/**
 * @typedef {Object} UtforskaEventActionSheetProps
 * @property {boolean} visible
 * @property {object|null} event — se MOCK_EVENTS-shape i UtforskaSection
 * @property {() => void} onClose
 * @property {(actionId: string, event: object, payload?: object) => void} onAction
 */

/**
 * @param {UtforskaEventActionSheetProps} props
 */
export default function UtforskaEventActionSheet({
  visible,
  event,
  onClose,
  onAction,
}) {
  // Lokalt toggle-state för "Spara" så labeln växlar utan att sheeten stängs.
  const [savedState, setSavedState] = useState(false);

  // Drag-to-dismiss state. translateY styr sheet-translation;
  // backdropOpacity interpoleras från samma värde (sheet åker ner →
  // bakgrund bleknar). Båda nollställs när sheeten öppnas igen.
  const translateY = useRef(new Animated.Value(0)).current;
  const backdropOpacity = translateY.interpolate({
    inputRange: [0, 300],
    outputRange: [TOKENS.color.backdropOpacity, 0],
    extrapolate: 'clamp',
  });

  // När sheeten öppnas med nytt event, synka `saved` från props.
  useEffect(() => {
    if (visible && event) {
      setSavedState(Boolean(event.saved));
    }
  }, [visible, event]);

  // När sheeten blir synlig: nollställ translateY INNAN nästa paint
  // så nästa öppning startar från botten utan att användaren ser en
  // frame där sheeten står kvar på translateY=1000 (rest från en
  // föregående drag-dismiss). useLayoutEffect körs synkront efter
  // render, före paint — useEffect kan komma för sent.
  useLayoutEffect(() => {
    if (visible) {
      translateY.setValue(0);
    }
  }, [visible, translateY]);

  // PanResponder fångar vertikala nedåt-drag på drag-handlen.
  // ScrollView inuti sheeten har egna gestures och påverkas inte.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dy) > 4 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.2,
      onPanResponderGrant: () => {
        translateY.setOffset(0);
        translateY.setValue(0);
      },
      onPanResponderMove: (_, gs) => {
        // Endast nedåt (dy > 0). Uppåt-rörelser studsar tillbaka.
        if (gs.dy > 0) {
          translateY.setValue(gs.dy);
        }
      },
      onPanResponderRelease: (_, gs) => {
        const shouldDismiss = gs.dy > 80 || gs.vy > 0.5;
        if (shouldDismiss) {
          Animated.timing(translateY, {
            toValue: 1000,
            duration: 200,
            useNativeDriver: true,
          }).start(() => handleDismiss());
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            tension: 80,
            friction: 10,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  // Centraliserad stäng. OBS: vi nollställer INTE translateY här —
  // det var det som orsakade "blink"-effekten efter drag-dismiss:
  // sheeten hade just animerats till translateY=1000 (off-screen),
  // sedan hoppade den tillbaka till 0 när handleDismiss kördes, och
  // DÄRPÅ gick modalen i slide-out. Hoppet = blink. Nu lämnas
  // translateY ifred och useLayoutEffect ovan nollställer den
  // nästa gång sheeten öppnas.
  const handleDismiss = () => {
    onClose?.();
  };

  if (!event) {
    // Även om Modal visas vill vi inte rendera innehåll utan event.
    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={handleDismiss}
      />
    );
  }

  const actions = buildActions(event, savedState);
  const subtitleText = Array.isArray(event.subtitleParts)
    ? event.subtitleParts.filter(Boolean).join(' · ')
    : '';

  function handleActionPress(action) {
    // Toggle-spara håller sheeten öppen så användaren ser etikett-växlingen.
    // Övriga actions stänger sheeten (Spotify-mönster).
    if (action.id === 'save') {
      setSavedState((s) => {
        const next = !s;
        onAction?.('save', event, { saved: next });
        return next;
      });
      return;
    }
    onAction?.(action.id, event);
    // Liten fördröjning så callback hinner logga före unmount.
    setTimeout(() => handleDismiss(), 200);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleDismiss}
    >
      <View style={styles.backdropRoot}>
        {/* Lager 1 — visuell backdrop (släpper igenom tryck).
            Animations-opacity styrs av translateY-interpolationen
            så sheeten "löses upp" mot appen under när man drar ner. */}
        <Animated.View
          style={[styles.backdrop, { opacity: backdropOpacity }]}
          pointerEvents="none"
        />

        {/* Lager 2 — tap-to-dismiss. absoluteFill = hela skärmen.
            Eftersom sheet-wrappern nedan renderas EFTER (högre
            z-order) fångar denna bara tryck utanför sheeten. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleDismiss}
        />

        {/* Lager 3 — sheet. Pressable-wrappern suger upp tryck på
            tom sheet-yta (annars hade de fallit igenom till Lager 2
            och dismissat). Action-Pressables inuti är djupare och
            fångar sina egna tryck. */}
        <Pressable style={styles.sheetWrapper} onPress={() => {}}>
          <Animated.View
            style={[styles.sheet, { transform: [{ translateY }] }]}
          >
          {/* Drag handle — drag-to-dismiss target */}
          <View style={styles.handleRow} {...panResponder.panHandlers}>
            <View style={styles.handle} />
          </View>

          {/* Event header (samma rad som listvyn visar) */}
          <View style={styles.header}>
            {event.imageUrl ? (
              <Image
                source={
                  typeof event.imageUrl === 'string'
                    ? { uri: event.imageUrl }
                    : event.imageUrl
                }
                style={styles.thumb}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[styles.thumb, styles.thumbFallback]}>
                <Text style={styles.thumbFallbackText}>
                  {(event.title || '?').slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.headerText}>
              <Text style={styles.heroTitle} numberOfLines={1}>
                {event.title}
              </Text>
              {subtitleText ? (
                <Text style={styles.heroSub} numberOfLines={1}>
                  {subtitleText}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.divider} />

          {/* Actions */}
          <ScrollView
            style={styles.actionsList}
            contentContainerStyle={styles.actionsContent}
            showsVerticalScrollIndicator={false}
          >
            {actions.map((action, idx) =>
              action.id === '__divider__' ? (
                <View
                  key={`__divider-${idx}`}
                  style={styles.tasteDivider}
                />
              ) : (
                <Pressable
                  key={action.id}
                  style={({ pressed }) => [
                    styles.actionRow,
                    pressed && styles.actionRowPressed,
                  ]}
                  onPress={() => handleActionPress(action)}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                >
                  <Text
                    style={[
                      styles.actionIcon,
                      { color: VARIANT_COLOR[action.variant] || TOKENS.color.text },
                    ]}
                  >
                    {action.icon}
                  </Text>
                  <Text
                    style={[
                      styles.actionLabel,
                      { color: VARIANT_COLOR[action.variant] || TOKENS.color.text },
                    ]}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              )
            )}
          </ScrollView>
          </Animated.View>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  sheet: {
    backgroundColor: TOKENS.color.sheet,
    borderTopLeftRadius: TOKENS.radius.sheet,
    borderTopRightRadius: TOKENS.radius.sheet,
    paddingBottom: TOKENS.space.sheetBottomPad,
    maxHeight: `${TOKENS.space.sheetMaxHeightPct * 100}%`,
  },
  // sheetWrapper: Pressable som ligger överst i z-order (renderas
  // efter Lager 2-bakgrunden) och suger upp tomma-sheet-tryck.
  // Positioneras längst ned i absolute-läge så wrapper-bounds
  // matchar sheet-bounds vid translateY=0.
  sheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: TOKENS.space.handleGap,
    paddingBottom: TOKENS.space.handleGap + 4,
  },
  handle: {
    width: TOKENS.space.handleW,
    height: TOKENS.space.handleH,
    borderRadius: TOKENS.radius.handle,
    backgroundColor: TOKENS.color.handle,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: TOKENS.space.padX,
    paddingVertical: TOKENS.space.handleGap + 4,
    gap: TOKENS.space.headerGap,
  },
  thumb: {
    width: TOKENS.space.thumb,
    height: TOKENS.space.thumb,
    borderRadius: TOKENS.radius.thumb,
    backgroundColor: TOKENS.color.thumbBg,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFallbackText: {
    color: TOKENS.color.placeholderText,
    fontSize: TOKENS.font.thumbFallback.size,
    fontWeight: TOKENS.font.thumbFallback.weight,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  heroTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.heroTitle.size,
    fontWeight: TOKENS.font.heroTitle.weight,
    letterSpacing: TOKENS.font.heroTitle.letterSpacing,
  },
  heroSub: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.heroSub.size,
    fontWeight: TOKENS.font.heroSub.weight,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: TOKENS.color.divider,
    marginHorizontal: 0,
  },
  actionsList: {},
  actionsContent: {
    paddingVertical: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: TOKENS.space.padX,
    height: TOKENS.space.actionRowH,
    gap: 16,
  },
  actionRowPressed: {
    opacity: 0.5,
  },
  actionIcon: {
    fontSize: TOKENS.font.icon.size,
    width: TOKENS.space.iconSize,
    textAlign: 'center',
    fontWeight: TOKENS.font.icon.weight,
  },
  actionLabel: {
    fontSize: TOKENS.font.label.size,
    fontWeight: TOKENS.font.label.weight,
  },
  tasteDivider: {
    height: 1,
    backgroundColor: TOKENS.color.divider,
    marginHorizontal: TOKENS.space.padX,
    marginVertical: TOKENS.space.dividerPad,
  },
});
