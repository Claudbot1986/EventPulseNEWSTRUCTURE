// MapBaseLayer.js — utbytbar tile-provider/renderer för kartan.
//
// Detta är ENDA punkten som rör vad som visas bakom prickarna.
// Pin-lagret (MapPinLayer) är separat och anropar projectViewport från
// mapProjection.js. När vi vill byta tile-provider (react-native-maps,
// Leaflet via WebView, MapLibre, Google Maps) byter vi ENDAST denna
// komponent — pin/cluster/tooltip/filter-logiken rörs inte.
//
// Kontrakt för en base-layer:
//   - Tar emot `viewport` (width, height, bounds, zoom).
//   - Renderar inom exakt viewport-ets pixel-koordinater.
//   - Synkroniserar med samma Mercator-projektion som pin-lagret.
//
// Två implementationer i denna fil:
//   GridBaseLayer        — ingen tile-provider, bara grid-rutor.
//                          Använd för offline-test eller som fallback.
//   StaticTilesBaseLayer — för-bakade OSM-tile-tillgångar (Mercator-
//                          korrekt) för flera z-nivåer (11/13/15).
//                          Användaren kan pinch:a för att växla.
//
// Framtida implementationer (egna filer):
//   WebViewLeafletBaseLayer, ReactNativeMapsBaseLayer, etc.
//   Samma kontrakt. Samma `viewport`-prop. Noll påverkan på pin-lagret.

import { Image, StyleSheet, Text, View } from 'react-native';

// Tillgängliga zoom-nivåer och deras asset-källor. Snap-point: om
// viewport.zoom faller mellan två nivåer används den som är närmast.
// När du vill lägga till fler z-nivåer: bygg en ny asset via
// scripts/build-stockholm-tiles.mjs och lägg till här.
const ZOOM_LEVELS = [
  { zoom: 11, source: require('../assets/stockholm-tiles-z11.png'), label: 'z11 overview' },
  { zoom: 13, source: require('../assets/stockholm-tiles-z13.png'), label: 'z13 neighborhood' },
  { zoom: 15, source: require('../assets/stockholm-tiles-z15.png'), label: 'z15 street' },
];

// Hitta närmaste tillgängliga z-nivå för en given fractional zoom.
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
 *
 * Använd för:
 *   - offline-test (inga tiles krävs)
 *   - verifiering av pin-projection utan visuell distraktion
 *   - sandbox-fallback om tiles-asset saknas
 */
export function GridBaseLayer({ viewport, style, testID = 'map-base-grid' }) {
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
 * Väljer automatiskt rätt asset baserat på viewport.zoom:
 *   - z ≈ 11 → stockholm-tiles-z11.png (hela Stockholm)
 *   - z ≈ 13 → stockholm-tiles-z13.png (1/4 område)
 *   - z ≈ 15 → stockholm-tiles-z15.png (Sergels torg närbild)
 *
 * Visar en liten z-badge i hörnet så man ser vilken zoom-nivå som är
 * aktiv (särskilt viktigt under pinch när fractional zoom skiftar
 * snabbtav).
 *
 * Props:
 *   - viewport: { width, height, zoom, bounds, center? } (obligatoriskt)
 *   - resizeMode: 'cover' | 'contain' | 'stretch' | 'center' (default 'contain')
 *   - style: extra styles för wrapper
 */
export function StaticTilesBaseLayer({
  viewport,
  resizeMode = 'contain',
  style,
  testID = 'map-base-static-tiles',
  showZoomBadge = true,
}) {
  const { width, height, zoom } = viewport;
  const level = pickZoomLevel(zoom);
  return (
    <View
      testID={testID}
      style={[styles.canvas, { width, height }, style]}
      accessibilityLabel={`Bakgrundskarta: OSM-tiles, ${level.label}`}
    >
      <Image
        source={level.source}
        style={{ width, height }}
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
  ...rest
}) {
  if (kind === 'grid') return <GridBaseLayer viewport={viewport} {...rest} />;
  return <StaticTilesBaseLayer viewport={viewport} {...rest} />;
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: TOKENS.color.canvasBg,
    borderRadius: 0,
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