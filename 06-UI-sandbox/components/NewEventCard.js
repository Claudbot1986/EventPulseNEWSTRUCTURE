// Eventkort — kompakt rad med hero-bild, titel, meta och icon-actions.
// Tryck på 📍 öppnar Apple Maps-popup med eventets position. Tryck utanför
// stänger.

import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
// 2026-10-04: Samma MapView som AppleMapsScreen (06-UI karta-flik) —
// Apple Maps via react-native-maps. PROVIDER_DEFAULT = MapKit på iOS.
import MapView, { PROVIDER_DEFAULT, Marker } from 'react-native-maps';

// ─── Tokens (i linje med DESIGN_SYSTEM.md binding-värden) ─────────
const T = {
  color: {
    bg: '#000000',
    surface: '#0A0A0A',
    border: '#2A2A33',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
    textTertiary: '#727B8D',
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
  },
  space: {
    padX: 14,
    padY: 10,
    // 2026-10-04 (efter feedback): "kolla i eventkorten som finns i
    // riktiga 06-UI och lägg in den bilden med de reglerna". Användaren
    // vill ha SAMMA hero-bild-regler som EventPulseCard (06-UI/components/
    // EventPulseCard.js) — aspect 1.15, image full-wrap, cover crop.
    // Wrap = 1.15:1 (lite högre än kvadrat), image matchar wrap, cover
    // croppar jämnt top+botten (~6.5% var).
    heroAspect: 1.15,
    heroRadius: 8,
    gap: 10,
    actionHit: 32,
    actionGap: 4,
    titleMargin: 6,
    metaMargin: 2,
    previewMargin: 6,
    bottomPad: 12,
  },
};

// ─── Helpers ───────────────────────────────────────────────────────
function sourceOf(imageSource) {
  if (imageSource == null) return null;
  if (typeof imageSource === 'number') return imageSource;
  if (typeof imageSource === 'string' && imageSource.length > 0) {
    return { uri: imageSource };
  }
  if (typeof imageSource === 'object' && imageSource.uri) return imageSource;
  return null;
}

// Glyph-set: kompakta symboler istället för 48px-knappar med text.
const ICON = {
  save: '♡',
  saved: '♥',
  pin: '📍',         // Location pin-emoji (drop-form med vit mitt-cirkel)
  calendar: '◷',
  share: '↗',
  more: '⋯',
};

// ─── NewEventCard ──────────────────────────────────────────────────
export default function NewEventCard({
  title,
  dateLine,             // t.ex. "LÖR 26 SEP · 20:00"
  meta,                 // t.ex. "Drottninggatan · Stockholm"
  preview = null,
  badge = null,
  imageSource = null,
  saved = false,
  // lat, lng används av mini-kartan (default Stockholm)
  lat = 59.3326,
  lng = 18.0668,
  onPress,
  onSave,
  onCalendar,
  onShare,
  onMore,
  onPin,
  a11yLabel,
}) {
  const source = sourceOf(imageSource);
  const label = a11yLabel ?? `${title}${dateLine ? ' — ' + dateLine : ''}${meta ? ' — ' + meta : ''}`;
  const stop = (fn) => (e) => { e?.stopPropagation?.(); fn?.(); };

  // 2026-10-04: toggle-funkt för hjärta-knappen. Lokal state speglar
  // initialt `saved`-proppen och togglar på klick. onSave-callback får
  // det nya värdet så parent kan synka om den vill (t.ex. spara i
  // user_preferences). Vid toggle stängs INTE event-raden (stop()).
  const [isSaved, setIsSaved] = useState(Boolean(saved));
  const handleToggleSave = () => {
    const next = !isSaved;
    setIsSaved(next);
    onSave?.(next);
  };

  // 2026-10-04: toggle-funkt för pin-knappen som visar/döljer mini-
  // kartan med eventets lat/lng.
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
      {/* ─── Hero-bild överst (croppad nerifrån) ─── */}
      {source ? (
        <View style={styles.heroWrap}>
          <Image
            source={source}
            style={styles.hero}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        </View>
      ) : (
        <View style={styles.heroPlaceholder}>
          <Text style={styles.heroPlaceholderText}>EVENT</Text>
        </View>
      )}

      {/* ─── Mini-karta som popup-modal ─── */}
      <Modal
        visible={showMap}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMap(false)}
      >
        {/* Lager 1: backdrop. Tap stänger modal. */}
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowMap(false)}
          accessibilityLabel="Stäng karta"
        >
          {/* Lager 2: centrerad karta. Ren <View> (INTE Pressable) —
              MapView fyller absoluteFill och hanterar sina egna
              gesture-respondrar (pinch zoom + pan). Om vi sveper i
              Pressable med onPress riskerar vi att claim:a responder
              och stjäla första touch från kartan, vilket gör den stel.
              MapView default beter sig så att EN tap på kartan INTE
              bubblar till backdrop-Pressable (native gestures vinner
              över JS responder på iOS). */}
          <View style={styles.modalCard}>
            {/* Samma MapView som AppleMapsScreen. 90% × 4:3 (uppskrivet
                från 66.66% inline på användarens begäran). zoomEnabled
                + scrollEnabled är default true i react-native-maps men
                sätts explicit för tydlighet. pitch/rotate av — bara
                plan 2D för ett mini-eventkort, enklare mental modell. */}
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
            {/* Stäng-knapp (X) uppe i högra hörnet */}
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

      {/* ─── Body (innehåll under bilden) ─── */}
      <View style={styles.body}>
        {/* Rad 1: badge + datum/tid + ikoner */}
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

        {/* Rad 2: TITEL (egen rad — användarens krav) */}
        <Text
          style={styles.title}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {title}
        </Text>

        {/* Rad 3: meta (egen rad) */}
        {meta ? (
          <Text style={styles.meta} numberOfLines={1} ellipsizeMode="tail">
            {meta}
          </Text>
        ) : null}

        {/* Rad 4 (valfri): description-preview */}
        {preview ? (
          <Text
            style={styles.preview}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {preview}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// ─── Ikon-knapp (32×32, ingen bakgrund, ingen border, bara glyph) ──
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

// ─── Styles ────────────────────────────────────────────────────────
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

  // Hero-bild
  // 2026-10-04: SAMMA approach som EventPulseCard (06-UI/components/
  // EventPulseCard.js rad 95-105). Wrap = aspectRatio 1.15, image
  // matchar wrap (100% × 100%), cover-croppar jämnt top+botten.
  heroWrap: {
    marginHorizontal: T.space.padX,    // standard padX (14)
    marginTop: T.space.padY,
    borderRadius: T.space.heroRadius,
    overflow: 'hidden',
    backgroundColor: T.color.placeholder,
    aspectRatio: T.space.heroAspect,    // 1.15 (samma som EventPulseCard)
  },
  hero: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',                // default; croppar bilden för att passa wrap
  },
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

  // 2026-10-04: Modal-popup för pin-knappen. Samma MapView-bibliotek
  // och approach som AppleMapsScreen (06-UI) — Apple Maps via
  // react-native-maps, PROVIDER_DEFAULT, Marker på eventets lat/lng.
  //
  // Lager 1: modalBackdrop — hela skärmen, mörk translucent ton (typ
  // 75% svart) så event-kortet under syns diffus. Tap stänger modal.
  // Lager 2: modalCard — centrerad karta. 2026-10-04: storleken
  // uppskriven från 66.66% till 90% × 4:3 på användarens begäran
  // ("gör kartan större") — ger kartan rejäl popup-närvaro.
  // Tap på kartan gör INGENTING så backdrop inte råkar stänga.
  // Lager 3: modalClose — X-knapp uppe i högra hörnet (32×32, vit).
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
    // Skugga för att lyfta kartan från backdrop.
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
    // Centrera ×-tecknet i knappen (default är lite högerlutat).
    textAlign: 'center',
    includeFontPadding: false,
  },

  // Body
  body: {
    paddingHorizontal: T.space.padX,
    paddingTop: T.space.gap,
    paddingBottom: T.space.bottomPad,
  },

  // Rad 1: badge + datum/tid + ikoner
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

  // Rad 2: TITEL (egen rad)
  title: {
    color: T.color.text,
    fontSize: T.font.title.size,
    fontWeight: T.font.title.weight,
    letterSpacing: T.font.title.letterSpacing,
    lineHeight: T.font.title.lineHeight,
    marginTop: T.space.titleMargin,
  },

  // Rad 3: meta (egen rad)
  meta: {
    color: T.color.textMuted,
    fontSize: T.font.meta.size,
    fontWeight: T.font.meta.weight,
    marginTop: T.space.metaMargin,
  },

  // Rad 4 (valfri): preview
  preview: {
    color: T.color.textMuted,
    fontSize: T.font.preview.size,
    fontWeight: T.font.preview.weight,
    lineHeight: T.font.preview.lineHeight,
    marginTop: T.space.previewMargin,
    opacity: 0.75,
  },
});

NewEventCard.__tokens = T;
NewEventCard.__sampleProps = {
  title: 'Krogshow — Norra Latin',
  dateLine: 'LÖR 26 SEP · 20:00',
  meta: 'Drottninggatan · Stockholm',
  preview:
    'En kväll med lokala artister och hemlagad mat. Biljetter från 295 kr.',
  badge: 'MUSIK',
  // tile-4 = utomhuskonsert, silhuetter mot brandgul solnedgång. Skarpare
  // än tile-1 (mörk restauranginteriör) och croppas snyggare från botten
  // — himlen och silhuetterna behåller sin karaktär.
  imageSource: require('../assets/tile-4.png'),
  saved: false,
};