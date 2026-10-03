// MapCanvas.js — tunn orchestrator för kartvyn: MapBaseLayer (bakgrund)
// + MapPinLayer (pinnar/klustring/tooltip) ovanpå, plus pinch+pan.
//
// Vad detta lager gör:
//   1. Håller state: center (lat/lng), zoomFractional (continuous), och
//      panOffset (assetOffsetX/Y i renderade pixlar). Dessa är synkroniserade.
//   2. Beräknar pixel-storlek (bredd från onLayout, höjd = bredd /
//      STOCKHOLM_ASSET_ASPECT).
//   3. Hanterar pinch (2 fingrar → zoomFractional + justering så focal
//      stannar på samma pixel) och pan (1 finger → panOffset) via
//      PanResponder.
//   4. Renderar MapBaseLayer (multi-zoom OSM-tiles 3× storlek) +
//      MapPinLayer (pinnar/klustring/tooltip) med samma visibleBounds.
//
// Vad detta lager INTE gör:
//   - Event-hämtning (bor i MapScreen)
//   - Filter-logik (bor i MapScreen)
//   - Tile-nedladdning (bor i MapBaseLayer)
//   - Pin-projection (bor i MapPinLayer via mapProjection.js)
//
// Pan-riktning: 1 finger drag → kartan följer fingret (standard kart-UX).
//   dragDx > 0 (finger åt höger) → innehållet flyttar höger på skärmen.
//   Detta matchar Apple/Google Maps och Naturlig Scrollning.
//
// Zoom-modell (sömlös mellan lager):
//   Vi har bara assets på z11/z13/z15 (udda zoom-nivåer). Mellan två
//   snap-points (t.ex. f=13 → f=14) används den lägre asset:n med
//   scale = 2^(f - asset.zoom), dvs 1 → 2. Känns som 10 inkrementella
//   pixel-steg — kartan blir gradvis mer "pixlat" (uppscalad). Vid
//   f=14 byts asset till nästa nivå (z15) och scale återgår till 1.
//
// Provider-byte: byt endast `baseKind` prop eller använd en annan
// MapBaseLayer-komponent (t.ex. WebViewLeafletBaseLayer när den finns).

import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import {
  STOCKHOLM_CENTER,
  STOCKHOLM_ASSET_ASPECT,
  pickAssetForFractionalZoom,
  visibleBoundsFromAsset,
  panOffsetForCenter,
} from './mapProjection';
import MapBaseLayer from './MapBaseLayer';
import MapPinLayer from './MapPinLayer';

const TOKENS = {
  space: { padX: 20 },
  gesture: {
    MIN_ZOOM: 11,
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
  style,
}) {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [center, setCenter] = useState({ lat: initialCenter.lat, lng: initialCenter.lng });
  const [zoomFractional, setZoomFractional] = useState(initialZoom);
  const [panOffset, setPanOffset] = useState({ assetOffsetX: 0, assetOffsetY: 0 });

  // Refs som speglar state för PanResponder-closure.
  const centerRef = useRef(center);
  const zoomRef = useRef(zoomFractional);
  const panOffsetRef = useRef(panOffset);
  const widthRef = useRef(0);
  const heightRef = useRef(0);
  centerRef.current = center;
  zoomRef.current = zoomFractional;
  panOffsetRef.current = panOffset;

  // Gesture refs.
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

  // Synkronisera center och panOffset — när ena ändras, uppdatera den andra.
  const updateCenterFromPan = (newPanOffset, currentZoom, currentScale) => {
    const asset = pickAssetForFractionalZoom(currentZoom).level;
    const bounds = visibleBoundsFromAsset(asset.assetBounds, asset.assetSize, size, newPanOffset, currentScale);
    return {
      lat: (bounds.minLat + bounds.maxLat) / 2,
      lng: (bounds.minLng + bounds.maxLng) / 2,
    };
  };
  const updatePanFromCenter = (newCenter, currentZoom, currentScale) => {
    const asset = pickAssetForFractionalZoom(currentZoom).level;
    return panOffsetForCenter(asset.assetBounds, asset.assetSize, size, newCenter, currentScale);
  };

  // Bygg synliga viewport-bounds via panOffset + zoom (SINGLE SOURCE OF TRUTH).
  const { level: asset, scale } = pickAssetForFractionalZoom(zoomFractional);
  const visibleBounds = visibleBoundsFromAsset(asset.assetBounds, asset.assetSize, size, panOffset, scale);
  const viewport = viewportProp
    ? { ...viewportProp, width, height }
    : { width, height, bounds: visibleBounds, zoom: zoomFractional, center };

  // PanResponder ---------------------------------------------------------
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
            initialPanOffset: { ...panOffsetRef.current },
            focalX: (t0.pageX + t1.pageX) / 2,
            focalY: (t0.pageY + t1.pageY) / 2,
          };
        } else if (touches.length === 1) {
          const t = touches[0];
          panRef.current = {
            initialTouchX: t.pageX,
            initialTouchY: t.pageY,
            initialPanOffset: { ...panOffsetRef.current },
          };
        }
      },

      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        const W = widthRef.current;
        const H = heightRef.current;
        if (W <= 0 || H <= 0) return;

        // 1 finger = pan (uppdatera panOffset).
        // "Follow finger": dragDx > 0 (finger höger) → assetOffsetX minskar
        // → left = -(initialX + offset) blir mer positiv → bilden flyttar
        // höger → innehållet (pinnar/gator) följer fingret.
        if (touches.length === 1 && panRef.current && !pinchRef.current) {
          const t = touches[0];
          const dragDx = t.pageX - panRef.current.initialTouchX;
          const dragDy = t.pageY - panRef.current.initialTouchY;
          const currentZoom = zoomRef.current;
          const { level: panAsset, scale: panScale } = pickAssetForFractionalZoom(currentZoom);
          const newPan = { ...panRef.current.initialPanOffset };
          // Klipp till giltiga offset-gränser (renderade pixlar).
          const halfSpanX = panScale * (panAsset.assetSize.width - W / panScale) / 2;
          const halfSpanY = panScale * (panAsset.assetSize.height - H / panScale) / 2;
          // Negera drag så att finger-drag höger → innehåll flyttar höger.
          newPan.assetOffsetX = Math.max(-halfSpanX, Math.min(halfSpanX,
            panRef.current.initialPanOffset.assetOffsetX - dragDx));
          newPan.assetOffsetY = Math.max(-halfSpanY, Math.min(halfSpanY,
            panRef.current.initialPanOffset.assetOffsetY - dragDy));
          // Uppdatera både panOffset och center.
          const newCenter = updateCenterFromPan(newPan, currentZoom, panScale);
          setPanOffset(newPan);
          setCenter(newCenter);
          if (onViewportChange) {
            onViewportChange({ center: newCenter, zoom: currentZoom });
          }
          return;
        }

        // 2 fingers = pinch (zoom + center-shift så focal stannar på samma pixel).
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

          // Focal lat/lng vid start av pinch (med start-scale).
          const startPicked = pickAssetForFractionalZoom(pinchRef.current.initialZoom);
          const startAsset = startPicked.level;
          const startScale = startPicked.scale;
          const startBounds = visibleBoundsFromAsset(
            startAsset.assetBounds, startAsset.assetSize, { width: W, height: H },
            pinchRef.current.initialPanOffset,
            startScale,
          );
          const focalX = pinchRef.current.focalX;
          const focalY = pinchRef.current.focalY;
          const focalLng =
            startBounds.minLng +
            (focalX / W) * (startBounds.maxLng - startBounds.minLng);
          const focalLat =
            startBounds.maxLat -
            (focalY / H) * (startBounds.maxLat - startBounds.minLat);

          // Hitta asset+scale för newZoom.
          const newPicked = pickAssetForFractionalZoom(newZoom);
          const newAsset = newPicked.level;
          const newScale = newPicked.scale;
          // Räkna ut panOffset som centrerar viewport på focal lat/lng
          // (dvs focal hamnar vid (W/2, H/2) i den nya vyn).
          // Sedan kompenserar vi för off-center focal: vill vi ha focal
          // vid (focalX, focalY) istället för center → skift content med
          // (focalX - W/2) pixlar. Pan-offset och pixel-rörelse är
          // samma enhet (render-pixlar) vid scale s, men tecken är
          // omvänt: panOffset +K → content flyttar vänster.
          const centeredPan = panOffsetForCenter(
            newAsset.assetBounds, newAsset.assetSize, size,
            { lat: focalLat, lng: focalLng }, newScale,
          );
          const newPan = {
            assetOffsetX: centeredPan.assetOffsetX + (W / 2 - focalX),
            assetOffsetY: centeredPan.assetOffsetY + (H / 2 - focalY),
          };
          // Klipp till giltiga gränser.
          const halfSpanX = newScale * (newAsset.assetSize.width - W / newScale) / 2;
          const halfSpanY = newScale * (newAsset.assetSize.height - H / newScale) / 2;
          newPan.assetOffsetX = Math.max(-halfSpanX, Math.min(halfSpanX, newPan.assetOffsetX));
          newPan.assetOffsetY = Math.max(-halfSpanY, Math.min(halfSpanY, newPan.assetOffsetY));

          const newCenter = updateCenterFromPan(newPan, newZoom, newScale);
          setPanOffset(newPan);
          setCenter(newCenter);
          setZoomFractional(newZoom);
          if (onViewportChange) {
            onViewportChange({ center: newCenter, zoom: newZoom });
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
      style={[styles.canvas, style, { height }]}
      accessibilityLabel={`Karta med ${events.length} events i Stockholm-området`}
      {...panResponder.panHandlers}
    >
      <MapBaseLayer
        kind={baseKind}
        viewport={viewport}
        panOffset={panOffset}
        scale={scale}
        testID={`${testID}-base`}
      />
      <MapPinLayer events={events} viewport={viewport} testID={`${testID}-pins`} />
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: '#0A0A0A',
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
});

export { TOKENS as MAP_CANVAS_TOKENS };