-- 20260826-0002-events-cleanup-non-ai-images.sql
--
-- Nollställer image_url + relaterade fält för events som INTE är AI-genererade.
-- Efter denna migration finns inga originalbilder kvar i events-tabellen.
--
-- Bakgrund: enligt user request 2026-08-26 ("inga originalbilder får finnas i
-- supabase för att förhindra att det läcker ut copywritematerial till projektet")
-- måste alla scrape-originaler (Ticketmaster, Eventbrite, pressbild) tas bort
-- från events.image_url. Detta är en striktare variant av den befintliga
-- backfillen i 20260825-0001-ai-image-mandatory.sql som bara backfillade
-- redan-AI-rader baserat på URL-prefix.
--
-- Vad denna migration gör:
--   1. Nollställer image_url, image_attribution, image_source_url
--      för events där image_license != 'ai-generated' (eller är NULL/okänd).
--   2. Markerar image_ai_generated = FALSE så workern plockar upp dem.
--   3. Sätter image_generation_status = 'pending' → workern processar dem
--      via befintlig ai-image-generation BullMQ-kö.
--
-- Säkerhet:
--   - Kör alltid 08-Agent/scripts/cleanup_non_ai_images.ts --dry-run först
--     för att se antal rader + exempel innan skarp körning.
--   - Opt-out events (image_ai_optout=TRUE) skyddas INTE automatiskt av
--     denna migration — de har per definition image_license != 'ai-generated'
--     om de behåller original, så de MÅSTE sättas tillbaka manuellt efter
--     cleanupen om man vill bevara originalbilden för dem.
--     → Kör --skip-optout flagga på cleanup-skriptet för att skydda dem.
--
-- ⚠️ KRITISK OPERATION: Tier 0 policy kräver explicit human approval innan
--    sharp apply. Dry-run är OK utan godkännande.

BEGIN;

-- ─── Nollställ icke-AI-rader ──────────────────────────────────────────────

UPDATE events
SET
  image_url = NULL,
  image_attribution = NULL,
  image_source_url = NULL,
  image_ai_generated = FALSE,
  image_model = NULL,
  image_generated_at = NULL,
  image_generation_status = 'pending',
  image_generation_attempts = 0,
  image_generation_error = NULL
WHERE image_license IS DISTINCT FROM 'ai-generated'
   OR image_ai_generated IS NOT TRUE;

COMMIT;
