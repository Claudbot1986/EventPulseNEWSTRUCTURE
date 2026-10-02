// MapCanvas.js — tunn orchestrator för kartvyn: MapBaseLayer (bakgrund)
// + MapPinLayer (pinnar/klustring/tooltip) ovanpå, plus pinch+pan.
//
// Vad detta lager gör:
//   1. Håller state: center (lat/lng), zoom, och panOffset
//      (assetOffsetX/Y inom asset:t). Dessa är synkroniserade.
//   2. Beräknar pixel-storlek (bredd från onLayout, höjd = bredd /
//      STOCKHOLM_ASSET_ASPECT).
//   3. Hanterar pinch (2 fingrar → zoom + justering så focal stannar på
//      samma pixel) och pan (1 finger → panOffset) via PanResponder.
//   4. Renderar MapBaseLayer (multi-zoom OSM-tiles 3× storlek) +
//      MapPinLayer (pinnar/klustring/tooltip) med samma visibleBounds.
//
// Vad detta lager INTE gör:
//   - Event-hämtning (bor i MapScreen)
//   - Filter-logik (bor i MapScreen)
//   - Tile-nedladdning (bor i MapBaseLayer)
//   - Pin-projection (bor i MapPinLayer via mapProjection.js)
//
// Provider-byte: byt endast `baseKind` prop eller använd en annan
// MapBaseLayer-komponent (t.ex. WebViewLeafletBaseLayer när den finns).

import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import {
  STOCKHOLM_CENTER,
  STOCKHOLM_ASSET_ASPECT,
  pickZoomAsset,
  visibleBoundsFromAsset,
  panOffsetForCenter,
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
  style,
}) {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [center, setCenter] = useState({ lat: initialCenter.lat, lng: initialCenter.lng });
  const [zoom, setZoom] = useState(initialZoom);
  const [panOffset, setPanOffset] = useState({ assetOffsetX: 0, assetOffsetY: 0 });

  // Refs som speglar state för PanResponder-closure.
  const centerRef = useRef(center);
  const zoomRef = useRef(zoom);
  const panOffsetRef = useRef(panOffset);
  const widthRef = useRef(0);
  const heightRef = useRef(0);
  centerRef.current = center;
  zoomRef.current = zoom;
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
  const updateCenterFromPan = (newPanOffset, currentZoom) => {
    const asset = pickZoomAsset(currentZoom);
    const bounds = visibleBoundsFromAsset(asset.assetBounds, asset.assetSize, size, newPanOffset);
    return {
      lat: (bounds.minLat + bounds.maxLat) / 2,
      lng: (bounds.minLng + bounds.maxLng) / 2,
    };
  };
  const updatePanFromCenter = (newCenter, currentZoom) => {
    const asset = pickZoomAsset(currentZoom);
    return panOffsetForCenter(asset.assetBounds, asset.assetSize, size, newCenter);
  };

  // Bygg synliga viewport-bounds via panOffset (SINGLE SOURCE OF TRUTH).
  const asset = pickZoomAsset(zoom);
  const visibleBounds = visibleBoundsFromAsset(asset.assetBounds, asset.assetSize, size, panOffset);
  const viewport = viewportProp
    ? { ...viewportProp, width, height }
    : { width, height, bounds: visibleBounds, zoom, center };

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
        if (touches.length === 1 && panRef.current && !pinchRef.current) {
          const t = touches[0];
          // Användaren drar höger → vi vill se content till höger →
          // viewport flyttar höger inom asset → assetOffsetX ökar.
          // image.left = -(initialX + assetOffsetX) → om assetOffsetX
          // ökar blir left mer negativt → bilden flyttar vänster.
          // På skärmen: nya delar av asset syns på höger sida ✓
          const dragDx = t.pageX - panRef.current.initialTouchX;
          const dragDy = t.pageY - panRef.current.initialTouchY;
          const newPan = { ...panRef.current.initialPanOffset };
          // Klipp till giltiga offset-gränser baserat på asset-storlek.
          const assetInfo = pickZoomAsset(zoomRef.current);
          const initX = (assetInfo.assetSize.width - W) / 2;
          const initY = (assetInfo.assetSize.height - H) / 2;
          const minOffX = -initX; // viewport vid vänsterkanten av asset
          const maxOffX = assetInfo.assetSize.width - W - initX; // viewport vid högerkanten
          const minOffY = -initY;
          const maxOffY = assetInfo.assetSize.height - H - initY;
          newPan.assetOffsetX = Math.max(minOffX, Math.min(maxOffX, panRef.current.initialPanOffset.assetOffsetX + dragDx));
          newPan.assetOffsetY = Math.max(minOffY, Math.min(maxOffY, panRef.current.initialPanOffset.assetOffsetY + dragDy));
          // Uppdatera både panOffset och center.
          const newCenter = updateCenterFromPan(newPan, zoomRef.current);
          setPanOffset(newPan);
          setCenter(newCenter);
          if (onViewportChange) {
            onViewportChange({ center: newCenter, zoom: zoomRef.current });
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

          // Focal lat/lng vid start av pinch.
          const initAsset = pickZoomAsset(pinchRef.current.initialZoom);
          const initBounds = visibleBoundsFromAsset(
            initAsset.assetBounds, initAsset.assetSize, { width: W, height: H },
            pinchRef.current.initialPanOffset,
          );
          const focalX = pinchRef.current.focalX;
          const focalY = pinchRef.current.focalY;
          const focalLng =
            initBounds.minLng +
            (focalX / W) * (initBounds.maxLng - initBounds.minLng);
          const focalLat =
            initBounds.maxLat -
            (focalY / H) * (initBounds.maxLat - initBounds.minLat);

          // Hitta asset för newZoom och räkna ut var focal skulle hamna
          // med newZoom + initialPanOffset.
          const newAsset = pickZoomAsset(newZoom);
          const newBounds = visibleBoundsFromAsset(
            newAsset.assetBounds, newAsset.assetSize, { width: W, height: H },
            pinchRef.current.initialPanOffset,
          );
          const newFocalX =
            ((focalLng - newBounds.minLng) /
              (newBounds.maxLng - newBounds.minLng)) * W;
          const newFocalY =
            ((newBounds.maxLat - focalLat) /
              (newBounds.maxLat - newBounds.minLat)) * H;

          // Skifta panOffset så att focal stannar på samma pixel.
          // Focal ska flytta (snässefocal - newFocal) i motsatt enhet
          // av panOffset.
          const dX = focalX - newFocalX;
          const dY = focalY - newFocalY;
          // Använd asset pixel-to-asset-pixel-relationen (asset-storlek
          // / visible lng/lat range).
          const newPan = {
            assetOffsetX: pinchRef.current.initialPanOffset.assetOffsetX + dX,
            assetOffsetY: pinchRef.current.initialPanOffset.assetOffsetY + dY,
          };
          // Klipp till giltiga gränser.
          const initX = (newAsset.assetSize.width - W) / 2;
          const initY = (newAsset.assetSize.height - H) / 2;
          const minOffX = -initX;
          const maxOffX = newAsset.assetSize.width - W - initX;
          const minOffY = -initY;
          const maxOffY = newAsset.assetSize.height - H - initY;
          newPan.assetOffsetX = Math.max(minOffX, Math.min(maxOffX, newPan.assetOffsetX));
          newPan.assetOffsetY = Math.max(minOffY, Math.min(maxOffY, newPan.assetOffsetY));

          const newCenter = updateCenterFromPan(newPan, newZoom);
          setPanOffset(newPan);
          setCenter(newCenter);
          setZoom(newZoom);
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