// mapProjection.js — Mercator-projektion + viewport-modell för MapCanvas.
//
// Vad:
//   - projectViewport(lat, lng, viewport): Mercator-projektion.
//     Returnerar pixel x/y i viewport-koordinater (origin top-left).
//   - getViewport(bounds, size): bygger viewport av bounds + pixel-storlek.
//   - clampToBounds, hashStringToFloat, jitterFallback: oförändrade.
//
// Vy-modell (single source of truth):
//   En "viewport" = { width, height, bounds, zoom }.
//   För sandbox: bounds-baserat (Stockholm är en fixerad rektangel).
//   När react-native-maps / Leaflet / MapLibre ansluts senare kan
//   projectViewport även acceptera centerLat/centerLng — samma return-typ.
//
//   Pin-lagret (MapPinLayer) anropar ENDAST projectViewport. Tile-lagret
//   (MapBaseLayer) bestämmer vad som visas. Byt provider → ändra ENDAST
//   MapBaseLayer; ingen annan kod rörs.
//
// Mercator:
//   - samma formler som OSM-tile-systemet (EPSG:3857-aligned).
//   - lat klipps till ±85.0511° för att undvika singularitet vid polerna.
//   - Stockholm @ ~59° lat → ~1.28x lat-stretch i y-led, vilket matchar
//     OSM-tiles 1:1 så prickar hamnar på rätt gata.

// Stockholm centrum (Sergels torg) + marginal som täcker hela
// Storstockholm (≈30km radie ≈ 0.27° lat).
export const STOCKHOLM_BOUNDS = {
  minLat: 59.06,
  maxLat: 59.60,
  minLng: 17.65,
  maxLng: 18.49,
};

// Fallback-koordinater från venues-migrationen
// (20261002-0001-venues-country.sql rad 20).
export const STOCKHOLM_FALLBACK = {
  lat: 59.3293,
  lng: 18.0686,
};

// Hur mycket vi sprider fallback-events (≈550m på lat).
const JITTER_DEGREES = 0.005;

// Mercator-konstanter
const MIN_LAT = -85.05112878;
const MAX_LAT = 85.05112878;
const TILE_SIZE = 256;

// Standard-zoom för Stockholm-vyn. Hårdkodat eftersom sandboxen
// inte har pan/zoom i v1.
const STOCKHOLM_ZOOM = 11;

// Asset-naturliga dimensioner (matchar assets/stockholm-tiles.png).
// Aspect 360/454 = 0.793 — Mercator-korrekt för Stockholm bbox.
const ASSET_WIDTH = 360;
const ASSET_HEIGHT = 454;

// --- Hjälpare --------------------------------------------------------------

const _lngToWorldPx = (lng, zoom) => ((lng + 180) / 360) * (1 << zoom) * TILE_SIZE;

const _latToWorldPx = (lat, zoom) => {
  const clamped = Math.max(MIN_LAT, Math.min(MAX_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * (1 << zoom) * TILE_SIZE;
};

const _lngLatToWorldPx = (lng, lat, zoom) => ({
  x: _lngToWorldPx(lng, zoom),
  y: _latToWorldPx(lat, zoom),
});

// --- Publikt API ------------------------------------------------------------

/**
 * Bygg viewport för bounds + pixel-storlek.
 *
 * @param {{minLat,maxLat,minLng,maxLng}} bounds
 * @param {{width:number,height:number}} size
 * @param {number} [zoom=STOCKHOLM_ZOOM]
 * @returns {{width,height,bounds,zoom}}
 */
export function getViewport(bounds, size, zoom = STOCKHOLM_ZOOM) {
  return {
    width: size.width,
    height: size.height,
    bounds,
    zoom,
  };
}

/**
 * Default-viewport för sandbox: Stockholm bbox vid zoom 11.
 * Bild-asset: assets/stockholm-tiles.png (360×454, Mercator-aspect 0.793).
 *
 * När canvas-måttet i runtime skiljer sig från 360×454 (t.ex. smalare
 * telefon), använd onLayout i MapCanvas för att sätta width/height
 * proportionellt mot asset-aspect.
 */
export const STOCKHOLM_VIEWPORT = Object.freeze(
  getViewport(STOCKHOLM_BOUNDS, { width: ASSET_WIDTH, height: ASSET_HEIGHT }, STOCKHOLM_ZOOM),
);

/**
 * Asset-aspect (width/height) för default Stockholm-vyn. Använd i
 * MapCanvas för att sätta canvas-höjd proportionellt mot canvas-bredd.
 */
export const STOCKHOLM_ASSET_ASPECT = ASSET_WIDTH / ASSET_HEIGHT;

/**
 * Mercator-projektion: lat/lng → pixel x/y i viewport-koordinater.
 *
 * Synkar pixel-noggrannt med OSM-tile-systemet: en pixel i den
 * stitched tilen och motsvarande pixel från projectViewport ligger
 * på samma lat/lng. Det är detta som gör att prickar hamnar på rätt
 * gata.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{width,height,bounds,zoom}} [viewport=STOCKHOLM_VIEWPORT]
 * @returns {{x:number,y:number,visible:boolean}}
 */
export function projectViewport(lat, lng, viewport = STOCKHOLM_VIEWPORT) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { x: -1, y: -1, visible: false };
  }
  if (!viewport || !viewport.bounds) {
    return { x: -1, y: -1, visible: false };
  }
  const { zoom, width, height, bounds } = viewport;
  if (width <= 0 || height <= 0 || zoom < 0) {
    return { x: -1, y: -1, visible: false };
  }

  const topLeft = _lngLatToWorldPx(bounds.minLng, bounds.maxLat, zoom);
  const bottomRight = _lngLatToWorldPx(bounds.maxLng, bounds.minLat, zoom);
  const px = _lngLatToWorldPx(lng, lat, zoom);

  const x = ((px.x - topLeft.x) / (bottomRight.x - topLeft.x)) * width;
  const y = ((px.y - topLeft.y) / (bottomRight.y - topLeft.y)) * height;
  const visible = x >= 0 && x <= width && y >= 0 && y <= height;
  return { x, y, visible };
}

/**
 * Bakåt-projektion: pixel x/y → lat/lng. Används av framtida
 * pan/zoom-gester.
 *
 * @param {number} x
 * @param {number} y
 * @param {{width,height,bounds,zoom}} [viewport=STOCKHOLM_VIEWPORT]
 * @returns {{lat:number,lng:number}|null}
 */
export function unprojectViewport(x, y, viewport = STOCKHOLM_VIEWPORT) {
  if (!viewport || !viewport.bounds) return null;
  const { zoom, width, height, bounds } = viewport;
  if (width <= 0 || height <= 0 || zoom < 0) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const topLeft = _lngLatToWorldPx(bounds.minLng, bounds.maxLat, zoom);
  const bottomRight = _lngLatToWorldPx(bounds.maxLng, bounds.minLat, zoom);

  const worldX = topLeft.x + (x / width) * (bottomRight.x - topLeft.x);
  const worldY = topLeft.y + (y / height) * (bottomRight.y - topLeft.y);

  const lng = (worldX / (1 << zoom) / TILE_SIZE) * 360 - 180;
  // y → lat: invert latToWorldPx-formeln (atan(sinh(x)))
  const n = Math.PI - (2 * Math.PI * worldY) / ((1 << zoom) * TILE_SIZE);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

/**
 * Klipp lat/lng till bounds (för tooltip-edge-cases).
 * Returnerar null om lat/lng är NaN.
 */
export function clampToBounds(lat, lng, bounds) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat: Math.min(Math.max(lat, bounds.minLat), bounds.maxLat),
    lng: Math.min(Math.max(lng, bounds.minLng), bounds.maxLng),
  };
}

/**
 * Deterministisk FNV-1a-hash (32-bit) → [0, 1).
 */
export function hashStringToFloat(str) {
  if (typeof str !== 'string' || str.length === 0) return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

/**
 * Jitter för fallback-events. Returnerar NY lat/lng ± JITTER_DEGREES.
 * Deterministisk: samma id → samma nya position varje gång.
 *
 * Riktiga events (lat ≠ 59.3293) påverkas INTE.
 */
export function jitterFallback(event) {
  if (!event || event.lat !== STOCKHOLM_FALLBACK.lat) return event;
  const seed = hashStringToFloat(event.id || '');
  const dy = hashStringToFloat('lat-' + (event.id || ''));
  const dLat = (dy * 2 - 1) * JITTER_DEGREES;
  const dLng = (seed * 2 - 1) * JITTER_DEGREES;
  return {
    ...event,
    lat: event.lat + dLat,
    lng: event.lng + dLng,
  };
}

// Bakåtkompatibilitet: gamla anropsställen använder projectToXY.
export function projectToXY(lat, lng, bounds, size) {
  return projectViewport(lat, lng, getViewport(bounds, size));
}