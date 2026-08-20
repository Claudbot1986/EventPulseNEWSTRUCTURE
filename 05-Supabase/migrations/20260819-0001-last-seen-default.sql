-- 20260819-0001-last-seen-default.sql
--
-- Close the gap between the SQL confidence backfill
-- (20260818-0002-confidence-v1.sql) and the normalizer worker
-- (04-Normalizer/normalizer.ts).
--
-- Background:
--   * `events.freshness_at` was added without a DEFAULT and is seeded by
--     the 20260818-0002 migration via COALESCE + NOW() at backfill time.
--   * `events.last_seen_at` was added without a DEFAULT and never seeded
--     by any migration. On the live database, every row has NULL there
--     (verified 2026-08-19: 100% NULL coverage).
--   * The normalizer will start writing freshness_at / last_seen_at /
--     confidence_score on every insert and update from now on, but rows
--     that have already been imported still need defaults so that
--     ranking, freshness filters, and provenance surfaces can rely on
--     non-null values.
--
-- What this migration does:
--   1. Add DEFAULT now() on freshness_at and last_seen_at so future writes
--      from any code path that omits them still get a timestamp.
--      (Note: existing INSERTs in 04-Normalizer still pass explicit
--      timestamps; the DEFAULT is defense-in-depth.)
--   2. Backfill last_seen_at = freshness_at for rows where it is NULL
--      and freshness_at is set, so staleness ranking reflects the
--      last-known observation rather than NULL.
--   3. Backfill last_seen_at = created_at for rows where both are NULL
--      (should be empty post-20260818-0001 backfill, but safe).
--   4. Leave confidence_score untouched — that migration is idempotent
--      and already runs cleanly; the new normalizer will refresh it on
--      the next parse.
--
-- Idempotency: SET DEFAULT is idempotent. Backfills are WHERE NULL
-- guards, so re-running this file is a no-op.

BEGIN;

ALTER TABLE events
  ALTER COLUMN freshness_at SET DEFAULT now();
ALTER TABLE events
  ALTER COLUMN last_seen_at SET DEFAULT now();

-- 2. Backfill: prefer freshness_at (when did we last verify the row?).
UPDATE events
SET    last_seen_at = freshness_at
WHERE  last_seen_at IS NULL
  AND  freshness_at IS NOT NULL;

-- 3. Fallback: rows with neither field set fall back to created_at.
UPDATE events
SET    last_seen_at = created_at,
       freshness_at = COALESCE(freshness_at, created_at)
WHERE  last_seen_at IS NULL;

COMMIT;