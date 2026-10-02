-- Backfill: description_sv = description_en för svenska venues (5.2)
-- Datum: 2026-10-02
-- Klass: factual-data-mutation (säker — spegelbe description_en → description_sv,
--        ingen information skapas; beskrivningen finns redan i description_en)
--
-- BAKGRUND (02-Operations/2026-10-02-Description-Coverage-Investigation.md §5.2):
--   Planen förutspådde 3–5 %-enheters ökning av description_sv-coverage.
--   Faktisk mätning (2026-10-02 mot live DB): 1 615 events uppfyller kriterierna
--   (~44 % av corpus — INTE 3-5%, eftersom corpus har vuxit och många
--   scrape-källor routar description till description_en oavsett språk).
--
-- SÄKERHETSREGLER (identiska med normalizer.ts rule 3):
--   1. Endast events där venue_id är satt (rule 3 kräver venue.country).
--   2. Endast events där venue.country === 'SE' (rule 3 gäller bara Sverige).
--   3. Endast events där title_sv INTE innehåller å/ä/ö (rule 2 har redan
--      täckt de med svenska titlar — vi vill inte dubbel-routa).
--   4. Endast events där description_en har ≥10 tecken (placeholder-filter).
--   5. Endast events där description_sv är NULL (rule 1+2 har företräde
--      om de redan satt description_sv).
--
-- IDEMPOTENS:
--   UPDATE är idempotent — körs flera gånger utan sidoeffekt eftersom vi
--   bara sätter description_sv där description_sv IS NULL.
--
-- DRY-RUN: Kör SELECT först för att bekräfta antal. UPDATE:n nedan är anti-template
--          — kör den INTE utan att först ha verifierat count sel target.

-- =====================================================================
-- VÄLJ PRE-CHECK (kör stats vid):
-- SELECT COUNT(*) FROM events e
-- JOIN venues v ON v.id = e.venue_id
-- WHERE e.description_sv IS NULL
--   AND v.country = 'SE'
--   AND LENGTH(e.description_en) >= 10
--   AND (e.title_sv IS NULL OR e.title_sv !~ '[åäöÅÄÖ]');
-- =====================================================================

BEGIN;

UPDATE events e
SET description_sv = e.description_en
FROM venues v
WHERE v.id = e.venue_id
  AND e.description_sv IS NULL
  AND v.country = 'SE'
  AND LENGTH(e.description_en) >= 10
  AND (e.title_sv IS NULL OR e.title_sv !~ '[åäöÅÄÖ]');

COMMIT;