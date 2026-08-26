-- 20260826-0001-events-image-ai-optout.sql
--
-- Per-event opt-out flag for the AI-image rollout in the Utforska tab.
--
-- Bakgrund: när AI-bilder blir obligatoriska måste enskilda venues kunna
-- behålla sin egen pressbild (t.ex. specifika kulturhus som har förhandlat
-- rätt att visa original). Den här migrationen lägger till en boolean som:
--   - default = false  → alla events går igenom AI-pipelinen
--   - true             → useAiImageUrl-hook visar originalbilden istället
--
-- Operationellt: sätts via admin-endpoint POST /agent/ai-image/optout.
-- Workern konsulterar fältet och skippar generering om sant (sätter
-- image_generation_status='failed', rör inte image_license).
--
-- events_public-view exponeras så att agent-feed kan forwarda fältet
-- till Expo-klienten (krävs av useAiImageUrl).
--
-- Idempotency: ADD COLUMN IF NOT EXISTS, DROP/CREATE view idempotent.

BEGIN;

-- ─── Ny kolumn ─────────────────────────────────────────────────────────────

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_ai_optout BOOLEAN NOT NULL DEFAULT FALSE;

-- Index: snabb lookup av opt-out events (för admin-audit).
CREATE INDEX IF NOT EXISTS idx_events_image_ai_optout
  ON events (image_ai_optout)
  WHERE image_ai_optout = TRUE;

-- ─── events_public-view: exponera image_ai_optout ─────────────────────────

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
  e.image_ai_optout,
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
