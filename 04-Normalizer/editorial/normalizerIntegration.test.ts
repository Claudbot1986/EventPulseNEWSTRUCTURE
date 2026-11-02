/**
 * 04-Normalizer/editorial/normalizerIntegration.test.ts
 *
 * Regressionstester för normalizer-integrationsfället (2026-11-02).
 *
 * Bakgrund: användaren beslutade att punkt 4 (prosa i stället för faktmall)
 * ska gälla "kommande events enbart" — ingen backfill av de 5 388 faktmalls-
 * raderna. Då måste ett NYTT event alltid få en beskrivning.
 *
 * Före fixen: när LLM-anropet föll (t.ex. MiniMax 429 under nattens körning)
 * skrev `writeEditorialBack` ingenting, så eventet sparades utan
 * `editorial_description` OCH utan `event_profile` — och syntes tomt i appen.
 * Mätt 2026-11-02: 271 av 1 304 events i nattens worker-drain föll på
 * "rate limit exceeded(RPM)".
 *
 * Efter fixen: ett deterministiskt FACT-fallback skrivs i stället. Fallbacken
 * kommer ur profilens egna fält (titel, typ, genre, lokal, datum, tid, pris)
 * och innehåller INGEN källtext — samma upphovsrättslogik som i övrigt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const pipelineMock = vi.fn();

vi.mock('./index', async () => {
  const actual = await vi.importActual<typeof import('./index.js')>('./index.js');
  return {
    ...actual,
    runEditorialPipeline: (...args: unknown[]) => pipelineMock(...args),
  };
});

const { maybeRunEditorial } = await import('./normalizerIntegration.js');

// ─── Hjälpare ────────────────────────────────────────────────────────────────

interface CapturedUpdate {
  table: string;
  payload: Record<string, unknown>;
}

function fakeSupabase(captured: CapturedUpdate[]) {
  return {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          return {
            async eq(_col: string, _val: string) {
              captured.push({ table, payload });
              return { error: null };
            },
          };
        },
      };
    },
  } as never;
}

const RAW_SOURCE_TEXT =
  'Bandet Cola kommer till Sverige för första gången. Support: JJULIUS. Insläpp 20.00. ' +
  'Kanadensiska Cola (medlemmar ur Ought) kommer till Sverige för första gången i höst.';

const EVENT = {
  event_id: 'evt-1',
  title: 'Cola + JJULIUS',
  title_sv: 'Cola + JJULIUS',
  category_slug: 'music',
  venue_name: 'Hus 7',
  city: 'Stockholm',
  start_time: '2026-11-14T20:00:00+01:00',
  end_time: null,
  price_min_sek: 250,
  is_free: false,
  language: 'sv',
  source: 'fb-events-stockholm-apify',
  raw_description: RAW_SOURCE_TEXT,
};

beforeEach(() => {
  pipelineMock.mockReset();
  process.env.EDITORIAL_ENABLED = '1';
});

afterEach(() => {
  delete process.env.EDITORIAL_ENABLED;
  vi.restoreAllMocks();
});

// ─── Tester ──────────────────────────────────────────────────────────────────

describe('maybeRunEditorial — prosa', () => {
  it('skriver LLM-texten när pipelinen passerar', async () => {
    pipelineMock.mockResolvedValue({
      status: 'passed',
      attempts: 0,
      final_text: 'Konsert med Cola och JJULIUS på scenen i Hus 7.',
      draft: {
        text: 'Konsert med Cola och JJULIUS på scenen i Hus 7.',
        word_count: 9,
        info_level: 'MEDIUM',
        meta: { model: 'minimax-M3', prompt_version: 'editorial-writer/v1', generated_at: '2026-11-02T00:00:00Z' },
      },
      factuality: { pass: true, unsupported_claims: [] },
      independence: { pass: true, matched_phrases: [] },
    });

    const captured: CapturedUpdate[] = [];
    await maybeRunEditorial({ supabase: fakeSupabase(captured) }, EVENT);

    expect(captured).toHaveLength(1);
    expect(captured[0].payload.editorial_description).toBe(
      'Konsert med Cola och JJULIUS på scenen i Hus 7.',
    );
    expect(captured[0].payload.editorial_info_level).toBe('MEDIUM');
    expect(captured[0].payload.event_profile).toBeTruthy();
  });
});

describe('maybeRunEditorial — fallback när LLM fallerar', () => {
  it('skriver deterministisk FACT-text när pipelinen kastar (t.ex. 429)', async () => {
    pipelineMock.mockRejectedValue(new Error('MiniMax 429: rate limit exceeded(RPM)'));

    const captured: CapturedUpdate[] = [];
    await maybeRunEditorial({ supabase: fakeSupabase(captured) }, EVENT);

    // FÖRE fixen: captured.length === 0 → eventet sparades tomt.
    expect(captured).toHaveLength(1);
    const text = String(captured[0].payload.editorial_description ?? '');
    expect(text.length).toBeGreaterThan(0);
    expect(captured[0].payload.event_profile).toBeTruthy();
    expect(captured[0].payload.editorial_info_level).toBe('LOW');
    expect(captured[0].payload.editorial_model).toBe('fallback');
  });

  it('skriver deterministisk FACT-text när status är "failed"', async () => {
    pipelineMock.mockResolvedValue({
      status: 'failed',
      attempts: 2,
      final_text: '',
      draft: null,
      factuality: { pass: false, unsupported_claims: ['något'] },
      independence: { pass: false, matched_phrases: [] },
    });

    const captured: CapturedUpdate[] = [];
    await maybeRunEditorial({ supabase: fakeSupabase(captured) }, EVENT);

    expect(captured).toHaveLength(1);
    expect(String(captured[0].payload.editorial_description ?? '').length).toBeGreaterThan(0);
    expect(captured[0].payload.editorial_model).toBe('fallback');
  });

  it('FALLBACKEN INNEHÅLLER INGEN KÄLLTEXT (upphovsrätt)', async () => {
    pipelineMock.mockRejectedValue(new Error('MiniMax 429: rate limit exceeded(RPM)'));

    const captured: CapturedUpdate[] = [];
    await maybeRunEditorial({ supabase: fakeSupabase(captured) }, EVENT);

    const text = String(captured[0].payload.editorial_description ?? '');
    //inga utdrag ur källtexten
    expect(text).not.toContain('Kanadensiska');
    expect(text).not.toContain('medlemmar ur Ought');
    expect(text).not.toContain('Insläpp');
    expect(text).not.toContain('Support');
    // inga navigeringsskräp-token
    expect(text).not.toContain('SÖK PÅ KATEGORI');
    expect(text).not.toMatch(/©/);
    // men den innehåller fakta
    expect(text).toContain('Cola + JJULIUS');
  });

  it('skriver MINIMAL-text när profilen är för tunn för FACT', async () => {
    pipelineMock.mockRejectedValue(new Error('MiniMax 429'));
    const captured: CapturedUpdate[] = [];

    await maybeRunEditorial(
      { supabase: fakeSupabase(captured) },
      {
        ...EVENT,
        // Utan venue, start_time, pris eller kategori -> FACT otillräcklig,
        // men MINIMAL (titel + datum) fungerar fortfarande.
        venue_name: null,
        city: null,
        start_time: null,
        price_min_sek: null,
        is_free: null,
        category_slug: null,
        title: 'X',
      },
    );

    expect(captured).toHaveLength(1);
    expect(String(captured[0].payload.editorial_description ?? '')).toContain('X');
    expect(captured[0].payload.editorial_info_level).toBe('VERY_LOW');
  });

  it('skriver aldrig en TOM beskrivning — en eventrad får aldrig lämnas blank', async () => {
    pipelineMock.mockRejectedValue(new Error('MiniMax 429'));
    const captured: CapturedUpdate[] = [];

    await maybeRunEditorial(
      { supabase: fakeSupabase(captured) },
      {
        ...EVENT,
        title: '',
        title_sv: '',
        venue_name: null,
        city: null,
        start_time: null,
        price_min_sek: null,
        is_free: null,
        category_slug: null,
      },
    );

    // Om en skrivning sker måste den innehålla text — aldrig en tom sträng.
    for (const c of captured) {
      expect(String(c.payload.editorial_description ?? '').trim().length).toBeGreaterThan(0);
    }
    expect(captured.every((c) => String(c.payload.editorial_description ?? '').trim().length > 0)).toBe(true);
  });
});

describe('maybeRunEditorial — flaggan', () => {
  it('kör ingenting när EDITORIAL_ENABLED inte är 1', async () => {
    delete process.env.EDITORIAL_ENABLED;
    const captured: CapturedUpdate[] = [];
    await maybeRunEditorial({ supabase: fakeSupabase(captured) }, EVENT);
    expect(pipelineMock).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });
});
