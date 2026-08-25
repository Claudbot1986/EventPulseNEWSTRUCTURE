-- 20260825-0001-event-image-tracking.sql
--
-- Adds EU AI Act (Art. 50) compliance columns to events table.
-- Enables traceability: every AI-generated image has its prompt + model + timestamp
-- stored alongside the event row.
--
-- NOT APPLIED — review before running against Supabase.
-- Apply via Supabase SQL editor or:
--   psql "$DATABASE_URL" -f 05-Supabase/migrations/20260825-0001-event-image-tracking.sql
--
-- See docs/AI-IMAGE-PIPELINE-PLAN.md for context.

BEGIN;

-- ── Per-event AI image provenance ────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_prompt text,
  ADD COLUMN IF NOT EXISTS image_model text,
  ADD COLUMN IF NOT EXISTS image_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS image_generation_status text
    CHECK (image_generation_status IN ('pending', 'done', 'failed')),
  ADD COLUMN IF NOT EXISTS image_ai_generated boolean NOT NULL DEFAULT false;

-- ── Indexes for backfill jobs ───────────────────────────────────────────────
-- GIN/btree på image_url IS NULL för snabb backfill-query.
CREATE INDEX IF NOT EXISTS idx_events_image_missing
  ON events (id) WHERE image_url IS NULL;

-- Status-index för BullMQ-workers som processar pending events.
CREATE INDEX IF NOT EXISTS idx_events_image_status_pending
  ON events (image_generation_status) WHERE image_generation_status = 'pending';

-- ── RLS-justering (privacy) ─────────────────────────────────────────────────
-- image_prompt och image_model kan innehålla scraping-/affärslogik.
-- Vi vill INTE att anon-key exponerar dem.
-- Om RLS är aktiv på events, lägg till explicit anon-policy:
--
--   CREATE POLICY "anon cannot read image metadata"
--     ON events FOR SELECT TO anon
--     USING (true);  -- befintlig policy
--     -- men anon-projectionen utesluter image_prompt/image_model via REST-select
--
-- Verifiera i Supabase → Table Editor → events → API-exposure att
-- anon-projektionen INTE inkluderar image_prompt/image_model.
-- Om Supabase REST exponerar * → uppdatera anon-key SELECT-policy.

COMMIT;
