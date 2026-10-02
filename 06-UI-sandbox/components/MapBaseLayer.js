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
//   StaticTilesBaseLayer — för-bakad OSM-tile-asset (Mercator-korrekt).
//                          Dagens produktionsvisualisering i sandbox.
//
// Framtida implementationer (egna filer):
//   WebViewLeafletBaseLayer, ReactNativeMapsBaseLayer, etc.
//   Samma kontrakt. Samma `viewport`-prop. Noll påverkan på pin-lagret.

import { Image, StyleSheet, Text, View } from 'react-native';

const TOKENS = {
  color: {
    canvasBg: '#0A0A0A',
    gridLine: '#14110C',
    line: '#1A1A1A',
    centerDot: '#FFB454',
    cornerLabel: '#9AA3B5',
  },
  font: {
    cornerLabel: { size: 10, weight: '700', letterSpacing: 1.6 },
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
 * StaticTilesBaseLayer — för-bakad OSM-tile-asset (Mercator-korrekt).
 *
 * Visar assets/stockholm-tiles.png (eller custom source) som bakgrund.
 * Bildens aspect-ratio MÅSTE matcha viewport-ets aspect-ratio — annars
 * blir det distortion eller tomma ytor. Använd STOCKHOLM_ASSET_ASPECT
 * från mapProjection.js för att sätta canvas-höjd = bredd / aspect.
 *
 * Props:
 *   - viewport: { width, height, ... } (obligatoriskt)
 *   - source: bild-source (ImageSource, optional — default = stockholm-tiles.png)
 *   - resizeMode: 'cover' | 'contain' | 'stretch' | 'center' (default 'contain')
 *   - style: extra styles för wrapper
 */
export function StaticTilesBaseLayer({
  viewport,
  source = require('../assets/stockholm-tiles.png'),
  resizeMode = 'contain',
  style,
  testID = 'map-base-static-tiles',
}) {
  const { width, height } = viewport;
  return (
    <View
      testID={testID}
      style={[styles.canvas, { width, height }, style]}
      accessibilityLabel="Bakgrundskarta: OSM-tiles för Stockholm"
    >
      <Image
        source={source}
        style={{ width, height }}
        resizeMode={resizeMode}
        pointerEvents="none"
      />
      <View style={styles.cornerTopLeft} pointerEvents="none">
        <Text style={styles.cornerLabel}>STOCKHOLM</Text>
      </View>
    </View>
  );
}

/**
 * Default export: dispatch via `kind`-prop. Bekvämt för att kunna byta
 * base-layer i App.js / tester utan att behöva importera de specifika.
 *
 * <MapBaseLayer kind="grid" viewport={viewport} />
 * <MapBaseLayer kind="tiles" viewport={viewport} />
 * <MapBaseLayer kind="tiles" viewport={viewport} source={...} />
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
  cornerLabel: {
    color: TOKENS.color.cornerLabel,
    fontSize: TOKENS.font.cornerLabel.size,
    fontWeight: TOKENS.font.cornerLabel.weight,
    letterSpacing: TOKENS.font.cornerLabel.letterSpacing,
    textTransform: 'uppercase',
  },
});

export { TOKENS as MAP_BASE_LAYER_TOKENS };