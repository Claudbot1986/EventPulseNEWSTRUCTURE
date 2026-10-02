// MapCanvas.js — SVG-fri karta med React Native Views.
//
// Varför inte SVG: sandboxen har inte react-native-svg installerat
// och vi vill undvika native build-krav. RN-Views med position:
//   absolute duger för 100+ prickar; React hanterar layout.
//
// Vad visas:
//   - Bakgrund (Stockholm-området, representerad av en centrerad
//     "glow" + horisontella "longitud"-linjer som subtila tick-marks)
//   - En klustrad pin per cell som samlar events
//   - Kluster-cirkeln skalas med sqrt(count) så multi-event-celler
//     syns tydligt
//   - Tap på kluster → MapTooltip öppnas med 3 första events
//
// Begränsningar:
//   - Inga zoom/pannings-gester (utökat scope, sandbox-nivå)
//   - Inget tile-bakgrund (vi visar bara prickarna, inte gatunamn)
//     — tillräckligt för att verifiera positions-trohet
//   - Markers är View-cirklar (inte SVG-cirklar)

import { useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  STOCKHOLM_BOUNDS,
  STOCKHOLM_FALLBACK,
  jitterFallback,
  projectToXY,
} from './mapProjection';
import { clusterPins, CELL_SIZE } from './mapClustering';
import MapTooltip from './MapTooltip';

const TOKENS = {
  color: {
    bg: '#000000',
    canvasBg: '#0A0A0A',
    gridLine: '#14110C',
    line: '#1A1A1A',
    centerGlow: 'rgba(255,180,254,0.06)',
    centerDot: '#FFB454',
    pin: '#F7F2EA',
    pinFree: '#5BC85B',
    pinCluster: '#FFB454',
    pinClusterStroke: '#000000',
    textMuted: '#9AA3B5',
  },
  font: {
    count: { size: 11, weight: '800', letterSpacing: 0 },
    badge: { size: 10, weight: '700', letterSpacing: 0.4 },
    cornerLabel: { size: 10, weight: '700', letterSpacing: 1.6 },
  },
  space: {
    padX: 20,
    canvasHeight: 360,
    canvasRadius: 8,
    pinRadius: 3,
    clusterMinRadius: 8,
    clusterRadiusPerEvent: 2,
    gridLines: 5,
    cornerInset: 10,
  },
};

// Kategori → pin-färg. Bucket: 8 nivåer, muted/saturated alternating.
const CATEGORY_PALETTE = {
  music: '#FFB454',
  'musical-theatre': '#F4A6A6',
  classical: '#9CB8FF',
  theater: '#F7C97A',
  community: '#7DD3C0',
  comedy: '#F4A6A6',
  sport: '#FF9C7A',
  family: '#A4DD80',
  dance: '#C8A4FF',
  exhibition: '#A4C8DD',
  workshop: '#DDB79E',
};

function pinColor(event) {
  if (event && event.is_free) return TOKENS.color.pinFree;
  const slug = event && event.category_slug;
  if (slug && CATEGORY_PALETTE[slug]) return CATEGORY_PALETTE[slug];
  return TOKENS.color.pin;
}

/**
 * Bygg synliga gridlines (horisontella "tick-marks" vid olika lat).
 * Lat är inverterad i pixel-space så vi går från top→bottom.
 */
function GridLines({ width, height }) {
  const lines = [];
  for (let i = 0; i <= TOKENS.space.gridLines; i++) {
    const y = (height / TOKENS.space.gridLines) * i;
    lines.push(
      <View
        key={`h${i}`}
        style={[styles.gridLine, { top: y, width }]}
        pointerEvents="none"
      />,
    );
  }
  for (let i = 0; i <= TOKENS.space.gridLines; i++) {
    const x = (width / TOKENS.space.gridLines) * i;
    lines.push(
      <View
        key={`v${i}`}
        style={[styles.gridLineV, { left: x, height }]}
        pointerEvents="none"
      />,
    );
  }
  return lines;
}

export default function MapCanvas({
  events,
  testID = 'map-canvas',
}) {
  const [size, setSize] = useState({ width: 0, height: TOKENS.space.canvasHeight });
  const [activeClusterKey, setActiveClusterKey] = useState(null);

  const onLayout = (e) => {
    const { width } = e.nativeEvent.layout;
    setSize((prev) =>
      prev.width === width
        ? prev
        : { width, height: TOKENS.space.canvasHeight },
    );
  };

  // Projicera + jittera + filtrera bort out-of-bounds.
  const pins = useMemo(() => {
    if (!size.width || size.width <= 0) return [];
    const out = [];
    for (const raw of events) {
      if (!raw || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) continue;
      const event = jitterFallback(raw);
      const projected = projectToXY(event.lat, event.lng, STOCKHOLM_BOUNDS, size);
      out.push({ x: projected.x, y: projected.y, visible: projected.visible, event });
    }
    return out;
  }, [events, size.width]);

  const clusters = useMemo(() => clusterPins(pins, CELL_SIZE), [pins]);
  const activeCluster = activeClusterKey != null
    ? clusters.find((c) => `${Math.round(c.x)},${Math.round(c.y)}` === activeClusterKey)
    : null;

  // Första Stockholm-pin (centrum) → subtil orange markering.
  const centerProjection = size.width
    ? projectToXY(STOCKHOLM_FALLBACK.lat, STOCKHOLM_FALLBACK.lng, STOCKHOLM_BOUNDS, size)
    : { x: -1, y: -1, visible: false };

  return (
    <View
      onLayout={onLayout}
      testID={testID}
      style={[styles.canvas, { height: TOKENS.space.canvasHeight }]}
      accessibilityLabel={`Karta med ${events.length} events i Stockholm-området`}
    >
      <GridLines width={size.width} height={TOKENS.space.canvasHeight} />
      {centerProjection.visible ? (
        <View
          pointerEvents="none"
          style={[
            styles.centerGlow,
            {
              top: centerProjection.y - 16,
              left: centerProjection.x - 16,
            },
          ]}
        />
      ) : null}

      <View style={styles.cornerTopLeft} pointerEvents="none">
        <Text style={styles.cornerLabel}>STOCKHOLM</Text>
      </View>
      <View style={styles.cornerBottomLeft} pointerEvents="none">
        <Text style={styles.cornerLabel}>
          {events.length} events · {clusters.length} kluster
        </Text>
      </View>

      {clusters.map((c, i) => {
        const isCluster = c.count > 1;
        const radius = isCluster
          ? Math.min(
              TOKENS.space.clusterMinRadius +
                Math.sqrt(c.count) * TOKENS.space.clusterRadiusPerEvent,
              22,
            )
          : TOKENS.space.pinRadius;
        const key = `${Math.round(c.x)},${Math.round(c.y)}`;
        const isActive = key === activeClusterKey;
        const fillColor = isCluster ? TOKENS.color.pinCluster : pinColor(c.events[0]);
        return (
          <Pressable
            onPress={() => setActiveClusterKey(isActive ? null : key)}
            key={`${key}-${i}`}
            testID={`pin-${i}`}
            accessibilityRole="button"
            accessibilityLabel={
              isCluster
                ? `Kluster med ${c.count} events`
                : c.events[0]?.title_sv || c.events[0]?.title_en || 'Event'
            }
            style={[
              styles.pin,
              {
                top: c.y - radius,
                left: c.x - radius,
                width: radius * 2,
                height: radius * 2,
                borderRadius: radius,
                backgroundColor: fillColor,
                borderColor: isActive ? TOKENS.color.pinClusterStroke : 'transparent',
                borderWidth: isActive ? 2 : 0,
              },
            ]}
          >
            {isCluster ? (
              <Text style={styles.countText}>{c.count}</Text>
            ) : null}
          </Pressable>
        );
      })}

      {activeCluster ? (
        <MapTooltip
          cluster={activeCluster}
          canvasW={size.width}
          canvasH={TOKENS.space.canvasHeight}
          onDismiss={() => setActiveClusterKey(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: TOKENS.color.canvasBg,
    marginHorizontal: TOKENS.space.padX,
    borderRadius: TOKENS.space.canvasRadius,
    overflow: 'hidden',
    position: 'relative',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    height: 1,
    backgroundColor: TOKENS.color.gridLine,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    width: 1,
    backgroundColor: TOKENS.color.gridLine,
  },
  centerGlow: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: TOKENS.color.centerGlow,
  },
  pin: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    color: '#000000',
    fontSize: TOKENS.font.count.size,
    fontWeight: TOKENS.font.count.weight,
    letterSpacing: TOKENS.font.count.letterSpacing,
  },
  cornerTopLeft: {
    position: 'absolute',
    top: TOKENS.space.cornerInset,
    left: TOKENS.space.cornerInset,
  },
  cornerBottomLeft: {
    position: 'absolute',
    bottom: TOKENS.space.cornerInset,
    left: TOKENS.space.cornerInset,
  },
  cornerLabel: {
    color: TOKENS.color.textMuted,
    fontSize: TOKENS.font.cornerLabel.size,
    fontWeight: TOKENS.font.cornerLabel.weight,
    letterSpacing: TOKENS.font.cornerLabel.letterSpacing,
    textTransform: 'uppercase',
  },
});

export { TOKENS as MAP_CANVAS_TOKENS, CATEGORY_PALETTE };