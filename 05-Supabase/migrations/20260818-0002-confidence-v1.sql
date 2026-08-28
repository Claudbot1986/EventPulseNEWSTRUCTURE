-- 20260818-0002-confidence-v1.sql
--
-- Confidence v1 scorer — per docs/MASTERPLAN.md §181-190.
-- Heuristic, not ML. Each row gets a score in [0, 100].
--
-- Components (sum, then clamp):
--   +20 venue_id resolved
--   +20 future start_time
--   +15 price present (price_min_sek / price_max_sek) OR is_free = true
--   +10 image_url present
--   +15 freshness_at within 7 days of now()
--   +20 source is a known structured feed
--         (ticketmaster, eventbrite, berwaldhallen-tixly, konserthuset, dramaten)
--
-- Notes:
--   * Idempotent — running again produces the same scores as long as
--     events.* hasn't changed.
--   * freshness_at is preserved when present (COALESCE), and seeded to
--     NOW() where NULL. Future ingestion should overwrite freshness_at
--     on each successful parse so the "+15 within 7 days" component
--     stays meaningful. The current worker does not yet set this — see
--     docs/AGENT-FOUNDATION-PHASE0.md §3 item 4.
--   * The "+20 future start_time" component is currently always true
--     because events_public filters out past rows. It stays in the
--     formula for consistency with MASTERPLAN but does not differentiate.
--   * The "+20 structured data" component is approximated by source
--     membership. A future migration can switch to a raw_data->>'@type'
--     check once raw_data is exposed on events_public.
--   * status = 'published' is the only scope — drafts, cancelled, etc.
--     are not scored (events_public filters them out anyway).

BEGIN;

UPDATE events
SET freshness_at = COALESCE(freshness_at, NOW())
WHERE freshness_at IS NULL
  AND status = 'published';

UPDATE events
SET confidence_score = LEAST(100, GREATEST(0,
  (CASE WHEN venue_id IS NOT NULL THEN 20 ELSE 0 END)
  + (CASE WHEN start_time > NOW() THEN 20 ELSE 0 END)
  + (CASE WHEN (price_min_sek IS NOT NULL OR price_max_sek IS NOT NULL OR is_free = true) THEN 15 ELSE 0 END)
  + (CASE WHEN image_url IS NOT NULL THEN 10 ELSE 0 END)
  + (CASE WHEN freshness_at > NOW() - INTERVAL '7 days' THEN 15 ELSE 0 END)
  + (CASE WHEN source IN ('ticketmaster', 'eventbrite', 'berwaldhallen-tixly', 'konserthuset', 'dramaten') THEN 20 ELSE 0 END)
))
WHERE status = 'published';

COMMIT;