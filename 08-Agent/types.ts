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
  | 'stale';

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
   * Present iff the agent is asking the user for clarification.
   * When non-empty, `cards` is empty and `reply` is a brief lead-in.
   */
  clarifying_questions?: ClarifyingQuestion[];
}
