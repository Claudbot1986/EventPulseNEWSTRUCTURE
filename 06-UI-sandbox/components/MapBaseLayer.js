// MapBaseLayer.js — utbytbar tile-provider/renderer för kartan.
//
// Detta är ENDA punkten som rör vad som visas bakom prickarna.
// Pin-lagret (MapPinLayer) är separat och anropar projectViewport från
// mapProjection.js. När vi vill byta tile-provider (react-native-maps,
// Leaflet via WebView, MapLibre, Google Maps) byter vi ENDAST denna
// komponent — pin/cluster/tooltip/filter-logiken rörs inte.
//
// Kontrakt för en base-layer:
//   - Tar emot `viewport` (width, height, bounds, zoom) och
//     `panOffset` (assetOffsetX/Y, asset-storlek).
//   - Renderar inom exakt viewport-ets pixel-koordinater.
//   - Synkroniserar med samma Mercator-projektion som pin-lagret.
//
// Två implementationer i denna fil:
//   GridBaseLayer        — ingen tile-provider, bara grid-rutor.
//                          Använd för offline-test eller som fallback.
//   StaticTilesBaseLayer — för-bakade OSM-tile-tillgångar (Mercator-
//                          korrekt) för flera z-nivåer (11/13/15).
//                          3× större än viewport så vi har pan-rumner
//                          inom asset. Användaren kan pinch:a för att
//                          växla och pan:a för att röra sig.

import { Image, StyleSheet, Text, View } from 'react-native';

// Tillgängliga zoom-nivåer och deras asset-källor. Snap-point: om
// viewport.zoom faller mellan två nivåer används den som är närmast.
// Varje asset är 3× viewport-storlek så vi har pan-rumner.
const ZOOM_LEVELS = [
  { zoom: 11, source: require('../assets/stockholm-tiles-z11.png'), label: 'z11 overview', assetSize: { width: 1080, height: 1362 }, assetBounds: { minLat: 58.511, maxLat: 60.149, minLng: 16.81, maxLng: 19.33 } },
  { zoom: 13, source: require('../assets/stockholm-tiles-z13.png'), label: 'z13 neighborhood', assetSize: { width: 1080, height: 1362 }, assetBounds: { minLat: 59.1245, maxLat: 59.5355, minLng: 17.755, maxLng: 18.385 } },
  { zoom: 15, source: require('../assets/stockholm-tiles-z15.png'), label: 'z15 street', assetSize: { width: 1080, height: 1362 }, assetBounds: { minLat: 59.2786, maxLat: 59.3814, minLng: 17.991, maxLng: 18.149 } },
];

// Hitta närmaste tillgänglig z-nivå för en given fractional zoom.
function pickZoomLevel(targetZoom) {
  let best = ZOOM_LEVELS[0];
  let bestDist = Math.abs(targetZoom - best.zoom);
  for (const level of ZOOM_LEVELS) {
    const dist = Math.abs(targetZoom - level.zoom);
    if (dist < bestDist) {
      best = level;
      bestDist = dist;
    }
  }
  return best;
}

const TOKENS = {
  color: {
    canvasBg: '#0A0A0A',
    gridLine: '#14110C',
    line: '#1A1A1A',
    centerDot: '#FFB454',
    cornerLabel: '#9AA3B5',
    zoomBadge: '#000000',
    zoomBadgeBg: 'rgba(255, 180, 84, 0.9)',
  },
  font: {
    cornerLabel: { size: 10, weight: '700', letterSpacing: 1.6 },
    zoomBadge: { size: 11, weight: '800' },
  },
  space: {
    gridLines: 5,
    cornerInset: 10,
  },
};

/**
 * GridBaseLayer — bakgrund med horisontella + vertikala grid-linjer.
 */
export function GridBaseLayer({ viewport, panOffset, style, testID = 'map-base-grid' }) {
  const { width, height } = viewport;
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
  return (
    <View
      testID={testID}
      style={[styles.canvas, { width, height }, style]}
      accessibilityLabel="Bakgrundskarta med rutnät"
    >
      {lines}
      <View style={styles.cornerTopLeft} pointerEvents="none">
        <Text style={styles.cornerLabel}>STOCKHOLM (GRID)</Text>
      </View>
    </View>
  );
}

/**
 * StaticTilesBaseLayer — för-bakade OSM-tile-tillgångar (Mercator-korrekt).
 *
 * Väljer automatiskt rätt asset baserat på viewport.zoom (z11/z13/z15).
 * Varje asset är 3× viewport-storlek så vi kan pan:a inom asset via
 * `panOffset` (assetOffsetX/Y) — bildens position förskjuts inom en
 * overflow:hidden-wrapper så användaren ser ett annat varsellt område.
 *
 * Props:
 *   - viewport: { width, height, zoom, bounds }
 *   - panOffset: { assetOffsetX, assetOffsetY } (default 0,0 = centrerad)
 *   - resizeMode: 'cover' | 'contain' | 'stretch' | 'center' (default 'contain')
 *   - showZoomBadge: boolean (default true)
 */
export function StaticTilesBaseLayer({
  viewport,
  panOffset = { assetOffsetX: 0, assetOffsetY: 0 },
  resizeMode = 'contain',
  style,
  testID = 'map-base-static-tiles',
  showZoomBadge = true,
}) {
  const { width, height, zoom } = viewport;
  const level = pickZoomLevel(zoom);
  const { assetSize } = level;
  // Initial offset = halva skillnaden mellan asset och viewport → centrerad.
  const initialX = (assetSize.width - width) / 2;
  const initialY = (assetSize.height - height) / 2;
  const left = -(initialX + panOffset.assetOffsetX);
  const top = -(initialY + panOffset.assetOffsetY);

  return (
    <View
      testID={testID}
      style={[styles.canvas, { width, height }, style]}
      accessibilityLabel={`Bakgrundskarta: OSM-tiles, ${level.label}`}
    >
      <Image
        source={level.source}
        style={[styles.assetImage, { width: assetSize.width, height: assetSize.height, left, top }]}
        resizeMode={resizeMode}
        pointerEvents="none"
      />
      <View style={styles.cornerTopLeft} pointerEvents="none">
        <Text style={styles.cornerLabel}>STOCKHOLM</Text>
      </View>
      {showZoomBadge ? (
        <View style={styles.cornerTopRight} pointerEvents="none">
          <Text style={styles.zoomBadgeText}>z{Math.round(zoom)}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Default export: dispatch via `kind`-prop.
 */
export default function MapBaseLayer({
  kind = 'tiles',
  viewport,
  panOffset,
  ...rest
}) {
  if (kind === 'grid') return <GridBaseLayer viewport={viewport} panOffset={panOffset} {...rest} />;
  return <StaticTilesBaseLayer viewport={viewport} panOffset={panOffset} {...rest} />;
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: TOKENS.color.canvasBg,
    borderRadius: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  assetImage: {
    position: 'absolute',
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
  cornerTopLeft: {
    position: 'absolute',
    top: TOKENS.space.cornerInset,
    left: TOKENS.space.cornerInset,
  },
  cornerTopRight: {
    position: 'absolute',
    top: TOKENS.space.cornerInset,
    right: TOKENS.space.cornerInset,
    backgroundColor: TOKENS.color.zoomBadgeBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  zoomBadgeText: {
    color: TOKENS.color.zoomBadge,
    fontSize: TOKENS.font.zoomBadge.size,
    fontWeight: TOKENS.font.zoomBadge.weight,
  },
  cornerLabel: {
    color: TOKENS.color.cornerLabel,
    fontSize: TOKENS.font.cornerLabel.size,
    fontWeight: TOKENS.font.cornerLabel.weight,
    letterSpacing: TOKENS.font.cornerLabel.letterSpacing,
    textTransform: 'uppercase',
  },
});

export { TOKENS as MAP_BASE_LAYER_TOKENS, ZOOM_LEVELS, pickZoomLevel };