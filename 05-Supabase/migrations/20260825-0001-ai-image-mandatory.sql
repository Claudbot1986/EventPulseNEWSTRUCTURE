-- 20260825-0001-ai-image-mandatory.sql
--
-- Gör AI-genererade bilder obligatoriska i hela pipeline.
--
-- Bakgrund: tidigare hade vi en mix av upstream-originalbilder (Ticketmaster,
-- Eventbrite, scrape) och AI-genererade bilder. Originalerna är inte
-- licensierade för återpublicering. Denna migration sätter de schema-fält
-- som krävs för att garantera 100 % AI-generering vid ingestion.
--
-- Schema:
--   image_ai_generated         BOOLEAN  — TRUE om bilden är AI-genererad
--                                          (EventPulse hem* pipeline + EU
--                                          AI Act Art. 50-stämplad).
--                                          Source of truth för "är bilden AI?".
--   image_prompt               TEXT     — prompt som användes (audit trail).
--   image_model                TEXT     — modellnamn, t.ex. 'flux-dev'.
--   image_generated_at         TIMESTAMPTZ — när bilden genererades.
--   image_generation_status    TEXT     — 'pending' (köad) | 'completed' (klar)
--                                          | 'failed' (BFL-fel, max retries
--                                          uppnådda) | 'no_credits' (BFL-
--                                          kredit slut — UI visar "no credits
--                                          BFL - recharge", workern pausar).
--   image_generation_attempts  INT      — antal försök som gjorts.
--   image_generation_error     TEXT     — sista felet om status='failed'.
--
-- image_license-utökning:
--   Enum utökas med 'ai-generated'. Befintliga värden ('cc-by', 'cc0',
--   'pressbild', 'copyright-with-attribution', 'unknown') bevaras.
--
-- Backfill:
--   Befintliga AI-genererade bilder identifieras via URL-prefix
--   '/event-posters/events/' eller '/event-posters/ai-generated/'. Dessa
--   markeras image_ai_generated=TRUE och image_generation_status='completed'
--   så att backfill-scriptet inte regenererar dem.
--
-- events_public-view uppdateras för att exponera de nya kolumnerna.
--
-- Idempotency: ALTER TABLE ADD COLUMN IF NOT EXISTS, DROP/ADD CONSTRAINT
-- wrapped i DO-blocks. Kan köras flera gånger utan fel.

BEGIN;

-- ─── Nya kolumner ──────────────────────────────────────────────────────────

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_ai_generated BOOLEAN DEFAULT FALSE;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_prompt TEXT;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_model TEXT;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_generated_at TIMESTAMPTZ;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_generation_status TEXT;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_generation_attempts INT DEFAULT 0;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_generation_error TEXT;

-- ─── image_generation_status CHECK (egen, fristående från license) ────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_image_generation_status_check'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_image_generation_status_check
      CHECK (image_generation_status IS NULL OR image_generation_status IN (
        'pending',
        'completed',
        'failed',
        'no_credits'
      ));
  END IF;
END $$;

-- ─── Utöka image_license CHECK med 'ai-generated' ─────────────────────────

-- Drop och re-add eftersom PostgreSQL saknar ALTER CHECK syntax.
-- Vi tillåter NULL för bakåtkompatibilitet (nya rader behöver inte sätta
-- license förrän AI-bilden är klar).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_image_license_check'
  ) THEN
    ALTER TABLE events DROP CONSTRAINT events_image_license_check;
  END IF;
END $$;

ALTER TABLE events
  ADD CONSTRAINT events_image_license_check
  CHECK (image_license IS NULL OR image_license IN (
    'cc-by',
    'cc0',
    'pressbild',
    'copyright-with-attribution',
    'unknown',
    'ai-generated'
  ));

-- ─── Backfilla redan-AI-genererade rader ──────────────────────────────────
-- Identifieras via URL-prefix. Sätter image_ai_generated=TRUE och status='completed'
-- så att backfill-scriptet hoppar över dem.

UPDATE events
SET
  image_ai_generated = TRUE,
  image_license = 'ai-generated',
  image_attribution = COALESCE(image_attribution, 'AI-generated image (EU AI Act Art. 50)'),
  image_generation_status = 'completed',
  image_generated_at = COALESCE(image_generated_at, NOW()),
  image_model = COALESCE(image_model, 'flux-dev')
WHERE image_url LIKE '%/event-posters/events/%'
   OR image_url LIKE '%/event-posters/ai-generated/%';

-- ─── Index: worker-frågan (hämta pending + failed för retry) ──────────────

CREATE INDEX IF NOT EXISTS idx_events_image_pending
  ON events (image_generation_status, image_generated_at)
  WHERE image_ai_generated = FALSE;

-- ─── events_public-view: exponera nya kolumner ────────────────────────────

DROP VIEW IF EXISTS events_public;

CREATE VIEW events_public AS
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
  e.image_ai_generated,
  e.image_prompt,
  e.image_model,
  e.image_generated_at,
  e.image_generation_status,
  e.category_slug,
  e.confidence_score,
  e.freshness_at,
  e.status_expanded
FROM events e
WHERE e.status = 'published';

GRANT SELECT ON events_public TO anon, authenticated;

COMMIT;