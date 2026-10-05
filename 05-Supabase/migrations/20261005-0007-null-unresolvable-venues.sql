-- 20261005-0007-null-unresolvable-venues.sql
--
-- NULL:a ut Sergels-torg-fallback för events vars venue-namn inte kunde
-- verifieras som Stockholm-plats via Photon/OSM-geokodning. Dessa events
-- kommer från källor som täcker hela landet (spelning.se, fb-events m.fl.)
-- och har blandat Stockholm-events med events från Umeå, Kalmar, Västerås
-- osv. NULL är bättre än fel markering på Sergels torg.
--
-- Kör EN gång — WHERE-guards gör den idempotent.

BEGIN;

UPDATE events e
SET lat = NULL, lng = NULL, location = NULL, venue_lat = NULL, venue_lng = NULL
FROM venues v
WHERE e.venue_id = v.id
  AND v.lat = 59.3293
  AND v.lng = 18.0686
  AND (
    -- Online events
    v.name ILIKE '%Zoom%'
    OR v.name ILIKE '%Silja%'  -- cruise ships
    -- Out-of-Stockholm venues (named places)
    OR v.name ILIKE '%Umeå%'
    OR v.name ILIKE '%Kalmar%'
    OR v.name ILIKE '%Jönköping%'
    OR v.name ILIKE '%Norrköping%'
    OR v.name ILIKE '%Eskilstuna%'
    OR v.name ILIKE '%Helsingborg%'
    OR v.name ILIKE '%Karlshamn%'
    OR v.name ILIKE '%Skåne%'
    OR v.name ILIKE '%Östersund%'
    OR v.name ILIKE '%Västerås%'
    OR v.name ILIKE '%Gävle%'
    OR v.name ILIKE '%Ljusterö%'
    OR v.name ILIKE '%Täby%'
    OR v.name ILIKE '%Åkersberga%'
    OR v.name ILIKE '%Dunkers%'
    OR v.name ILIKE '%Storsjö%'
    OR v.name ILIKE '%Kulturhuset Najaden%'
    OR v.name ILIKE '%Kulturhuset Strömmen%'
    OR v.name ILIKE '%Bollbrolyckan%'
    OR v.name ILIKE '%Klart stockholms%'  -- legacy misspelling
    -- Generic/garbage
    OR v.name = '[object Object]'
    OR v.name = 'Eidra'
    OR v.name ILIKE '%lokalhelhet-calendar%'
    OR v.name ILIKE '%datum:%'  -- raw text
    OR LENGTH(v.name) < 3
  );

COMMIT;

-- Verifiering (förväntat: bara events utan match kvar på Sergels-torg, troligen <5)
-- SELECT COUNT(*) FROM events WHERE lat = 59.3293 AND lng = 18.0686;