-- 20261005-0002-backfill-venue-from-raw.sql
--
-- Backfill events.venue_full_name/address/city från events.raw_data för events
-- där venue_id är NULL (Pass 2 av venue-fix). Kör ENDAST en gång —
-- WHERE-guards gör det idempotent.
--
-- Säkerhet:
--   - Bara events med venue_id IS NULL uppdateras (Pass 1 är redan körd).
--   - NULLIF tar bort strängen 'null' eller tomma strängar som ibland
--     finns i raw_data p.g.a. JSON-parsning.

BEGIN;

UPDATE events
SET
  venue_full_name = NULLIF(raw_data->>'venue', 'null'),
  venue_full_address = NULLIF(raw_data->>'address', 'null'),
  venue_city = NULLIF(raw_data->>'city', 'null')
WHERE
  venue_id IS NULL
  AND venue_full_name IS NULL
  AND raw_data IS NOT NULL
  AND (raw_data->>'venue') IS NOT NULL
  AND (raw_data->>'venue') != '';

COMMIT;

-- Verifiering (förväntat: med venue_full_name ~= 12,757 av 14,293)
-- SELECT COUNT(*) FROM events WHERE venue_full_name IS NOT NULL;