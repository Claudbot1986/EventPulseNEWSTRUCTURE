// e2e/map-event-card.test.mjs — verifierar MapEventCard (06-UI-sandbox).
//
// Vad detta test verifierar (logik, inte JSX):
//   1. pickTitle — väljer sv > en > fallback
//   2. pickCategoryLabel — svenska kategorinamn
//   3. formatMetaLine — "fre 19:30 · Musik"
//   4. pickFreeLabel — "Gratis" eller null
//   5. hasRenderableContent — avgör om kortet ska renderas
//
// Vad det INTE verifierar (kräver simulator/Dev Client):
//   - Visuell rendering av kortet
//   - X-knapp / Läs mer-knapp (kräver Pressable-touch)
//   - Integration med AppleMapsScreen (state-wiring)
//
// Hur man kör:
//   node --test 06-UI-sandbox/e2e/map-event-card.test.mjs

import { test } from 'node:test';
import assertStrict from 'node:assert/strict';

const helpers = await import('../components/MapEventCard.helpers.js');

// --- pickTitle ----------------------------------------------------------

test('pickTitle: föredrar title_sv', () => {
  assertStrict.equal(
    helpers.pickTitle({ title_sv: 'På svenska', title_en: 'In English' }),
    'På svenska',
  );
});

test('pickTitle: faller tillbaka till title_en om title_sv saknas', () => {
  assertStrict.equal(
    helpers.pickTitle({ title_en: 'In English' }),
    'In English',
  );
});

test('pickTitle: tom sträng i title_sv → faller tillbaka till title_en', () => {
  assertStrict.equal(
    helpers.pickTitle({ title_sv: '', title_en: 'English only' }),
    'English only',
  );
});

test('pickTitle: ingen titel → fallback "Evenemang"', () => {
  assertStrict.equal(helpers.pickTitle({}), 'Evenemang');
});

test('pickTitle: null event → tom sträng', () => {
  assertStrict.equal(helpers.pickTitle(null), '');
});

// --- pickCategoryLabel -------------------------------------------------

test('pickCategoryLabel: kända slugs mappar till svenska', () => {
  const cases = [
    ['music', 'Musik'],
    ['comedy', 'Standup'],
    ['theater', 'Teater'],
    ['classical', 'Klassiskt'],
    ['family', 'Familj'],
    ['dance', 'Dans'],
    ['sport', 'Sport'],
    ['exhibition', 'Utställning'],
    ['community', 'Community'],
    ['workshop', 'Workshop'],
    ['musical-theatre', 'Musikal'],
  ];
  for (const [slug, expected] of cases) {
    assertStrict.equal(
      helpers.pickCategoryLabel({ category_slug: slug }),
      expected,
      `slug=${slug}`,
    );
  }
});

test('pickCategoryLabel: okänd slug returneras rå', () => {
  assertStrict.equal(
    helpers.pickCategoryLabel({ category_slug: 'weird-slug' }),
    'weird-slug',
  );
});

test('pickCategoryLabel: ingen slug → "evenemang"', () => {
  assertStrict.equal(helpers.pickCategoryLabel({}), 'evenemang');
});

test('pickCategoryLabel: null event → "evenemang"', () => {
  assertStrict.equal(helpers.pickCategoryLabel(null), 'evenemang');
});

// --- formatMetaLine ---------------------------------------------------

test('formatMetaLine: kombinerar tid + kategori med ·', () => {
  // start_time är lör 2026-10-04 20:00 lokal-tid, formatet ska vara "lör 20:00 · Musik"
  const event = {
    start_time: '2026-10-04T20:00:00',
    category_slug: 'music',
  };
  const out = helpers.formatMetaLine(event);
  assertStrict.ok(/Musik/.test(out), 'ska innehålla Musik');
  assertStrict.ok(/·/.test(out), 'ska ha ·-separator');
});

test('formatMetaLine: saknar start_time → bara kategori', () => {
  assertStrict.equal(
    helpers.formatMetaLine({ category_slug: 'comedy' }),
    'Standup',
  );
});

test('formatMetaLine: ogiltigt start_time → bara kategori', () => {
  assertStrict.equal(
    helpers.formatMetaLine({ start_time: 'not-a-date', category_slug: 'music' }),
    'Musik',
  );
});

test('formatMetaLine: null event → tom sträng', () => {
  assertStrict.equal(helpers.formatMetaLine(null), '');
});

// --- pickFreeLabel ---------------------------------------------------

test('pickFreeLabel: is_free=true → "Gratis"', () => {
  assertStrict.equal(helpers.pickFreeLabel({ is_free: true }), 'Gratis');
});

test('pickFreeLabel: is_free=false → null', () => {
  assertStrict.equal(helpers.pickFreeLabel({ is_free: false }), null);
});

test('pickFreeLabel: saknar is_free → null', () => {
  assertStrict.equal(helpers.pickFreeLabel({}), null);
});

test('pickFreeLabel: null event → null', () => {
  assertStrict.equal(helpers.pickFreeLabel(null), null);
});

// --- hasRenderableContent --------------------------------------------

test('hasRenderableContent: event med titel → true', () => {
  assertStrict.ok(helpers.hasRenderableContent({ title_sv: 'Något' }));
});

test('hasRenderableContent: event med kategori → true', () => {
  assertStrict.ok(helpers.hasRenderableContent({ category_slug: 'music' }));
});

test('hasRenderableContent: tomt objekt → false', () => {
  assertStrict.equal(helpers.hasRenderableContent({}), false);
});

test('hasRenderableContent: null → false', () => {
  assertStrict.equal(helpers.hasRenderableContent(null), false);
});

test('hasRenderableContent: endast is_free=true räcker inte', () => {
  assertStrict.equal(helpers.hasRenderableContent({ is_free: true }), false);
});

// --- pickImageUrl ------------------------------------------------------

test('pickImageUrl: string-URL returneras', () => {
  assertStrict.equal(
    helpers.pickImageUrl({ image_url: 'https://example.com/img.jpg' }),
    'https://example.com/img.jpg',
  );
});

test('pickImageUrl: tom sträng → null', () => {
  assertStrict.equal(helpers.pickImageUrl({ image_url: '' }), null);
});

test('pickImageUrl: number (lokal asset) → null', () => {
  // require()-nummer är inte en URL, returnera null så anroparen väljer placeholder.
  assertStrict.equal(helpers.pickImageUrl({ image_url: 12345 }), null);
});

test('pickImageUrl: imageSource (preview-konvention) accepteras', () => {
  assertStrict.equal(
    helpers.pickImageUrl({ imageSource: 'https://preview/img.png' }),
    'https://preview/img.png',
  );
});

test('pickImageUrl: object med uri → uri extraheras', () => {
  assertStrict.equal(
    helpers.pickImageUrl({ image_url: { uri: 'https://x.com/a.jpg' } }),
    'https://x.com/a.jpg',
  );
});

test('pickImageUrl: null event → null', () => {
  assertStrict.equal(helpers.pickImageUrl(null), null);
});

test('pickImageUrl: undefined image_url → null', () => {
  assertStrict.equal(helpers.pickImageUrl({}), null);
});