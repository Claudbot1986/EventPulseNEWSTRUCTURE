-- 20261007-0001-editorial-description-engine.sql
--
-- P7 EventPulse Editorial Description Engine — schema-fält.
--
-- Lägger till sex kolumner på events-tabellen som Editorial Engine behöver:
--   event_profile                    JSONB NULL — semantisk profil (se 04-Normalizer/editorial/types.ts)
--   editorial_description           TEXT NULL  — den redaktionella texten
--   editorial_description_generated_at TIMESTAMPTZ NULL — när texten skapades
--   editorial_info_level            TEXT NULL  — RICH | MEDIUM | LOW | VERY_LOW
--   editorial_model                 TEXT NULL  — modell-id (t.ex. 'gpt-4o-mini')
--   editorial_prompt_version        TEXT NULL  — prompt-version (för regression)
--
-- Schema-konventioner (jfr 20260821-0004-image-license-fields.sql):
--   - Alla nya kolumner NULLABLE så befintliga rader inte påverkas.
--   - ALTER TABLE ... ADD COLUMN IF NOT EXISTS = idempotent.
--   - CHECK constraint på editorial_info_level via DO block.
--
-- RLS:
--   events_public view används för anon/authenticated SELECT.
--   service_role har full access (writes från normalizer.ts).
--
-- Backfill:
--   Inga backfill här. Editorial pipeline körs av normalizer stegvis och
--   skriver till kolumnerna när den är redo. Det är OK att låta dem vara
--   NULL för äldre rader — UI använder eventpulse_summary som fallback.

BEGIN;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS event_profile JSONB NULL,
  ADD COLUMN IF NOT EXISTS editorial_description TEXT NULL,
  ADD COLUMN IF NOT EXISTS editorial_description_generated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS editorial_info_level TEXT NULL,
  ADD COLUMN IF NOT EXISTS editorial_model TEXT NULL,
  ADD COLUMN IF NOT EXISTS editorial_prompt_version TEXT NULL;

-- Idempotent CHECK constraint på info_level.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_editorial_info_level_check'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_editorial_info_level_check
      CHECK (editorial_info_level IS NULL OR editorial_info_level IN ('RICH', 'MEDIUM', 'LOW', 'VERY_LOW'));
  END IF;
END$$;

-- Index för att snabbt hitta events med redaktionella beskrivningar,
-- sorterat på senast genererad.
CREATE INDEX IF NOT EXISTS idx_events_editorial_generated_at
  ON events (editorial_description_generated_at DESC NULLS LAST)
  WHERE editorial_description IS NOT NULL;

-- Index för att hitta events som behöver genereras (NULL eller gammal).
CREATE INDEX IF NOT EXISTS idx_events_editorial_missing
  ON events (id)
  WHERE editorial_description IS NULL;

-- Kommentar för framtida läsare.
COMMENT ON COLUMN events.event_profile IS
  'P7 Editorial Engine: strukturerad EventProfile (semantisk extraktion UTAN source-text).';
COMMENT ON COLUMN events.editorial_description IS
  'P7 Editorial Engine: redaktionell beskrivning (2-3 meningar), AI-genererad från Profile.';
COMMENT ON COLUMN events.editorial_description_generated_at IS
  'P7 Editorial Engine: timestamp för senaste generering. NULL = aldrig genererad.';
COMMENT ON COLUMN events.editorial_info_level IS
  'P7 Editorial Engine: hur mycket info Profile innehöll (RICH/MEDIUM/LOW/VERY_LOW).';
COMMENT ON COLUMN events.editorial_model IS
  'P7 Editorial Engine: modell-id som genererade texten (t.ex. gpt-4o-mini).';
COMMENT ON COLUMN events.editorial_prompt_version IS
  'P7 Editorial Engine: prompt-version (för regression-spårning).';

COMMIT;