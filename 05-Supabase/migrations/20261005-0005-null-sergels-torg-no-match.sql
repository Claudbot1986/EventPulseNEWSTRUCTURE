-- 20261005-0005-null-sergels-torg-no-match.sql
--
-- 5 326 events har fortfarande lat=59.3293/lng=18.0686 (Sergels-torg-fallback)
-- EFTER venue-fix + venue-geocode + Sergels-torg-replace. Av dessa saknar
-- merparten venue_id (venues-tabellen har inte matchat deras venue-namn).
--
-- Strategi: NULL:a ut Sergels-torg-fallback för events som INTE har ett
-- venue_id — bättre att inte visa markör alls än att visa fel markör.
--
-- Säkerhet:
--   - WHERE-guards: bara events där venue_id är NULL OCH lat är Sergels-torg.
--   - Idempotent.

BEGIN;

UPDATE events
SET
  lat = NULL,
  lng = NULL,
  location = NULL,
  venue_lat = NULL,
  venue_lng = NULL
WHERE lat = 59.3293
  AND lng = 18.0686
  AND venue_id IS NULL;

COMMIT;

-- Förväntat efter: ~50–200 events kvar på Sergels-torg (de som har venue_id
-- matchat till en venue som faktiskt LIGGER på Sergels torg).
-- SELECT COUNT(*) FROM events WHERE lat = 59.3293 AND lng = 18.0686;