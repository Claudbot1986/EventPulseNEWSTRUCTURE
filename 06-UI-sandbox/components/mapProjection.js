// mapProjection.js — Mercator-projektion och bounds för MapCanvas.
//
// Varför fristående: projektionen är en ren funktion av lat/lng,
// ingen React, ingen UI. Går att enhetstesta isolerat.
//
// Begränsningar (avsiktliga för sandbox):
//   - Ingen web-mercator tile-beräkning (x/y i tile coords); vi
//     projicerar lat/lng direkt till pixel-koordinater inom en
//     SVG-bildyta. Det är en *linjär* projektion (ekvivalent med
//     Plate Carrée), tillräckligt bra för en liten viewport som
//     täcker Stockholms storlek (≈0.5° lat × 0.5° lng ≈ 30×30km).
//     Felmarginal vid polerna är försumbar i Sverige.
//   - Ingen wrap-around vid antimeridian (Stockholm-area är tryggt
//     inom ±180°).
//   - Out-of-bounds returnerar { x: -1, y: -1, visible: false } så
//     MapCanvas kan rendera en "off-screen"-sentinel istället för
//     att Visa utanför canvas.
//
// Exporterar:
//   STOCKHOLM_BOUNDS  — lat/lng-union centrerad på Stockholm centrum
//   projectToXY()      — projicerar lat/lng + bounds → pixel x/y
//   clampToBounds()    — klipper till bounds, returnerar visible=true
//   jitterFallback()   — sprider fallback-events så de inte krockar
//   hashStringToFloat() — deterministisk hash för jitter

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

/**
 * Beräkna pixel x/y för lat/lng inom bounds.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{minLat,maxLat,minLng,maxLng}} bounds
 * @param {{width:number,height:number}} size  pixel-canvas storlek
 * @returns {{x:number,y:number,visible:boolean}}
 */
export function projectToXY(lat, lng, bounds, size) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { x: -1, y: -1, visible: false };
  }
  const lngRange = bounds.maxLng - bounds.minLng;
  const latRange = bounds.maxLat - bounds.minLat;
  if (lngRange <= 0 || latRange <= 0 || size.width <= 0 || size.height <= 0) {
    return { x: -1, y: -1, visible: false };
  }

  // x växer åt höger (lng ökar), y växer nedåt (lat minskar i
  // pixel-space). Vi normaliserar 0..1 och skalar till canvas.
  const xNorm = (lng - bounds.minLng) / lngRange;
  const yNorm = 1 - (lat - bounds.minLat) / latRange; // inverterad lat
  const x = xNorm * size.width;
  const y = yNorm * size.height;
  const visible = x >= 0 && x <= size.width && y >= 0 && y <= size.height;
  return { x, y, visible };
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
 *
 * @param {string} str
 * @returns {number}  flyttal i [0, 1)
 */
export function hashStringToFloat(str) {
  if (typeof str !== 'string' || str.length === 0) return 0;
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Ta absolut värde, modulo för att passa i JS Number-säkert.
  const u = (hash >>> 0) / 0xffffffff; // 0..1
  return u;
}

/**
 * Jitter för fallback-events. Returnerar NY lat/lng ± JITTER_DEGREES.
 * Deterministisk: samma id → samma nya position varje gång.
 *
 * Varför ±0.005°? ≈550m radie, tillräckligt för att separera 25-100
 * pins visuellt utan att tappa "i Stockholm"-känslan. Riktiga events
 * (lat ≠ 59.3293) påverkas INTE.
 *
 * @param {{id:string,lat:number,lng:number}} event
 * @returns {{lat:number,lng:number}}
 */
export function jitterFallback(event) {
  if (!event || event.lat !== STOCKHOLM_FALLBACK.lat) return event;
  const seed = hashStringToFloat(event.id || '');
  const dy = hashStringToFloat('lat-' + (event.id || ''));
  // Slump i [-1, +1] gån och JITTER_DEGREES.
  const dLat = (dy * 2 - 1) * JITTER_DEGREES;
  const dLng = (seed * 2 - 1) * JITTER_DEGREES;
  return {
    ...event,
    lat: event.lat + dLat,
    lng: event.lng + dLng,
  };
}