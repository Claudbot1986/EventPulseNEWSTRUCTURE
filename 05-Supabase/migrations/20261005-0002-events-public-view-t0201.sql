-- T0201 (2026-10-05) — events_public view med säker description-flöde.
--
-- BAKGRUND:
--   Tidigare exponerade `events_public.description_en/sv` rakt av till anon
--   REST — scraped text kunde visas utan rättighetskontroll. Detta är den
--   migration som stänger den luckan.
--
-- NY SÄKERHETSREGLER:
--   1. `eventpulse_summary` exponeras ALLTID (om den finns) — primärt
--      visningsfält för UI.
--   2. `description_en/sv` exponeras ENDAST om `description_license IN (...)`
--      (se beslut nedan).
--   3. `description_license`, `description_attribution` exponeras för UI att
--      visa attribution-badge.
--   4. `raw_description`, `eventpulse_summary_facts`, `eventpulse_summary_provenance`
--      exponeras ALDRIG — det är internt material (reprocessing, audit).
--
-- BESLUT (användarbeslut 2026-10-05):
--   Default license = 'unknown' innebär att description_en/sv INTE exponeras
--   publikt om source-registry inte gett en explicit tillåtande license.
--   Det är en striktare default än image_license-prejudikatet (T0052) — vi
--   följer användarens val.
--
-- BEROENDE:
--   Denna migration kräver att 20261005-0001-description-rights-summary.sql
--   applicerats. Kör den först.
--
-- OBS: Postgres kan INTE ändra kolumnordning via CREATE OR REPLACE VIEW.
-- Vi behåller exakt befintlig kolumnsekvens och lägger T0201-fält i slutet.
-- description_en/sv är på sina positioner 5-6 redan — vi ändrar bara deras
-- expression till CASE-WHEN-license.

BEGIN;

CREATE OR REPLACE VIEW events_public AS
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
  -- ── T0201-fält (nya, läggs till i slutet) ───────────────────────────
  e.description_license,
  e.description_attribution,
  e.description_source_url,
  e.eventpulse_summary,
  e.eventpulse_summary_generated_at,
  e.eventpulse_summary_model
FROM events e
WHERE e.status = 'published';

GRANT SELECT ON events_public TO anon, authenticated;

-- ─── Audit-kommentarer ─────────────────────────────────────────────────────
COMMENT ON VIEW events_public IS
  'Anon-läsbar vy över events. T0201 (2026-10-05): description_en/sv exponeras ENDAST om description_license är tillåtande (pressbild|copyright-with-attribution|partner-licensed|public-domain). raw_description, eventpulse_summary_facts och eventpulse_summary_provenance exponeras ALDRIG — det är internt material för reprocessing och audit.';

COMMENT ON COLUMN events_public.eventpulse_summary IS
  'Faktabaserad, deterministisk EventPulse-sammanfattning (T0201). Primärt visningsfält i UI om det finns. Byggs av 04-Normalizer/eventpulseSummary.ts.';

COMMENT ON COLUMN events_public.description_license IS
  'Rättighetsstatus för description_en/sv (T0201). Default unknown. UI visar description_en/sv ENDAST om license är tillåtande enligt events_public view-logik.';

COMMIT;