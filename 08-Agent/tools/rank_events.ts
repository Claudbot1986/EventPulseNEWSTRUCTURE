/**
 * rank_events — deterministic feature-based ranker.
 *
 * Phase 0: no LLM re-ranking. Weights below are the *initial* baseline;
 * they will be tuned against the golden eval set in Phase 1.
 *
 * Output is `reasons: RankReason[]` — an enum only — never free text.
 * This keeps the contract verifiable and prevents the model from inventing
 * rationale that we cannot trace.
 */

import type {
  EventCard,
  IntentBrief,
  RankedEvent,
  RankReason,
} from '../types';
import {
  type UserSignal,
  CATEGORY_BOOST_BETA,
  VENUE_PENALTY_GAMMA,
  MIN_SAVES,
  MIN_WEIGHTED_REJECTS,
  BOOST_CAP_FRACTION,
  PENALTY_CAP_ABS,
} from './personalize';

export const RANK_WEIGHTS = {
  time_fit:           25,
  under_budget:       20,
  over_budget:       -30,
  category_match:     30,
  exclude_match:     -50,
  not_ended:           5,
  high_confidence:    15,
  low_confidence:    -10,
  stale:             -15,
  stated_category_match: 0.3,
  followed_venue_match: 20,
  followed_artist_match: 15,
} as const;

/** Confidence threshold for the `high_confidence` ranker reason. */
export const CONFIDENCE_HIGH = 70;
/** Confidence below this triggers the `low_confidence` reason. */
export const CONFIDENCE_LOW = 50;
/** Freshness older than this (ms) triggers the `stale` reason. Default 14d. */
export const STALE_AFTER_MS = 14 * 24 * 3600_000;

/**
 * Default timezone used to bucket events into morning/afternoon/evening/night.
 * Product is Stockholm-only (MASTERPLAN §2), so we bucket by Stockholm
 * wall-clock hour — not the server's runtime timezone.
 *
 * Override via `RankOptions.timeZone` for tests (rare) or future multi-city.
 */
export const DEFAULT_TIME_ZONE = 'Europe/Stockholm';

export interface RankOptions {
  /** override default topN. Default 5. */
  topN?: number;
  /** ISO "now" — tests inject a deterministic value */
  now?: Date;
  /** IANA timezone for bucketing events. Default Europe/Stockholm. */
  timeZone?: string;
  /**
   * Per-user signal bundle from `buildUserSignal`. When provided AND the
   * user has enough history (≥ MIN_SAVES weighted saves OR ≥
   * MIN_WEIGHTED_REJECTS weighted rejects), count-based priors are
   * applied: category boost and venue badness penalty, both capped to
   * prevent filter-bubble pathology.
   *
   * See 08-Agent/tools/personalize.ts for the math + research citations.
   */
  personalization?: UserSignal;
  /**
   * User-declared category preferences from `user_preferences.categories`
   * (read by `loadStatedPreferences`). When the array is non-empty, every
   * event whose `category_slug` is in this set receives a small additive
   * boost (`RANK_WEIGHTS.stated_category_match`, default 0.3). The boost
   * is intentionally small — same magnitude discipline as `BOOST_CAP_FRACTION` —
   * so it nudges the ranking without dominating other features (notably
   * `category_match: 30` from the intent, and `time_fit: 25`). The
   * behavioral `personalization.categoryPosterior` boost remains additive
   * — users with both signals get both.
   */
  statedCategories?: ReadonlyArray<string>;
  /**
   * User-declared venue follows from `user_preferences.followed_venue_ids`
   * (read by `loadFollowedVenues`). When the array contains the card's
   * `venue_id`, the card receives a `followed_venue_match` boost
   * (`RANK_WEIGHTS.followed_venue_match`, default 20). The boost is
   * intentionally below `category_match` (30) and `time_fit` (25) so the
   * user's explicit intent still dominates declared prefs — same magnitude
   * discipline as `stated_category_match` (0.3). Empty / missing array
   * means no boost, no cost.
   *
   * T0050 / MVP-gap §77. Phase 1 declared pref; Phase 2 will add a
   * learned-personalization lift on top (Bayesian posterior on follows).
   */
  followedVenueIds?: ReadonlyArray<string>;
  /**
   * User-declared artist follows from `user_preferences.followed_artist_slugs`
   * (read by `loadFollowedArtists`). When the array contains any of the card's
   * `artist_slugs` (populated by `search_events.ts` via the `event_artists`
   * join), the card receives a `followed_artist_match` boost
   * (`RANK_WEIGHTS.followed_artist_match`, default 15). Lower than the venue
   * boost because artists are inherently weaker signal than venues for "I'll
   * go tonight" — a venue implies the user is geographically anchored; an
   * artist often plays in cities the user won't travel to. Empty / missing
   * array means no boost, no cost.
   *
   * T0050 / MVP-gap §77. Phase 1 declared pref.
   */
  followedArtistSlugs?: ReadonlyArray<string>;
}

/**
 * Wall-clock hour (0–23) of an ISO instant at the given IANA timezone.
 *
 * Pure function — exported so tests can pin behavior without touching the
 * ranker. Uses `Intl.DateTimeFormat` (no external deps) to read the hour in
 * the target timezone, which correctly handles DST (CEST/CET) shifts that a
 * naive offset-based approach would get wrong across spring/fall.
 *
 * Returns NaN if the ISO is unparseable. `formatToParts` can yield `hour`
 * as `"24"` for midnight in some locales — normalized to `0` to match the
 * bucket logic (hour 0 is night, not a separate "24" bucket).
 */
export function hourInTimeZone(iso: string, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(iso));
  const hourPart = parts.find((p) => p.type === 'hour');
  if (!hourPart) return NaN;
  const h = parseInt(hourPart.value, 10);
  return h === 24 ? 0 : h;
}

export function rankEvents(
  cards: EventCard[],
  intent: IntentBrief,
  opts: RankOptions = {}
): RankedEvent[] {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const topN = opts.topN ?? 5;
  const timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;

  const scored: RankedEvent[] = cards.map((c) => {
    const reasons: RankReason[] = [];
    let score = 0;

    // not_ended
    if (new Date(c.start_time).getTime() > nowMs) {
      score += RANK_WEIGHTS.not_ended;
      reasons.push('not_ended');
    }

    // time_fit (rough hour bucket vs intent.time_of_day) — uses wall-clock
    // hour in the product timezone, NOT the server's runtime timezone.
    // Otherwise Q21 "konsert ikväll" passes only by accident when the server
    // happens to run in UTC and an evening event at 22:00 local falls into
    // the UTC evening bucket instead of the Stockholm night bucket.
    const hour = hourInTimeZone(c.start_time, timeZone);
    if (
      (intent.time_of_day === 'morning'   && hour >= 6  && hour < 12) ||
      (intent.time_of_day === 'afternoon' && hour >= 12 && hour < 17) ||
      (intent.time_of_day === 'evening'   && hour >= 17 && hour < 22) ||
      (intent.time_of_day === 'night'     && (hour >= 22 || hour < 6))
    ) {
      score += RANK_WEIGHTS.time_fit;
      reasons.push('time_fit');
    }

    // budget
    if (intent.budget === 'free' && c.is_free) {
      score += RANK_WEIGHTS.under_budget;
      reasons.push('under_budget');
    } else if (intent.budget === 'free' && !c.is_free) {
      score += RANK_WEIGHTS.over_budget;
      reasons.push('over_budget');
    }

    // category match
    if (intent.categories.length > 0 && intent.categories.includes(c.category_slug)) {
      score += RANK_WEIGHTS.category_match;
      reasons.push('category_match');
    }

    // exclude
    if (intent.exclude_categories.length > 0 && intent.exclude_categories.includes(c.category_slug)) {
      score += RANK_WEIGHTS.exclude_match;
      reasons.push('exclude_match');
    }

    // confidence (only if score is known — null/undefined is "no signal yet")
    if (typeof c.confidence_score === 'number') {
      if (c.confidence_score >= CONFIDENCE_HIGH) {
        score += RANK_WEIGHTS.high_confidence;
        reasons.push('high_confidence');
      } else if (c.confidence_score < CONFIDENCE_LOW) {
        score += RANK_WEIGHTS.low_confidence;
        reasons.push('low_confidence');
      }
    }

    // freshness — ISO timestamp older than STALE_AFTER_MS triggers `stale`
    if (c.freshness_at) {
      const freshMs = new Date(c.freshness_at).getTime();
      if (Number.isFinite(freshMs) && nowMs - freshMs > STALE_AFTER_MS) {
        score += RANK_WEIGHTS.stale;
        reasons.push('stale');
      }
    }

    // Personalization priors (count-based, research-backed; see personalize.ts).
    // Applied AFTER all base features so the prior can only nudge, never
    // dominate. Both priors are subject to min-N gates and magnitude caps.
    if (opts.personalization) {
      const p = opts.personalization;

      // Category boost: Bayesian posterior of "liked this category",
      // log-compressed and capped to bound the filter-bubble effect.
      if (p.totalSaves >= MIN_SAVES && p.categoryPosterior[c.category_slug] !== undefined) {
        const posterior = p.categoryPosterior[c.category_slug];
        const raw = CATEGORY_BOOST_BETA * Math.log(1 + p.totalSaves * posterior);
        const cap = CATEGORY_BOOST_BETA * Math.log(1 + BOOST_CAP_FRACTION * p.totalSaves);
        const boost = Math.max(0, Math.min(raw, cap));
        if (boost > 0) {
          score += boost;
          reasons.push('category_personalization');
        }
      }

      // Venue penalty: Wilson lower bound of "this venue was rejected",
      // capped to a small absolute bound.
      if (p.weightedRejects >= MIN_WEIGHTED_REJECTS && p.venueBadness[c.venue_name] !== undefined) {
        const badness = p.venueBadness[c.venue_name];
        const penalty = -Math.min(VENUE_PENALTY_GAMMA * badness, PENALTY_CAP_ABS);
        if (penalty < 0) {
          score += penalty;
          reasons.push('venue_personalization_penalty');
        }
      }
    }

    // Stated-category boost (T0023). Distinct from the count-based
    // behavioral prior above: this is the user's EXPLICIT declaration from
    // `user_preferences.categories`, not an inference from saves/rejects.
    // Small constant weight (0.3) keeps it as a nudge — it cannot displace
    // `category_match` (30) or `time_fit` (25). Gated on a non-empty array
    // so users with no stated prefs incur zero cost. The two boosts stack
    // for users who have both signals.
    if (opts.statedCategories && opts.statedCategories.length > 0
        && opts.statedCategories.includes(c.category_slug)) {
      score += RANK_WEIGHTS.stated_category_match;
      reasons.push('stated_category_match');
    }

    // Followed-venue boost (T0050 / MVP-gap §77). Triggered when the user
    // has explicitly followed this venue via `POST /agent/follow` and the
    // venue UUID matches `EventCard.venue_id`. The boost (20) sits between
    // `under_budget` (20) and `category_match` (30) so a followed venue
    // surfaces near the top when the user intent is generic but stays
    // below a strong category match when the intent is specific.
    //
    // Gated on:
    //   - non-empty `followedVenueIds` (zero cost when user follows nothing)
    //   - non-null `card.venue_id` (orphan events without venue are skipped)
    //   - UUID equality (string compare; UUIDs are normalized by supabase)
    if (opts.followedVenueIds && opts.followedVenueIds.length > 0
        && c.venue_id && opts.followedVenueIds.includes(c.venue_id)) {
      score += RANK_WEIGHTS.followed_venue_match;
      reasons.push('followed_venue');
    }

    // Followed-artist boost (T0050 / MVP-gap §77). Triggered when the user
    // has explicitly followed at least one artist on this event via
    // `POST /agent/follow`. The card must expose `artist_slugs` (populated
    // by search_events.ts via the event_artists join). The boost (15) sits
    // below `followed_venue_match` (20) because artists are inherently
    // weaker "I'll go tonight" signal — a venue implies geographic anchor,
    // an artist often plays in cities the user won't travel to.
    //
    // Case-insensitive comparison guards against case drift between the
    // storage slug (lowercased in follow_entity.ts) and any future join
    // that might emit mixed case.
    if (opts.followedArtistSlugs && opts.followedArtistSlugs.length > 0
        && c.artist_slugs && c.artist_slugs.length > 0) {
      const followed = opts.followedArtistSlugs;
      const cardSlugs = c.artist_slugs;
      let matchedArtist = false;
      for (const a of cardSlugs) {
        if (!a) continue;
        const lc = a.toLowerCase();
        if (followed.includes(lc)) {
          matchedArtist = true;
          break;
        }
      }
      if (matchedArtist) {
        score += RANK_WEIGHTS.followed_artist_match;
        reasons.push('followed_artist');
      }
    }

    return { card: c, score, reasons };
  });

  // Stable sort: score desc, then earliest start_time, then id.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = new Date(a.card.start_time).getTime();
    const tb = new Date(b.card.start_time).getTime();
    if (ta !== tb) return ta - tb;
    return a.card.id.localeCompare(b.card.id);
  });

  return scored.slice(0, topN);
}
