/**
 * 06-UI/hooks/useAiImageUrl.js
 *
 * Pure function (no useState/useEffect — call directly from components)
 * that decides what image URL to render for an event in the Utforska tab.
 *
 * Copyright-strict by design. After the 2026-08-26 cleanup migration, the
 * events table contains no non-AI images; this hook enforces that contract
 * on the client side too.
 *
 * Decision tree (in priority order):
 *   1. EXPO_PUBLIC_AI_IMAGE_EXPLORE_ENABLED !== 'true'  → empty (kill switch)
 *   2. event.image_ai_optout === true                    → original (explicit)
 *   3. event.image_ai_generated === true && imageUrl     → pre-baked (worker done)
 *   4. event.image_ai_generated === false && status='library_fallback' && imageUrl
 *                                                         → library (no AI stamp)
 *   5. event.image_ai_generated === true && !imageUrl    → lazy (build URL)
 *   6. otherwise                                          → empty (no fallback)
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

  // 1. Global kill switch — when OFF, never serve AI images. UI shows empty box.
  const flag = process.env.EXPO_PUBLIC_AI_IMAGE_EXPLORE_ENABLED;
  if (flag !== 'true' && flag !== '1') {
    return { uri: null, source: 'empty', stampVisible: false };
  }

  // 2. Explicit per-event opt-out — venue requested original (e.g. pressbild).
  if (event.image_ai_optout === true) {
    const uri = event.imageUrl || event.image_url || null;
    return { uri, source: 'original', stampVisible: false };
  }

  // 3. Pre-baked — worker has already written the AI URL to DB.
  const isAiDone = event.image_ai_generated === true;
  const imageUrl = event.imageUrl || event.image_url || null;
  if (isAiDone && typeof imageUrl === 'string' && imageUrl.length > 0) {
    return { uri: imageUrl, source: 'pre-baked', stampVisible: true };
  }

  // 4. Library fallback — server assigned a library image when BFL was
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

  // 5. Lazy — worker flagged AI generation but URL not yet persisted.
  //    Only attempt when status is 'completed' (worker done) — pending/failed
  //    will return empty until the worker resolves them.
  if (isAiDone && event.image_generation_status === 'completed' && event.id) {
    const url = buildAiImageUrl(event.id);
    if (url) return { uri: url, source: 'lazy', stampVisible: true };
  }

  // 6. Default — empty box. NO silent fallback to original images.
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
