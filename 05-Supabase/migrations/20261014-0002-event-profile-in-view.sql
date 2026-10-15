-- 20261014-0002-event-profile-in-view.sql
--
-- FAS 5.5 2026-10-14: events_public saknar event_profile-kolumnen.
-- feed_events.ts väljer 'event_profile' (rad 241) men vyn (20261010-0001) har
-- den inte. Resultat: /agent/feed returnerar
--   {"error":"feed_events: column events_public.event_profile does not exist"}
-- för ALLA anrop.
--
-- Säkerhet: event_profile är JSONB NULL med strukturerad EventProfile
-- (performer_metadata, subject_metadata, etc.) — INTE source_text eller
-- scrape-payload. Säker att exponera via anon/authenticated-roller.
--   Se 04-Normalizer/editorial/types.ts och
--   05-Supabase/migrations/20261007-0001-editorial-description-engine.sql:30.

BEGIN;

DROP VIEW IF EXISTS events_public;
CREATE VIEW events_public
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.title_en,
  e.title_sv,
  CASE
    WHEN e.description_license IN ('pressbild', 'copyright-with-attribution',
                                   'partner-licensed', 'public-domain')
    THEN e.description_en
    ELSE NULL
  END AS description_en,
  CASE
    WHEN e.description_license IN ('pressbild', 'copyright-with-attribution',
                                   'partner-licensed', 'public-domain')
    THEN e.description_sv
    ELSE NULL
  END AS description_sv,
  e.start_time,
  e.end_time,
  e.source,
  e.venue_id,
  e.venue_full_name,
  e.venue_full_address,
  e.venue_city,
  e.venue_lat,
  e.venue_lng,
  e.venue_url,
  e.venue_phone,
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
  e.status_expanded,
  e.is_online,
  e.online_url,
  e.link_status,
  e.link_last_checked_at,
  e.description_license,
  e.description_attribution,
  e.description_source_url,
  e.eventpulse_summary,
  e.eventpulse_summary_generated_at,
  e.eventpulse_summary_model,
  e.editorial_description,
  e.editorial_description_generated_at,
  -- FAS 5.5: strukturerad EventProfile JSONB. Säker (innehåller inte
  -- source_text eller scrape-payload; se 20261007-0001 editorial migration).
  e.event_profile
FROM events e
WHERE e.status = 'published'
  AND (e.link_status IS DISTINCT FROM 'dead');

GRANT SELECT ON events_public TO anon, authenticated;

INSERT INTO events_public_expected_columns (column_name, must_be_present, added_in_migration, rationale)
VALUES
  ('event_profile', TRUE, '20261014-0002', 'P7 Editorial Engine: strukturerad EventProfile JSONB. Säker (ingen source_text, ingen scrape-payload).')
ON CONFLICT (column_name) DO UPDATE SET
  must_be_present = EXCLUDED.must_be_present,
  added_in_migration = EXCLUDED.added_in_migration,
  rationale = EXCLUDED.rationale;

COMMIT;
