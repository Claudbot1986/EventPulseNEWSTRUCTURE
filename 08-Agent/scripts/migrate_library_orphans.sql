-- 08-Agent/scripts/migrate_library_orphans.sql
--
-- Reparera image_library-rader som inte pekar på import-original/.
-- Upptäckt vid UI-verifiering 2026-09-01: 115 rader hade legacy/phantom paths
-- vilket gjorde att pickLibraryFallback returnerade 404-URL:er eller pekade
-- på fel library-roller.
--
-- Tre kategorier av problem:
--
-- A. 99 rader med storage_path = 'event-posters/events/<file>.png' (legacy).
--    Motsvarande rad finns REDAN i import-original/ (dubbletter skapades vid
--    någon tidigare backfill eller migration). Lösning: DELETE legacy-rad,
--    behåll den korrekt-migrerade import-original/-raden.
--
-- B. 10 rader med storage_path = 'event-posters/import-stamped/<file>.png'.
--    Dessa är från en första migration där library lagrade den-stamped
--    storage_path; ska vara import-original/ (canonical identity).
--    Motsvarande import-original/-rad kan eller kan inte finnas.
--
-- C. 6 rader utan folder-prefix (default-<file>.png). Inga filer finns i
--    någon bucket; 0 events refererar dem idag. → DELETE.

BEGIN;

-- Pre-flight: visa vilka paths som ska fixas
SELECT
  CASE
    WHEN storage_path LIKE 'event-posters/events/%' THEN 'A. events-legacy (will delete dup)'
    WHEN storage_path LIKE 'event-posters/import-stamped/%' THEN 'B. import-stamped-legacy (will migrate)'
    WHEN storage_path NOT LIKE '%/%' THEN 'C. no-prefix phantom (will delete)'
    ELSE 'other'
  END AS group_label,
  COUNT(*) AS n
FROM image_library
WHERE storage_path IS NOT NULL
  AND storage_path NOT LIKE '%/import-original/%'
GROUP BY 1
ORDER BY n DESC;

-- A. events-legacy rows: det finns redan en import-original/-rad med
--    samma filnamn (skapad vid tidigare migration). Den legacy-rad vi
--    har dubblerar bara. → DELETE.
DELETE FROM image_library
WHERE storage_path LIKE 'event-posters/events/%'
  AND EXISTS (
    SELECT 1 FROM image_library il2
    WHERE il2.storage_path = REPLACE(image_library.storage_path, 'event-posters/events/', 'event-posters/import-original/')
  );

-- A. Resterande events-legacy (utan import-original/-par) → migrera.
UPDATE image_library
SET
  storage_path = REPLACE(storage_path, 'event-posters/events/', 'event-posters/import-original/'),
  public_url   = REPLACE(public_url,   'event-posters/events/', 'event-posters/import-original/')
WHERE storage_path LIKE 'event-posters/events/%';

-- B. import-stamped/ → import-original/  (library pekar alltid på original).
--    Samma dup-logik: om import-original/-rad redan finns, ta bort
--    import-stamped/-dubletten.
DELETE FROM image_library
WHERE storage_path LIKE 'event-posters/import-stamped/%'
  AND EXISTS (
    SELECT 1 FROM image_library il2
    WHERE il2.storage_path = REPLACE(image_library.storage_path, 'event-posters/import-stamped/', 'event-posters/import-original/')
  );

-- B. Resterande import-stamped utan original-par → migrera.
UPDATE image_library
SET
  storage_path = REPLACE(storage_path, 'event-posters/import-stamped/', 'event-posters/import-original/'),
  public_url   = REPLACE(public_url,   'event-posters/import-stamped/', 'event-posters/import-original/')
WHERE storage_path LIKE 'event-posters/import-stamped/%';

-- C. Phantom default-* rows → DELETE.
DELETE FROM image_library
WHERE storage_path IS NOT NULL
  AND storage_path NOT LIKE '%/%'
  AND storage_path LIKE '%.png';

-- Post-flight verifiering (ska alla vara 0)
SELECT
  (SELECT COUNT(*) FROM image_library WHERE storage_path LIKE 'event-posters/events/%')   AS remaining_events_legacy,
  (SELECT COUNT(*) FROM image_library WHERE storage_path LIKE 'event-posters/import-stamped/%') AS remaining_stamped_in_lib,
  (SELECT COUNT(*) FROM image_library WHERE storage_path IS NOT NULL AND storage_path NOT LIKE '%/import-original/%') AS remaining_orphans;