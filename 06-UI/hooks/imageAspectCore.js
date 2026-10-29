// hooks/imageAspectCore.js
//
// Pure async-funktioner för att mäta en bilds naturliga aspect (w/h).
// Löst från React-hooks så hooks/useImageAspect.js kan wrap:a dem och
// tester kan köra mot kärnan utan att mocka react.
//
// Design: trevärdestyper — require-nummer, URI-sträng, eller null.
//
//   resolveAssetAspect(reqNum) → aspect | null          (sync)
//   resolveRemoteAspect(uri)    → Promise<aspect|null>  (async via Image.getSize)
//
// Aspect-cache delas mellan wrappers eftersom de båda går genom samma
// Map i denna modul.

import { Image } from 'react-native';

export const FALLBACK_ASPECT = 1.15; // matchar tidigare hårdkodat värde (hero-geometri)

/**
 * Låst aspect ratio för eventbilder: 3:2 (1.5).
 *
 * 2026-10-29 — användarbeslut: "ramen runt bilden behöver vara samma aspect
 * ratio" för ALLA bilder, så att korten i karusellen blir lika höga oavsett
 * bildformat.
 *
 * Tidigare följde ramen bildens naturliga aspect (useImageAspect + contain).
 * Med blandade format (16:9 i det gamla biblioteket, 3:2 i det nya) gav det
 * kort med olika höjd — 16:9-bilder gav 202 pt och 3:2-bilder 240 pt vid
 * 360 pt bredd (19 % högre).
 *
 * Varför 3:2 och inte 16:9: UI:s egen `eventImage`-container i App.js är
 * maxWidth 420 × height 280 = exakt 3:2, och genereringen producerar nu
 * 1248×832 (3:2). Med låst 3:2-ram och resizeMode="contain" fyller bilden
 * ramen exakt utan beskärning och utan brevluckor — förutsatt att bilden
 * också är 3:2. Äldre 16:9-bilder får då brevluckor ovan/under tills de
 * regenereras, vilket är den avvägda kostnaden.
 *
 * resizeMode stays "contain" (aldrig "cover"): användaren krävde 2026-10-07
 * att "bilderna i eventcard måste vara helt synliga, inget inzopmat".
 */
export const LOCKED_EVENT_IMAGE_ASPECT = 1.5;

const aspectCache = new Map();

function resolveFromCache(uri) {
  const cached = aspectCache.get(uri);
  return typeof cached === 'number' && cached > 0 ? cached : null;
}

function storeInCache(uri, aspect) {
  if (typeof aspect === 'number' && aspect > 0) {
    aspectCache.set(uri, aspect);
  }
}

/**
 * Sync-uppslag för lokala require()-assets. Returnerar null om asset
 * inte kan lösas (tex okänt id).
 */
export function resolveAssetAspect(reqNum) {
  if (typeof reqNum !== 'number') return null;
  try {
    const meta = Image.resolveAssetSource(reqNum);
    if (meta && meta.width > 0 && meta.height > 0) {
      return meta.width / meta.height;
    }
  } catch {
    /* swallow */
  }
  return null;
}

/**
 * Async-uppslag för HTTP-URI:er. Resolver med cache först, annars
 * Image.getSize. Vid fel returnerar vi null (hook-wrapper faller då till
 * FALLBACK_ASPECT).
 *
 * Retry: en gång efter 5s om första Image.getSize fail:ar. Detta fångar
 * långsam första bildladdning (HTTP cold cache).
 */
export function resolveRemoteAspect(uri) {
  if (typeof uri !== 'string' || uri.length === 0) {
    return Promise.resolve(null);
  }
  const cached = resolveFromCache(uri);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    let resolved = false;
    Image.getSize(
      uri,
      (width, height) => {
        if (resolved) return;
        resolved = true;
        if (width > 0 && height > 0) {
          const aspect = width / height;
          storeInCache(uri, aspect);
          resolve(aspect);
        } else {
          resolve(null);
        }
      },
      () => {
        if (resolved) return;
        // Retry efter 5s — första försöket kan ha missat pga cache cold.
        setTimeout(() => {
          if (resolved) return;
          resolved = true;
          Image.getSize(
            uri,
            (width, height) => {
              if (width > 0 && height > 0) {
                const aspect = width / height;
                storeInCache(uri, aspect);
                resolve(aspect);
              } else {
                resolve(null);
              }
            },
            () => resolve(null),
          );
        }, 5000);
      },
    );
  });
}

/**
 * Test-hjälp: rensa cache. Exporteras för tester i hooks/useImageAspect.test.ts.
 */
export function resetAspectCache() {
  aspectCache.clear();
}

/**
 * Test-hjälp: sätt cache manuellt (för tester).
 */
export function primeAspectCache(uri, aspect) {
  storeInCache(uri, aspect);
}