/**
 * Integration test: POST /agent/chat returns cards with reasons[] populated
 * and score as a number.
 *
 * Wires buildApp() to a free local port with a mocked Supabase client so
 * the deterministic parse → search → rank → compose pipeline runs end-to-end.
 * No LLM call (ANTHROPIC_API_KEY is unset so composeReply falls back to the
 * deterministic template).
 *
 * Run with:  npx vitest run 08-Agent/tests/agent_chat_wire.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AddressInfo } from 'node:net';

// Ensure the fallback (no-LLM) path is exercised.
delete process.env.ANTHROPIC_API_KEY;

import { buildApp } from '../server';
import type { EventCard } from '../types';

// Mock supabase that returns a fixed Stockholm event row from events_public.
function makeMockSupabase(): SupabaseClient {
  const futureIso = '2099-01-01T19:30:00Z';
  const eventRow = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    title_sv: 'Jazz Konsert',
    title_en: 'Jazz Concert',
    start_time: futureIso,
    end_time: null,
    venue_id: null,
    is_free: false,
    price_min_sek: 150,
    price_max_sek: 250,
    ticket_url: 'https://example.com',
    image_url: null,
    category_slug: 'music',
    confidence_score: 90,
    freshness_at: new Date().toISOString(),
    status_expanded: 'scheduled',
  };

  const chain: any = {
    select: () => chain,
    eq: () => chain,
    gt: () => chain,
    gte: () => chain,
    lte: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: any, reject: any) =>
      Promise.resolve({ data: [eventRow], error: null }).then(resolve, reject),
  };

  const insert = (_row: unknown) => Promise.resolve({ error: null });

  return {
    from: (table: string) => {
      if (table === 'user_interactions') {
        return { insert };
      }
      return chain;
    },
  } as unknown as SupabaseClient;
}

let baseUrl = '';
let server: ReturnType<ReturnType<typeof buildApp>['listen']> | undefined;

beforeAll(async () => {
  const app = buildApp({ supabase: makeMockSupabase() });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

const uuid = (s: string) => s;

describe('POST /agent/chat wire format — reasons[] + score', () => {
  it('returns cards with reasons[] populated and score as a number', async () => {
    const res = await fetch(`${baseUrl}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: uuid('00000000-0000-0000-0000-000000000001'),
        // "konsert ikväll med en kompis" fills all 3 critical slots
        // (category=music, time_of_day=evening, party=friends) so the
        // cold-start gate does NOT short-circuit with clarifying_questions.
        message: 'konsert ikväll med en kompis',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cards: EventCard[]; reply: string; warnings: string[]; clarifying_questions?: unknown[] };
    expect(body.clarifying_questions ?? []).toEqual([]);
    expect(body.cards.length).toBeGreaterThan(0);

    for (const c of body.cards) {
      expect(c.id).toBeTruthy();
      // reasons must be present and an array of valid RankReason enum members.
      expect(Array.isArray(c.reasons)).toBe(true);
      const VALID = new Set([
        'time_fit', 'under_budget', 'over_budget', 'category_match',
        'exclude_match', 'not_ended', 'high_confidence', 'low_confidence', 'stale',
      ]);
      for (const r of c.reasons ?? []) {
        expect(VALID.has(r)).toBe(true);
      }
      // score must be a finite number (ranker output).
      expect(typeof c.score).toBe('number');
      expect(Number.isFinite(c.score as number)).toBe(true);
    }
  });

  it('includes category_match + time_fit for a music+evening query', async () => {
    const res = await fetch(`${baseUrl}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: uuid('00000000-0000-0000-0000-000000000001'),
        message: 'konsert ikväll med kompis',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cards: EventCard[]; clarifying_questions?: unknown[] };
    expect(body.clarifying_questions ?? []).toEqual([]);
    expect(body.cards.length).toBeGreaterThan(0);
    const top = body.cards[0];
    expect(top.reasons).toContain('category_match');
    expect(top.reasons).toContain('time_fit');
    expect(top.reasons).toContain('not_ended');
    // top-1 score must be > 0 for a perfect-fit card.
    expect(top.score).toBeGreaterThan(0);
  });
});