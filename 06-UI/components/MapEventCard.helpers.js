// MapEventCard.helpers.js — pure formatters för MapEventCard.
//
// Splittat från .jsx så att node-test kan importera logiken utan att
// behöva parsa JSX. Mönstret är samma som AppleMapsScreen.helpers.js.

import { formatStartLabel } from './mapTime.js';

const CATEGORY_LABELS = {
  'musical-theatre': 'Musikal',
  music: 'Musik',
  classical: 'Klassiskt',
  community: 'Community',
  theater: 'Teater',
  comedy: 'Standup',
  sport: 'Sport',
  family: 'Familj',
  dance: 'Dans',
  exhibition: 'Utställning',
  workshop: 'Workshop',
};

/**
 * Plocka bästa titeln (sv > en > fallback).
 */
export function pickTitle(event) {
  if (!event) return '';
  return event.title_sv || event.title_en || 'Evenemang';
}

/**
 * Plocka läsbar kategori-label på svenska.
 */
export function pickCategoryLabel(event) {
  if (!event) return 'evenemang';
  const slug = event.category_slug;
  if (slug && CATEGORY_LABELS[slug]) return CATEGORY_LABELS[slug];
  return slug || 'evenemang';
}

/**
 * Formatera första metaraden: "fre 19:30 · Musik" (eller med Gratis-flagga).
 *
 * @param {{start_time?: string, category_slug?: string, is_free?: boolean}} event
 * @returns {string}
 */
export function formatMetaLine(event) {
  if (!event) return '';
  const parts = [];
  const time = formatStartLabel(event.start_time);
  if (time) parts.push(time);
  parts.push(pickCategoryLabel(event));
  return parts.join(' · ');
}

/**
 * Returnerar "Gratis" om eventet är gratis, annars null.
 */
export function pickFreeLabel(event) {
  if (!event) return null;
  return event.is_free === true ? 'Gratis' : null;
}

/**
 * Bestämmer om ett event är "visbart nog" — har minst titel ELLER meta.
 * Kollar rå fält (inte derived via pickTitle-fallback).
 */
export function hasRenderableContent(event) {
  if (!event) return false;
  const hasTitle = Boolean(event.title_sv || event.title_en);
  const hasMeta = Boolean(event.start_time || event.category_slug);
  return hasTitle || hasMeta;
}

/**
 * Returnera bild-URL (sträng) om eventet har en. Returnerar null om
 * URL saknas, är tom, eller är ett require()-nummer (lokala hanteras
 * separat av sourceOf() i komponenten).
 *
 * Accepterar både `image_url` (Supabase-konvention) och `imageSource`
 * (test/preview-konvention).
 */
export function pickImageUrl(event) {
  if (!event) return null;
  const candidate = event.image_url || event.imageSource;
  if (!candidate) return null;
  if (typeof candidate === 'number') return null; // require() — hanteras av sourceOf()
  if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  if (typeof candidate === 'object' && candidate.uri) return candidate.uri;
  return null;
}