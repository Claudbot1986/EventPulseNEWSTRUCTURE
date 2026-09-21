/**
 * Static mirror of the ENTIRE Home chip universe (2026-09-20), shared by
 * promptIntent.test.ts (intent resolution) and chipSimulation.test.ts
 * (fixture-level survival). Server sources of truth:
 *
 *   - 08-Agent/tools/curated_collections.ts  CATALOG (lines 195–310)
 *   - 08-Agent/tools/get_suggested_prompts.ts TIME_TEMPLATES / WEEKEND_TEMPLATES /
 *     CATEGORY_TEMPLATES / FALLBACK / DEFAULT (lines 76–124, 276–293)
 *
 * The server files import Supabase-coupled modules, so vitest cannot import
 * them directly — keep this mirror in sync when the server catalog changes.
 *
 * `expected` is the EXACT resolvePromptIntent output the chip must produce
 * for its text to stop lying. `null` = field must stay unset.
 */

export interface ExpectedIntent {
  timeFilter: 'ikvall' | 'imorgon' | 'helgen' | null;
  pinnedDow: number | null;
  priceFilter: 'free' | 'under_200' | null;
  categories: string[] | null;
  queryTerms: string[] | null;
  queryLabel: string | null;
  anchor: 'pinned' | 'weekend' | 'today' | null;
}

export interface ChipCase {
  /** curated id or the prompt text itself for suggested chips */
  id: string;
  text: string;
  hints?: {
    category_slug?: string;
    category?: string;
    budget?: string;
    day_filter?: string;
    time_of_day?: string;
  };
  expected: ExpectedIntent;
}

function intent(partial: Partial<ExpectedIntent>): ExpectedIntent {
  return {
    timeFilter: null,
    pinnedDow: null,
    priceFilter: null,
    categories: null,
    queryTerms: null,
    queryLabel: null,
    anchor: null,
    ...partial,
  };
}

/* ---------------- Curated catalog (10 entries, sv + en text) ---------------- */

export const CURATED_CHIPS: ChipCase[] = [
  {
    id: 'klassiskt-ikvall',
    text: 'Klassisk konsert ikväll i Stockholm?',
    hints: { category_slug: 'music', time_of_day: 'evening' },
    expected: intent({ queryTerms: ['klassisk', 'classical'], queryLabel: 'klassisk', timeFilter: 'ikvall', anchor: 'today' }),
  },
  {
    id: 'klassiskt-ikvall (en)',
    text: 'Classical concert tonight in Stockholm?',
    hints: { category_slug: 'music', time_of_day: 'evening' },
    expected: intent({ queryTerms: ['klassisk', 'classical'], queryLabel: 'klassisk', timeFilter: 'ikvall', anchor: 'today' }),
  },
  {
    id: 'jazz-i-stan',
    text: 'Jazz ikväll i Stockholm?',
    hints: { category_slug: 'music', time_of_day: 'evening' },
    expected: intent({ queryTerms: ['jazz'], queryLabel: 'jazz', timeFilter: 'ikvall', anchor: 'today' }),
  },
  {
    id: 'jazz-i-stan (en)',
    text: 'Jazz tonight in Stockholm?',
    hints: { category_slug: 'music', time_of_day: 'evening' },
    expected: intent({ queryTerms: ['jazz'], queryLabel: 'jazz', timeFilter: 'ikvall', anchor: 'today' }),
  },
  {
    id: 'morgonens-lugna-toner',
    text: 'Lugn musik eller frukostevenemang i Stockholm?',
    hints: { category_slug: 'music', time_of_day: 'morning' },
    // Morning = no client time filter; category narrows to music only.
    expected: intent({ categories: ['music'], anchor: 'today' }),
  },
  {
    id: 'gratis-pa-lordag',
    text: 'Gratis evenemang i Stockholm på lördag?',
    hints: { budget: 'free', day_filter: 'saturday' },
    expected: intent({ priceFilter: 'free', pinnedDow: 6, anchor: 'pinned' }),
  },
  {
    id: 'gratis-pa-lordag (en)',
    text: 'Free events in Stockholm on Saturday?',
    hints: { budget: 'free', day_filter: 'saturday' },
    expected: intent({ priceFilter: 'free', pinnedDow: 6, anchor: 'pinned' }),
  },
  {
    id: 'gratis-pa-sondag',
    text: 'Gratis evenemang i Stockholm på söndag?',
    hints: { budget: 'free', day_filter: 'sunday' },
    expected: intent({ priceFilter: 'free', pinnedDow: 0, anchor: 'pinned' }),
  },
  {
    id: 'gratis-i-helgen',
    text: 'Gratis evenemang i Stockholm i helgen?',
    hints: { budget: 'free', day_filter: 'weekend' },
    expected: intent({ priceFilter: 'free', timeFilter: 'helgen', anchor: 'weekend' }),
  },
  {
    id: 'konsert-under-200',
    text: 'Konserter i Stockholm under 200 kronor?',
    hints: { category_slug: 'music', budget: 'low' },
    expected: intent({ categories: ['music'], priceFilter: 'under_200', anchor: 'today' }),
  },
  {
    id: 'metal-under-200',
    text: 'Metal- eller hårdrockskonserter i Stockholm under 200 kronor?',
    hints: { category_slug: 'music', budget: 'low' },
    expected: intent({ queryTerms: ['metal', 'hardrock', 'hard rock'], queryLabel: 'metal', priceFilter: 'under_200', anchor: 'today' }),
  },
  {
    id: 'metal-under-200 (en)',
    text: 'Metal or hard rock concerts in Stockholm under 200 kronor?',
    hints: { category_slug: 'music', budget: 'low' },
    expected: intent({ queryTerms: ['metal', 'hardrock', 'hard rock'], queryLabel: 'metal', priceFilter: 'under_200', anchor: 'today' }),
  },
  {
    id: 'barnens-helg',
    text: 'Familjevänliga evenemang i Stockholm i helgen?',
    hints: { category_slug: 'family', day_filter: 'weekend' },
    expected: intent({ categories: ['barn'], timeFilter: 'helgen', anchor: 'weekend' }),
  },
  {
    id: 'utstallningar-i-helgen',
    text: 'Utställningar i Stockholm öppna i helgen?',
    hints: { category_slug: 'art', day_filter: 'weekend' },
    expected: intent({ categories: ['culture'], timeFilter: 'helgen', anchor: 'weekend' }),
  },
  {
    id: 'utstallningar-i-helgen (en)',
    text: 'Exhibitions in Stockholm open this weekend?',
    hints: { category_slug: 'art', day_filter: 'weekend' },
    expected: intent({ categories: ['culture'], timeFilter: 'helgen', anchor: 'weekend' }),
  },
];

/* ------------- Suggested prompts (every template across all slots) ---------- */

export const SUGGESTED_CHIPS: ChipCase[] = [
  // TIME_TEMPLATES
  { id: 'Något intressant i dag?', text: 'Något intressant i dag?', expected: intent({ timeFilter: 'ikvall', anchor: 'today' }) },
  { id: 'Konserter i Stockholm i helgen?', text: 'Konserter i Stockholm i helgen?', hints: { category: 'konserter' }, expected: intent({ categories: ['music'], timeFilter: 'helgen', anchor: 'weekend' }) },
  { id: 'Vad ska jag göra ikväll?', text: 'Vad ska jag göra ikväll?', expected: intent({ timeFilter: 'ikvall', anchor: 'today' }) },
  { id: 'Gratis events i helgen?', text: 'Gratis events i helgen?', expected: intent({ priceFilter: 'free', timeFilter: 'helgen', anchor: 'weekend' }) },
  { id: 'Konsert ikväll i Stockholm?', text: 'Konsert ikväll i Stockholm?', hints: { category: 'konserter' }, expected: intent({ categories: ['music'], timeFilter: 'ikvall', anchor: 'today' }) },
  { id: 'Något gratis ikväll?', text: 'Något gratis ikväll?', expected: intent({ priceFilter: 'free', timeFilter: 'ikvall', anchor: 'today' }) },
  { id: 'Vad händer i helgen?', text: 'Vad händer i helgen?', expected: intent({ timeFilter: 'helgen', anchor: 'weekend' }) },
  { id: 'Planera för i morgon', text: 'Planera för i morgon', expected: intent({ timeFilter: 'imorgon', anchor: 'today' }) },

  // WEEKEND_TEMPLATES
  { id: 'Konserter i helgen i Stockholm?', text: 'Konserter i helgen i Stockholm?', hints: { category: 'konserter' }, expected: intent({ categories: ['music'], timeFilter: 'helgen', anchor: 'weekend' }) },
  { id: 'Utställningar i helgen?', text: 'Utställningar i helgen?', hints: { category: 'utställningar' }, expected: intent({ categories: ['culture'], timeFilter: 'helgen', anchor: 'weekend' }) },
  { id: 'Något för barnen i helgen?', text: 'Något för barnen i helgen?', hints: { category: 'barn-familj' }, expected: intent({ categories: ['barn'], timeFilter: 'helgen', anchor: 'weekend' }) },
  { id: 'Gratis i helgen i Stockholm?', text: 'Gratis i helgen i Stockholm?', expected: intent({ priceFilter: 'free', timeFilter: 'helgen', anchor: 'weekend' }) },
  { id: 'Sport i helgen?', text: 'Sport i helgen?', hints: { category: 'sport' }, expected: intent({ categories: ['sports'], timeFilter: 'helgen', anchor: 'weekend' }) },

  // CATEGORY_TEMPLATES
  // 'Lådbordskonserter?' compounds around 'konserter' so pure text matching
  // CANNOT find it — only the structured category hint saves this chip.
  { id: 'Konserter i Stockholm?', text: 'Konserter i Stockholm?', hints: { category: 'konserter' }, expected: intent({ categories: ['music'], anchor: 'today' }) },
  { id: 'Lådbordskonserter?', text: 'Lådbordskonserter?', hints: { category: 'konserter' }, expected: intent({ categories: ['music'], anchor: 'today' }) },
  { id: 'Jazz i Stockholm?', text: 'Jazz i Stockholm?', hints: { category: 'jazz' }, expected: intent({ queryTerms: ['jazz'], queryLabel: 'jazz', anchor: 'today' }) },
  { id: 'Utställningar i Stockholm just nu?', text: 'Utställningar i Stockholm just nu?', hints: { category: 'utställningar' }, expected: intent({ categories: ['culture'], anchor: 'today' }) },
  { id: 'Gratis utställningar?', text: 'Gratis utställningar?', hints: { category: 'utställningar' }, expected: intent({ categories: ['culture'], priceFilter: 'free', anchor: 'today' }) },
  { id: 'Sport i Stockholm i helgen?', text: 'Sport i Stockholm i helgen?', hints: { category: 'sport' }, expected: intent({ categories: ['sports'], timeFilter: 'helgen', anchor: 'weekend' }) },
  { id: 'Fotbollsmatcher i Stockholm?', text: 'Fotbollsmatcher i Stockholm?', hints: { category: 'sport' }, expected: intent({ categories: ['sports'], anchor: 'today' }) },
  { id: 'Barnvänliga events i helgen?', text: 'Barnvänliga events i helgen?', hints: { category: 'barn-familj' }, expected: intent({ categories: ['barn'], timeFilter: 'helgen', anchor: 'weekend' }) },
  { id: 'Något för hela familjen?', text: 'Något för hela familjen?', hints: { category: 'barn-familj' }, expected: intent({ categories: ['barn'], anchor: 'today' }) },

  // FOLLOW (artist chips) — text carries 'Konserter med <artist>?'
  { id: 'Konserter med Tommy Nilsson?', text: 'Konserter med Tommy Nilsson?', expected: intent({ categories: ['music'], anchor: 'today' }) },

  // FALLBACK / DEFAULT
  { id: 'Gratis events i Stockholm?', text: 'Gratis events i Stockholm?', expected: intent({ priceFilter: 'free', anchor: 'today' }) },
];

/* ---------------- Negative cases — these MUST NOT filter anything --------- */

export const NON_CHIPS: ChipCase[] = [
  { id: 'Vad händer i stan?', text: 'Vad händer i stan?', expected: intent({}) },
  { id: 'Något kul på torsdag?', text: 'Något kul på torsdag?', expected: intent({}) }, // weekday not in the conservative tables
  { id: 'Visa allt', text: 'Visa allt', expected: intent({}) },
  // 'freestyle' contains 'free' but must NOT trigger the gratis filter:
  { id: 'freestyle-fest i helgen', text: 'Freestyle-fest i helgen', expected: intent({ timeFilter: 'helgen', anchor: 'weekend' }) },
  // 'gratisbiljetter' is one word — must not trigger gratis either:
  { id: 'gratisbiljetter-sajt', text: 'Hitta gratisbiljetter online', expected: intent({}) },
];

export const ALL_CHIP_CASES: ChipCase[] = [...CURATED_CHIPS, ...SUGGESTED_CHIPS, ...NON_CHIPS];
