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
  | 'venue_personalization_penalty';

export interface EventCard {
  id: string;
  title: string;
  start_time: string;
  end_time?: string | null;
  venue_name: string;
  city: string;
  category_slug: string;
  price_min_sek?: number | null;
  price_max_sek?: number | null;
  is_free: boolean;
  ticket_url?: string | null;
  image_url?: string | null;
  /**
   * Source id from events.source — the ingestor that produced this row.
   * Surfaced in the UI so the user can see which site the event came from
   and (where a public homepage URL is registered) link to the source.
   Not all sources have a public homepage; the UI degrades gracefully
   (shows name, no link).
   */
  source?: string | null;
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
}

// ─── Feedback ───────────────────────────────────────────────────────────────
export interface RecordFeedbackInput {
  client_user_id: string;
  session_id?: string;
  event_id: string;
  interaction: 'impression' | 'click' | 'outbound' | 'save' | 'dismiss' | 'feedback_positive' | 'feedback_negative';
  query_text?: string;
  rank_position?: number;
  reasons?: RankReason[];
  /** Free-form metadata blob. Persisted to user_interactions.metadata JSONB.
   *  Used by the experiment layer to tag rows with experiment_id + variant
   *  (see 08-Agent/tools/experiments.ts). */
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
