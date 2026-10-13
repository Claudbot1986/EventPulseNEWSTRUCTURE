-- 2026-10-13-0001-fix-music-event-type.sql
--
-- BUG-FIX: CATEGORY_HENTS saknade 'music'-nyckel → buildEventProfile
-- defaultade Profile.event_type='community' för music-events.
--
-- Denna migration sätter Profile.event_type='music' för alla events där
-- category_slug='music' men Profile.event_type='community'.
--
-- Idempotent — kan köras flera gånger.
--
-- Säker: påverkar BARA Profile.event_type (inuti event_profile JSONB).
-- Påverkar inte raw_description, title, venue, source eller något annat fält.

UPDATE events
SET event_profile = jsonb_set(
  event_profile,
  '{profile,event_type}',
  '"music"',
  false
)
WHERE category_slug = 'music'
  AND event_profile IS NOT NULL
  AND event_profile->'profile'->>'event_type' = 'community';
