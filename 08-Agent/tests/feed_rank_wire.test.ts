/**
 * Integration test: GET /agent/feed taste ranking (Fas C, 2026-09-23 plan).
 *
 * Verifies the four ranking-gate combinations on the wire:
 *   - Anonymous caller → 200, chronological order, zero personalization reads
 *   - Valid Bearer + PERSONALIZATION_PRIORS treatment variant → the page is
 *     re-ranked by the user's save signals (category_personalization boost),
 *     cards carry `reasons` + `score`, and the extended ranker fields
 *     (description, artist_slugs hop) reach the wire
 *   - Invalid Bearer → treated as anonymous (never 401), chronological
 *   - Valid Bearer + control variant → chronological, zero signal reads
 *   - Treatment variant with cold history → chronological, no crash
 *   - Fas C.4: treatment user whose feed slot 0 is reserved for exploration
 *     keeps the chronological card at slot 0 (no reasons/score) even with a
 *     rich taste history — the reserve beats the ranker.
 *   - Fas D: ?mood=stamningsfullt filters the window with the static mood
 *     lexicon (title/description terms + category anchors) BEFORE any
 *     ranking — guests included, since it is a content filter, not
 *     personalization.
 *
 * Variant assignment is deterministic per user id (SHA-256, experiments.ts),
 * so the test scans for fixed UUIDs that hash to each variant up front. The
 * exploration reserve is deterministic per (user, window, slot) the same way
 * (tools/explore_reserve.ts), so a reserve user is scanned the same way.
 *
 * Run with: npx vitest run 08-Agent/tests/feed_rank_wire.test.ts
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../server';
import { assignVariant } from '../tools/experiments';
import { isReservedSlot } from '../tools/explore_reserve';

/** Must match server.ts PERSONALIZATION_PRIORS_EXP. */
const EXPERIMENT_ID = 'PERSONALIZATION_PRIORS';

/**
 * Scan sequential UUIDs until `count` distinct ids hash to the wanted
 * variant. Deterministic: the salt is fixed, so the same ids come out on
 * every run — no flakiness, no runtime env dependency.
 */
function findVariantUsers(count: number, variant: 'control' | 'treatment'): string[] {
  const found: string[] = [];
  for (let i = 0; found.length < count && i < 50_000; i++) {
    const id = `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, '0')}`;
    if (assignVariant(id, EXPERIMENT_ID) === variant) found.push(id);
  }
  if (found.length < count) {
    throw new Error(`could not find ${count} ${variant} users`);
  }
  return found;
}

// Two users per variant: personalize.ts/follow_entity.ts keep module-level
// per-user caches, so each test uses a fresh id to avoid cross-test staleness.
// 4 treatment users: 3 ranking tests + 1 for the Fas D mood test.
const TREATMENT_USERS = findVariantUsers(4, 'treatment');
const CONTROL_USERS = findVariantUsers(2, 'control');

/**
 * Fas C.4: scan for a treatment user whose feed slot 0 is reserved for
 * exploration on the test window (2099-01-01) but whose slot 1 is NOT — so
 * the 2-card fixture page demonstrates the merge exactly: one reserved
 * chronological card + one ranked card. Distinct from the fixed users above
 * (fresh id → no cache staleness). Deterministic for the same reason.
 */
function findReserveSlot0User(): string {
  const used = new Set([...TREATMENT_USERS, ...CONTROL_USERS]);
  for (let i = 0; i < 50_000; i++) {
    const id = `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, '0')}`;
    if (assignVariant(id, EXPERIMENT_ID) !== 'treatment') continue;
    if (used.has(id)) continue;
    if (isReservedSlot(id, '2099-01-01', 0) && !isReservedSlot(id, '2099-01-01', 1)) {
      return id;
    }
  }
  throw new Error('could not find a slot-0-reserve treatment user');
}
const RESERVE_USER = findReserveSlot0User();

// ─── Fixtures ───────────────────────────────────────────────────────────────

const NOW_ISO = new Date().toISOString();

/** Music event — earlier start_time, so pure chronology puts it first. */
const musicRow = {
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  title_sv: 'Konsert',
  title_en: 'Concert',
  description_sv: 'Musik i Stockholm.',
  description_en: 'Live music in Stockholm.',
  start_time: '2099-01-01T19:00:00Z',
  end_time: null,
  venue_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  category_slug: 'music',
  is_free: false,
  price_min_sek: 100,
  price_max_sek: 200,
  ticket_url: null,
  image_url: null,
  image_license: null,
  image_attribution: null,
  image_source_url: null,
  image_ai_generated: false,
  image_ai_optout: false,
  image_generation_status: null,
  source: 'test',
  confidence_score: 85,
  freshness_at: NOW_ISO,
  lat: null,
  lng: null,
  venues: { name: 'Scen X', city: 'Stockholm' },
};

/** Theatre event — later start_time; a theatre-loving user must see it first. */
const theatreRow = {
  ...musicRow,
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  title_sv: 'Teaterföreställning',
  title_en: 'Theatre Play',
  description_sv: 'En pjäs på scenen.',
  description_en: 'A play on stage.',
  start_time: '2099-01-02T19:00:00Z',
  category_slug: 'theatre',
};

/** events_public returns start_time ASC — music first in both fixtures. */
const chronologicalEvents = [musicRow, theatreRow];

/**
 * Five decay-weighted theatre saves. Future created_at → recencyDecay 1.0,
 * so totalSaves = 5 ≥ MIN_SAVES(5) and the category boost gate trips.
 */
const theatreSaves = Array.from({ length: 5 }, () => ({
  interaction: 'save',
  created_at: '2099-01-01T12:00:00Z',
  events: { category_slug: 'theatre', venue_name: 'Scen X' },
}));

/**
 * Fas C.3 (2026-09-23): three fresh ticket-page clicks on theatre events.
 * Future created_at → recencyDecay 1.0 → totalOutbounds=3 ≥ MIN_OUTBOUNDS(3),
 * so the outbound_personalization boost gate trips and the reason must ride
 * the wire on the boosted theatre card.
 */
const theatreOutbounds = Array.from({ length: 3 }, () => ({
  interaction: 'outbound',
  created_at: '2099-01-01T12:00:00Z',
  events: { category_slug: 'theatre', venue_name: 'Scen X' },
}));

/**
 * Fas D (2026-09-23): atmospheric theatre event — matches the stamningsfullt
 * mood lexicon via its TITLE ("Stämningsfull…"), no category anchor needed.
 * musicRow/theatreRow deliberately match no mood term (their copy is plain).
 */
const moodRow = {
  ...musicRow,
  id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  title_sv: 'Stämningsfull teaterkväll',
  title_en: 'Atmospheric theatre evening',
  description_sv: 'En pjäs i skymningen.',
  description_en: 'A play at twilight.',
  start_time: '2099-01-03T19:00:00Z',
  category_slug: 'theatre',
};

// ─── Mock Supabase ──────────────────────────────────────────────────────────

interface FeedMockOptions {
  eventRows?: any[];
  interactionRows?: any[];
  artistRows?: any[];
  /** Tables that must make the read fail (chain rejects). */
  failTables?: string[];
}

function makeChain(value: unknown): any {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    gt: () => chain,
    gte: () => chain,
    lte: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
  };
  // Anti-pattern guard: then must CALL the awaiting resolver (see
  // recommended_wire.test.ts) — and pass it THIS chain's payload.
  chain.then = (res: (v: unknown) => void) => res(value);
  chain.single = () => Promise.resolve({ data: null, error: null });
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  return chain;
}

function makeFeedMockSupabase(opts: FeedMockOptions = {}) {
  const eventRows = opts.eventRows ?? chronologicalEvents;
  const interactionRows = opts.interactionRows ?? [];
  const artistRows = opts.artistRows ?? [];
  const failTables = new Set(opts.failTables ?? []);

  let eventsPublicCalls = 0;
  const tablesCalled: string[] = [];

  const from = (table: string): any => {
    tablesCalled.push(table);
    if (failTables.has(table)) {
      // Error payload (not a throw) — tools that collapse errors to cold
      // data must see this as a failed read.
      return makeChain({ data: null, count: null, error: { message: `mock ${table} error` } });
    }
    if (table === 'events_public') {
      eventsPublicCalls += 1;
      if (eventsPublicCalls % 2 === 1) {
        // Data page query.
        return makeChain({ data: eventRows, error: null });
      }
      // Canonical count query (head: true).
      return makeChain({ data: null, count: eventRows.length, error: null });
    }
    if (table === 'user_interactions') {
      return makeChain({ data: interactionRows, error: null });
    }
    if (table === 'event_artists') {
      return makeChain({ data: artistRows, error: null });
    }
    if (table === 'user_signal_weights') {
      return makeChain({ data: [], error: null });
    }
    // user_preferences, event_translations and everything else: empty read.
    return makeChain({ data: [], error: null });
  };

  return {
    client: { from } as unknown as SupabaseClient,
    tablesCalled,
  };
}

/** Start an app on an ephemeral port, run the request, shut down. */
async function requestFeed(
  mock: ReturnType<typeof makeFeedMockSupabase>,
  opts: { bearer?: string | null; mood?: string | null } = {}
): Promise<{ status: number; body: any }> {
  const app = buildApp({ supabase: mock.client, verify: testVerify });
  const server = await new Promise<ReturnType<ReturnType<typeof buildApp>['listen']>>(
    (resolve, reject) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
      s.on('error', reject);
    }
  );
  const addr = server.address() as AddressInfo;
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  const moodParam = opts.mood ? `&mood=${encodeURIComponent(opts.mood)}` : '';
  try {
    const res = await fetch(
      `http://127.0.0.1:${addr.port}/agent/feed?from=2099-01-01&days=7${moodParam}`,
      { headers }
    );
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

/** Maps bearer tokens to the fixed variant-scanned users; unknown → null. */
const testVerify = async (token: string) => {
  const all = [
    ...TREATMENT_USERS.map((id) => ({ token: `t:${id}`, id })),
    ...CONTROL_USERS.map((id) => ({ token: `c:${id}`, id })),
    { token: `t:${RESERVE_USER}`, id: RESERVE_USER },
  ];
  const hit = all.find((x) => x.token === token);
  return hit ? { id: hit.id, email: 'test@example.com' } : null;
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET /agent/feed — Fas C taste ranking', () => {
  it('anonymous caller gets chronological order with zero personalization reads', async () => {
    const mock = makeFeedMockSupabase();
    const { status, body } = await requestFeed(mock);
    expect(status).toBe(200);
    expect(body.events.map((e: any) => e.id)).toEqual([
      musicRow.id,
      theatreRow.id,
    ]);
    expect(mock.tablesCalled).not.toContain('user_interactions');
    expect(mock.tablesCalled).not.toContain('user_preferences');
    expect(mock.tablesCalled).not.toContain('event_artists');
    // Window contract unchanged.
    expect(body.from).toBe('2099-01-01');
    expect(body.to).toBe('2099-01-08');
    expect(body.next_from).toBe('2099-01-08');
    expect(body.has_more).toBe(false);
    expect(body.total).toBe(2);
  });

  it('treatment variant with 5 theatre saves + 3 ticket clicks sees theatre ranked first with both reasons', async () => {
    const mock = makeFeedMockSupabase({ interactionRows: [...theatreSaves, ...theatreOutbounds] });
    const { status, body } = await requestFeed(mock, {
      bearer: `t:${TREATMENT_USERS[0]}`,
    });
    expect(status).toBe(200);
    expect(body.events.map((e: any) => e.id)).toEqual([
      theatreRow.id,
      musicRow.id,
    ]);
    const theatre = body.events[0];
    expect(theatre.reasons).toContain('category_personalization');
    // Fas C.3: the ticket clicks add the outbound prior on the same card —
    // proof the server pipeline carries outbound rows end-to-end to the wire.
    expect(theatre.reasons).toContain('outbound_personalization');
    expect(typeof theatre.score).toBe('number');
    // Extended ranker fields reach the wire (Fas C select extension).
    expect(theatre.description).toBe('En pjäs på scenen.');
    // Treatment fetches the artist hop for followed-artist boosts.
    expect(mock.tablesCalled).toContain('event_artists');
    // Window contract still intact after ranking.
    expect(body.total).toBe(2);
    expect(body.has_more).toBe(false);
    expect(body.next_from).toBe('2099-01-08');
  });

  it('invalid Bearer token is treated as anonymous — 200, chronological, no signal reads', async () => {
    const mock = makeFeedMockSupabase({ interactionRows: theatreSaves });
    const { status, body } = await requestFeed(mock, { bearer: 'garbage-token' });
    expect(status).toBe(200);
    expect(body.events.map((e: any) => e.id)).toEqual([
      musicRow.id,
      theatreRow.id,
    ]);
    expect(mock.tablesCalled).not.toContain('user_interactions');
  });

  it('control variant gets chronological order even with a rich signal history', async () => {
    const mock = makeFeedMockSupabase({ interactionRows: theatreSaves });
    const { status, body } = await requestFeed(mock, {
      bearer: `c:${CONTROL_USERS[0]}`,
    });
    expect(status).toBe(200);
    expect(body.events.map((e: any) => e.id)).toEqual([
      musicRow.id,
      theatreRow.id,
    ]);
    // Isolation: control must not even read the signal tables.
    expect(mock.tablesCalled).not.toContain('user_interactions');
    expect(mock.tablesCalled).not.toContain('event_artists');
  });

  it('treatment variant with cold history gets chronological order without crashing', async () => {
    const mock = makeFeedMockSupabase({ interactionRows: [] });
    const { status, body } = await requestFeed(mock, {
      bearer: `t:${TREATMENT_USERS[1]}`,
    });
    expect(status).toBe(200);
    expect(body.events.map((e: any) => e.id)).toEqual([
      musicRow.id,
      theatreRow.id,
    ]);
  });

  it('treatment variant survives a personalization read failure and falls back to chronology', async () => {
    const mock = makeFeedMockSupabase({
      interactionRows: theatreSaves,
      failTables: ['user_interactions'],
    });
    const { status, body } = await requestFeed(mock, {
      bearer: `t:${TREATMENT_USERS[2]}`,
    });
    // buildUserSignal swallows read errors into a cold signal — the feed
    // must never break because personalization is unavailable.
    expect(status).toBe(200);
    expect(body.events.map((e: any) => e.id)).toEqual([
      musicRow.id,
      theatreRow.id,
    ]);
  });
});

describe('GET /agent/feed — Fas C.4 utforskningsreserv', () => {
  it('the fixed variant users above have no reserved slots on the test window (preflight)', () => {
    // If EXPLORE_RESERVE_SALT or the fraction is ever rotated, the reserve
    // pattern may land on the fixed test users and silently change what the
    // ranking tests above prove. This guard fails first, with a clear name.
    for (const id of [...TREATMENT_USERS, ...CONTROL_USERS]) {
      expect(isReservedSlot(id, '2099-01-01', 0)).toBe(false);
      expect(isReservedSlot(id, '2099-01-01', 1)).toBe(false);
    }
  });

  it('a reserved slot keeps its chronological card even with a rich taste history', async () => {
    // RESERVE_USER: treatment variant, feed slot 0 reserved on 2099-01-01.
    // Same rich theatre history as the ranking test — but the reserve wins:
    // slot 0 keeps the chronological music card, stripped of all ranker
    // metadata (no reasons/score → the UI shows no taste chips there).
    const mock = makeFeedMockSupabase({
      interactionRows: [...theatreSaves, ...theatreOutbounds],
    });
    const { status, body } = await requestFeed(mock, {
      bearer: `t:${RESERVE_USER}`,
    });
    expect(status).toBe(200);
    expect(body.events.map((e: any) => e.id)).toEqual([
      musicRow.id,   // reserved slot 0: chronological, reserve beats ranker
      theatreRow.id, // non-reserved slot 1: ranked queue's #1
    ]);
    const music = body.events[0];
    // No ranker metadata on the reserved card — the same wire shape as an
    // anonymous card (the client mapper defaults missing reasons to []).
    expect(music.reasons).toBeUndefined();
    expect(music.score).toBeUndefined();
    // The non-reserved slot still carries the full taste ranking — the
    // reserve carves out exploration slots, it does not disable ranking.
    const theatre = body.events[1];
    expect(theatre.reasons).toContain('category_personalization');
    expect(theatre.reasons).toContain('outbound_personalization');
    expect(typeof theatre.score).toBe('number');
    // Window contract still intact after the merge.
    expect(body.total).toBe(2);
    expect(body.from).toBe('2099-01-01');
  });
});

describe('GET /agent/feed — Fas D mood-filter (Stämningsfullt)', () => {
  const moodPage = [musicRow, theatreRow, moodRow];

  it('an anonymous caller with ?mood=stamningsfullt gets only mood-matching events, in order', async () => {
    // The mood tile is a CONTENT filter, not personalization — it must work
    // for guests too (no auth header, no signal reads).
    const mock = makeFeedMockSupabase({ eventRows: moodPage });
    const { status, body } = await requestFeed(mock, { mood: 'stamningsfullt' });
    expect(status).toBe(200);
    expect(body.events.map((e: any) => e.id)).toEqual([moodRow.id]);
    // Canonical window total stays honest to the DB; the mood filter shrinks
    // the page, not the window contract.
    expect(body.total).toBe(3);
    expect(body.from).toBe('2099-01-01');
    expect(mock.tablesCalled).not.toContain('user_interactions');
  });

  it('a treatment user gets mood-filtered AND taste-ranked — AI lexicon + aktivitetssignaler', async () => {
    // "Stämningsfullt" = AI-genererat lexikon (static) + aktivitetsbaserad
    // rankning (Fas C): the mood filter runs BEFORE the ranker, and the
    // surviving card still carries the user's personal reasons.
    const mock = makeFeedMockSupabase({
      eventRows: moodPage,
      interactionRows: [...theatreSaves, ...theatreOutbounds],
    });
    const { status, body } = await requestFeed(mock, {
      bearer: `t:${TREATMENT_USERS[3]}`,
      mood: 'stamningsfullt',
    });
    expect(status).toBe(200);
    expect(body.events.map((e: any) => e.id)).toEqual([moodRow.id]);
    expect(body.events[0].reasons).toContain('category_personalization');
    expect(body.events[0].reasons).toContain('outbound_personalization');
    expect(typeof body.events[0].score).toBe('number');
  });

  it('an unknown mood value is ignored — full page, no filtering', async () => {
    const mock = makeFeedMockSupabase({ eventRows: moodPage });
    const { status, body } = await requestFeed(mock, { mood: 'whatever' });
    expect(status).toBe(200);
    expect(body.events.map((e: any) => e.id)).toEqual([
      musicRow.id,
      theatreRow.id,
      moodRow.id,
    ]);
  });

  it('a mood with zero matches returns an honest empty page', async () => {
    // No row matches the lexikon (musicRow/theatreRow copy is plain) — the
    // filter must not invent matches or crash.
    const mock = makeFeedMockSupabase({ eventRows: [musicRow, theatreRow] });
    const { status, body } = await requestFeed(mock, { mood: 'stamningsfullt' });
    expect(status).toBe(200);
    expect(body.events).toEqual([]);
    expect(body.total).toBe(2);
    expect(body.has_more).toBe(false);
  });
});