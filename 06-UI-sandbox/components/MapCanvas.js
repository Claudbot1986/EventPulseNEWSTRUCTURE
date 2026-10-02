// MapCanvas.js — tunn orchestrator för kartvyn: MapBaseLayer (bakgrund)
// + MapPinLayer (pinnar/klustring/tooltip) ovanpå.
//
// Vad detta lager gör:
//   1. Håller rätt pixel-storlek (bredd från onLayout, höjd = bredd /
//      STOCKHOLM_ASSET_ASPECT så bilden inte blir distorderad).
//   2. Bygger en `viewport` (bounds, zoom, width, height) som skickas
//      till båda underliggande lager.
//   3. Renderar MapBaseLayer (grid eller OSM-tiles) + MapPinLayer
//      (pinnar/klustring/tooltip) staplade på samma yta.
//
// Vad detta lager INTE gör:
//   - Event-hämtning (bor i MapScreen)
//   - Filter-logik (bor i MapScreen)
//   - Tile-nedladdning (bor i MapBaseLayer eller framtida provider)
//   - Pin-projection (bor i MapPinLayer via mapProjection.js)
//
// Provider-byte: byt `baseKind` prop eller använd en annan MapBaseLayer-
// komponent (t.ex. WebViewLeafletBaseLayer när den finns). Inget annat
// i kedjan berörs.

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { STOCKHOLM_VIEWPORT, STOCKHOLM_ASSET_ASPECT } from './mapProjection';
import MapBaseLayer from './MapBaseLayer';
import MapPinLayer from './MapPinLayer';

const TOKENS = {
  space: {
    padX: 20,
  },
};

export default function MapCanvas({
  events,
  viewport: viewportProp,
  baseKind = 'tiles', // 'tiles' | 'grid'
  testID = 'map-canvas',
}) {
  const [measuredWidth, setMeasuredWidth] = useState(0);

  const onLayout = (e) => {
    const { width } = e.nativeEvent.layout;
    setMeasuredWidth((prev) => (prev === width ? prev : width));
  };

  // Beräkna canvas-storlek: bredd från layout, höjd proportionellt mot
  // asset-aspect. Behåller Mercator-korrekt projektion.
  const width = measuredWidth || viewportProp?.width || STOCKHOLM_VIEWPORT.width;
  const height = Math.round(width / STOCKHOLM_ASSET_ASPECT);

  const viewport = viewportProp
    ? { ...viewportProp, width, height }
    : { ...STOCKHOLM_VIEWPORT, width, height };

  return (
    <View
      onLayout={onLayout}
      testID={testID}
      style={[styles.canvas, { height }]}
      accessibilityLabel={`Karta med ${events.length} events i Stockholm-området`}
    >
      <MapBaseLayer kind={baseKind} viewport={viewport} testID={`${testID}-base`} />
      <MapPinLayer events={events} viewport={viewport} testID={`${testID}-pins`} />
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: '#0A0A0A',
    marginHorizontal: TOKENS.space.padX,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
});

export { TOKENS as MAP_CANVAS_TOKENS };