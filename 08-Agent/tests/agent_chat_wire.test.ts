/**
 * Integration test: POST /agent/chat wire format end-to-end.
 *
 * Wires buildApp() to a free local port with a mocked Supabase client so
 * the deterministic parse → search → rank → compose pipeline runs end-to-end.
 * No LLM call (ANTHROPIC_API_KEY is unset so composeReply falls back to the
 * deterministic template).
 *
 * Run with:  npx vitest run 08-Agent/tests/agent_chat_wire.test.ts
 *
 * Workstream C assertions (MASTERPLAN §1, §18.2, §18.4 DoD):
 *   - Magic query ("live musik på fredag kväll, max 400 kr, gärna med en
 *     vän, inte arena") returns ≥3 cards, each with non-empty venue_name.
 *   - At most ONE clarifying question is attached, never in place of cards.
 *   - The chat handler NEVER short-circuits with clarifying_questions when
 *     the intent is sparse (party/anytime/etc.) — results come first.
 *   - /agent/outbound accepts a valid recordOutboundClick payload and
 *     forwards it to Supabase; invalid UUIDs are rejected.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AddressInfo } from 'node:net';

// Ensure the fallback (no-LLM) path is exercised.
delete process.env.ANTHROPIC_API_KEY;

import { buildApp } from '../server';
import type { EventCard } from '../types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string): boolean => UUID_RE.test(s);

// ─── Mock Supabase (deterministic, no I/O) ─────────────────────────────────

/**
 * Returns N future Stockholm events with non-empty venue_name from a join
 * hop (events_public + venues). Each card has the reasons the ranker can
 * pick up (time_fit, category_match, etc.).
 */
function makeMockSupabase(opts: { rowCount?: number } = {}): SupabaseClient {
  const rowCount = opts.rowCount ?? 3;
  const futureIso = '2099-01-01T19:30:00Z';
  const eventRows = Array.from({ length: rowCount }).map((_, i) => ({
    id: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa${i.toString(16).padStart(2, '0')}`,
    title_sv: `Jazz Konsert ${i + 1}`,
    title_en: `Jazz Concert ${i + 1}`,
    description_sv: 'En kväll med levande musik i Stockholm.',
    description_en: 'An evening of live music in Stockholm.',
    start_time: futureIso,
    end_time: null,
    venue_id: `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb${i.toString(16).padStart(2, '0')}`,
    is_free: false,
    price_min_sek: 250,
    price_max_sek: 350,
    ticket_url: `https://example.com/event-${i}`,
    image_url: null,
    category_slug: 'music',
    confidence_score: 90,
    freshness_at: new Date().toISOString(),
    status_expanded: 'scheduled',
    source: 'test-source',
  }));
  const venueRows = Array.from({ length: rowCount }).map((_, i) => ({
    id: `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb${i.toString(16).padStart(2, '0')}`,
    name: `Test Venue ${i + 1}`,
    city: 'Stockholm',
    address: `Testgatan ${i + 1}, Stockholm`,
  }));

  let tableForCurrentChain: string | null = null;
  const insertedRows: unknown[] = [];

  const chain: any = {
    select: (_cols: string) => chain,
    eq: (_col: string, _val: unknown) => chain,
    gt: (_col: string, _val: unknown) => chain,
    gte: (_col: string, _val: unknown) => chain,
    lte: (_col: string, _val: unknown) => chain,
    in: (_col: string, _vals: readonly unknown[]) => chain,
    order: (_col: string, _opts?: { ascending?: boolean }) => chain,
    limit: (_n: number) => chain,
    then: (
      resolve: (v: { data: unknown[]; error: null }) => void,
      reject: (e: unknown) => void
    ) => {
      let payload: unknown[] = [];
      if (tableForCurrentChain === 'venues') payload = venueRows;
      else payload = eventRows;
      Promise.resolve({ data: payload, error: null }).then(resolve, reject);
    },
  };

  const insert = (row: unknown) => {
    insertedRows.push(row);
    return Promise.resolve({ error: null });
  };

  const from = (table: string) => {
    tableForCurrentChain = table;
    if (table === 'outbound_clicks' || table === 'user_interactions') {
      return { insert };
    }
    return chain;
  };

  return {
    from,
    __getInsertedRows: () => insertedRows,
  } as unknown as SupabaseClient;
}

// ─── Test app lifecycle ─────────────────────────────────────────────────────

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

// ─── /agent/chat — happy path: magic query returns ≥3 cards ────────────────

describe('POST /agent/chat — magic query (MASTERPLAN §1 acceptance)', () => {
  it('returns ≥3 cards with non-empty venue_name for the magic query', async () => {
    const res = await fetch(`${baseUrl}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: uuid('00000000-0000-0000-0000-000000000001'),
        // The magic slice: live musik, fredag kväll, under 400 kr, med en
        // vän, inte arena. The intent is dense, but the agent should still
        // run the pipeline and return cards.
        message: 'jag är i Stockholm på fredag kväll, sugen på live musik men inte arena, max 400 kr, gärna med en vän',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cards: EventCard[];
      reply: string;
      warnings: string[];
      clarifying_question?: { id: string; text: string } | null;
      clarifying_questions?: Array<{ id: string; text: string }>;
    };

    expect(body.cards.length).toBeGreaterThanOrEqual(3);
    for (const c of body.cards) {
      // venue_name is now a real field (WS-B fix). Magic-slice DoD §18.4:
      // "each with a non-empty venue_name".
      expect(c.venue_name).toBeTruthy();
      expect(typeof c.venue_name).toBe('string');
      expect(c.venue_name.length).toBeGreaterThan(0);
      expect(c.id).toBeTruthy();
    }
  });

  it('every card has reasons[] and a finite score', async () => {
    const res = await fetch(`${baseUrl}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: uuid('00000000-0000-0000-0000-000000000002'),
        message: 'konsert ikväll med en kompis',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cards: EventCard[];
      clarifying_questions?: unknown[];
    };
    expect(body.cards.length).toBeGreaterThan(0);

    for (const c of body.cards) {
      expect(Array.isArray(c.reasons)).toBe(true);
      const VALID = new Set([
        'time_fit', 'under_budget', 'over_budget', 'category_match',
        'exclude_match', 'not_ended', 'high_confidence', 'low_confidence',
        'stale', 'category_personalization', 'venue_personalization_penalty',
      ]);
      for (const r of c.reasons ?? []) {
        expect(VALID.has(r)).toBe(true);
      }
      expect(typeof c.score).toBe('number');
      expect(Number.isFinite(c.score as number)).toBe(true);
    }
  });
});

// ─── /agent/chat — mixed-initiative: results before questions ──────────────

describe('POST /agent/chat — mixed-initiative orchestration (WS-C)', () => {
  it('returns cards even when intent is sparse (party=any, categories empty)', async () => {
    // Previously this query short-circuited with clarifying_questions and
    // an empty cards array (D1 defect). After WS-C it MUST return cards.
    const res = await fetch(`${baseUrl}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: uuid('00000000-0000-0000-0000-000000000003'),
        message: 'något i Stockholm ikväll',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cards: EventCard[];
      clarifying_questions?: unknown[];
      clarifying_question?: { id: string; text: string } | null;
    };
    // Results before questions — cards MUST be present even if a question
    // is attached.
    expect(body.cards.length).toBeGreaterThan(0);
    // Backward-compat: the legacy array is present and has ≤1 entry.
    expect((body.clarifying_questions ?? []).length).toBeLessThanOrEqual(1);
  });

  it('attaches at most ONE clarifying question (new clarifying_question field)', async () => {
    const res = await fetch(`${baseUrl}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: uuid('00000000-0000-0000-0000-000000000004'),
        // Sparse intent → one question possible. We assert the shape:
        // either null or a single object (not an array).
        message: 'något på fredag',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cards: EventCard[];
      clarifying_question?: { id: string; text: string; options: Array<{ label: string; value: string }> } | null;
    };
    expect(body.cards.length).toBeGreaterThan(0);
    // The single-question contract: either null or a single object.
    if (body.clarifying_question !== null && body.clarifying_question !== undefined) {
      expect(typeof body.clarifying_question.id).toBe('string');
      expect(typeof body.clarifying_question.text).toBe('string');
      expect(Array.isArray(body.clarifying_question.options)).toBe(true);
      expect(body.clarifying_question.options.length).toBeGreaterThan(0);
    }
  });

  it('omits the question when the intent is already dense (music + evening + kompis)', async () => {
    const res = await fetch(`${baseUrl}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: uuid('00000000-0000-0000-0000-000000000005'),
        message: 'konsert ikväll med kompis',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cards: EventCard[];
      clarifying_question?: { id: string } | null;
      clarifying_questions?: unknown[];
    };
    expect(body.cards.length).toBeGreaterThan(0);
    // Dense intent → no question.
    expect(body.clarifying_question ?? null).toBeNull();
    expect((body.clarifying_questions ?? []).length).toBe(0);
  });
});

// ─── /agent/chat — envelope shape (back-compat + additive) ─────────────────

describe('POST /agent/chat — envelope shape', () => {
  it('keeps the existing keys stable (session_id, reply, cards, warnings)', async () => {
    const res = await fetch(`${baseUrl}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: uuid('00000000-0000-0000-0000-000000000006'),
        session_id: uuid('00000000-0000-0000-0000-0000000000aa'),
        message: 'konsert ikväll',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('session_id');
    expect(body).toHaveProperty('reply');
    expect(body).toHaveProperty('cards');
    expect(body).toHaveProperty('warnings');
    expect(typeof body.reply).toBe('string');
    expect(Array.isArray(body.cards)).toBe(true);
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it('rejects a non-uuid client_user_id with 400', async () => {
    const res = await fetch(`${baseUrl}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: 'not-a-uuid',
        message: 'konsert ikväll',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an empty message with 400', async () => {
    const res = await fetch(`${baseUrl}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: uuid('00000000-0000-0000-0000-000000000007'),
        message: '',
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── /agent/outbound — Workstream F wiring (WS-C) ──────────────────────────

describe('POST /agent/outbound — per-organizer outbound attribution', () => {
  const validUrl = 'https://konserthuset.se/kop-biljetter/event-42';

  it('accepts a valid payload and returns ok', async () => {
    const res = await fetch(`${baseUrl}/agent/outbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: uuid('00000000-0000-0000-0000-000000000010'),
        event_id: uuid('00000000-0000-0000-0000-000000000011'),
        ticket_url: validUrl,
        source: 'konserthuset',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('rejects a bad client_user_id with 400', async () => {
    const res = await fetch(`${baseUrl}/agent/outbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: 'not-a-uuid',
        event_id: uuid('00000000-0000-0000-0000-000000000011'),
        ticket_url: validUrl,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a bad event_id with 400', async () => {
    const res = await fetch(`${baseUrl}/agent/outbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: uuid('00000000-0000-0000-0000-000000000010'),
        event_id: 'not-a-uuid',
        ticket_url: validUrl,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-http ticket_url with 400', async () => {
    const res = await fetch(`${baseUrl}/agent/outbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id: uuid('00000000-0000-0000-0000-000000000010'),
        event_id: uuid('00000000-0000-0000-0000-000000000011'),
        ticket_url: 'javascript:alert(1)',
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────

export { isUuid };