// NewEventCard.js — kompakt event-rendering för rullistor (Hem/Utforska/
// Sök/Karta). Ersätter UtforskaSection:s EventRow.
//
// Struktur:
//   HERO-bild (full bredd, 1.15 aspect) → badge + datum/tid + actions
//   → TITEL (egen rad) → meta → description-preview (valfri).
//
// Action-knappar (28×28 glyph): ♡ spara, 📍 karta-popup, ◷ kalender,
// ↗ dela, ⋯ mer. Karta-popup använder samma react-native-maps /
// PROVIDER_DEFAULT-setup som AppleMapsScreen — Apple Maps på iOS.

import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { PROVIDER_DEFAULT, Marker } from 'react-native-maps';
import { useImageAspect } from '../hooks/useImageAspect.js';

// Tokens speglar 06-UI:s mörka/beige/orange-estetik (DESIGN_SYSTEM.md binding).
const T = {
  color: {
    bg: '#000000',
    surface: '#0A0A0A',
    border: '#2A2A33',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
    accent: '#FFB454',
    placeholder: '#1F1F26',
    placeholderText: '#8B92A1',
    savedAccent: '#FF759E',
  },
  font: {
    eyebrow: { size: 11, weight: '800', letterSpacing: 1.4 },
    title: { size: 15, weight: '700', letterSpacing: -0.3, lineHeight: 20 },
    meta: { size: 12, weight: '500' },
    preview: { size: 12, weight: '300', lineHeight: 16 },
    icon: { size: 16, weight: '600' },
    badge: { size: 10, weight: '800', letterSpacing: 0.6 },
    // 2026-10-07: Läs mer-knappen är gul text dateLine (11) + 3 pt → 14 pt,
    // samma letterSpacing 0.4 som MapEventCard.readMore.
    readMore: { size: 14, weight: '700', letterSpacing: 0.4 },
    // 2026-10-10: Tier 1 attribution — mindre än meta, italic, mest muted.
    // "Artistinfo från öppna datakällor" eller liknande.
    dataSource: { size: 11, weight: '400', letterSpacing: 0.1 },
  },
  space: {
    padX: 14,
    padY: 10,
    // Wrap = 1.15:1 — samma hero-geometri som EventPulseCard.
    heroAspect: 1.15,
    heroRadius: 8,
    gap: 10,
    actionHit: 32,
    actionGap: 4,
    titleMargin: 6,
    metaMargin: 2,
    previewMargin: 6,
    // 2026-10-10: Tier 1 attribution raden under meta.
    dataSourceMargin: 4,
    bottomPad: 12,
    // 2026-10-07: Läs mer-knappen sitter på egen rad efter preview,
    // högerjusterad. Samma padding/radius som MapEventCard.readMore.
    // 2026-10-07 (justering): lite mindre padding så knappen krymper
    // proportionellt mot MapEventCard.
    readMoreRowMargin: 6,
    readMoreRadius: 8,
    readMorePadX: 10,
    readMorePadY: 4,
  },
};

// Normaliserar imageSource → format <Image> accepterar (kräver-nummer eller
// {uri: string}). Används så samma komponent funkar både med
// agent-flödets HTTP-URL:er och MOCK_EVENTS-lokala require-resultat.
function sourceOf(imageSource) {
  if (imageSource == null) return null;
  if (typeof imageSource === 'number') return imageSource;
  if (typeof imageSource === 'string' && imageSource.length > 0) {
    return { uri: imageSource };
  }
  if (typeof imageSource === 'object' && imageSource.uri) return imageSource;
  return null;
}

const ICON = {
  save: '♡',
  saved: '♥',
  pin: '📍',
  calendar: '◷',
  share: '↗',
  more: '⋯',
};

/**
 * @typedef {Object} NewEventCardProps
 * @property {string} title
 * @property {string|null} dateLine            t.ex. "LÖR 26 SEP · 20:00"
 * @property {string|null} meta                t.ex. "Drottninggatan · Stockholm"
 * @property {string|null} [preview]
 * @property {string|null} [badge]             t.ex. "MUSIK"
 * @property {number|string|object|null} [imageSource]   require() eller {uri}
 * @property {boolean} [saved=false]           initial sparat-läge
 * @property {number} [lat=59.3326]            fallback Stockholm centrum
 * @property {number} [lng=18.0668]
 * @property {string} [id]                     används i a11y-label
 * @property {() => void} [onPress]
 * @property {(next: boolean) => void} [onSave]   parent wirable till recordEventInteraction
 * @property {() => void} [onCalendar]            parent wirable till fetchEventIcs + Linking
 * @property {() => void} [onShare]               parent wirable till shareSession
 * @property {() => void} [onMore]                parent wirable till UtforskaEventActionSheet
 * @property {() => void} [onPin]                 analytics-callback för kartöppning
 * @property {() => void} [onReadMore]            2026-10-07: callback för "Läs mer"-knappen
 *                                              (samma stil som MapEventCard).
 * @property {string} [a11yLabel]
 */

export default function NewEventCard({
  title,
  dateLine,
  meta,
  preview = null,
  // 2026-10-14 — fas 5.7: utöka default-preview från 2 till 10 rader så
  // Användaren slipper "Läs mer"-tratten och ser hela FACT-beskrivningen
  // direkt i tilen. Samtalsvillkor 2026-10-14: "här vill jag ha 10 rader max".
  // Konfigurerbart via prop för callers som vill ha cliffhanger-versionen.
  previewLines = 10,
  badge = null,
  imageSource = null,
  saved = false,
  lat = 59.3326,
  lng = 18.0668,
  id,
  onPress,
  onSave,
  onCalendar,
  onShare,
  onMore,
  onPin,
  onReadMore,
  // 2026-10-10 (FAS 3.2 attribution, Tier 1) — kort öppen-data-text,
  // t.ex. "Artistinfo från öppna datakällor". Pedagogisk attribution
  // istället för ©-raden. Computed av parent från event.profile.
  dataSource = null,
  a11yLabel,
}) {
  const source = sourceOf(imageSource);
  // 2026-10-07 — wrap-aspect sätts till bildens naturliga aspect. Tidigare
  // fast 1.15 + cover cropade bilden (speciellt vertikala biblioteksbilder).
  // Nu visas bilden helt (contain) och wrap-ramen matchar bildens aspect.
  const { aspect: imageAspect } = useImageAspect(imageSource);
  const label = a11yLabel
    ?? [id ? `#${id}` : null, title, dateLine, meta, dataSource]
        .filter(Boolean).join(' — ');
  const stop = (fn) => (e) => { e?.stopPropagation?.(); fn?.(); };

  // Spara-toggle. Lokal state speglar initialt `saved`-proppen och
  // togglar på klick; onSave-callback får nästa värde så parent kan
  // anropa recordEventInteraction + analytics (samma kedja som
  // DetailsScreen använder idag).
  const [isSaved, setIsSaved] = useState(Boolean(saved));
  const handleToggleSave = () => {
    const next = !isSaved;
    setIsSaved(next);
    onSave?.(next);
  };

  // Pin-toggle — öppnar/stänger modal-karta med eventets lat/lng.
  const [showMap, setShowMap] = useState(false);
  const handleTogglePin = () => {
    setShowMap((s) => !s);
    onPin?.();
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* Hero-bild (wrap-aspect sätts dynamiskt från useImageAspect() —
          bilden visas helt med contain-resize, ramen matchar bildens
          naturliga aspect). 2026-10-07-bytet: tidigare fast 1.15 + cover
          cropade bilden. Nu visas allt i centrum utan crop. */}
      {source ? (
        <View style={[styles.heroWrap, { aspectRatio: imageAspect }]}>
          <Image
            source={source}
            style={styles.hero}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </View>
      ) : (
        <View style={styles.heroPlaceholder}>
          <Text style={styles.heroPlaceholderText}>EVENT</Text>
        </View>
      )}

      {/* Modal-karta — Apple Maps via react-native-maps, samma setup
          som AppleMapsScreen (karta-fliken). Tap utanför stänger. */}
      <Modal
        visible={showMap}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMap(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowMap(false)}
          accessibilityLabel="Stäng karta"
        >
          {/* Ren <View> (inte Pressable) — MapView fyller absoluteFill
              och vinner gesture-responder, så zoom/pan funkar utan att
              första touch stjäls av en yttre tap-handler. */}
          <View style={styles.modalCard}>
            <MapView
              provider={PROVIDER_DEFAULT}
              style={StyleSheet.absoluteFill}
              zoomEnabled
              scrollEnabled
              pitchEnabled={false}
              rotateEnabled={false}
              initialRegion={{
                latitude: lat,
                longitude: lng,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
              accessibilityLabel="Karta med eventets position"
            >
              <Marker coordinate={{ latitude: lat, longitude: lng }} />
            </MapView>
            <Pressable
              style={styles.modalClose}
              onPress={() => setShowMap(false)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Stäng"
            >
              <Text style={styles.modalCloseText}>×</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Body under bilden */}
      <View style={styles.body}>
        {/* Rad 1: badge + datum/tid + actions */}
        <View style={styles.topRow}>
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
          {dateLine ? (
            <Text style={styles.dateLine} numberOfLines={1}>
              {dateLine}
            </Text>
          ) : null}
          <View style={styles.flex} />
          <View style={styles.actions}>
            <ActionIcon
              glyph={isSaved ? ICON.saved : ICON.save}
              color={isSaved ? T.color.savedAccent : T.color.textMuted}
              a11y={isSaved ? 'Ta bort sparning' : 'Spara'}
              onPress={handleToggleSave}
            />
            <ActionIcon
              glyph={ICON.pin}
              color={showMap ? T.color.accent : T.color.textMuted}
              a11y={showMap ? 'Dölj karta' : 'Visa karta'}
              onPress={handleTogglePin}
            />
            <ActionIcon
              glyph={ICON.calendar}
              a11y="Lägg till i kalender"
              onPress={stop(onCalendar)}
            />
            <ActionIcon
              glyph={ICON.share}
              a11y="Dela"
              onPress={stop(onShare)}
            />
            <ActionIcon
              glyph={ICON.more}
              a11y="Fler alternativ"
              onPress={stop(onMore)}
            />
          </View>
        </View>

        {/* Rad 2: TITEL */}
        <Text
          style={styles.title}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {title}
        </Text>

        {/* Rad 3: meta */}
        {meta ? (
          <Text style={styles.meta} numberOfLines={1} ellipsizeMode="tail">
            {meta}
          </Text>
        ) : null}

        {/* Rad 3b (2026-10-10, FAS 3.2): Tier 1 attribution.
            Diskret, italic, muted — visar att artistinfo etc. kommer
            från öppna datakällor. Computed av parent från event.profile
            via buildAttribution(). Tier 2/3 hanteras på details-sidan. */}
        {dataSource ? (
          <Text
            style={styles.dataSource}
            numberOfLines={1}
            ellipsizeMode="tail"
            accessibilityLabel={`Datakälla: ${dataSource}`}
          >
            {dataSource}
          </Text>
        ) : null}

        {/* Rad 4 (valfri): description-preview.
            Antal rader styrs av `previewLines` prop (default 10 från 2026-10-14). */}
        {preview ? (
          <Text
            style={styles.preview}
            numberOfLines={previewLines}
            ellipsizeMode="tail"
          >
            {preview}
          </Text>
        ) : null}

        {/* Rad 5 (2026-10-07): "Läs mer"-knapp — samma stil som
            MapEventCard.readMore (orange ram, rektangulär, gul text).
            Visas alltid när onReadMore finns — parent bestämmer om knappen
            ska renderas (t.ex. bara om preview är truncated eller om det
            finns mer info på details-skärmen). Högerjusterad, egen rad. */}
        {onReadMore ? (
          <View style={styles.readMoreRow}>
            <Pressable
              style={({ pressed }) => [
                styles.readMore,
                pressed && styles.readMorePressed,
              ]}
              onPress={onReadMore}
              accessibilityRole="button"
              accessibilityLabel="Läs mer"
              testID="event-card-read-more"
            >
              <Text style={styles.readMoreText}>Läs mer</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function ActionIcon({ glyph, a11y, onPress, color }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.action,
        pressed && styles.actionPressed,
      ]}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      <Text style={[styles.actionGlyph, color && { color }]}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: T.color.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.color.border,
  },
  cardPressed: {
    backgroundColor: T.color.surface,
    opacity: 0.85,
  },
  // 2026-10-07 — wrap-aspect sätts dynamiskt från useImageAspect().
  // Inget hård aspectRatio här — bilden får wrap:en att följa sina egna
  // proportioner så hela bilden syns (contain-resize).
  heroWrap: {
    marginHorizontal: T.space.padX,
    marginTop: T.space.padY,
    borderRadius: T.space.heroRadius,
    overflow: 'hidden',
    backgroundColor: T.color.placeholder,
  },
  hero: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  // Placeholder behåller fast aspectRatio så layouten är stabil även
  // innan/aspect när bilden inte finns.
  heroPlaceholder: {
    marginHorizontal: T.space.padX,
    marginTop: T.space.padY,
    borderRadius: T.space.heroRadius,
    backgroundColor: T.color.placeholder,
    aspectRatio: T.space.heroAspect,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPlaceholderText: {
    color: T.color.placeholderText,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: '90%',
    aspectRatio: 1.33,
    borderRadius: T.space.heroRadius,
    overflow: 'hidden',
    backgroundColor: T.color.placeholder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  modalClose: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '300',
    lineHeight: 24,
    textAlign: 'center',
    includeFontPadding: false,
  },
  body: {
    paddingHorizontal: T.space.padX,
    paddingTop: T.space.gap,
    paddingBottom: T.space.bottomPad,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    backgroundColor: 'rgba(255,180,84,0.12)',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  badgeText: {
    color: T.color.accent,
    fontSize: T.font.badge.size,
    fontWeight: T.font.badge.weight,
    letterSpacing: T.font.badge.letterSpacing,
    textTransform: 'uppercase',
  },
  dateLine: {
    color: T.color.accent,
    fontSize: T.font.eyebrow.size,
    fontWeight: T.font.eyebrow.weight,
    letterSpacing: T.font.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  flex: { flex: 1 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.actionGap,
  },
  action: {
    width: T.space.actionHit,
    height: T.space.actionHit,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPressed: {
    opacity: 0.4,
  },
  actionGlyph: {
    color: T.color.textMuted,
    fontSize: T.font.icon.size,
    fontWeight: T.font.icon.weight,
    lineHeight: T.font.icon.size + 2,
  },
  title: {
    color: T.color.text,
    fontSize: T.font.title.size,
    fontWeight: T.font.title.weight,
    letterSpacing: T.font.title.letterSpacing,
    lineHeight: T.font.title.lineHeight,
    marginTop: T.space.titleMargin,
  },
  meta: {
    color: T.color.textMuted,
    fontSize: T.font.meta.size,
    fontWeight: T.font.meta.weight,
    marginTop: T.space.metaMargin,
  },
  // 2026-10-10: Tier 1 attribution — diskret text under meta-rad.
  // Visar "Artistinfo från öppna datakällor" eller liknande. Italic,
  // lägre opacitet än meta, ingen ikon (för att inte konkurrera med
  // meta om uppmärksamhet). Hela raden är 1 line + ellipsize.
  dataSource: {
    color: T.color.textMuted,
    fontSize: T.font.dataSource.size,
    fontWeight: T.font.dataSource.weight,
    letterSpacing: T.font.dataSource.letterSpacing,
    fontStyle: 'italic',
    marginTop: T.space.dataSourceMargin,
    opacity: 0.7,
  },
  preview: {
    color: T.color.textMuted,
    fontSize: T.font.preview.size,
    fontWeight: T.font.preview.weight,
    lineHeight: T.font.preview.lineHeight,
    marginTop: T.space.previewMargin,
    opacity: 0.75,
  },
  // 2026-10-07: "Läs mer"-knappen (egen rad, högerjusterad). Samma stil
  // som MapEventCard.readMore — orange ram, rektangulär, gul text.
  readMoreRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: T.space.readMoreRowMargin,
  },
  readMore: {
    minHeight: 30,
    paddingHorizontal: T.space.readMorePadX,
    paddingVertical: T.space.readMorePadY,
    borderRadius: T.space.readMoreRadius,
    borderWidth: 1,
    borderColor: T.color.accent,
    backgroundColor: 'rgba(255,180,84,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  readMorePressed: {
    opacity: 0.6,
  },
  readMoreText: {
    color: T.color.accent,
    fontSize: T.font.readMore.size,
    fontWeight: T.font.readMore.weight,
    letterSpacing: T.font.readMore.letterSpacing,
  },
});