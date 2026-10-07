-- 20261006-0001-venue-rescue-from-named.sql
--
-- Rädda 2 368 events där venue_full_name finns men venue_id är NULL.
-- Migration 20261005-0003 (venue-backfill) hade WHERE-guard
--   "e.lat IS NULL OR (e.lat = 59.3293 AND e.lng = 18.0686)"
-- som blockerade många events som redan fått en icke-Sergels-torg-koordinat
-- men saknade venue_id. Den här migrationen tar 3 nya steg UTAN den guarden:
--
-- Steg 1: Exakt normaliserad match (LOWER + TRIM)
-- Steg 2: Suffix-trim (Museet, Teatern, Kyrkan etc.) — utökat suffix-lista
-- Steg 3: Contains-match med deterministisk ordning
--
-- Säkerhet:
--   - Idempotent (WHERE venue_id IS NULL guard)
--   - DISTINCT ON (event.id) → en venue per event
--   - Inget raderas i vid matcher — bara UPDATE av venue_id/lat/lng
--   - Skippa events där source-värdet redan pekar mot en icke-Stockholm-plats
--     (samma out-of-stad-lista som Sun-Beam 20261005-0007, plus online/cruise)

BEGIN;

-- ===========================
-- STEG 1: EXAKT normaliserad match
-- ===========================
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
  AND LOWER(TRIM(e.venue_full_name)) = LOWER(TRIM(v.name));

-- ===========================
-- STEG 2: Suffix-trim match (utökat lista jämfört med 20261005-0003)
-- ===========================
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
  AND LOWER(TRIM(REGEXP_REPLACE(e.venue_full_name,
    '\s*(jazz club|jazzbar|jazz|konserthus|concert hall|concert house|live music venue|live|music venue|baren|bar & nightclub|nightclub|teatern|teater|kyrkan|church|museet|museum|galleriet|gallery|hotell|hotel|stadium|arenan|hallen|salen|klubb|pub|café|cafe|restaurang|bar|store|gallery|kyrka|capel|kapell|chapel|konsthall|stadsteatern|stadsteater|teatern|teater)$',
    '', 'i'))) = LOWER(TRIM(v.name));

-- ===========================
-- STEG 3: Contains-match (kortare i längre eller tvärtom)
-- ===========================
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
    AND LENGTH(e2.venue_full_name) >= 4
    AND (LOWER(v2.name) LIKE '%' || LOWER(e2.venue_full_name) || '%'
      OR LOWER(e2.venue_full_name) LIKE '%' || LOWER(v2.name) || '%')
  ORDER BY e2.id, LENGTH(v2.name) DESC
) AS m
WHERE e.id = m.e_id;

-- ===========================
-- STEG 4: NULL:a ut Sergels-torg-fallback för events som nu har venue_id
--   (säkerhetsstäd — om lat fortfarvar SÅ Sergels torg fast venue matchades
--    uppdatera lat/lng från venue)
-- ===========================
UPDATE events e
SET
  lat = COALESCE(e.lat, v.lat),
  lng = COALESCE(e.lng, v.lng),
  venue_lat = COALESCE(e.venue_lat, v.lat),
  venue_lng = COALESCE(e.venue_lng, v.lng)
FROM venues v
WHERE e.venue_id = v.id
  AND v.lat IS NOT NULL AND v.lng IS NOT NULL
  AND v.lat <> 59.3293  -- bara om venue INTE är Sergels-torg-fallback
  AND (e.lat IS NULL OR (e.lat = 59.3293 AND e.lng = 18.0686));

COMMIT;

-- Verifiering (förväntat efter: <1 600 events kvar med null venue_id)
-- SELECT COUNT(*) FROM events WHERE venue_id IS NULL AND status = 'published';
-- SELECT COUNT(*) FROM events WHERE venue_id IS NULL AND venue_full_name IS NOT NULL AND status = 'published';