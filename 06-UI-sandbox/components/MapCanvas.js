// MapCanvas.js — tunn orchestrator för kartvyn: MapBaseLayer (bakgrund)
// + MapPinLayer (pinnar/klustring/tooltip) ovanpå, plus pinch+pan.
//
// Vad detta lager gör:
//   1. Håller dynamisk center + zoom state.
//   2. Beräknar pixel-storlek (bredd från onLayout, höjd = bredd /
//      STOCKHOLM_ASSET_ASPECT) och bygger en `viewport` från center+zoom.
//   3. Hanterar pinch-gester (2 fingrar → zoom) och pan-gester (1 finger
//      → pan via PanResponder; kräver ingen native build).
//   4. Renderar MapBaseLayer (multi-zoom OSM-tiles eller grid) +
//      MapPinLayer (pinnar/klustring/tooltip) staplade på samma yta.
//
// Vad detta lager INTE gör:
//   - Event-hämtning (bor i MapScreen)
//   - Filter-logik (bor i MapScreen)
//   - Tile-nedladdning (bor i MapBaseLayer eller framtida provider)
//   - Pin-projection (bor i MapPinLayer via mapProjection.js)
//
// Provider-byte: byt endast `baseKind` prop eller använd en annan
// MapBaseLayer-komponent (t.ex. WebViewLeafletBaseLayer när den finns).
// Inget annat i kedjan berörs.

import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import {
  STOCKHOLM_CENTER,
  STOCKHOLM_ASSET_ASPECT,
  viewportFromCenter,
} from './mapProjection';
import MapBaseLayer from './MapBaseLayer';
import MapPinLayer from './MapPinLayer';

const TOKENS = {
  space: { padX: 20 },
  gesture: {
    MIN_ZOOM: 10,
    MAX_ZOOM: 16,
  },
};

const INITIAL_ZOOM = 11;

export default function MapCanvas({
  events,
  viewport: viewportProp,
  baseKind = 'tiles',
  testID = 'map-canvas',
  initialCenter = STOCKHOLM_CENTER,
  initialZoom = INITIAL_ZOOM,
  onViewportChange,
}) {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [center, setCenter] = useState({ lat: initialCenter.lat, lng: initialCenter.lng });
  const [zoom, setZoom] = useState(initialZoom);

  // Refs som alltid speglar state — så PanResponder-closure kan se
  // senaste värden utan att vi re-skapar den varje render.
  const centerRef = useRef(center);
  const zoomRef = useRef(zoom);
  const widthRef = useRef(0);
  const heightRef = useRef(0);
  centerRef.current = center;
  zoomRef.current = zoom;

  // Gesture refs — håller initial-state per gest.
  const pinchRef = useRef(null);
  const panRef = useRef(null);

  const onLayout = (e) => {
    const { width } = e.nativeEvent.layout;
    setMeasuredWidth((prev) => (prev === width ? prev : width));
    widthRef.current = width;
    heightRef.current = Math.round(width / STOCKHOLM_ASSET_ASPECT);
  };

  const width = measuredWidth || viewportProp?.width || 360;
  const height = Math.round(width / STOCKHOLM_ASSET_ASPECT);
  const size = { width, height };

  // Bygg viewport från aktuell center + zoom + size.
  const viewport = viewportProp
    ? { ...viewportProp, width, height }
    : viewportFromCenter(center.lat, center.lng, zoom, size);

  // PanResponder ---------------------------------------------------------
  // VIKTIGT: onStartShouldSetPanResponder = false (så Pressable-pinnar
  // får sina taps). onMoveShouldSetPanResponder = true (så PanResponder
  // tar över så snart användaren drar).
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,

      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const t0 = touches[0];
          const t1 = touches[1];
          const dx = t0.pageX - t1.pageX;
          const dy = t0.pageY - t1.pageY;
          pinchRef.current = {
            initialDistance: Math.sqrt(dx * dx + dy * dy),
            initialZoom: zoomRef.current,
            initialCenter: { ...centerRef.current },
            focalX: (t0.pageX + t1.pageX) / 2,
            focalY: (t0.pageY + t1.pageY) / 2,
          };
        } else if (touches.length === 1) {
          const t = touches[0];
          panRef.current = {
            initialTouchX: t.pageX,
            initialTouchY: t.pageY,
            initialCenter: { ...centerRef.current },
          };
        }
      },

      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        const W = widthRef.current;
        const H = heightRef.current;
        if (W <= 0 || H <= 0) return;

        // 2 fingers = pinch (zoom + justering så focal stannar på samma pixel).
        if (touches.length >= 2 && pinchRef.current) {
          const t0 = touches[0];
          const t1 = touches[1];
          const dx = t0.pageX - t1.pageX;
          const dy = t0.pageY - t1.pageY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const ratio = distance / pinchRef.current.initialDistance;
          let newZoom = pinchRef.current.initialZoom + Math.log2(ratio);
          newZoom = Math.max(TOKENS.gesture.MIN_ZOOM,
                             Math.min(TOKENS.gesture.MAX_ZOOM, newZoom));
          if (newZoom === zoomRef.current && pinchRef.current.initialZoom === zoomRef.current) {
            // ingen zoom-ändring, skippa
          }

          // Focal lat/lng (vid start av pinch).
          const initViewport = viewportFromCenter(
            pinchRef.current.initialCenter.lat,
            pinchRef.current.initialCenter.lng,
            pinchRef.current.initialZoom,
            { width: W, height: H },
          );
          const focalX = pinchRef.current.focalX;
          const focalY = pinchRef.current.focalY;
          const focalLng =
            initViewport.bounds.minLng +
            (focalX / W) * (initViewport.bounds.maxLng - initViewport.bounds.minLng);
          const focalLat =
            initViewport.bounds.maxLat -
            (focalY / H) * (initViewport.bounds.maxLat - initViewport.bounds.minLat);

          // Var hamnar focal lat/lng med newZoom + initialCenter?
          const newViewport = viewportFromCenter(
            pinchRef.current.initialCenter.lat,
            pinchRef.current.initialCenter.lng,
            newZoom,
            { width: W, height: H },
          );
          const newFocalX =
            ((focalLng - newViewport.bounds.minLng) /
              (newViewport.bounds.maxLng - newViewport.bounds.minLng)) * W;
          const newFocalY =
            ((newViewport.bounds.maxLat - focalLat) /
              (newViewport.bounds.maxLat - newViewport.bounds.minLat)) * H;

          // Skifta center så att focal stannar på samma skärmposition.
          const dX = focalX - newFocalX;
          const dY = focalY - newFocalY;
          const degPerPxNew = 360 / (256 * (1 << newZoom));
          const adjustedLat = pinchRef.current.initialCenter.lat - dY * degPerPxNew;
          const adjustedLng = pinchRef.current.initialCenter.lng + dX * degPerPxNew;

          setCenter({ lat: adjustedLat, lng: adjustedLng });
          setZoom(newZoom);
          if (onViewportChange) {
            onViewportChange({ center: { lat: adjustedLat, lng: adjustedLng }, zoom: newZoom });
          }
          return;
        }

        // 1 finger = pan.
        if (touches.length === 1 && panRef.current) {
          const t = touches[0];
          const dX = t.pageX - panRef.current.initialTouchX;
          const dY = t.pageY - panRef.current.initialTouchY;
          // Mercator: deg/px = 360 / (256 * 2^Z).
          const degPerPx = 360 / (256 * (1 << zoomRef.current));
          const newLat = panRef.current.initialCenter.lat - dY * degPerPx;
          const newLng = panRef.current.initialCenter.lng + dX * degPerPx;
          setCenter({ lat: newLat, lng: newLng });
          if (onViewportChange) {
            onViewportChange({ center: { lat: newLat, lng: newLng }, zoom: zoomRef.current });
          }
        }
      },

      onPanResponderRelease: () => {
        pinchRef.current = null;
        panRef.current = null;
      },
      onPanResponderTerminate: () => {
        pinchRef.current = null;
        panRef.current = null;
      },
    }),
  ).current;

  return (
    <View
      onLayout={onLayout}
      testID={testID}
      style={[styles.canvas, { height }]}
      accessibilityLabel={`Karta med ${events.length} events i Stockholm-området`}
      {...panResponder.panHandlers}
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