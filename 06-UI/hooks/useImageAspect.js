// hooks/useImageAspect.js
//
// Returnerar en wrap-aspectRatio som matchar bildens naturliga
// proportioner (width / height). Behövs så vi kan visa bilder i
// event-cards HELT utan crop, med ramen (= likad/väggen som bilden
// sitter i) i samma aspect som bilden själv.
//
// Innan denna hook hade varje hero-kort en fast aspectRatio (1.15) +
// resizeMode="cover" — vilket crop:ade bilden till wrap:ens aspect.
// Användaren klagade: "bilderna i eventcard måste vara helt synliga,
// inget inzopmat, ramen runt bilden / framen som bilden sitter mountad
// i behöver vara samma aspect ratio".
//
// Ren React-wrapper runt hooks/imageAspectCore.js (pure-funktioner).
// Indirekt-lösningen gör imageAspectCore testbar utan React-mock.

import { useEffect, useMemo, useState } from 'react';
import {
  FALLBACK_ASPECT,
  resolveAssetAspect,
  resolveRemoteAspect,
} from './imageAspectCore.js';

function normalize(source) {
  if (source == null) return { uri: null, isAsset: false };
  if (typeof source === 'number') return { uri: source, isAsset: true };
  if (typeof source === 'object' && source.uri) {
    return { uri: source.uri, isAsset: false };
  }
  if (typeof source === 'string' && source.length > 0) {
    return { uri: source, isAsset: false };
  }
  return { uri: null, isAsset: false };
}

/**
 * @param {number|string|object|null|undefined} imageSource
 *   require()-nummer, "https://..."-sträng eller { uri }.
 * @returns {{
 *   aspect: number,            // w/h, alltid > 0. FALLBACK_ASPECT tills känt.
 *   ready: boolean,            // true när vi har bildens riktiga aspect.
 *   naturalWidth: number|null,
 *   naturalHeight: number|null,
 * }}
 */
export function useImageAspect(imageSource) {
  const { uri, isAsset } = normalize(imageSource);
  const [state, setState] = useState(() => {
    if (isAsset && typeof uri === 'number') {
      const aspect = resolveAssetAspect(uri);
      if (aspect) {
        return {
          aspect,
          ready: true,
          naturalWidth: null,
          naturalHeight: null,
        };
      }
    }
    return {
      aspect: FALLBACK_ASPECT,
      ready: false,
      naturalWidth: null,
      naturalHeight: null,
    };
  });

  useEffect(() => {
    if (isAsset || typeof uri !== 'string') return;
    let cancelled = false;

    resolveRemoteAspect(uri).then((aspect) => {
      if (cancelled || !aspect) return;
      setState({
        aspect,
        ready: true,
        naturalWidth: null,
        naturalHeight: null,
      });
    });

    return () => { cancelled = true; };
  }, [uri, isAsset]);

  return useMemo(
    () => ({
      aspect: state.aspect,
      ready: state.ready,
      naturalWidth: state.naturalWidth,
      naturalHeight: state.naturalHeight,
    }),
    [state.aspect, state.ready, state.naturalWidth, state.naturalHeight],
  );
}

// Re-export för bakåtkompatibilitet (befintliga imports av FALLBACK_ASPECT).
export { FALLBACK_ASPECT };