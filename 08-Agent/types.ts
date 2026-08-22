/**
 * 08-Agent/types — shared TypeScript types for the private agent API.
 *
 * Phase 0 surface only. Phase 1 may extend these.
 */

// ─── User-facing intent ─────────────────────────────────────────────────────
export type IntentLanguage = 'sv' | 'en';
export type IntentTimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night' | 'anytime';
export type IntentBudget = 'free' | 'low' | 'medium' | 'high' | 'any';
export type IntentParty = 'solo' | 'couple' | 'friends' | 'family' | 'any';

export interface IntentBrief {
  /** free-text original query */
  raw_query: string;
  /** ISO date inclusive lower bound (YYYY-MM-DD), optional */
  date_from?: string;
  /** ISO date inclusive upper bound (YYYY-MM-DD), optional */
  date_to?: string;
  time_of_day: IntentTimeOfDay;
  budget: IntentBudget;
  party: IntentParty;
  /** category slugs the user asked for (music, theater, etc.) */
  categories: string[];
  /** city filter — default Stockholm */
  city: string;
  language: IntentLanguage;
  /** categories the user explicitly does NOT want */
  exclude_categories: string[];
}

// ─── Card output for Phase 1 ────────────────────────────────────────────────
export type RankReason =
  | 'time_fit'
  | 'under_budget'
  | 'over_budget'
  | 'category_match'
  | 'exclude_match'
  | 'not_ended'
  | 'high_confidence'
  | 'low_confidence'
  | 'stale'
  | 'category_personalization'
  | 'venue_personalization_penalty'
  | 'followed_venue'
  | 'followed_artist'
  | 'near'
  | 'far';

export interface EventCard {
  id: string;
  title: string;
  start_time: string;
  end_time?: string | null;
  venue_name: string;
  /**
   * Venue UUID from `events_public.venue_id`. Surfaced so the ranker can
   * apply the T0050 follow-venue lift and so the UI can wire long-press
   * "Följ / Sluta följ" to a stable identifier (venue_name collisions
   * exist — e.g. two Folkets Hus venues in different cities).
   * `null` when the event has no venue (orphan row).
   */
  venue_id?: string | null;
  city: string;
  category_slug: string;
  price_min_sek?: number | null;
  price_max_sek?: number | null;
  is_free: boolean;
  ticket_url?: string | null;
  image_url?: string | null;
  /**
   * License class for the image served via `image_url`. T0052 surface.
   *   - 'cc-by' / 'cc0' / 'copyright-with-attribution' require UI attribution badge.
   *   - 'pressbild' = Swedish press-image exception (no attribution required).
   *   - 'unknown' / NULL = not yet classified (UI suppresses badge for safety).
   * See 22-Image-Rights-Policy.md in vault.
   */
  image_license?: string | null;
  /** Human-readable attribution string. UI shows when license requires it. */
  image_attribution?: string | null;
  /** Original image URL when runtime serves via proxy/cache. */
  image_source_url?: string | null;
  /**
   * Artist slugs on this event (T0050). Populated by `search_events.ts` via
   * a JOIN on `event_artists → artists`. Used by the ranker for the
   * `followed_artist_match` boost. Empty / undefined means "no artists
   * catalogued yet" — the ranker treats it as a no-op, never a penalty.
   */
  artist_slugs?: string[];
  /**
   * Source id from events.source — the ingestor that produced this row.
   * Surfaced in the UI so the user can see which site the event came from
   and (where a public homepage URL is registered) link to the source.
   Not all sources have a public homepage; the UI degrades gracefully
   (shows name, no link).
   */
  source?: string | null;
  /**
   * Venue latitude (decimal degrees, WGS84). Populated when the venue row
   * has a known coordinate; `null` / undefined means the ranker cannot
   * compute distance for this card. Both `venue_lat` AND `venue_lng` must
   * be present and finite for the geo feature to fire — see
   * `08-Agent/utils/haversine.ts`. Surfaced in the wire so the UI can
   * plot on a map (Phase 2).
   */
  venue_lat?: number | null;
  /**
   * Venue longitude (decimal degrees, WGS84). See `venue_lat` for the
   * "must be present together" rule.
   */
  venue_lng?: number | null;
  /** 0–100 confidence from the ingestion stack. Optional: not all rows have it. */
  confidence_score?: number | null;
  /** ISO timestamp of last ingestion. Drives the `stale` ranker reason. */
  freshness_at?: string | null;
  /**
   * Deterministic ranker reasons (enum only, never free text).
   * Populated by /agent/chat so the UI can render grounded "why" copy.
   */
  reasons?: RankReason[];
  /** Deterministic ranker score (sum of weighted features). */
  score?: number;
}

export interface EventDetail extends EventCard {
  description?: string | null;
  offers: Array<{
    offer_url: string;
    price_min?: number | null;
    price_max?: number | null;
    currency: string;
    vendor?: string | null;
  }>;
  provenance: Array<{
    source: string;
    source_event_id: string;
    confidence: number;
  }>;
}

export interface RankedEvent {
  card: EventCard;
  score: number;
  reasons: RankReason[];
  /**
   * Great-circle distance in km from the user's current location to the
   * venue. `undefined` when the request did not include `userLocation`,
   * or when the card has no `venue_lat`/`venue_lng`. Surfaced in the
   * wire so the UI can render "2.3 km" copy.
   */
  distance_km?: number;
}

// ─── Feedback ───────────────────────────────────────────────────────────────

/**
 * The full set of interaction types the agent server records. The string
 * union is the single source of truth for the `user_interactions.interaction`
 * CHECK constraint (see 05-Supabase/migrations/20260821-0001-…). Keep these
 * in sync with the migration's CHECK list when adding a new interaction.
 *
 * Phase 1 funnel:
 *   impression  — card rendered to the user (rank-aware)
 *   click       — user tapped the card (no URL open)
 *   outbound    — user opened the ticket URL (click + outbound = bouncer)
 *   save        — user saved the event (positive signal)
 *   reject      — user explicitly dismissed the event (negative signal)
 *   dismiss     — legacy alias of `reject` (kept for back-compat with
 *                 personalize.ts, which reads both)
 *   feedback_positive / feedback_negative — explicit thumbs up/down copy
 *     from the UI (Phase 1.5+); semantically alias to save / reject today.
 */
export type FeedbackInteraction =
  | 'impression'
  | 'click'
  | 'outbound'
  | 'save'
  | 'reject'
  | 'dismiss'
  | 'feedback_positive'
  | 'feedback_negative';

/** Stable, machine-readable categorization of a `reject` interaction. Maps
 *  to `user_interactions.metadata->>reject_reason` so the personalization
 *  layer can weight venue priors by *why* the user rejected. */
export type RejectReason =
  | 'not_interested'    // generic dismiss, no specific reason
  | 'wrong_category'    // category mismatch
  | 'too_far'           // venue too far / wrong city
  | 'too_expensive'     // price > budget
  | 'already_seen'      // event has happened or the user knows it
  | 'other';            // catch-all; never null so metrics can count

export interface RecordFeedbackInput {
  client_user_id: string;
  session_id?: string;
  event_id: string;
  interaction: FeedbackInteraction;
  query_text?: string;
  rank_position?: number;
  reasons?: RankReason[];
  /**
   * Optional structured rejection reason. Only meaningful when `interaction`
   * is 'reject' (or 'dismiss'). Persisted to user_interactions.metadata as
   * `{ reject_reason: <value> }` so the personalization layer can bucket
   * them. Defaults to 'not_interested' server-side when omitted.
   */
  reject_reason?: RejectReason;
  /** Free-form metadata blob. Persisted to user_interactions.metadata JSONB.
   *  Used by the experiment layer to tag rows with experiment_id + variant
   *  (see 08-Agent/tools/experiments.ts).
   *
   *  NOTE: when `reject_reason` is set, the tool merges it into this blob
   *  under `reject_reason` so callers don't need to repeat themselves. */
  metadata?: Record<string, unknown>;
}

// ─── User profile (read-only stub for Phase 0) ──────────────────────────────
export interface UserProfile {
  client_user_id: string;
  city_default: string;
  language: IntentLanguage;
  budget_sek_max?: number | null;
  party_size: number;
  categories_pref: string[];
}

// ─── Agent chat envelope ────────────────────────────────────────────────────
export interface AgentChatRequest {
  client_user_id: string;
  session_id?: string;
  message: string;
  origin?: string;
}

/**
 * Phase 1 cold-start. When the agent cannot produce a useful answer
 * because critical intent slots are missing, it asks up to 3 short
 * questions instead of guessing. The user's free-text reply (or chip
 * tap) is parsed by the same regex rules as a normal query.
 */
export interface ClarifyingQuestion {
  /** stable id matching the IntentBrief slot: 'category' | 'time_of_day' | 'party' */
  id: 'category' | 'time_of_day' | 'party';
  /** user-facing question, already in the user's language */
  text: string;
  /** quick-tap options; each `value` is a regex trigger that parse_intent understands */
  options: Array<{ label: string; value: string }>;
}

export interface AgentChatResponse {
  session_id: string;
  reply: string;
  cards: EventCard[];
  warnings: string[];
  /**
   * Zero-result broadening label, surfaced by search_events. The agent
   * reports it in the reply so the user knows why the date window or
   * category filter was relaxed (e.g. "hittade inget pa fredag - har ar
   * helgen istallet"). `null` when the strict query matched.
   *
   * Machine-readable so the LLM composer can include it in the
   * deterministic fallback copy. See llmRouter.deterministicReply.
   */
  relaxed_constraint?: 'date_window' | 'category' | null;
  /**
   * At most ONE clarifying question, attached alongside `cards` (never in
   * place of them). The chat handler ALWAYS runs the search pipeline; when
   * the intent is sparse, the highest-gain question is attached so the
   * user sees results AND a nudge to refine.
   *
   * `null` (or omitted) when the intent is already complete enough.
   * `undefined` is the wire-level "no field at all" for back-compat with
   * clients that do not yet parse this key.
   */
  clarifying_question?: ClarifyingQuestion | null;
  /**
   * Legacy array form, capped at 1 entry (MAX_QUESTIONS). Preserved for
   * back-compat with existing clients. New clients should prefer
   * `clarifying_question` (the single-question contract is easier to
   * enforce on the client side).
   */
  clarifying_questions?: ClarifyingQuestion[];
}
