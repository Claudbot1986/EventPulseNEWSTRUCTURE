-- 20261005-0001-events-venue-full-fields.sql
--
-- Lägger till venue-fält på events-tabellen så ingestion kan lagra
-- verklig venue-info från källan (namn, address, lat, lng, url, phone)
-- istället för att kasta den. events_public-viewen utökas så UI:n kan
-- visa platsnamn utan att kräva venue_id-länk.
--
-- Bakgrund (2026-10-05):
--   9 491 av 13 696 events saknar venue_id. Kartan visar default-position
--   (59.3293, 18.0686 = Sergels torg) för ALLA events från källor som
--   livespot, posh, stockholmjazz, nalen m.fl. Venue-namn finns i
--   source-payload men kastas vid ingestion.
--
--   Denna migration lägger till de kolumner som behövs och exponerar
--   dem via events_public. Ingestion-skript uppdateras i separata
--   commits för att skriva fälten.
--
-- Säkerhet:
--   - Alla nya kolumner är NULLABLE — ingen regression för befintliga
--     rader som saknar info.
--   - events_public-viewen utökas så UI ser fälten direkt. INGEN
--     ändring av RLS eller publikt API — nya kolumner följer samma
--     grants som befintliga.

BEGIN;

-- 1. Lägg till venue-fält på events-tabellen
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_full_name text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_full_address text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_city text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_lat double precision;
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_lng double precision;
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_url text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_phone text;

-- Kommentarer för framtida utvecklare
COMMENT ON COLUMN events.venue_full_name IS 'Venue-namn från källan, t.ex. "Fasching". Skild från venue.name som är canonical venue-post.';
COMMENT ON COLUMN events.venue_full_address IS 'Adress från källan, t.ex. "Kungsgatan 63".';
COMMENT ON COLUMN events.venue_city IS 'Stad från källan, t.ex. "Stockholm".';
COMMENT ON COLUMN events.venue_lat IS 'Venue-koordinat från källan (KAN vara null om källan saknar). Skild från lat som är event-position (default = city center om okänd).';
COMMENT ON COLUMN events.venue_lng IS 'Venue-koordinat från källan (KAN vara null).';
COMMENT ON COLUMN events.venue_url IS 'URL till venue (t.ex.官方网站).';
COMMENT ON COLUMN events.venue_phone IS 'Telefonnummer om källan har det.';

-- 2. Uppdatera events_public-viewen så UI ser fälten
CREATE OR REPLACE VIEW events_public AS
SELECT
  e.id,
  e.title_en,
  e.title_sv,
  e.description_en,
  e.description_sv,
  e.start_time,
  e.end_time,
  e.source,
  e.venue_id,
  e.venue_full_name,
  e.venue_full_address,
  e.venue_city,
  e.venue_lat,
  e.venue_lng,
  e.venue_url,
  e.venue_phone,
  e.lat,
  e.lng,
  e.location,
  e.is_free,
  e.price_min_sek,
  e.price_max_sek,
  e.ticket_url,
  e.image_url,
  e.image_license,
  e.image_attribution,
  e.image_source_url,
  e.image_ai_generated,
  e.image_ai_optout,
  e.image_prompt,
  e.image_model,
  e.image_generated_at,
  e.image_generation_status,
  e.category_slug,
  e.confidence_score,
  e.freshness_at,
  e.status_expanded,
  e.is_online,
  e.online_url,
  e.link_status,
  e.link_last_checked_at,
  e.address,
  e.city
FROM events e
WHERE e.status = 'published';

-- 3. Hjälpindex för reverse-geocoding / dedup baserat på venue-namn
--    (för att kunna hitta events med samma venue-namn och slå upp rätt venue_id)
CREATE INDEX IF NOT EXISTS idx_events_venue_full_name_lower
  ON events (LOWER(venue_full_name))
  WHERE venue_full_name IS NOT NULL;

COMMIT;

-- 2026-10-05 — separat validering om gamla rader har data att migrera.
-- SELECT COUNT(*) FROM events WHERE venue_full_name IS NOT NULL;