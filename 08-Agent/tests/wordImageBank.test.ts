/**
 * 08-Agent/tests/wordImageBank.test.ts
 *
 * Tester för ordbanken (image_library.category_slug = 'word').
 *
 * Kedjan som ska hålla:
 *   1. Finns ett ord i titeln som har en ordbild? → använd DEN bilden.
 *   2. Annars → gammal heuristik (cluster/venue/category/default).
 *
 * Run: npx vitest run 08-Agent/tests/wordImageBank.test.ts
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

const fromMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: fromMock,
    rpc: rpcMock,
    auth: { persistSession: false },
  })),
}));

import {
  buildWordFormIndex,
  pickWordImageFromTitle,
  loadWordFormIndex,
  resetWordFormIndexCache,
  type WordLibraryRow,
} from '../utils/wordImageBank';

/** En rad i image_library för en ordbild. */
function wordRow(key: string, forms: string[]): WordLibraryRow {
  return {
    id: `id-${key}`,
    public_url: `https://example.test/event-posters/import-stamped/word/${key}.webp`,
    storage_path: `event-posters/import-stamped/word/${key}.webp`,
    tags: [key, ...forms.slice(1)],
    cluster_tags: forms,
  };
}

describe('buildWordFormIndex', () => {
  test('mappar varje ordform till sin bild', () => {
    const index = buildWordFormIndex([wordRow('bastu', ['bastu', 'bastun'])]);
    expect(index.get('bastu')?.key).toBe('bastu');
    expect(index.get('bastun')?.key).toBe('bastu');
  });

  test('nyckeln är alltid tags[0] — ordet bilden faktiskt visar', () => {
    const index = buildWordFormIndex([wordRow('dambastu', ['dambastu', 'bastu'])]);
    // "bastu" i cluster_tags ska INTE överskugga nyckeln "dambastu".
    expect(index.get('dambastu')?.key).toBe('dambastu');
  });

  test('rad utan tags hoppas över (aldrig krascha)', () => {
    const index = buildWordFormIndex([
      { id: 'x', public_url: 'u', storage_path: 's', tags: null, cluster_tags: ['bastu'] },
    ]);
    expect(index.size).toBe(0);
  });

  test('ordlistan är facit: nyckeln matchar bara om den är en ordform', () => {
    // Bilden för nyckeln "dag" skapades via formen "dagen" — "dag" finns
    // INTE i ordlistan och ska därför inte matcha.
    const index = buildWordFormIndex([wordRow('dag', ['dagen', 'japandag'])]);
    expect(index.get('dagen')?.key).toBe('dag');
    expect(index.get('dag')).toBeUndefined();
  });
});

describe('pickWordImageFromTitle', () => {
  const index = buildWordFormIndex([
    wordRow('bastu', ['bastu', 'bastun']),
    wordRow('dambastu', ['dambastu']),
    wordRow('konsert', ['konsert', 'konserten']),
    wordRow('jul', ['jul', 'julen']),
  ]);

  test('hittar ordet i titeln', () => {
    expect(pickWordImageFromTitle('Bastu i Riksgränsen', index)?.key).toBe('bastu');
  });

  test('ordform matchar samma bild ("Julen är här" → jul)', () => {
    expect(pickWordImageFromTitle('Julen är här', index)?.key).toBe('jul');
  });

  test('längsta ordet vinner ("Dambastu … Bastu" → dambastu)', () => {
    expect(pickWordImageFromTitle('Dambastu lördagmorgon Inre Bastu', index)?.key).toBe('dambastu');
  });

  test('ingen träff → null (kedjan får gå vidare till gammal heuristik)', () => {
    expect(pickWordImageFromTitle('Något helt annat', index)).toBeNull();
  });

  test('tom titel → null', () => {
    expect(pickWordImageFromTitle('', index)).toBeNull();
  });

  test('diakritiska ord matchar ("Språkcafé på svenska")', () => {
    const idx = buildWordFormIndex([wordRow('språkcafé', ['språkcafé'])]);
    expect(pickWordImageFromTitle('Språkcafé på svenska', idx)?.key).toBe('språkcafé');
  });
});

describe('loadWordFormIndex', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
    resetWordFormIndexCache();
  });

  test('läser bara ordraderna (category_slug = word)', async () => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve({ data: [wordRow('bastu', ['bastu'])], error: null })),
    };
    fromMock.mockReturnValue(chain);

    const index = await loadWordFormIndex();
    expect(index.get('bastu')?.key).toBe('bastu');
    expect(fromMock).toHaveBeenCalledWith('image_library');
    expect(chain.eq).toHaveBeenCalledWith('category_slug', 'word');
  });

  test('DB-fel → tomt index (kedjan får INTE brutas)', async () => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
    };
    fromMock.mockReturnValue(chain);

    const index = await loadWordFormIndex();
    expect(index.size).toBe(0);
    expect(pickWordImageFromTitle('Bastu i Riksgränsen', index)).toBeNull();
  });
});
