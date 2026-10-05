-- 20261005-0004-replace-sergels-torg.sql
--
-- Många events har lat=59.3293/lng=18.0686 (Sergels-torg-fallback) från
-- pre-venue-fix-skripten. Efter 20261005-0003-matchningen har de flesta
-- venue_id satts — denna migration ersätter Sergels-torg-fallback med
-- verkliga koordinater från venues-tabellen.
--
-- Säkerhet:
--   - WHERE-guards: bara events där venue_id är satt OCH lat är Sergels-torg.
--   - Idempotent.

BEGIN;

UPDATE events e
SET
  lat = v.lat,
  lng = v.lng,
  location = ST_GeogFromText('POINT(' || v.lng || ' ' || v.lat || ')'),
  venue_lat = COALESCE(e.venue_lat, v.lat),
  venue_lng = COALESCE(e.venue_lng, v.lng)
FROM venues v
WHERE e.venue_id = v.id
  AND v.lat IS NOT NULL
  AND v.lng IS NOT NULL
  AND e.lat = 59.3293
  AND e.lng = 18.0686;

COMMIT;

-- Förväntat: bara events utan venue_id (inte matchade än) och events vars
-- venue ligger i Sergels torg kvar på Sergels-torg.
-- SELECT COUNT(*) FROM events WHERE lat = 59.3293 AND lng = 18.0686;