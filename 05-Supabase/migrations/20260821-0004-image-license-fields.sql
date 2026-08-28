-- 20260821-0004-image-license-fields.sql
--
-- T0052 image rights/license policy — schema-fält.
-- Vault-spec: 00-Vault/01-Projects/EventPulse/04-Sources/22-Image-Rights-Policy.md
--
-- Schema:
--   image_license      TEXT NULL  — enum (cc-by | cc0 | pressbild |
--                                         copyright-with-attribution |
--                                         unknown). NULL = "not yet classified".
--                                     CHECK constraint enforces allowed values.
--   image_attribution  TEXT NULL  — free-form attribution string ("Photo: Billetto",
--                                     "CC BY — John Doe"). NULL = no attribution
--                                     needed (pressbild) or not yet specified.
--   image_source_url   TEXT NULL  — original image URL when runtime serves via
--                                     proxy/cache. NULL = same as image_url.
--
-- Policy reference: T0020/T0021 audit established EventPulse served images
-- directly from external URLs with no rights/license metadata. T0052 introduces
-- the metadata layer to comply with copyright attribution requirements.
--
-- RLS:
--   anon / authenticated : SELECT through events_public view (already granted).
--   service_role         : full access (writes go via backend ingestion / agent).
--
-- Idempotency: ALTER TABLE ... ADD COLUMN IF NOT EXISTS is safe. New columns
-- default to NULL so existing rows are unaffected (back-compat). The CHECK
-- constraint is added IF NOT EXISTS via DO block (PG < 16 doesn't have
-- IF NOT EXISTS for constraints).

BEGIN;

-- ─── Add image_license column with enum-style CHECK ──────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_license TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_image_license_check'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_image_license_check
      CHECK (image_license IS NULL OR image_license IN (
        'cc-by',
        'cc0',
        'pressbild',
        'copyright-with-attribution',
        'unknown'
      ));
  END IF;
END $$;

-- ─── Add image_attribution column (free-form text) ──────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_attribution TEXT;

-- ─── Add image_source_url column (original URL when proxied) ────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_source_url TEXT;

-- ─── Index: filter by license for batch audits / re-classification ─────────
-- Partial index: only rows with a license set (the useful subset for queries
-- like "show me all events that need attribution rendered in UI").
CREATE INDEX IF NOT EXISTS idx_events_image_license_present
  ON events (image_license)
  WHERE image_license IS NOT NULL;

-- ─── Update events_public view to expose new columns ────────────────────────
-- The view is recreated to include the three new columns right after
-- image_url, preserving the existing field order for downstream clients.
-- The base events table is the source of truth — view is a projection.
CREATE OR REPLACE VIEW events_public AS
SELECT
  e.id,
  e.title_en,
  e.title_sv,
  e.description_en,
  e.description_sv,
  e.start_time,
  e.end_time,
  e.source,
  e.venue_id,
  e.lat,
  e.lng,
  e.location,
  e.is_free,
  e.price_min_sek,
  e.price_max_sek,
  e.ticket_url,
  e.image_url,
  e.image_license,
  e.image_attribution,
  e.image_source_url,
  e.category_slug,
  e.confidence_score,
  e.freshness_at,
  e.status_expanded
FROM events e
WHERE e.status = 'published';

GRANT SELECT ON events_public TO anon, authenticated;

-- ─── Audit-log row: confidence-v1 should not change here ───────────────────
-- Image license does NOT affect confidence scoring (it is metadata, not
-- content quality). The existing +10 image_url scoring in
-- 20260818-0002-confidence-v1.sql remains unchanged.

COMMIT;
