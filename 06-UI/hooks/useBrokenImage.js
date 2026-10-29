// hooks/useBrokenImage.js
//
// Hanterar en trasig bild-URL.
//
// 2026-10-29 — varför detta finns: 13 <Image>-taggar i appen saknade
// onError. En trasig URL (t.ex. en fil som aldrig laddades upp till
// Storage, vilket var fallet för samtliga 16 452 events med image_url
// efter storage-cleanup) renderade då en TYST TOM YTA — ingen
// platshållare, ingen felmarkering, ingen logg. Felet var osynligt.
//
// Mönstret är det MapEventCard redan använde: state + onError → vi
// renderar platshållaren i stället för bilden.
//
// Nyckeln spåras per källa så att en lista där kort återanvänds med
// ny bild inte blir permanent "trasig" — byter källan är bilden frisk igen.

import { useCallback, useState } from 'react';

/** Stabil nyckel för en bildkälla (sträng, require()-nummer eller { uri }). */
export function imageSourceKey(source) {
  if (source == null) return 'none';
  if (typeof source === 'string') return source;
  if (typeof source === 'number') return `num:${source}`;
  if (typeof source === 'object' && source.uri) return source.uri;
  return 'none';
}

/**
 * @param {number|string|object|null|undefined} source
 * @param {string} logTag  Prefix i console.warn, t.ex. 'EventPulseCard'.
 * @returns {{ broken: boolean, onError: (e?: unknown) => void }}
 */
export function useBrokenImage(source, logTag = 'Image') {
  const key = imageSourceKey(source);
  const [brokenKey, setBrokenKey] = useState(null);

  const onError = useCallback(
    (e) => {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[${logTag}] image onError — visar platshållare i stället`, key);
      }
      setBrokenKey(key);
    },
    [key, logTag],
  );

  return { broken: brokenKey !== null && brokenKey === key, onError };
}
