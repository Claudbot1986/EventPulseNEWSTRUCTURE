/**
 * aiPromptClient — port av autoGenServer/buildAutoPrompt för klient-side
 * prompt-rekonstruktion.
 *
 * autoGenServer (port 7790) genererar AI-bilder med BFL Flux. Bildens prompt
 * byggs av `buildAutoPrompt()` server-side men lagras INTE i databasen —
 * bara `image_url` uppdateras. För att visa "vilken prompt användes för den
 * här bilden" rekonstruerar vi prompten här med samma logik.
 *
 * Logik 1:1 med `asterisk/autoGenServer.js` buildAutoPrompt:
 *   1. category_slug → konkret visuell scen (PRIMÄR driver)
 *   2. venue_name → kort kontextuell hint ("At a Stockholm art museum")
 *   3. title_sv → kort hint (max 60 chars), INTE bokstavlig avbildning
 *   4. description_sv (om finns) → stödkontext
 *   5. Om category_slug är generisk (community/culture) eller null →
 *      sök kategori-nyckelord i titeln (extractCategoryFallback)
 *
 * Konvention: samma input → samma prompt (deterministiskt).
 */

const CATEGORY_SCENES = {
  // ── Sports
  sports:  'a football match in a stadium with players in action on green grass under dramatic sky',
  idrott:  'a football match in a stadium with players in action on green grass under dramatic sky',
  fotboll: 'a football match in a stadium with players in action on green grass under dramatic sky',
  // ── Art / exhibition
  exhibition:        'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  'art-exhibitions': 'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  konst:             'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  utställning:       'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  galleri:           'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  art:               'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  arts:              'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  // ── Music / concert
  music:    'a concert stage with musicians performing under dramatic stage lights, instruments visible, audience in silhouette',
  konsert:  'a concert stage with musicians performing under dramatic stage lights, instruments visible, audience in silhouette',
  // ── Theater
  theater:  'a theater stage with dramatic lighting, performers mid-scene, ornate curtain in background',
  teater:   'a theater stage with dramatic lighting, performers mid-scene, ornate curtain in background',
  föreställning: 'a theater stage with dramatic lighting, performers mid-scene, ornate curtain in background',
  // ── Family
  family: 'a bright family-friendly indoor scene, colorful workshop with creative materials, warm atmosphere',
  barn:   'a bright family-friendly indoor scene, colorful workshop with creative materials, warm atmosphere',
  kids:   'a bright family-friendly indoor scene, colorful workshop with creative materials, warm atmosphere',
  // ── Nightlife
  nightlife: 'a nightclub interior with colored stage lights, DJ booth, dance floor with movement, energetic atmosphere',
  nattliv:   'a nightclub interior with colored stage lights, DJ booth, dance floor with movement, energetic atmosphere',
  club:      'a nightclub interior with colored stage lights, DJ booth, dance floor with movement, energetic atmosphere',
  // ── Food
  food: 'a restaurant setting with plated dishes on a wooden table, warm ambient lighting, dining atmosphere',
  mat:  'a restaurant setting with plated dishes on a wooden table, warm ambient lighting, dining atmosphere',
  // ── Festival
  festival: 'an outdoor summer festival with stage and crowd, colorful flags and tents, sunny sky',
  // ── Produktionsdata-fallbacks (verifierat från Supabase 2026-08-24)
  community: 'an abstract editorial composition with soft atmospheric lighting, no specific setting, no people',
  culture:   'a cultural venue interior with artistic atmosphere, soft museum-style lighting',
  // ── Default
  default: 'an abstract editorial composition with soft atmospheric lighting, no specific setting, no people',
};

// Venue-specifika scener (PRIORITY över category_slug)
// Synkad med autoGenServer/services buildAutoPrompt.
const VENUE_SCENES = [
  { match: /textil/i, scene: 'a textile museum interior with woven fabrics, threads, looms, fabric swatches and textile art on display, soft warm lighting' },
  { match: /nationalmuseum/i, scene: 'a national museum interior with curated design objects, mid-century furniture, sketches, design process materials and craft pieces, elegant gallery lighting' },
  { match: /moderna museet/i, scene: 'a modernist art museum interior with bold contemporary paintings and sculptures, dramatic skylights, clean white walls' },
  { match: /liljevalchs/i, scene: 'a contemporary art gallery interior with large-scale paintings, vivid colors, modern exhibition lighting' },
  { match: /cecilia hillstr/i, scene: 'a small intimate art gallery interior with carefully arranged paintings on neutral walls, focused spotlights' },
  { match: /ois\b|\u00f6is\b|\u00f6rgryte/i, scene: 'a football match scene on a green grass pitch, players in action, dramatic stadium atmosphere' },
];

function getVenueScene(venueName) {
  if (!venueName || typeof venueName !== 'string') return null;
  const v = venueName.toLowerCase();
  for (const { match, scene } of VENUE_SCENES) {
    if (match.test(v)) return scene;
  }
  return null;
}

const GENERIC_CATEGORIES = new Set(['community', 'culture', 'event', 'default', '']);

/**
 * Venue-aware hint — kort kontextuell fras baserat på venue-namn.
 * INTE anonymisering — vi vill att Moderna Museet ska signalera "konstmuseum".
 */
function getVenueHint(venueName) {
  if (!venueName || typeof venueName !== 'string') return '';
  const v = venueName.toLowerCase();
  if (/museet|gallery|galleri/.test(v))    return 'At a Stockholm art museum. ';
  if (/arena|stadium/.test(v))              return 'At a sports arena. ';
  if (/stadion/.test(v))                    return 'At a stadium. ';
  if (/konserthus|concert hall/.test(v))    return 'At a concert hall. ';
  if (/teatern|dramaten|opera/.test(v))     return 'At a theater. ';
  if (/arena|stadion|stadium/.test(v))      return 'At a sports venue. ';
  return '';
}

/**
 * Fallback för kategori när category_slug är generisk/null.
 * Sök i titeln efter svenska/engelska nyckelord.
 */
function extractCategoryFallback(title) {
  if (!title || typeof title !== 'string') return null;
  const t = title.toLowerCase();
  // Varje pattern kräver word-boundary för att undvika falska positiva
  // (t.ex. "desinformation" innehåller "mat" → felaktig food-matchning).
  if (/\b(idrott|fotboll|sport|match)\b/.test(t))                          return 'sports';
  if (/\b(utställning|utstallning|konst|galleri|museum|exhibition|surrealism|design)\b/.test(t)) return 'exhibition';
  if (/\b(konsert|concert|musik|music)\b/.test(t))                         return 'music';
  if (/\b(teater|theater|föreställning|forestallning|pjäs|pjas)\b/.test(t)) return 'theater';
  if (/\b(barn|family|kids)\b/.test(t))                                    return 'family';
  if (/\b(nattliv|night|club)\b/.test(t))                                  return 'nightlife';
  if (/\b(mat|food|restaurang)\b/.test(t))                                 return 'food';
  if (/\bfestival\b/.test(t))                                              return 'festival';
  return null;
}

/**
 * Bygger auto-prompt kategori-driven istället för titel-driven.
 *
 * @param {Object} event - { title_sv, title, venue_name, category_slug, description_sv }
 * @returns {string} Full BFL Flux prompt (deterministisk för samma input)
 */
export function buildAutoPrompt(event) {
  const title = (event?.title_sv || event?.title || '').trim();
  const titleShort = title.slice(0, 60);

  const venueName = event?.venues?.name || event?.venue_name || event?.venue || '';
  const venueHint = getVenueHint(venueName);

  // 1. Venue-specifik scene vinner över category_slug (PRIORITY)
  let scene = getVenueScene(venueName);

  // 2. Annars: category_slug + title-fallback
  let category = '';
  if (!scene) {
    category = (event?.category_slug || '').toLowerCase();
    if (!category || GENERIC_CATEGORIES.has(category)) {
      const titleFallback = extractCategoryFallback(title);
      if (titleFallback) category = titleFallback;
    }
    scene = CATEGORY_SCENES[category] || CATEGORY_SCENES.default;
  }

  return (
    `${venueHint}Editorial photograph of ${scene}. ` +
    `Theme hint: "${titleShort}". ` +
    `Photographic style, vivid natural colors, soft natural lighting, cinematic depth of field. ` +
    `Mobile event thumbnail, square aspect. ` +
    `Hard negative prompt: zero text anywhere — no words, letters, numbers, calligraphy, typography, signs, labels, watermarks, UI. ` +
    `No logos, no trademarks, no brand names. ` +
    `NEVER show people outdoors among buildings, plazas, or city streets. ` +
    `Prefer indoor, abstract, or close-up subject-focused compositions. ` +
    `If people appear they are small in frame, full-body, in action, or in silhouette — never close-up portraits of faces. `
  );
}

/**
 * Resumé av prompten — korta rader för UI (inte hela BFL-prompten).
 * Visar: scene (venue-specifik eller kategori), venue-hint, titel-hint. Bra för kort-layout.
 *
 * @param {Object} event
 * @returns {{ scene: string, venueHint: string|null, themeHint: string, category: string, fullPrompt: string }}
 */
export function summarizePrompt(event) {
  const title = (event?.title_sv || event?.title || '').trim();
  const titleShort = title.slice(0, 60);

  const venueName = event?.venues?.name || event?.venue_name || event?.venue || '';
  const venueHint = getVenueHint(venueName).trim();

  let scene = getVenueScene(venueName);
  let category = '';
  if (!scene) {
    category = (event?.category_slug || '').toLowerCase();
    if (!category || GENERIC_CATEGORIES.has(category)) {
      const titleFallback = extractCategoryFallback(title);
      if (titleFallback) category = titleFallback;
    }
    scene = CATEGORY_SCENES[category] || CATEGORY_SCENES.default;
  }

  return {
    scene,
    venueHint: venueHint || null,
    themeHint: titleShort,
    category: category || 'venue-specific',
    fullPrompt: buildAutoPrompt(event),
  };
}