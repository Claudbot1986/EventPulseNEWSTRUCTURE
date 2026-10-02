// MapPinLayer.js — overlay med pinnar, klustring och tooltip.
//
// Detta lager rör sig INTE om vad som finns bakom (MapBaseLayer). Det
// tar emot en lista events + en viewport (width/height, zoom, bounds), och
// ritar:
//   - En pin per event (kategori-färg + gratis-event-grön)
//   - Klustrade events i samma pixel-cell → en kluster-cirkel med count
//   - Tap på pin/kluster → tooltip med första events
//
// Projektion: projectViewport från mapProjection.js (Mercator).
// Pin-pixel-positioner är därmed pixel-noggrant synkade med
// OSM-tile-bilden i StaticTilesBaseLayer.
//
// Användning:
//   <MapPinLayer events={filteredEvents} viewport={viewport} />
//
// När vi flyttar till react-native-maps i 06-UI/ senare: byt ut detta
// lager mot MapView+<Marker>-komponenter från react-native-maps.
// Samma data-kontrakt, samma tooltip-UX, samma projektion.

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { projectViewport, jitterFallback } from './mapProjection';
import { clusterPins, CELL_SIZE } from './mapClustering';
import MapTooltip from './MapTooltip';

const TOKENS = {
  color: {
    pin: '#F7F2EA',
    pinFree: '#5BC85B',
    pinCluster: '#FFB454',
    pinClusterStroke: '#000000',
    textMuted: '#9AA3B5',
  },
  font: {
    count: { size: 11, weight: '800' },
    cornerLabel: { size: 10, weight: '700', letterSpacing: 1.6 },
  },
  space: {
    pinRadius: 3,
    clusterMinRadius: 8,
    clusterRadiusPerEvent: 2,
    clusterMaxRadius: 22,
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

export default function MapPinLayer({
  events,
  viewport,
  testID = 'map-pin-layer',
  showCount = true,
}) {
  const [activeClusterKey, setActiveClusterKey] = useState(null);

  // Projicera + jittera + filtrera bort out-of-bounds.
  const pins = useMemo(() => {
    if (!viewport || viewport.width <= 0) return [];
    const out = [];
    for (const raw of events) {
      if (!raw || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) continue;
      const event = jitterFallback(raw);
      const projected = projectViewport(event.lat, event.lng, viewport);
      out.push({ x: projected.x, y: projected.y, visible: projected.visible, event });
    }
    return out;
  }, [events, viewport]);

  const clusters = useMemo(() => clusterPins(pins, CELL_SIZE), [pins]);
  const activeCluster = activeClusterKey
    ? clusters.find((c) => `${Math.round(c.x)},${Math.round(c.y)}` === activeClusterKey)
    : null;

  if (!viewport || viewport.width <= 0) return null;

  return (
    <View
      testID={testID}
      style={[styles.layer, { width: viewport.width, height: viewport.height }]}
      pointerEvents="box-none"
      accessibilityLabel={`Karta med ${events.length} events`}
    >
      {showCount ? (
        <View style={styles.cornerBottomLeft} pointerEvents="none">
          <Text style={styles.cornerLabel}>
            {events.length} events · {clusters.length} kluster
          </Text>
        </View>
      ) : null}

      {clusters.map((c, i) => {
        const isCluster = c.count > 1;
        const radius = isCluster
          ? Math.min(
              TOKENS.space.clusterMinRadius +
                Math.sqrt(c.count) * TOKENS.space.clusterRadiusPerEvent,
              TOKENS.space.clusterMaxRadius,
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
          canvasW={viewport.width}
          canvasH={viewport.height}
          onDismiss={() => setActiveClusterKey(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
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

export { TOKENS as MAP_PIN_LAYER_TOKENS, CATEGORY_PALETTE };