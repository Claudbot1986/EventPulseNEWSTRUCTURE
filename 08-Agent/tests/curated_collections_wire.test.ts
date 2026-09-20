/**
 * Integration test: GET /agent/curated-collections locale widening
 * (Språkstöd 2026-09-20).
 *
 * Verifies the route-level contract the 10-language client relies on:
 *   - No locale param → 200, defaults to 'sv' (back-compat).
 *   - Every supported locale → 200, echoed back on each collection.
 *   - Unknown/unsupported locale → 200 with 'en' fallback — never 400.
 *   - Non-'sv' locales render the English copy (only sv/en texts exist).
 *
 * Run with: npx vitest run 08-Agent/tests/curated_collections_wire.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../server';
import { SUPPORTED_CURATED_LOCALES } from '../tools/curated_collections';

// The curated route is public (generalLimiter only, no requireUser), but
// buildApp expects a verifier — a never-matching one is fine here.
const testVerify = async (_token: string) => null;

function makeMockSupabase(): SupabaseClient {
  const futureIso = '2099-01-01T19:30:00Z';
  const eventRows = [
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
      title_sv: 'Konsert 1',
      title_en: 'Concert 1',
      description_sv: 'Musik i Stockholm.',
      description_en: 'Live music in Stockholm.',
      start_time: futureIso,
      end_time: null,
      venue_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01',
      is_free: false,
      price_min_sek: 200,
      price_max_sek: 300,
      ticket_url: 'https://example.com/event-1',
      image_url: null,
      image_license: null,
      image_attribution: null,
      image_source_url: null,
      category_slug: 'music',
      confidence_score: 85,
      freshness_at: new Date().toISOString(),
      status_expanded: 'scheduled',
      source: 'test',
    },
  ];

  let tableForCurrentChain: string | null = null;

  const chain: any = {
    select: (_cols: string) => chain,
    eq: (_col: string, _val: unknown) => chain,
    gt: (_col: string, _val: unknown) => chain,
    gte: (_col: string, _val: unknown) => chain,
    lte: (_col: string, _val: unknown) => chain,
    in: (_col: string, _vals: readonly unknown[]) => chain,
    order: (_col: string, _opts?: { ascending?: boolean }) => chain,
    limit: (_n: number) => chain,
    single: () =>
      new Promise<{ data: unknown; error: null }>((res) => {
        res({ data: tableForCurrentChain === 'events' ? eventRows[0] : null, error: null });
      }),
    maybeSingle: () =>
      new Promise<{ data: unknown; error: null }>((res) => {
        res({ data: tableForCurrentChain === 'events' ? eventRows[0] : null, error: null });
      }),
    then: (
      resolve: (v: { data: unknown[]; error: null }) => void,
      _reject: (e: unknown) => void,
    ) => {
      const payload = tableForCurrentChain === 'events' ? eventRows : [];
      // NOTE: must CALL resolve — returning Promise.resolve here is a
      // Promise/A+ anti-pattern that hangs await (verified empirically).
      resolve({ data: payload, error: null });
    },
  };

  const from = (table: string) => {
    tableForCurrentChain = table;
    return chain;
  };

  return { from } as unknown as SupabaseClient;
}

let baseUrl = '';
let server: ReturnType<ReturnType<typeof buildApp>['listen']> | undefined;

beforeAll(async () => {
  const app = buildApp({ supabase: makeMockSupabase(), verify: testVerify });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

interface CuratedWireCollection {
  id: string;
  name: string;
  prompt_text: string;
  locale: string;
}

async function getCollections(query = ''): Promise<{
  status: number;
  collections: CuratedWireCollection[];
}> {
  const res = await fetch(`${baseUrl}/agent/curated-collections${query}`);
  const body = (await res.json()) as { collections?: CuratedWireCollection[] };
  return { status: res.status, collections: body.collections ?? [] };
}

describe('GET /agent/curated-collections locale widening', () => {
  it('defaults to sv when no locale param is given (back-compat)', async () => {
    const { status, collections } = await getCollections();
    expect(status).toBe(200);
    expect(collections.length).toBeGreaterThanOrEqual(2);
    for (const c of collections) {
      expect(c.locale).toBe('sv');
    }
  });

  it.each([...SUPPORTED_CURATED_LOCALES])(
    'accepts supported locale %s with 200 and echoes it back',
    async (locale) => {
      const { status, collections } = await getCollections(
        `?locale=${encodeURIComponent(locale)}`,
      );
      expect(status).toBe(200);
      expect(collections.length).toBeGreaterThanOrEqual(2);
      for (const c of collections) {
        expect(c.locale).toBe(locale);
      }
    },
  );

  it('renders English copy for a supported non-sv locale (de)', async () => {
    const { status, collections } = await getCollections('?locale=de');
    expect(status).toBe(200);
    for (const c of collections) {
      expect(c.prompt_text).not.toContain('ikväll');
      expect(c.prompt_text).not.toContain('Gratis');
    }
  });

  it.each(['xx', 'pt-BR', 'sv-SE-extended'])(
    'falls back to en (never 400) for unsupported locale %s',
    async (locale) => {
      const { status, collections } = await getCollections(
        `?locale=${encodeURIComponent(locale)}`,
      );
      expect(status).toBe(200);
      expect(collections.length).toBeGreaterThanOrEqual(2);
      for (const c of collections) {
        expect(c.locale).toBe('en');
        expect(c.prompt_text).not.toContain('ikväll');
      }
    },
  );
});
