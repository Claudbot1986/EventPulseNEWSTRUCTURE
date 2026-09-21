-- T0094 — Event title/description translations cache (Språkstöd 2026-09-21).
--
-- Purpose: store per-event, per-language translations of `events.title_sv`
-- and `events.description_sv` so 08-Agent can serve them on /agent/feed etc.
-- when the client sends `Accept-Language`-equivalent (today: body.locale on
-- /agent/chat). Source-of-truth text lives on events; this table is a
-- read-cache filled by the translation worker (11-Translation/), not by
-- ingestion.
--
-- Why a separate table (and not more columns on events):
-- - Locale fan-out is unbounded long-term; columns on events would multiply
--   linearly. A row-per-(event, language) scales.
-- - Translations are cacheable, regenerable, and may be missing — the
--   fallback chain (requested-lang translation → events.title_sv) is the
--   agent's job, not a column convention.
--
-- Safety boundary (per user direction 2026-09-21):
-- - Additive only. No DROP, no ALTER on existing tables/columns.
-- - Reads event_translations only via service_role (08-Agent +
--   translation worker). Anon never reaches this table directly.
-- - The pgsql function `update_updated_at_column` (from migration #9) is
--   NOT reused here; if a trigger is ever added later, use a namespaced
--   name like `event_translations_touch_updated_at` to avoid collision.

BEGIN;

CREATE TABLE IF NOT EXISTS event_translations (
  event_id      UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  language      TEXT        NOT NULL,                         -- BCP-47: 'ar', 'fa', 'so', 'pl', 'tr', 'fi'
  title         TEXT,                                          -- nullable: title may not be requested/known
  description   TEXT,                                          -- nullable: long descriptions optional
  model         TEXT        NOT NULL,                         -- e.g. 'minimax-m3', 'minimax-m2.7'
  translated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, language)
);

-- Most reads: list translations for a language, or all-translations for an
-- event when re-rendering after source changes.
CREATE INDEX IF NOT EXISTS idx_event_translations_language
  ON event_translations (language);

CREATE INDEX IF NOT EXISTS idx_event_translations_event
  ON event_translations (event_id);

-- RLS: service_role only. Reads by 08-Agent + writes by translation worker
-- both run with the service-role key.
ALTER TABLE event_translations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_translations_no_anon ON event_translations;
CREATE POLICY event_translations_no_anon ON event_translations
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS event_translations_no_authenticated ON event_translations;
CREATE POLICY event_translations_no_authenticated ON event_translations
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE event_translations IS
  'Per-event, per-language translation cache. Filled by 11-Translation/translate.mjs via MiniMax API; read by 08-Agent when serving /agent/feed. service_role-only.';

COMMENT ON COLUMN event_translations.language IS
  'BCP-47 tag. Only the locales listed in 06-UI/i18n/languages.js are expected, but no constraint here — adding locales without a migration is intentional.';

COMMENT ON COLUMN event_translations.model IS
  'Which LLM produced this translation. Useful for re-translation sweeps when switching models.';

COMMIT;
