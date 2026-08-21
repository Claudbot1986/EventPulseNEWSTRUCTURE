/**
 * 08-Agent/server — Express HTTP entry for the private agent API.
 *
 * Phase 0 surface:
 *   POST /agent/chat  → returns AgentChatResponse
 *
 * Lockdown:
 *   - Origin allowlist via AGENT_ALLOWED_ORIGINS (comma-separated).
 *   - client_user_id is treated as opaque user-supplied UUID; the agent only
 *     persists feedback/interactions against it. There is no login flow yet.
 *
 * Deterministic pipeline (no LLM yet — Phase 0):
 *   parse_intent → search_events → rank_events → top-5 → log impression → respond
 *
 * The composer wraps results in the SystemPrompt contract so the LLM layer
 * can be slotted in later without changing the wire format.
 */

import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseIntent } from './tools/parse_intent';
import { searchEvents } from './tools/search_events';
import { rankEvents } from './tools/rank_events';
import { mmrRerank } from './tools/diversify';
import { recordFeedback } from './tools/record_feedback';
import { pickClarifyingQuestion } from './tools/find_gaps';
import { recordOutboundClick } from './tools/attribution';
import { feedEvents, todayIso, addDays } from './tools/feed_events';
import { getSavedEvents } from './tools/get_saved_events';
import { buildUserSignal, loadStatedPreferences } from './tools/personalize';
import {
  assignVariant,
  computeLift,
  type VariantStats,
  MIN_SAMPLE_PER_VARIANT,
} from './tools/experiments';
import { composeReply } from './llmRouter';
import { fetchEventImage } from './tools/fetch_event_image';
import { createRateLimiter, ipKeyFn } from './middleware/rateLimit';
import { createAdminAuth } from './middleware/adminAuth';
import {
  listNotifications,
  markNotificationRead,
  generateRemindersForUser,
} from './tools/notification_center';
import {
  followVenue,
  unfollowVenue,
  followArtist,
  unfollowArtist,
  loadFollowedVenues,
  loadFollowedArtists,
} from './tools/follow_entity';
import type {
  AgentChatRequest,
  AgentChatResponse,
  EventCard,
  RankedEvent,
} from './types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Phase 2 A/B experiment ID. Sticky per client_user_id. Salt lives in
 *  experiments.ts (DEFAULT_ASSIGNMENT_SALT) — change the salt to
 *  re-randomize without rotating user IDs. */
const PERSONALIZATION_PRIORS_EXP = 'PERSONALIZATION_PRIORS';

function getAllowedOrigins(): string[] {
  const raw = process.env.AGENT_ALLOWED_ORIGINS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not configured`);
  return v;
}

let supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (supabase) return supabase;
  supabase = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } }
  );
  return supabase;
}

export function buildApp(opts: { supabase?: SupabaseClient } = {}): express.Express {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const allowedOrigins = getAllowedOrigins();
  const sb = opts.supabase ?? null;

  // Rate limiting (Workstream E follow-up, MVP Hardening §18.4 DoD 5).
  //
  // Two buckets:
  //   - `chatLimiter` tracks `client_user_id` from the request body and is
  //     the tightest budget — it backs the Anthropic call. Default: 5 rps,
  //     burst 20, idle-evict after 10 min.
  //   - `generalLimiter` is IP-keyed and gates feed/metrics/experiments so
  //     a single anonymous caller cannot scrape them. Same defaults.
  //
  // Both are in-memory (single Fly machine). Multi-instance scale-out
  // would require a shared store; explicitly listed in docs/DEPLOY.md §8.
  const chatLimiter = createRateLimiter({ rps: 5, burst: 20 });
  const generalLimiter = createRateLimiter({ rps: 10, burst: 40, keyFn: ipKeyFn });

  // Admin auth (Workstream E follow-up, MVP Hardening §18.4 DoD 5).
  // Gates /agent/metrics and /agent/experiments/personalization. Reads
  // `AGENT_ADMIN_TOKEN` from the env; if unset, all admin calls 503.
  const requireAdmin = createAdminAuth();

  app.use((req, res, next) => {
    const origin = req.header('origin');
    if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'origin not allowed' });
      return;
    }
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Origin'
      );
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/agent/health', (_req, res) => {
    res.json({ ok: true, phase: 0 });
  });

  /**
   * GET /agent/feed?from=YYYY-MM-DD&days=7&category=music&city=Stockholm
   *
   * Browse-window reader for the default-browse UI. Defaults to "today + 7 days".
   * Returns the events_public slice in [from, from+days), plus echo of the
   * window and a `has_more` flag so the client can advance by 7-day chunks.
   *
   * Same lockdown as /agent/chat: origin allowlist + service_role only.
   */
  app.get('/agent/feed', generalLimiter.middleware, async (req: Request, res: Response) => {
    const client = sb ?? getSupabase();
    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
      ? req.query.from
      : todayIso();
    const days = typeof req.query.days === 'string'
      ? Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 30)
      : 7;
    const category = typeof req.query.category === 'string' && req.query.category
      ? req.query.category
      : null;
    const city = typeof req.query.city === 'string' && req.query.city
      ? req.query.city
      : 'Stockholm';

    try {
      const result = await feedEvents(client, { from, days, category, city });
      res.json({
        events: result.events,
        from: result.from,
        to: result.to,
        has_more: result.has_more,
        next_from: addDays(result.from, days),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/agent/chat', chatLimiter.middleware, async (req: Request, res: Response) => {
    const body = req.body as Partial<AgentChatRequest>;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'invalid body' });
      return;
    }
    if (!body.client_user_id || !UUID_RE.test(body.client_user_id)) {
      res.status(400).json({ error: 'client_user_id must be a uuid' });
      return;
    }
    if (!body.message || typeof body.message !== 'string') {
      res.status(400).json({ error: 'message required' });
      return;
    }

    const client = sb ?? getSupabase();

    // session_id is optional; if present it must be a uuid (DB column is uuid).
    // Silently drop malformed session_ids rather than failing the chat request.
    const chatSessionId: string | undefined =
      typeof body.session_id === 'string' && UUID_RE.test(body.session_id)
        ? body.session_id
        : undefined;

    try {
      const intent = await parseIntent(body.message);

      // Mixed-initiative (Workstream C, MASTERPLAN §18.2 decision 1):
      //   - ALWAYS run the search pipeline. Results come first.
      //   - Attach AT MOST ONE clarifying question (highest info gain) when
      //     the intent is sparse, alongside the results — never in place of
      //     them. The user sees cards AND a nudge to refine.
      // This replaces the prior cold-start gate that short-circuited with
      // an empty cards array (D1 defect in §18.1).
      const clarifyingQuestion = pickClarifyingQuestion(intent);

      const search = await searchEvents(client, {
        city: intent.city,
        date_from: intent.date_from,
        date_to: intent.date_to,
        categories: intent.categories.length > 0 ? intent.categories : undefined,
        exclude_categories: intent.exclude_categories.length > 0 ? intent.exclude_categories : undefined,
        is_free: intent.budget === 'free' ? true : null,
        limit: 25,
      });

      // ─── A/B test: personalization priors ON vs OFF ────────────────────
      // 50/50 sticky assignment per client_user_id (see experiments.ts).
      // Treatment: priors enabled. Control: priors disabled (cold baseline).
      // Both branches are otherwise identical — same parse, same search,
      // same MMR, same impression logging. Only the priors toggle differs.
      //
      // Why this matters: Phase 2 success criterion is "measurable lift vs
      // unpersonalized rank on repeat sessions" (masterplan §10). Without
      // this split we cannot prove the priors actually help — we'd just be
      // shipping a feature and hoping.
      const variant = assignVariant(body.client_user_id, PERSONALIZATION_PRIORS_EXP);

      // Count-based personalization priors (research-backed; see personalize.ts).
      // Best-effort: buildUserSignal returns a "cold" signal on failure and
      // never throws into the chat path. Control variant SKIPS the call to
      // keep the variants truly isolated (no DB read in control).
      const personalization = variant === 'treatment'
        ? await buildUserSignal(client, body.client_user_id)
        : null;

      // Stated-user-category preferences from user_preferences (T0023).
      // loadStatedPreferences returns null when no row exists yet, and []
      // when the user explicitly cleared their preferences — both are handled
      // correctly by rankEvents (null = no stated boost; [] = no stated boost).
      const statedCategories = await loadStatedPreferences(client, body.client_user_id);

      // Followed-venue preferences from user_preferences.followed_venue_ids
      // (T0050 / MVP-gap §77). `loadFollowedVenues` returns `{ venue_ids: [] }`
      // when the user has no follows or no preferences row — empty array is
      // the correct "no lift" signal and rankEvents treats it as zero-cost.
      // Best-effort: never throws; same cache TTL as loadStatedPreferences.
      const followed = await loadFollowedVenues(client, body.client_user_id);

      // Followed-artist preferences from user_preferences.followed_artist_slugs
      // (T0050 — Phase 1 declared pref). Parallel cache to venues; ranker
      // gates on a non-empty array so users with no follows incur zero cost.
      const followedArtists = await loadFollowedArtists(client, body.client_user_id);

      // Two-stage retrieval→re-rank:
      //   1. rank_events returns the top 25 most relevant (deterministic
      //      feature scoring + count-based personalization priors + stated prefs).
      //   2. mmrRerank re-picks the final top 5 to maximize relevance×diversity
      //      (Carbonell & Goldstein 1998, λ=0.7 default — see diversify.ts).
      // MMR is the standard defense against filter-bubble pathology once the
      // personalization priors are applied.
      const ranked = rankEvents(search.events, intent, {
        topN: 25,
        personalization,
        statedCategories: statedCategories ?? undefined,
        followedVenueIds: followed.venue_ids.length > 0 ? followed.venue_ids : undefined,
        followedArtistSlugs: followedArtists.artist_slugs.length > 0 ? followedArtists.artist_slugs : undefined,
      });
      const reranked: RankedEvent[] = mmrRerank(ranked, { lambda: 0.7, topN: 5 });

      const cards: EventCard[] = reranked.map((r) => ({
        ...r.card,
        reasons: r.reasons,
        score: r.score,
      }));

      // ─── Phase 1.7: og:image / JSON-LD fallback enrichment ──────────
      // Many events in events_public have NULL image_url (the organizer
      // page is the only place a hero image lives). For the magic-slice
      // UI cards, an image dramatically increases engagement. We fire
      // fetchEventImage in parallel for cards missing image_url, with a
      // tight per-call timeout so /agent/chat stays bounded. Failures
      // collapse silently — never throw into the chat path. After this
      // block, `cards` reflects what the user will actually see.
      //
      // ticket_url is the best source proxy we have without a schema
      // change — most venues serve tickets on their own domain where the
      // og:image is reliable. We accept the rare wrong-domain case
      // (Ticketmaster / Eventbrite hosting) since those still embed the
      // event's own image in the ticket page.
      const IMAGE_FALLBACK_TIMEOUT_MS = 1500;
      const cardsNeedingImage = cards
        .map((card, idx) => ({ card, idx }))
        .filter(({ card }) => !card.image_url && !!card.ticket_url);
      if (cardsNeedingImage.length > 0) {
        const settled = await Promise.allSettled(
          cardsNeedingImage.map(({ card }) =>
            fetchEventImage(card.ticket_url as string, {
              timeoutMs: IMAGE_FALLBACK_TIMEOUT_MS,
            })
          )
        );
        for (let i = 0; i < cardsNeedingImage.length; i++) {
          const r = settled[i];
          if (r.status === 'fulfilled' && r.value) {
            const idx = cardsNeedingImage[i].idx;
            cards[idx] = { ...cards[idx], image_url: r.value };
          }
        }
      }

      // Log an "impression" per result. Best-effort, never throw.
      // Rank position reflects the ORDER THE USER ACTUALLY SEES (post-MMR),
      // not the upstream ranker order — that's the unit of evidence for
      // downstream CTR analysis. Metadata tags every row with the A/B
      // variant so the lift endpoint can aggregate per-variant CTR.
      const experimentMetadata = {
        experiment_id: PERSONALIZATION_PRIORS_EXP,
        experiment_variant: variant,
      };
      for (let i = 0; i < cards.length; i++) {
        await recordFeedback(client, {
          client_user_id: body.client_user_id,
          session_id: chatSessionId,
          event_id: cards[i].id,
          interaction: 'impression',
          query_text: body.message,
          rank_position: i,
          reasons: reranked[i].reasons,
          metadata: experimentMetadata,
        });
      }

      const replyResult = await composeReply({
        intent,
        cards,
        warnings: search.warnings,
        relaxed_constraint: search.relaxed_constraint,
      });

      const out: AgentChatResponse = {
        session_id: body.session_id ?? 'pending',
        reply: replyResult.reply,
        cards,
        warnings: search.warnings,
        // Additive: surface the relaxation label (machine-readable) so the
        // client can also render it. The reply string already contains the
        // human Swedish copy when the LLM composer is active.
        relaxed_constraint: search.relaxed_constraint,
        // Mixed-initiative: at most one clarifying question, attached
        // alongside results. Never in place of them.
        clarifying_question: clarifyingQuestion,
        // Legacy array form, capped at 1 entry. Kept for back-compat.
        clarifying_questions: clarifyingQuestion ? [clarifyingQuestion] : [],
      };
      res.json(out);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /agent/outbound — per-organizer outbound click attribution
   * (Workstream F, wired by Workstream C).
   *
   * Body shape matches the contract documented in
   * `08-Agent/tools/attribution.ts` JSDoc. Validation mirrors the
   * `/agent/feedback` pattern (UUID_RE + 400 on bad input) so the wire
   * surface stays consistent. Origin allowlist is enforced by the global
   * middleware above — this handler does NOT re-implement it.
   *
   * The call is best-effort: a Supabase insert failure returns
   * { ok: false, warning } with 202 so the click UX never breaks.
   */
  app.post('/agent/outbound', chatLimiter.middleware, async (req: Request, res: Response) => {
    const body = req.body as Partial<{
      client_user_id: string;
      session_id?: string;
      event_id: string;
      organizer_id?: string | null;
      source?: string | null;
      ticket_url: string;
      metadata?: Record<string, unknown>;
    }>;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'invalid body' });
      return;
    }
    if (!body.client_user_id || !UUID_RE.test(body.client_user_id)) {
      res.status(400).json({ error: 'client_user_id must be a uuid' });
      return;
    }
    if (!body.event_id || !UUID_RE.test(body.event_id)) {
      res.status(400).json({ error: 'event_id must be a uuid' });
      return;
    }
    if (
      body.organizer_id !== undefined &&
      body.organizer_id !== null &&
      typeof body.organizer_id === 'string' &&
      !UUID_RE.test(body.organizer_id)
    ) {
      res.status(400).json({ error: 'organizer_id must be a uuid when provided' });
      return;
    }
    if (!body.ticket_url || typeof body.ticket_url !== 'string') {
      res.status(400).json({ error: 'ticket_url required' });
      return;
    }
    // Validate ticket_url scheme up-front so bad client input is a 400 (the
    // attribution module's Zod check returns a warning, which we treat as a
    // transient insert failure → 202; we want the wire to distinguish).
    try {
      const u = new URL(body.ticket_url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        res.status(400).json({ error: 'ticket_url must be http or https' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'ticket_url must be a valid URL' });
      return;
    }
    // session_id is optional, but if present it MUST be a uuid (DB column).
    const sessionId: string | undefined =
      typeof body.session_id === 'string' && UUID_RE.test(body.session_id)
        ? body.session_id
        : undefined;

    const client = sb ?? getSupabase();
    const result = await recordOutboundClick(client, {
      client_user_id: body.client_user_id,
      session_id:     sessionId,
      event_id:       body.event_id,
      organizer_id:   body.organizer_id ?? null,
      source:         body.source ?? null,
      ticket_url:     body.ticket_url,
      metadata:       body.metadata,
    });

    if (!result.ok) {
      // Best-effort: a failed insert MUST NOT break the user click flow.
      // 202 Accepted = "we heard you, we couldn't persist it". The UI
      // can treat this as fire-and-forget.
      res.status(202).json({ ok: false, warning: result.warning ?? 'unknown' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/agent/feedback', chatLimiter.middleware, async (req: Request, res: Response) => {
    const body = req.body as Partial<{
      client_user_id: string;
      session_id?: string;
      event_id: string;
      interaction: string;
      reject_reason?: string;
      query_text?: string;
      rank_position?: number;
      metadata?: Record<string, unknown>;
    }>;
    // Delegate validation to the tool's pure validator so the wire contract
    // and tool contract cannot drift. `validateFeedbackInput` returns the
    // first failed check (or null). A 400 is correct for any malformed
    // payload — the agent UI treats it as a code bug, not a network blip.
    const validationError = validateFeedbackInput(body);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const client = sb ?? getSupabase();
    const result = await recordFeedback(client, {
      client_user_id: body.client_user_id as string,
      // session_id is optional; the validator accepts undefined / null, so
      // we forward as-is and the tool normalizes to null.
      session_id:     body.session_id,
      event_id:       body.event_id as string,
      interaction:    body.interaction as 'impression' | 'click' | 'outbound' | 'save' | 'reject' | 'dismiss' | 'feedback_positive' | 'feedback_negative',
      reject_reason:  body.reject_reason as 'not_interested' | 'wrong_category' | 'too_far' | 'too_expensive' | 'already_seen' | 'other' | undefined,
      query_text:     body.query_text,
      rank_position:  body.rank_position,
      metadata:       body.metadata,
    });

    if (!result.ok) {
      // Best-effort endpoint: a failed Supabase insert MUST NOT trip the UI.
      // 202 = "we heard you, we couldn't persist it". The client code
      // (agentClient.js) already treats 202 as silent and continues.
      res.status(202).json({ ok: false, warning: result.warning ?? 'unknown' });
      return;
    }
    // Echo the resolved values so the agent UI can log / reconcile locally.
    res.json({
      ok: true,
      interaction: result.interaction,
      reject_reason: result.reject_reason ?? null,
    });
  });

  /**
   * POST /agent/preferences — upsert stated user category preferences
   * (Workstream gating the T0023 stated-categories personalization path).
   *
   * Body: { client_user_id: uuid, categories: string[] }
   * Persists to `user_preferences` keyed by client_user_id (PK). The
   * preferences jsonb column stores `{ categories: string[] }` so the
   * personalization tool can read it back without a schema change.
   *
   * Best-effort: if the Supabase upsert fails we return 202 so the
   * onboarding UI never breaks. Validation errors are 400 (code bug,
   * not a network blip). Same rate limiter as `/agent/feedback` —
   * category prefs are set rarely from the onboarding step but we
   * want the same per-user budget because the endpoint is gated by
   * the same client_user_id key.
   */
  app.post('/agent/preferences', chatLimiter.middleware, async (req: Request, res: Response) => {
    const body = req.body as Partial<{
      client_user_id: string;
      categories: unknown;
    }>;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'invalid body' });
      return;
    }
    if (!body.client_user_id || !UUID_RE.test(body.client_user_id)) {
      res.status(400).json({ error: 'client_user_id must be a uuid' });
      return;
    }
    if (!Array.isArray(body.categories)) {
      res.status(400).json({ error: 'categories must be an array' });
      return;
    }
    const categories = body.categories.filter((x): x is string => typeof x === 'string');

    const client = sb ?? getSupabase();
    const { error } = await client
      .from('user_preferences')
      .upsert(
        {
          client_user_id: body.client_user_id,
          preferences: { categories },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'client_user_id' }
      );

    if (error) {
      res.status(202).json({ ok: false, warning: error.message });
      return;
    }
    res.json({ ok: true });
  });

  /**
   * POST /agent/follow
   *
   * T0050 / MVP-gap §77. Follow or unfollow a venue. Body:
   *   { client_user_id: uuid, venue_id: uuid, action: 'follow' | 'unfollow' }
   *
   * Persists to `user_preferences.preferences.followed_venue_ids` (jsonb,
   * additive key — `categories` is preserved through read-modify-write in
   * `follow_entity.ts`). The chat handler reads this list via
   * `loadFollowedVenues` and passes it as `RankOptions.followedVenueIds`
   * so followed venues receive a `followed_venue_match` boost (default 20)
   * in the ranker. UI binds the long-press action sheet on
   * `EventCard.venue_name` to this endpoint.
   *
   * Idempotent: calling `follow` twice for the same venue returns
   * `added:false` and the original count. Calling `unfollow` for an
   * un-followed venue returns `removed:false`. The DB row is always
   * bumped on a state-changing call so caches re-fetch.
   *
   * Best-effort: validation errors are 400 (code bug), Supabase failures
   * are 202 with a warning (the UI never blocks on a follow — the long-
   * press action sheet auto-dismisses either way).
   */
  app.post('/agent/follow', chatLimiter.middleware, async (req: Request, res: Response) => {
    // T0050 — entity_type discriminator routes to venue or artist follow.
    // Back-compat: callers that omit entity_type + send venue_id fall through
    // to the original venue-only path so the existing UI keeps working.
    const body = req.body as Partial<{
      client_user_id: string;
      entity_type?: string;
      venue_id?: string;
      entity_id?: string;
      artist_slug?: string;
      action: string;
    }>;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'invalid body' });
      return;
    }
    if (!body.client_user_id || !UUID_RE.test(body.client_user_id)) {
      res.status(400).json({ error: 'client_user_id must be a uuid' });
      return;
    }
    if (body.action !== 'follow' && body.action !== 'unfollow') {
      res.status(400).json({ error: "action must be 'follow' or 'unfollow'" });
      return;
    }

    // Resolve entity_type — default 'venue' for callers that only send venue_id.
    const entity_type = (body.entity_type === 'artist' || body.entity_type === 'venue')
      ? body.entity_type
      : (body.artist_slug ? 'artist' : 'venue');

    const client = sb ?? getSupabase();
    let result: { ok: boolean; count: number; warning?: string; added?: boolean; removed?: boolean };
    if (entity_type === 'artist') {
      // entity_id is the preferred name; artist_slug kept for back-compat.
      const slug = (body.entity_id ?? body.artist_slug ?? '').trim().toLowerCase();
      if (!slug) {
        res.status(400).json({ error: 'entity_id (or artist_slug) is required for entity_type=artist' });
        return;
      }
      result = body.action === 'follow'
        ? await followArtist(client, { client_user_id: body.client_user_id, artist_slug: slug })
        : await unfollowArtist(client, { client_user_id: body.client_user_id, artist_slug: slug });
    } else {
      // venue — prefer entity_id, fall back to legacy venue_id.
      const venue_id = body.entity_id ?? body.venue_id ?? '';
      if (!UUID_RE.test(venue_id)) {
        res.status(400).json({ error: 'venue_id (or entity_id) must be a uuid for entity_type=venue' });
        return;
      }
      result = body.action === 'follow'
        ? await followVenue(client, { client_user_id: body.client_user_id, venue_id })
        : await unfollowVenue(client, { client_user_id: body.client_user_id, venue_id });
    }

    if (!result.ok) {
      res.status(202).json({
        ok: false,
        entity_type,
        action: body.action,
        warning: result.warning ?? 'unknown',
      });
      return;
    }
    res.json({
      ok: true,
      entity_type,
      action: body.action,
      added:   'added'   in result ? (result as { added: boolean }).added   : false,
      removed: 'removed' in result ? (result as { removed: boolean }).removed : false,
      count:   result.count,
    });
  });

  /**
   * GET /agent/follow?client_user_id=<uuid>
   *
   * T0050 read-side. Returns the user's currently-followed venue ids.
   * The UI calls this on mount so the long-press action sheet knows
   * whether to show "Följ" or "Sluta följ" for a given venue.
   *
   * Best-effort: never throws. A Supabase failure returns 500 with the
   * underlying message; the UI treats that as "follows temporarily
   * unavailable" and shows the optimistic "Följ" default.
   */
  app.get('/agent/follow', generalLimiter.middleware, async (req: Request, res: Response) => {
    const raw = typeof req.query.client_user_id === 'string' ? req.query.client_user_id : '';
    if (!UUID_RE.test(raw)) {
      res.status(400).json({ error: 'client_user_id must be a uuid' });
      return;
    }
    const client = sb ?? getSupabase();
    // Parallel read — both helpers hit the same row but cache independently
    // and run their cached-path in O(1) on hot path.
    const [venues, artists] = await Promise.all([
      loadFollowedVenues(client, raw),
      loadFollowedArtists(client, raw),
    ]);
    res.json({
      ok: true,
      venue_ids: venues.venue_ids,
      artist_slugs: artists.artist_slugs,
      counts: {
        venues: venues.venue_ids.length,
        artists: artists.artist_slugs.length,
        total: venues.venue_ids.length + artists.artist_slugs.length,
      },
    });
  });

  /**
   * GET /agent/saved?client_user_id=<uuid>&limit=<int>
   *
   * T0054 / MVP-gap §77 (Phase 1 retention): saved events section in HomeScreen.
   * Returns events the current client_user_id has saved (user_interactions
   * with interaction='save'), enriched with full event details, sorted
   * newest-first by saved_at (created_at on the interaction row).
   *
   * Lockdown mirrors /agent/follow: origin allowlist + service_role only.
   * client_user_id is the same anon UUID the UI already sends.
   *
   * Response shape:
   *   { events: EventCard[] }
   */
  app.get('/agent/saved', generalLimiter.middleware, async (req: Request, res: Response) => {
    const raw = typeof req.query.client_user_id === 'string' ? req.query.client_user_id : '';
    if (!UUID_RE.test(raw)) {
      res.status(400).json({ error: 'client_user_id must be a uuid' });
      return;
    }
    const limit = typeof req.query.limit === 'string'
      ? Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100)
      : 50;
    const client = sb ?? getSupabase();
    const result = await getSavedEvents(client, { client_user_id: raw, limit });
    res.json({ events: result.events });
  });

  /**
   * GET /agent/notifications?client_user_id=<uuid>&limit=<int>
   *
   * T0048 / MVP-gap §77: read-side of the notification center. Returns
   * the user's notifications newest-first. The UI uses this to render
   * the three grouping buckets ("Påminnelse" / "Ny matchning" / "Svar")
   * per NotificationsScreen.js.
   *
   * Lockdown mirrors /agent/chat: origin allowlist + service_role only.
   * client_user_id is the same anon UUID the UI already sends — there
   * is no login flow yet.
   *
   * Best-effort: never throws. A Supabase failure returns 500 with the
   * underlying message; the client treats that as "feed temporarily
   * unavailable" and falls back to its empty-state copy.
   */
  app.get('/agent/notifications', generalLimiter.middleware, async (req: Request, res: Response) => {
    const raw = typeof req.query.client_user_id === 'string' ? req.query.client_user_id : '';
    if (!UUID_RE.test(raw)) {
      res.status(400).json({ error: 'client_user_id must be a uuid' });
      return;
    }
    const limit = typeof req.query.limit === 'string'
      ? Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200)
      : 50;
    const client = sb ?? getSupabase();
    const result = await listNotifications(client, raw, { limit });
    if (!result.ok) {
      res.status(500).json({ error: result.warning ?? 'unknown error' });
      return;
    }
    res.json({ notifications: result.notifications });
  });

  /**
   * POST /agent/notifications/read
   *
   * Body: { client_user_id: uuid, notification_id: uuid }
   * Marks a single notification as read. Idempotent — calling it twice
   * is the same as calling it once. Same rate limiter as /agent/feedback
   * because this is user-driven and could be batched by a future UI.
   */
  app.post('/agent/notifications/read', chatLimiter.middleware, async (req: Request, res: Response) => {
    const body = req.body as Partial<{ client_user_id: string; notification_id: string }>;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'invalid body' });
      return;
    }
    if (!body.client_user_id || !UUID_RE.test(body.client_user_id)) {
      res.status(400).json({ error: 'client_user_id must be a uuid' });
      return;
    }
    if (!body.notification_id || !UUID_RE.test(body.notification_id)) {
      res.status(400).json({ error: 'notification_id must be a uuid' });
      return;
    }
    const client = sb ?? getSupabase();
    const result = await markNotificationRead(client, body.client_user_id, body.notification_id);
    if (!result.ok) {
      res.status(202).json({ ok: false, warning: result.warning ?? 'unknown' });
      return;
    }
    res.json({ ok: true });
  });

  /**
   * POST /agent/notifications/scan
   *
   * Admin endpoint: forces an immediate reminder-generation pass for
   * one user. Used by the verify path (the task brief: "spara ett
   * event med start_time inom 2h → notification dyker upp inom 15 min")
   * so we don't have to wait for the cron to fire during testing.
   *
   * Body: { client_user_id: uuid }
   * Gates: same admin token as /agent/metrics and /agent/experiments.
   */
  app.post('/agent/notifications/scan', requireAdmin, generalLimiter.middleware, async (req: Request, res: Response) => {
    const body = req.body as Partial<{ client_user_id: string }>;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'invalid body' });
      return;
    }
    if (!body.client_user_id || !UUID_RE.test(body.client_user_id)) {
      res.status(400).json({ error: 'client_user_id must be a uuid' });
      return;
    }
    const client = sb ?? getSupabase();
    const result = await generateRemindersForUser(client, {
      client_user_id: body.client_user_id,
    });
    if (!result.ok) {
      res.status(500).json({ ok: false, warning: result.warning ?? 'unknown' });
      return;
    }
    res.json({
      ok: true,
      inserted: result.inserted,
      skipped: result.skipped,
      eligible: result.eligible,
    });
  });

  /**
   * GET /agent/recommended?client_user_id=<uuid>&limit=<int>
   *
   * T0056 / MVP-gap §77: AI-preference section in HomeScreen.
   * Returns top N future Stockholm events ranked by the user's declared and
   * behavioral priors (followed venues, followed artists, onboarding categories,
   * recency), with rank reasons so the card renderer can explain why.
   *
   * Pipeline: searchEvents(no filters → all future Stockholm events)
   *   → rankEvents(all personalization signals)
   *   → mmrRerank (diversity, λ=0.7)
   *   → top N cards with reasons
   *
   * Same lockdown as /agent/saved: origin allowlist + service_role only.
   */
  app.get('/agent/recommended', generalLimiter.middleware, async (req: Request, res: Response) => {
    const raw = typeof req.query.client_user_id === 'string' ? req.query.client_user_id : '';
    if (!UUID_RE.test(raw)) {
      res.status(400).json({ error: 'client_user_id must be a uuid' });
      return;
    }
    const limit = typeof req.query.limit === 'string'
      ? Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 20)
      : 10;

    const client = sb ?? getSupabase();

    try {
      // Fetch all personalization signals in parallel.
      const [personalization, statedCategories, followed, followedArtists] = await Promise.all([
        buildUserSignal(client, raw),
        loadStatedPreferences(client, raw),
        loadFollowedVenues(client, raw),
        loadFollowedArtists(client, raw),
      ]);

      // Search: no date filter (all future), no category filter, Stockholm only.
      // Cap at 50 to bound query time; ranker picks the top N from these.
      const search = await searchEvents(client, {
        city: 'Stockholm',
        limit: 50,
      });

      // Rank with all personalization signals.
      // /agent/recommended has no parsed intent — the recommendation is
      // driven entirely by the personalization signals. Build a minimal but
      // well-formed IntentBrief (rankEvents requires categories, time_of_day,
      // budget, party, language, exclude_categories, raw_query).
      const recommendedIntent: IntentBrief = {
        raw_query: 'recommended',
        time_of_day: 'anytime',
        budget: 'any',
        party: 'any',
        categories: [],
        city: 'Stockholm',
        language: 'sv',
        exclude_categories: [],
      };
      const ranked = rankEvents(search.events, recommendedIntent, {
        topN: limit * 2,
        personalization,
        statedCategories: statedCategories ?? undefined,
        followedVenueIds: followed.venue_ids.length > 0 ? followed.venue_ids : undefined,
        followedArtistSlugs: followedArtists.artist_slugs.length > 0 ? followedArtists.artist_slugs : undefined,
      });

      // MMR diversify.
      const reranked: RankedEvent[] = mmrRerank(ranked, { lambda: 0.7, topN: limit });

      const cards: EventCard[] = reranked.map((r) => ({
        ...r.card,
        reasons: r.reasons,
        score: r.score,
      }));

      res.json({ events: cards });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      res.status(500).json({ error: msg });
    }
  });

  /**
   * GET /agent/suggested-prompts?client_user_id=<uuid>
   *
   * T0057 / MVP-gap §77: time-aware suggested prompts in HomeScreen.
   * Returns 3–5 contextual intent chips with prompt_text + reason.
   * Chips are generated from: time-of-day, stated categories, followed
   * venues/artists, and interaction history.
   *
   * Same lockdown as /agent/saved: origin allowlist + service_role only.
   */
  app.get('/agent/suggested-prompts', generalLimiter.middleware, async (req: Request, res: Response) => {
    const raw = typeof req.query.client_user_id === 'string' ? req.query.client_user_id : '';
    if (!UUID_RE.test(raw)) {
      res.status(400).json({ error: 'client_user_id must be a uuid' });
      return;
    }
    const client = sb ?? getSupabase();
    try {
      const { getSuggestedPrompts } = await import('./tools/get_suggested_prompts.js');
      const result = await getSuggestedPrompts({
        supabase: client,
        client_user_id: raw,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      res.status(500).json({ error: msg });
    }
  });

  app.get('/agent/metrics', requireAdmin, generalLimiter.middleware, async (_req: Request, res: Response) => {
    const client = sb ?? getSupabase();
    try {
      const { data, error } = await client
        .from('user_interactions')
        .select('interaction');
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        counts[row.interaction] = (counts[row.interaction] ?? 0) + 1;
      }
      const impressions = counts.impression ?? 0;
      const clicks      = counts.click ?? 0;
      const outbounds   = counts.outbound ?? 0;
      const ctr         = impressions > 0 ? outbounds / impressions : 0;
      res.json({
        impressions,
        clicks,
        outbounds,
        saves:       counts.save ?? 0,
        ctr:         Number(ctr.toFixed(4)),
        total_rows:  (data ?? []).length,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      res.status(500).json({ error: msg });
    }
  });

  /**
   * GET /agent/experiments/personalization
   *
   * Reads user_interactions rows tagged with experiment_id =
   * PERSONALIZATION_PRIORS and computes the per-variant CTR lift. The OEC
   * is outbound/impression — Kohavi (2009) recommends one Overall Evaluation
   * Criterion per experiment; we don't mix CTR with saves here.
   *
   * Response shape:
   *   {
   *     experiment_id, min_sample_per_variant,
   *     treatment: { impressions, outbounds, ctr },
   *     control:    { impressions, outbounds, ctr },
   *     lift:       { absolute, relative, p_value, ci95, verdict, samples }
   *   }
   *
   * Verdict is INCONCLUSIVE while either side is below MIN_SAMPLE_PER_VARIANT.
   * That's by design — Kohavi §4 warns that premature peeking yields
   * false positives. Wait for the samples to accumulate before deciding.
   */
  app.get('/agent/experiments/personalization', requireAdmin, generalLimiter.middleware, async (_req: Request, res: Response) => {
    const client = sb ?? getSupabase();
    try {
      // Pull only the rows tagged with this experiment. We use metadata
      // JSONB →> 'experiment_id' which is supported in Supabase/Postgres.
      const { data, error } = await client
        .from('user_interactions')
        .select('interaction, metadata')
        .eq('metadata->>experiment_id', PERSONALIZATION_PRIORS_EXP);
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      // Aggregate per variant + per interaction. CTR = outbound / impression.
      const buckets: Record<'treatment' | 'control', { impressions: number; outbounds: number }> = {
        treatment: { impressions: 0, outbounds: 0 },
        control:    { impressions: 0, outbounds: 0 },
      };
      for (const row of data ?? []) {
        const variant = row.metadata?.experiment_variant as 'treatment' | 'control' | undefined;
        if (variant !== 'treatment' && variant !== 'control') continue;
        if (row.interaction === 'impression') buckets[variant].impressions++;
        else if (row.interaction === 'outbound') buckets[variant].outbounds++;
      }

      const treatment: VariantStats = { variant: 'treatment', ...buckets.treatment };
      const control:    VariantStats = { variant: 'control',    ...buckets.control };
      const lift = computeLift(treatment, control);

      const ctr = (s: VariantStats) => s.impressions > 0 ? s.outbounds / s.impressions : 0;
      res.json({
        experiment_id: PERSONALIZATION_PRIORS_EXP,
        min_sample_per_variant: MIN_SAMPLE_PER_VARIANT,
        treatment: { impressions: treatment.impressions, outbounds: treatment.outbounds, ctr: Number(ctr(treatment).toFixed(4)) },
        control:    { impressions: control.impressions,    outbounds: control.outbounds,    ctr: Number(ctr(control).toFixed(4)) },
        lift: {
          absolute: Number(lift.absoluteLift.toFixed(4)),
          relative: lift.relativeLift === null ? null : Number(lift.relativeLift.toFixed(4)),
          p_value:  Number(lift.pValue.toFixed(4)),
          ci95: {
            low:  Number(lift.ci95.low.toFixed(4)),
            high: Number(lift.ci95.high.toFixed(4)),
          },
          verdict: lift.verdict,
          samples: lift.samples,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      res.status(500).json({ error: msg });
    }
  });

  return app;
}

if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const port = Number(process.env.AGENT_PORT ?? 8787);
  buildApp().listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[08-Agent] listening on :${port}`);
  });
}
