-- 20261004-0001-events-image-url-contract-check.sql
--
-- Hårdar AI-bild-kontraktet: image_url får bara vara satts när bilden är
-- AI-genererad (image_ai_generated=true) eller en uttrycklig opt-out
-- (image_ai_optout=true — auktoriserad källa med leverantörsavtal) eller
-- en biblioteks-bild (image_generation_status='library_fallback').
--
-- Bakgrund (2026-10-04, user request):
--   341 rader i events_public hade image_url pekandes mot källans hemsida
--   (cms.dramaten.se m.fl.) med image_ai_generated=false,
--   image_ai_optout=false, image_generation_status=NULL — brott mot
--   user-policy "Samtliga bilder i repot ska använda ai-genererade bilder
--   från biblioteket". Klienten (useAiImageUrl rule 5) visade tom
--   placeholder, men data i DB var fortfarande copyright-stridigt. Manuell
--   PATCH nollställde dem.
--
-- Denna migration förhindrar att liknande brott kan återuppstå via
-- framtida INSERT/UPDATE som inte går via F-eventExtraction/extractor.ts
-- (som redan tvingar image_url=null för scrape-originaler).
--
-- Kontrakt:
--   image_url IS NULL
--     ELLER
--   image_ai_generated=true
--     ELLER
--   image_ai_optout=true
--     ELLER
--   image_generation_status='library_fallback'
--
-- Övriga tillåtna states (completed/failed/pending/no_credits) kräver
-- NULL i image_url — de är workerns transient states.
--
-- Säkerhet:
--   - Kör --dry-run först för att lista brotts-rader (förväntat 0 efter
--     PATCH 2026-10-04). Om det finns >0 rader kan de inte ha clearats.
--   - Migrationen är idempotent: DROP CONSTRAINT IF EXISTS + ADD.
--   - NOT VALID-konstraint används EFTERVALIDATION: snabbare på stora
--     tabeller, validerar bara nya inserts. FULL VALIDATE kräver separat
--     steg för redan existerande rader.
--
-- ⚠️ Tier 0 policy: kör --dry-run först, explicit human approval för sharp.

BEGIN;

-- 1. Drop gammal constraint om den fanns (idempotent).
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_image_url_contract_check;

-- 2. Lägg till ny constraint med NOT VALID — fångar alla nya INSERT/UPDATE.
--    Validering av existerande rader görs i ett separat steg om/när
--    tabellexpansion tillåter det (FULL VALIDATE kan låsa events-tabellen).
ALTER TABLE events
  ADD CONSTRAINT events_image_url_contract_check
  CHECK (
    image_url IS NULL
    OR image_ai_generated = true
    OR image_ai_optout = true
    OR image_generation_status = 'library_fallback'
  ) NOT VALID;

COMMIT;

-- 2026-10-04 — separat validering (efter att dry-run visar 0 brotts-rader).
-- ALTER TABLE events VALIDATE CONSTRAINT events_image_url_contract_check;