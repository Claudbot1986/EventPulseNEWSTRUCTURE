/**
 * Prompt-byggare för AI-eventbilder.
 *
 * Säkerhetspolicy (7 lager — alla explicita i bas-prompt):
 *   1. Aldrig riktiga venue-/artist-/varumärkesnamn (anonymiseras innan)
 *   2. Inga riktiga människor/ansikten
 *   3. Inga logotyper/varumärken
 *   4. Inga igenkännbara byggnader
 *   5. Ingen text i bilden (skyddar typsnitt/ordmärken)
 *   6. Aldrig "in the style of [artist]" — alla stilar är abstract/geometriska
 *   7. AI-märkning enligt EU AI Act (sätts i storage, ej i prompt)
 */

// Anonymisering — vi mappar kända Stockholm-venues till generiska beskrivningar.
const VENUE_GENERICIZERS = [
  { match: /konserthuset/i, replace: 'a Stockholm concert hall' },
  { match: /stockholm concert/i, replace: 'a Stockholm concert hall' },
  { match: /debaser/i, replace: 'a Stockholm music club' },
  { match: /strindbergs?/i, replace: 'a Stockholm intimate theater' },
  { match: /stampen/i, replace: 'a Stockholm jazz club' },
  { match: /kulturhuset(?:stadsteatern)?/i, replace: 'a Stockholm cultural center' },
  { match: /malmö?\s*live|malmolive/i, replace: 'a Malmö concert venue' },
  { match: /scandinavium/i, replace: 'a Gothenburg arena' },
  { match: /tele2|globen|avicii arena/i, replace: 'a Stockholm arena' },
  { match: /junibacken/i, replace: 'a Stockholm children\'s museum' },
  { match: /dramaten|kungliga dramatiska/i, replace: 'a Stockholm dramatic theater' },
  { match: /cirkus|cirkus(?:teatern)?/i, replace: 'a Stockholm variety theater' },
];

export function anonymizeVenue(name) {
  if (!name || typeof name !== 'string') return 'a Stockholm event venue';
  for (const { match, replace } of VENUE_GENERICIZERS) {
    if (match.test(name)) return replace;
  }
  return 'a Stockholm event venue';
}

const CATEGORY_PROMPTS = {
  music: 'live music event',
  concert: 'concert',
  theater: 'theater performance',
  teater: 'theater performance',
  family: 'family-friendly event',
  barn: 'family-friendly event',
  kids: 'family-friendly event',
  sports: 'sports event',
  idrott: 'sports event',
  nightlife: 'nightlife event',
  club: 'nightlife event',
  food: 'food and drink event',
  mat: 'food and drink event',
  exhibition: 'art exhibition',
  utställning: 'art exhibition',
  konst: 'art exhibition',
  festival: 'outdoor festival',
  default: 'event',
};

export function anonymizeCategory(slug) {
  if (!slug || typeof slug !== 'string') return CATEGORY_PROMPTS.default;
  const lower = slug.toLowerCase();
  return CATEGORY_PROMPTS[lower] || CATEGORY_PROMPTS.default;
}

export function buildBasePrompt(event) {
  const venue = anonymizeVenue(event?.venue_name || event?.venue);
  const category = anonymizeCategory(event?.category_slug || event?.category);
  return (
    `Abstract editorial poster art for a ${category} at ${venue}. ` +
    `Bold geometric composition, modern Scandinavian minimalism, warm color palette. ` +
    `Stylized illustration. ` +
    `No text, no words, no letters, no typography. ` +
    `No logos, no trademarks, no brand names. ` +
    `No recognizable people, no faces, no portraits. ` +
    `No recognizable buildings, no specific architecture. ` +
    `Suitable for digital display in a mobile app event listing.`
  );
}

export const STYLE_VARIATIONS = [
  {
    suffix: 'Bauhaus-inspired geometric shapes, primary colors, hard edges, asymmetric composition.',
    label: 'Bauhaus',
  },
  {
    suffix: 'Constructivist composition, dynamic diagonal angles, limited three-color palette.',
    label: 'Constructivist',
  },
  {
    suffix: 'Mid-century modern, organic curves, muted earth tones, sun and moon motifs.',
    label: 'Mid-century',
  },
  {
    suffix: 'Risograph print aesthetic, halftone dots, two-color overlay, registration error.',
    label: 'Risograph',
  },
  {
    suffix: 'Minimalist single-line art, continuous stroke, white background, negative space.',
    label: 'Line art',
  },
  {
    suffix: 'Watercolor wash background with geometric overlay, soft pastels, bleeding edges.',
    label: 'Watercolor',
  },
  {
    suffix: 'Abstract expressionist, bold gestural brushstrokes, high contrast, raw energy.',
    label: 'Abstract exp.',
  },
  {
    suffix: 'Swedish folk art inspired, stylized florals and trees, deep blues and warm golds.',
    label: 'Folk-inspired',
  },
  {
    suffix: 'Digital collage, layered geometric shapes, neon accents, scanlines and grain.',
    label: 'Digital collage',
  },
  {
    suffix: 'Flat vector illustration, simplified rounded forms, sunset gradient background.',
    label: 'Flat vector',
  },
];

export function buildVariations(event) {
  const base = buildBasePrompt(event);
  return STYLE_VARIATIONS.map(s => `${base} ${s.suffix}`);
}