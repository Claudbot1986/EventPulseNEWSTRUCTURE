-- 20261029-0002-image-library-storage-path-unique.sql
--
-- Gör image_library.storage_path UNIQUE.
--
-- Bakgrund (2026-10-29): image_library hade INGEN unik constraint på
-- storage_path — bara vanliga index. Det gjorde att:
--   1. `upsert(..., { onConflict: 'storage_path' })` inte gick att köra
--      ("no unique or exclusion constraint matching the ON CONFLICT").
--   2. Samma bild kunde registreras flera gånger.
--
-- Mätt före migrationen: 422 rader, 422 unika storage_path → inga
-- dubbletter, så indexet kan skapas utan dedup-steg.
--
-- Varför det spelar roll: storage_path bygger den public URL som appen
-- laddar bilder från (08-Agent/utils/imageLibrary.ts →
-- publicUrlFor(storage_path) → SUPABASE_STORAGE_URL + storage_path).
-- Dubbletter eller trasiga sökvägar ger tysta tomma bilder i UI:t.

BEGIN;

DO $$
DECLARE
  v_total   BIGINT;
  v_uniq    BIGINT;
  v_dupes   BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM image_library;
  SELECT COUNT(DISTINCT storage_path) INTO v_uniq FROM image_library;
  SELECT COUNT(*) INTO v_dupes FROM (
    SELECT storage_path FROM image_library
    GROUP BY storage_path HAVING COUNT(*) > 1
  ) d;

  RAISE NOTICE '=== image_library storage_path UNIQUE (2026-10-29) ===';
  RAISE NOTICE 'rader: % | unika storage_path: % | dubbletter: %', v_total, v_uniq, v_dupes;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'Migration misslyckades: % dubbletter av storage_path', v_dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS image_library_storage_path_key
  ON image_library (storage_path);

COMMENT ON INDEX image_library_storage_path_key IS
  'Gör storage_path unik — möjliggör idempotent upsert av biblioteksrader och garanterar att varje bild har exakt en sökväg.';

COMMIT;
