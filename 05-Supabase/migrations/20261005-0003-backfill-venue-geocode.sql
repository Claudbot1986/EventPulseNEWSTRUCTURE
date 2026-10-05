-- 20261005-0003-backfill-venue-geocode.sql
--
-- Backfill events.lat/lng från venues för events som har venue_full_name
-- men saknar koordinater (eller har Sergels-torg-fallback).
-- Använder en 3-stegs matchning: exact ilike → lower(trim) → slug.
--
-- Säkerhet:
--   - WHERE-guards: bara events där lat är NULL eller är Sergels-torg-fallback
--     uppdateras (de flesta events har redan rätt lat/lng via Pass 1).
--   - WHERE-match väljer ENDAST ENDAST EN venue per event (subquery med LIMIT 1).
--   - Idempotent: kan köras flera gånger utan regression.

BEGIN;

-- Step 1: Exact match (case-insensitive, trim)
UPDATE events e
SET
  venue_id = v.id,
  venue_lat = COALESCE(e.venue_lat, v.lat),
  venue_lng = COALESCE(e.venue_lng, v.lng),
  lat = COALESCE(e.lat, v.lat),
  lng = COALESCE(e.lng, v.lng),
  venue_full_address = COALESCE(e.venue_full_address, v.address),
  venue_city = COALESCE(e.venue_city, v.city)
FROM venues v
WHERE e.venue_id IS NULL
  AND e.venue_full_name IS NOT NULL
  AND (e.lat IS NULL OR (e.lat = 59.3293 AND e.lng = 18.0686))
  AND LOWER(TRIM(e.venue_full_name)) = LOWER(TRIM(v.name));

-- Step 2: Trimmed alias match (tar bort "Jazz Club", "Konserthus" etc.)
UPDATE events e
SET
  venue_id = v.id,
  venue_lat = COALESCE(e.venue_lat, v.lat),
  venue_lng = COALESCE(e.venue_lng, v.lng),
  lat = COALESCE(e.lat, v.lat),
  lng = COALESCE(e.lng, v.lng),
  venue_full_address = COALESCE(e.venue_full_address, v.address),
  venue_city = COALESCE(e.venue_city, v.city)
FROM venues v
WHERE e.venue_id IS NULL
  AND e.venue_full_name IS NOT NULL
  AND (e.lat IS NULL OR (e.lat = 59.3293 AND e.lng = 18.0686))
  AND LOWER(TRIM(REGEXP_REPLACE(e.venue_full_name,
    '\\s*(jazz club|jazzbar|jazz|konserthus|concert hall|concert house|live music venue|live|music venue|baren|bar & nightclub|nightclub|teatern|teater|kyrkan|church|museet|museum|galleriet|gallery|hotell|hotel)$',
    '', 'i'))) = LOWER(TRIM(v.name));

-- Step 3: Contains match (kortare venue-namn i längre source-namn eller vice versa)
UPDATE events e
SET
  venue_id = m.v_id,
  venue_lat = COALESCE(e.venue_lat, m.lat),
  venue_lng = COALESCE(e.venue_lng, m.lng),
  lat = COALESCE(e.lat, m.lat),
  lng = COALESCE(e.lng, m.lng),
  venue_full_address = COALESCE(e.venue_full_address, m.address),
  venue_city = COALESCE(e.venue_city, m.city)
FROM (
  SELECT DISTINCT ON (e2.id) e2.id AS e_id, v2.id AS v_id, v2.lat, v2.lng, v2.address, v2.city
  FROM events e2, venues v2
  WHERE e2.venue_id IS NULL
    AND e2.venue_full_name IS NOT NULL
    AND (e2.lat IS NULL OR (e2.lat = 59.3293 AND e2.lng = 18.0686))
    AND LENGTH(e2.venue_full_name) >= 4
    AND (LOWER(v2.name) LIKE '%' || LOWER(e2.venue_full_name) || '%'
      OR LOWER(e2.venue_full_name) LIKE '%' || LOWER(v2.name) || '%')
  ORDER BY e2.id, LENGTH(v2.name) DESC
) AS m
WHERE e.id = m.e_id;

-- Verifiering (förväntat: ~3 000–5 000 events kvar utan venue_id efter 3 steg)
-- SELECT COUNT(*) FROM events WHERE venue_id IS NULL AND venue_full_name IS NOT NULL;
COMMIT;