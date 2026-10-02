// MapTooltip.js — mini-callout för marker-press.
//
// Begränsningar för sandbox:
//   - Visar max 3 events från en kluster-cell (klustrade events)
//   - Tap utanför dismissar
//   - Positioneras ovanför marker, men flyttas ner om den klipper
//     ovanför canvas-toppen
//
// Tokens delas med MapScreen för visuell konsistens.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatStartLabel } from './mapTime';

const TOKENS = {
  color: {
    bg: '#000000',
    text: '#F7F2EA',
    textMuted: '#9AA3B5',
    accent: '#FFB454',
    border: '#FFB454',
    bgElev: '#14110C',
    bgFree: '#1A2A1A',
  },
  font: {
    title: { size: 14, weight: '800', letterSpacing: -0.2 },
    meta: { size: 12, weight: '500' },
    pill: { size: 10, weight: '700', letterSpacing: 0.6 },
  },
  space: {
    padX: 20,
    pad: 12,
    radius: 10,
    rowGap: 6,
    maxWidth: 280,
  },
};

const CATEGORY_LABELS = {
  'musical-theatre': 'Musikal',
  music: 'Musik',
  classical: 'Klassiskt',
  community: 'Community',
  theater: 'Teater',
  comedy: 'Standup',
  sport: 'Sport',
  family: 'Familj',
  dance: 'Dans',
  exhibition: 'Utställning',
  workshop: 'Workshop',
};

function pickTitle(event) {
  return event?.title_sv || event?.title_en || 'Evenemang';
}

function pickCategoryLabel(event) {
  const slug = event?.category_slug;
  if (slug && CATEGORY_LABELS[slug]) return CATEGORY_LABELS[slug];
  return slug || 'event';
}

export default function MapTooltip({ cluster, canvasW, canvasH, onDismiss }) {
  if (!cluster || !cluster.events || cluster.events.length === 0) return null;
  const events = cluster.events.slice(0, 3);
  const moreCount = Math.max(0, cluster.events.length - 3);

  // Positionering: ovanför marker om möjligt, annars nedanför.
  const tooltipW = Math.min(TOKENS.space.maxWidth, canvasW - 16);
  const tooltipH = 24 + events.length * 28 + (moreCount > 0 ? 22 : 0);
  const aboveMarker = cluster.y - tooltipH - 12 >= 0;
  const top = aboveMarker ? cluster.y - tooltipH - 12 : cluster.y + 16;
  const leftRaw = cluster.x - tooltipW / 2;
  const left = Math.max(8, Math.min(canvasW - tooltipW - 8, leftRaw));

  return (
    <Pressable
      onPress={onDismiss}
      accessibilityRole="button"
      accessibilityLabel="Stäng tooltip"
      style={[
        styles.tooltip,
        {
          top,
          left,
          width: tooltipW,
          minHeight: tooltipH,
        },
      ]}
    >
      <Text style={styles.title} numberOfLines={1}>
        {events.length === 1
          ? pickTitle(events[0])
          : `${cluster.count} events här`}
      </Text>
      {events.map((event) => (
        <View key={event.id} style={styles.row}>
          <Text style={styles.rowMeta}>
            {formatStartLabel(event.start_time)} · {pickCategoryLabel(event)}
          </Text>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {pickTitle(event)}
          </Text>
        </View>
      ))}
      {moreCount > 0 ? (
        <Text style={styles.more}>+{moreCount} till i denna cell</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tooltip: {
    position: 'absolute',
    backgroundColor: TOKENS.color.bgElev,
    borderWidth: 1,
    borderColor: TOKENS.color.border,
    borderRadius: TOKENS.space.radius,
    paddingHorizontal: TOKENS.space.pad,
    paddingVertical: TOKENS.space.pad,
    zIndex: 10,
  },
  title: {
    color: TOKENS.color.accent,
    fontSize: TOKENS.font.title.size,
    fontWeight: TOKENS.font.title.weight,
    letterSpacing: TOKENS.font.title.letterSpacing,
    marginBottom: 8,
  },
  row: {
    marginBottom: TOKENS.space.rowGap,
  },
  rowMeta: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.meta.size,
    fontWeight: TOKENS.font.meta.weight,
    marginBottom: 2,
  },
  rowTitle: {
    color: TOKENS.color.text,
    fontSize: TOKENS.font.meta.size,
    fontWeight: '700',
  },
  more: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.pill.size,
    fontWeight: TOKENS.font.pill.weight,
    letterSpacing: TOKENS.font.pill.letterSpacing,
    marginTop: 4,
  },
});

export { TOKENS as MAP_TOOLTIP_TOKENS };