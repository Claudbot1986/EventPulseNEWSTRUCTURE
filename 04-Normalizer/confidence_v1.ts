/**
 * confidence_v1 — deterministic confidence scorer for normalized events.
 *
 * Mirrors `05-Supabase/migrations/20260818-0002-confidence-v1.sql` so the
 * TypeScript normalizer worker and the SQL backfill agree on every component.
 *
 * Masterplan §4 / §13. Heuristic only — no ML. Sum and clamp to [0, 100].
 *
 * Components (sum, then clamp):
 *   +20 venue_id resolved
 *   +20 future start_time
 *   +15 price present (price_min_sek / price_max_sek) OR is_free = true
 *   +10 image_url present
 *   +15 freshness_at within 7 days of `now`
 *   +20 source is a known structured feed
 *         (ticketmaster, eventbrite, berwaldhallen-tixly, konserthuset, dramaten)
 *
 * If a value is missing, the component contributes 0. Future rows from the
 * normalizer will always populate freshness_at, so the "+15 within 7 days"
 * component stays meaningful.
 */

export interface ConfidenceV1Input {
  venue_id: string | null;
  start_time: string;        // ISO timestamp (raw.start_time is required)
  price_min_sek: number | null;
  price_max_sek: number | null;
  is_free: boolean | null;
  image_url: string | null;
  freshness_at: string | null;
  source: string;
  /** Defaults to Date.now() — overridable for tests. */
  now?: Date;
}

/**
 * Sources whose ingestion pipeline is structured enough to count as
 * "+20 structured data". Keep in sync with the SQL migration list.
 */
export const STRUCTURED_SOURCES: ReadonlySet<string> = new Set([
  'ticketmaster',
  'eventbrite',
  'berwaldhallen-tixly',
  'konserthuset',
  'dramaten',
]);

export const CONFIDENCE_V1_MAX = 100;

export function computeConfidenceV1(input: ConfidenceV1Input): number {
  const now = input.now ?? new Date();
  let score = 0;

  if (input.venue_id) score += 20;

  // +20 future start_time
  const start = new Date(input.start_time);
  if (!Number.isNaN(start.getTime()) && start.getTime() > now.getTime()) {
    score += 20;
  }

  // +15 price present OR is_free
  if (
    input.price_min_sek != null ||
    input.price_max_sek != null ||
    input.is_free === true
  ) {
    score += 15;
  }

  if (input.image_url) score += 10;

  // +15 freshness_at within 7 days
  if (input.freshness_at) {
    const fresh = new Date(input.freshness_at);
    if (
      !Number.isNaN(fresh.getTime()) &&
      fresh.getTime() > now.getTime() - 7 * 24 * 3600_000
    ) {
      score += 15;
    }
  }

  // +20 structured source
  if (STRUCTURED_SOURCES.has(input.source)) score += 20;

  return Math.max(0, Math.min(CONFIDENCE_V1_MAX, score));
}