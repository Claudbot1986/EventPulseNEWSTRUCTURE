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

// Stockholm centrum (Sergels torg). Används som default-center för
// center-baserad viewport när användaren inte har pan:at.
export const STOCKHOLM_CENTER = STOCKHOLM_FALLBACK;

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

// Asset-storlek och bounds för varje z-nivå. Assets är 3× viewport-
// storlek så vi har pan-rumner inom varje asset. assetBounds är det
// geografiska område som hela asset:t täcker; panOffset bestämmer vilken
// del som visas i viewport.
//
// Zoom-kedja vald så att +2 zoom = 4× mindre geografisk area (matchar
// OSM-tile-systemet). z=11 täcker hela Storstockholm, z=13 Sergels
// torg-distriktet, z=15 kvarter, z=17 gatunamn-detalj (Sergels torg
// mikrokvarter — gatunamn läsbara, varje pixel ≈ 2-3 m vid max zoom).
export const ZOOM_ASSETS = [
  {
    zoom: 11,
    assetSize: { width: 1080, height: 1362 },
    assetBounds: { minLat: 58.511, maxLat: 60.149, minLng: 16.81, maxLng: 19.33 },
  },
  {
    zoom: 13,
    assetSize: { width: 1080, height: 1362 },
    assetBounds: { minLat: 59.1245, maxLat: 59.5355, minLng: 17.755, maxLng: 18.385 },
  },
  {
    zoom: 15,
    assetSize: { width: 1080, height: 1362 },
    assetBounds: { minLat: 59.2786, maxLat: 59.3814, minLng: 17.991, maxLng: 18.149 },
  },
  {
    zoom: 17,
    assetSize: { width: 1080, height: 1362 },
    assetBounds: { minLat: 59.317, maxLat: 59.343, minLng: 18.05, maxLng: 18.09 },
  },
];

export function pickZoomAsset(targetZoom) {
  let best = ZOOM_ASSETS[0];
  let bestDist = Math.abs(targetZoom - best.zoom);
  for (const a of ZOOM_ASSETS) {
    const d = Math.abs(targetZoom - a.zoom);
    if (d < bestDist) { best = a; bestDist = d; }
  }
  return best;
}

/**
 * Hämta asset + upscale-scale för en continuous (fractional) zoom.
 *
 * Bakgrund: vi har assets på z11/z13/z15/z17. Mellan två asset-nivåer
 * (t.ex. f=15 → f=16) vill användaren ha sömlös pixel-zoom (asset-render
 * vid scale 1 → 4). Vid f=16 byts asset till z17 ("z16 öppnas") och
 * scale = 1.
 *
 * Mappning (snap-intervall, varje intervall = 2 zoom-steg):
 *   f ∈ [11, 12): z11-asset, scale = 2^(f-11)        [1, 2) — Stockholm
 *   f ∈ [12, 14): z13-asset, scale = 2^(f-12)        [1, 4) — distrikt
 *   f ∈ [14, 16): z15-asset, scale = 2^(f-14)        [1, 4) — kvarter
 *   f ∈ [16, 18]: z17-asset, scale = 2^(f-16)        [1, 4] — gatunamn-detalj
 *
 * Snaps vid f=12/14/16 byter asset — spans matchar (inom 2%) så övergången
 * är nästan osynkantlig visuellt.
 *
 * Bounds-helper-funktionerna tar scale för att beräkna rätt synlig
 * lat/lng-span. Med scale=1 är funktionsfall identiskt med tidigare
 * scale=0-default (default-arg bakåtkompatibelt).
 *
 * @param {number} f  fractional zoom (t.ex. 13.7)
 * @returns {{ level: object, scale: number, snapStart: number }}
 */
export function pickAssetForFractionalZoom(f) {
  const clamped = Number.isFinite(f) ? f : ZOOM_ASSETS[0].zoom;
  let level;
  let snapStart;
  if (clamped < 12) { level = ZOOM_ASSETS[0]; snapStart = 11; }
  else if (clamped < 14) { level = ZOOM_ASSETS[1]; snapStart = 12; }
  else if (clamped < 16) { level = ZOOM_ASSETS[2]; snapStart = 14; }
  else { level = ZOOM_ASSETS[3]; snapStart = 16; }
  const scale = Math.pow(2, clamped - snapStart);
  return { level, scale, snapStart };
}

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
 * Härled bounds + viewport från center (lat, lng) + zoom + pixel-storlek.
 * Detta är basen för pinch-to-zoom + pan: center och zoom är state,
 * bounds beräknas on-the-fly så vi slipper hålla bounds i state.
 *
 * Mercator-formeln är symmetrisk mellan lng och Mercator-lat, så för
 * en pixel-storlek (W, H) gäller:
 *   widthDeg  = W * 360 / (256 * 2^Z)              [lng grader]
 *   heightDegMercator = H * 360 / (256 * 2^Z)       [Mercator-lat grader]
 *   heightDegGeographic = heightDegMercator / sec(centerLat)
 *
 * @param {number} centerLat
 * @param {number} centerLng
 * @param {number} zoom
 * @param {{width:number,height:number}} size
 * @returns {{width,height,bounds,zoom,center}}
 */
export function viewportFromCenter(centerLat, centerLng, zoom, size) {
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
    return getViewport(STOCKHOLM_BOUNDS, size, zoom);
  }
  const W = size.width;
  const H = size.height;
  const degPerPixel = 360 / (256 * (1 << zoom));

  const widthDeg = W * degPerPixel;
  const minLng = centerLng - widthDeg / 2;
  const maxLng = centerLng + widthDeg / 2;

  // Mercator-aspect: lng och Mercator-lat har samma px-skala. Konvertera
  // tillbaka till geografisk lat via sec(centerLat).
  const heightDegMercator = H * degPerPixel;
  const secLat = 1 / Math.max(0.01, Math.cos((centerLat * Math.PI) / 180));
  const heightDeg = heightDegMercator / secLat;
  const maxLat = centerLat + heightDeg / 2;
  const minLat = centerLat - heightDeg / 2;

  return {
    width: W,
    height: H,
    bounds: { minLat, maxLat, minLng, maxLng },
    zoom,
    center: { lat: centerLat, lng: centerLng },
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

/**
 * Härled synliga bounds inom ett större asset baserat på pan-offset.
 * Asset:t täcker hela assetBounds; vi visar en viewport-stor window som
 * förskjutits med assetOffsetX/Y (default = centrerad).
 *
 * Med scale > 1 renderas asset:n uppscalad så viewporten ser en
 * mindre geografisk area (mer zoom). panOffset mäts i renderade pixlar
 * (dvs samma screen-rörelse oavsett scale — naturlig pan-känsla).
 *
 * Returnerar bounds som täcker EXAKT det samma latitud/longitud som
 * det synliga området — så projectViewport ger rätt pin-positioner.
 *
 * @param {{minLat,maxLat,minLng,maxLng}} assetBounds
 * @param {{width,height}} assetSize         hela asset:ets pixel-storlek
 * @param {{width,height}} size              viewport-storlek
 * @param {{assetOffsetX,assetOffsetY}} panOffset   default {0,0} = centrerad
 * @param {number} [scale=1]                 upscale-faktor (1 = native)
 * @returns {{minLat,maxLat,minLng,maxLng}}
 */
export function visibleBoundsFromAsset(
  assetBounds,
  assetSize,
  size,
  panOffset = { assetOffsetX: 0, assetOffsetY: 0 },
  scale = 1,
) {
  // Vid scale s renderas bilden assetSize*wide s. Initial-offset i renderade
  // pixlar = (assetSize.width*s - size.width) / 2. I asset-pixlar (den
  // geografiska kartan) blir motsvarande initial-offset / s, och den
  // synliga bredden i asset-pixlar blir size.width / s.
  const visLeftAsset = (assetSize.width - size.width / scale) / 2 + panOffset.assetOffsetX / scale;
  const visTopAsset = (assetSize.height - size.height / scale) / 2 + panOffset.assetOffsetY / scale;
  const visRightAsset = visLeftAsset + size.width / scale;
  const visBottomAsset = visTopAsset + size.height / scale;

  const lngRange = assetBounds.maxLng - assetBounds.minLng;
  const latRange = assetBounds.maxLat - assetBounds.minLat;
  const minLng = assetBounds.minLng + (visLeftAsset / assetSize.width) * lngRange;
  const maxLng = assetBounds.minLng + (visRightAsset / assetSize.width) * lngRange;
  const maxLat = assetBounds.maxLat - (visTopAsset / assetSize.height) * latRange;
  const minLat = assetBounds.maxLat - (visBottomAsset / assetSize.height) * latRange;

  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Beräkna assetOffset (inom asset) som centrerar viewport på givet lat/lng.
 * Användbart när användaren zoomar in till en ny z-nivå — vi vill
 * att center-punkten ska matcha.
 *
 * Med scale > 1 returneras offset i renderade pixlar (så samma pan-rörelse
 * i pixlar känns lika oavsett scale).
 *
 * @param {{minLat,maxLat,minLng,maxLng}} assetBounds
 * @param {{width,height}} assetSize
 * @param {{width,height}} size
 * @param {{lat,lng}} targetCenter
 * @param {number} [scale=1]
 * @returns {{assetOffsetX,assetOffsetY}}
 */
export function panOffsetForCenter(assetBounds, assetSize, size, targetCenter, scale = 1) {
  const lngRange = assetBounds.maxLng - assetBounds.minLng;
  const latRange = assetBounds.maxLat - assetBounds.minLat;
  // Asset pixel av target-center:
  const cx = ((targetCenter.lng - assetBounds.minLng) / lngRange) * assetSize.width;
  const cy = ((assetBounds.maxLat - targetCenter.lat) / latRange) * assetSize.height;
  // Avstånd från asset-center i asset-pixlar:
  const cxRel = cx - assetSize.width / 2;
  const cyRel = cy - assetSize.height / 2;
  // Offset i renderade pixlar (för att hålla pan naturlig oavsett scale):
  let assetOffsetX = scale * cxRel;
  let assetOffsetY = scale * cyRel;
  // Klipp till giltiga gränser så viewport håller sig inom asset.
  // Synlig asset-area i asset-pixlar: bredd = size.width / scale,
  // centrerad → [center - size.width/(2*scale), center + size.width/(2*scale)].
  // Tillåtna offset = scale × (halva marginalen).
  const halfSpanX = scale * (assetSize.width - size.width / scale) / 2;
  const halfSpanY = scale * (assetSize.height - size.height / scale) / 2;
  assetOffsetX = Math.max(-halfSpanX, Math.min(halfSpanX, assetOffsetX));
  assetOffsetY = Math.max(-halfSpanY, Math.min(halfSpanY, assetOffsetY));
  return { assetOffsetX, assetOffsetY };
}