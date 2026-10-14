-- 20261014-0001-editorial-description-in-view.sql
--
-- FAS 5.4 2026-10-14: events_public saknar editorial_description +
-- editorial_description_generated_at. 11 292 events har dessa fält satta
-- (MiniMax-M3 + FACT-template), men /agent/feed returnerar NULL eftersom
-- PostgREST-projection använder vyn.
--
-- Symptom: UI:t visar "ingen beskrivning finns från <källa>" för events som
-- har editorial_description eftersom descriptionFallback.js får null från API:t.
--
-- Fix: utöka events_public med två nya kolumner, samma SECURITY INVOKER-policy
-- som 20261010-0001 Alt A-städ.
--
-- Säkerhet:
--   - SECURITY INVOKER: samma som tidigare.
--   - Inget annat fält exponeras.
--   - RLS-guard: editorial_description är OK att exponera (deterministisk text
--     från strukturerade Profile-fält, inte source_text — textualFirewall belagd).
--
-- Idempotency: DROP VIEW IF EXISTS + CREATE OR REPLACE.

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
  -- FAS 5.4 2026-10-14: editorial_description (MiniMax-M3 / FACT-template)
  -- är primär källa för UI:t (06-UI/utils/descriptionFallback.js, steg 1).
  -- Utan detta fältet får UI:t null och visar "ingen beskrivning"-fallback.
  -- Säker att exponera: genereras av deterministisk pipeline från strukturerade
  -- Profile-fält (MusicBrainz CC0 / Wikidata CC0 / curator-data), inte source_text.
  -- textualFirewall belagd i 04-Normalizer/editorial/.
  e.editorial_description,
  e.editorial_description_generated_at
FROM events e
WHERE e.status = 'published'
  AND (e.link_status IS DISTINCT FROM 'dead');

GRANT SELECT ON events_public TO anon, authenticated;

-- Uppdatera expected_columns så lockdown-validering Check E inte failar
INSERT INTO events_public_expected_columns (column_name, must_be_present, added_in_migration, rationale)
VALUES
  ('editorial_description', TRUE, '20261014-0001', 'P7 Editorial Description Engine — primär beskrivning för UI:t (descriptionFallback.js steg 1).'),
  ('editorial_description_generated_at', TRUE, '20261014-0001', 'Timestamp för staleness-logik. Forwardad av UI:t för framtida uppdaterings-signals.')
ON CONFLICT (column_name) DO UPDATE SET
  must_be_present = EXCLUDED.must_be_present,
  added_in_migration = EXCLUDED.added_in_migration,
  rationale = EXCLUDED.rationale;

COMMIT;
