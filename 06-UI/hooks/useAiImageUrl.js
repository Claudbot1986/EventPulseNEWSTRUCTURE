/**
 * 06-UI/hooks/useAiImageUrl.js
 *
 * Pure function (no useState/useEffect — call directly from components)
 * that decides what image URL to render for an event in the Utforska tab.
 *
 * Copyright-strict by design. Event-bilder läggs bara in i Supabase när de
 * är AI-genererade (eller via library-fallback). Original-pressbilder från
 * källorna skrivs aldrig till events.image_url — det är ett rent kontrakt
 * som hålls i ingestion + worker. När vi i framtiden har auktoriserade
 * adaptrar med samtycke från leverantörer tillåts original per källa via
 * events.image_ai_optout (per-rad-flagga, inget globalt kill switch).
 *
 * Decision tree (in priority order):
 *   1. event.image_ai_optout === true                    → original (per-source opt-in)
 *   2. event.image_ai_generated === true && imageUrl     → pre-baked (worker done)
 *   3. event.image_ai_generated === false && status='library_fallback' && imageUrl
 *                                                         → library (no AI stamp)
 *   4. event.image_ai_generated === true && !imageUrl    → lazy (build URL)
 *   5. otherwise                                          → empty (no fallback)
 *
 * The hook returns `{ uri, source, stampVisible }`. The UI renders either:
 *   - <Image source={{ uri }} resizeMode="contain" />  (when uri is non-null)
 *   - <View style={emptyBoxStyle} />                    (when source === 'empty')
 *
 * stampVisible === true only for pre-baked/lazy sources (PNG has EU AI Act
 * stamp baked in by 08-Agent/tools/ai_compliance.ts). Library-fallback
 * images do NOT carry the stamp — they're reused past-AI or peer-event
 * images, and stamping every shared image would be misleading.
 *
 * 2026-08-27: Added library source type. Backend now assigns library URLs
 * server-side when BFL fails (no_credits / transient error) so the user
 * never sees an empty box while BFL credits are zero.
 *
 * 2026-08-27 (senare): Tog bort global kill switch (EXPO_PUBLIC_AI_IMAGE_EXPLORE_ENABLED).
 * Per-källa optout via image_ai_optout räcker — vi vill inte ha en dold spärr
 * som default är AV. När auktoriserade adaptrar med leverantörsavtal finns
 * sätts image_ai_optout=true på just de källorna, alla andra kör AI-bilder
 * via pre-baked → lazy → library → empty-flödet.
 */

import { buildAiImageUrl } from '../services/agentClient';

/**
 * @typedef {Object} AiImageResolution
 * @property {string|null} uri          Absolute image URL or null when empty.
 * @property {'original'|'pre-baked'|'lazy'|'library'|'empty'} source
 * @property {boolean} stampVisible     True for pre-baked/lazy (PNG has EU AI Act stamp).
 */

/**
 * Resolve the image URL for one event under the AI-image rollout.
 *
 * @param {Object} event
 * @param {string} [event.id]
 * @param {string|null|undefined} [event.imageUrl]
 * @param {string|null|undefined} [event.image_url]
 * @param {boolean} [event.image_ai_generated]
 * @param {boolean} [event.image_ai_optout]
 * @param {string|null} [event.image_generation_status]   // 'completed'|'pending'|'failed'|'no_credits'|'library_fallback'|null
 * @returns {AiImageResolution}
 */
export function useAiImageUrl(event) {
  if (!event || typeof event !== 'object') {
    return { uri: null, source: 'empty', stampVisible: false };
  }

  // 1. Explicit per-event opt-out — auktoriserad källa med leverantörsavtal
  //    som får visa sin egen pressbild. Sätts per rad i ingestion/normalizer.
  if (event.image_ai_optout === true) {
    const uri = event.imageUrl || event.image_url || null;
    return { uri, source: 'original', stampVisible: false };
  }

  // 2. Pre-baked — worker has already written the AI URL to DB.
  const isAiDone = event.image_ai_generated === true;
  const imageUrl = event.imageUrl || event.image_url || null;
  if (isAiDone && typeof imageUrl === 'string' && imageUrl.length > 0) {
    return { uri: imageUrl, source: 'pre-baked', stampVisible: true };
  }

  // 3. Library fallback — server assigned a library image when BFL was
  //    unavailable (no_credits / transient error). image_ai_generated=false,
  //    status='library_fallback'. No AI-stamp in the image.
  if (
    event.image_ai_generated === false &&
    event.image_generation_status === 'library_fallback' &&
    typeof imageUrl === 'string' &&
    imageUrl.length > 0
  ) {
    return { uri: imageUrl, source: 'library', stampVisible: false };
  }

  // 4. Lazy — worker flagged AI generation but URL not yet persisted.
  //    Only attempt when status is 'completed' (worker done) — pending/failed
  //    will return empty until the worker resolves them.
  if (isAiDone && event.image_generation_status === 'completed' && event.id) {
    const url = buildAiImageUrl(event.id);
    if (url) return { uri: url, source: 'lazy', stampVisible: true };
  }

  // 5. Default — empty box. NO silent fallback to original images.
  return { uri: null, source: 'empty', stampVisible: false };
}

/**
 * Shared style for the empty-image placeholder box. Matches the dark surface
 * of the event cards so missing images look visually uniform rather than
 * "broken". Applied at all three <Image> sites in App.js.
 */
export const emptyImageBoxStyle = {
  width: '100%',
  aspectRatio: 1,
  backgroundColor: '#1A1A1A',
  borderRadius: 12,
};
