-- 20260827-0002-image-library-status.sql
--
-- Utöka CHECK-constraints för image_library-fallback (2026-08-27).
--
-- Bakgrund: när BFL är slut på credits / transient error → workern tilldelar
-- eventet en biblioteks-bild istället. Vi markerar detta med:
--   - image_generation_status = 'library_fallback' (UI/dashboard)
--   - image_license           = 'library-fallback' (audit / copyright trail)
--
-- image_ai_generated = false görs i markEventWithLibraryFallback() för att
-- särskilja från faktiskt AI-genererade bilder.
--
-- Drop + re-add krävs (PostgreSQL saknar ALTER CHECK).

BEGIN;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_image_generation_status_check;
ALTER TABLE events
  ADD CONSTRAINT events_image_generation_status_check
  CHECK (image_generation_status IS NULL OR image_generation_status IN (
    'pending',
    'completed',
    'failed',
    'no_credits',
    'library_fallback'
  ));

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_image_license_check;
ALTER TABLE events
  ADD CONSTRAINT events_image_license_check
  CHECK (image_license IS NULL OR image_license IN (
    'cc-by',
    'cc0',
    'pressbild',
    'copyright-with-attribution',
    'unknown',
    'ai-generated',
    'library-fallback'
  ));

COMMIT;