-- 08-Agent/scripts/migrate_storage_paths.sql
--
-- Uppdatera DB-paths efter att migrate_to_import_buckets.ts har kopierat
-- filer från event-posters/{ai-generated,ai-stamped}/ till
-- event-posters/{import-original,import-stamped}/.
--
-- Användarens val (2026-09-01): library-bilder flyttas till import-stamped/
-- så att ALLA events har enhetlig stämpel-upplevelse i Utforska.
--
-- ── FÖRUTSÄTTNINGAR (kör i ordning) ──
-- 1. npx tsx --env-file=.env 08-Agent/scripts/migrate_to_import_buckets.ts
--    (kopierar 1828 filer, 910 → import-original/, 918 → import-stamped/)
-- 2. npx tsx --env-file=.env 08-Agent/scripts/stamp_all_originals.ts
--    (säkerställer att ALLA library-bilder har en stämplad kopia i import-stamped/)
-- 3. Kör detta SQL-skript i Supabase Studio → SQL Editor.
--
-- ── TRANSACTION ──
-- Allt-i-en transaktion: antingen allt eller inget.
BEGIN;

-- Pre-flight sanity checks (visar som query results)
SELECT
  (SELECT COUNT(*) FROM image_library WHERE storage_path LIKE '%/ai-generated/%') AS lib_ai_generated_rows,
  (SELECT COUNT(*) FROM image_library WHERE storage_path LIKE '%/ai-stamped/%')   AS lib_ai_stamped_rows,
  (SELECT COUNT(*) FROM events WHERE image_url LIKE '%/ai-generated/%')           AS ev_ai_generated_rows,
  (SELECT COUNT(*) FROM events WHERE image_url LIKE '%/ai-stamped/%')             AS ev_ai_stamped_rows;

-- 1. image_library: ai-generated/ → import-original/  (storage_path + public_url)
UPDATE image_library
SET
  storage_path = REPLACE(storage_path, '/ai-generated/', '/import-original/'),
  public_url   = REPLACE(public_url,   '/ai-generated/', '/import-original/')
WHERE storage_path LIKE '%/ai-generated/%';

-- 2. image_library: ai-stamped/ → import-stamped/  (storage_path + public_url)
UPDATE image_library
SET
  storage_path = REPLACE(storage_path, '/ai-stamped/', '/import-stamped/'),
  public_url   = REPLACE(public_url,   '/ai-stamped/', '/import-stamped/')
WHERE storage_path LIKE '%/ai-stamped/%';

-- 3. events.image_url: ai-generated/ → import-stamped/  (library-vägen → stämplat)
UPDATE events
SET image_url = REPLACE(image_url, '/ai-generated/', '/import-stamped/')
WHERE image_url LIKE '%/ai-generated/%';

-- 4. events.image_url: ai-stamped/ → import-stamped/
UPDATE events
SET image_url = REPLACE(image_url, '/ai-stamped/', '/import-stamped/')
WHERE image_url LIKE '%/ai-stamped/%';

-- 5. events.image_url: events/ → import-stamped/  (legacy pre-2026-08-27-konvention
--    som 790 library_fallback-events pekade på — upptäckt vid Fas 2-verifiering)
UPDATE events
SET image_url = REPLACE(image_url, '/events/', '/import-stamped/')
WHERE image_url LIKE '%/event-posters/events/%';

-- Post-flight verifiering (ska alla vara 0)
SELECT
  (SELECT COUNT(*) FROM image_library WHERE storage_path LIKE '%/ai-generated/%' OR storage_path LIKE '%/ai-stamped/%') AS remaining_lib_old,
  (SELECT COUNT(*) FROM events WHERE image_url LIKE '%/ai-generated/%' OR image_url LIKE '%/ai-stamped/%' OR image_url LIKE '%/event-posters/events/%')               AS remaining_ev_old,
  (SELECT COUNT(*) FROM events WHERE image_generation_status = 'library_fallback' AND image_url NOT LIKE '%/import-stamped/%') AS library_fallback_misrouted;

COMMIT;
