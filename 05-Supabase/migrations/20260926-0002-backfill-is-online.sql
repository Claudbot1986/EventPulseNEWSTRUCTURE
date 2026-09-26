-- 20260926-0002-backfill-is-online.sql
--
-- Backfill is_online via titel-heuristik (engångskörning).
--
-- Bakgrund: is_online-kolumnen sattes i 20260926-0001-add-is-online.sql.
-- Befintliga rader har NULL. Vi gissar online-events utifrån titel-ord
-- (online / digital / stream). Förväntat ~5-20 träffar — konservativ heuristik.
--
-- Risk:
--   - Kan ge false positives (t.ex. "onlinebiljett" utan online-deltagande).
--   - online_url sätts till ticket_url som fallback. Om ticket_url leder till
--     en fysisk lokal kan det vara vilseledande för användaren.
-- Mitigation:
--   - Användaren klickar sig aldrig vidare via online_url — UI:t visar bara
--     en "Online"-badge och använder fortfarande ticket_url som primär länk.
--   - Ingestion-pipeline (utanför scope) sätter is_online=true direkt vid
--     nya events från t.ex. youtube_live eller online_platform-källor.
--
-- Idempotency:
--   WHERE is_online IS NULL — körs säkert flera gånger; rader som redan är
--   satta hoppas över.
--
-- Rollback:
--   UPDATE events SET is_online = NULL, online_url = NULL WHERE ...;

BEGIN;

UPDATE events
SET is_online = true,
    online_url = ticket_url
WHERE is_online IS NULL
  AND (
    title_sv ILIKE '%online%'
    OR title_en ILIKE '%online%'
    OR title_sv ILIKE '%digital%'
    OR title_en ILIKE '%digital%'
    OR title_sv ILIKE '%stream%'
    OR title_en ILIKE '%stream%'
  );

COMMIT;
