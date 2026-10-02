-- Migration: venues.country
-- Datum: 2026-10-02
-- Owner: Tomor Gashi
-- Klass: factual-schema (tillåten att mutera utan user-decision; stöder description-routing 5.2)
--
-- BAKGRUND (02-Operations/2026-10-02-Description-Coverage-Investigation.md §5.2):
--   Svenska events med engelsk-titlad rubrik ("Dexys Midnight Runners" på
--   Göta Lejon) saknar description_sv eftersom normalizer-titel-has-sv-chars-
--   fallback (2026-09-29) inte fångar dem. ~3–5 %-enheter av description-gapet
--   beror på detta.
--
-- FIX:
--   Lägg till venues.country (TEXT, default 'SE' eftersom agent:en är
--   Stockholm-fokuserad och alla nuvarande venues FAKTISKT är i Sverige).
--   Normalizern läser nu venues.country och speglar description_en →
--   description_sv om venue.country === 'SE' (rule 3 i descriptionRouting.ts).
--
-- SÄKERHETSNOTERING:
--   Default 'SE' är SANT för alla befintliga venues — venue_resolve i
--   normalizer.ts skapar bara nya venues med lat=59.3293 / lng=18.0686
--   (Stockholm centrum), så vi hör ej äventy någon.
--
--   För framtida icke-svenska venues: sätt country via separat adapter-
--   ändring eller manuell UPDATE. Country tillåter ISO 3166-1 alpha-2
--   (SE/NO/DK/FI/DE/...) eller NULL om okänt.

BEGIN;

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'SE';

-- Index för att snabbt kunna filtrera "svenska venues" i framtida frågor.
CREATE INDEX IF NOT EXISTS idx_venues_country ON venues(country);

-- Inga backfill-rader behövs — DEFAULT 'SE' hanterar alla existerande rader.

COMMENT ON COLUMN venues.country IS
  'ISO 3166-1 alpha-2 landskod (SE/NO/DK/FI/DE/...). Default SE för Stockholm-fokuserad agent. NULL om vid okänt ursprung.';

COMMIT;