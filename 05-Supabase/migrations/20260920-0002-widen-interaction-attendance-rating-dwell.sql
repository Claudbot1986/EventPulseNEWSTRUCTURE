-- 20260920-0002-widen-interaction-attendance-rating-dwell.sql
--
-- Two jobs in one additive CHECK widening:
--
--   1. dwell (Din-helg S4, 2026-09-20) — the app now measures how long the
--      details screen stays open and records interaction='dwell' with
--      metadata.dwell_ms (milliseconds, >= 3s floor client-side). Passive
--      interest signal, complements the explicit save/reject funnel.
--
--   2. Repair live-DB drift for attendance/rating (T0082). Verified against
--      the live DB 2026-09-20 (Supabase Management API): the live
--      user_interactions_interaction_check constraint was
--        impression, click, outbound, save, reject, dismiss,
--        feedback_positive, feedback_negative, dwell
--      i.e. 'dwell' had been added live outside a committed migration (see
--      20260821-0001's header) and that manual re-creation DROPPED the
--      attendance/rating values that 20260822-0005 was supposed to add.
--      Result: server.ts /agent/attendance and /agent/rating inserts have
--      been silently rejected by the CHECK in prod (both routes swallow the
--      error into a 202, so no user-visible failure — but zero rows landed).
--      This migration re-adds attendance/rating and keeps dwell, so the
--      constraint now covers everything live + server actually use.
--
-- Full value set (11):
--   impression, click, outbound, save, reject, dismiss,
--   feedback_positive, feedback_negative,   — /agent/feedback wire contract
--   attendance, rating,                     — dedicated routes (T0082)
--   dwell                                   — details-view time (S4)
--
-- Idempotency:
--   DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT with the same name is safe
--   in a single transaction. CHECK constraints are not versioned in pg,
--   so widening the enum is always additive.

BEGIN;

ALTER TABLE user_interactions
  DROP CONSTRAINT IF EXISTS user_interactions_interaction_check;

ALTER TABLE user_interactions
  ADD CONSTRAINT user_interactions_interaction_check
  CHECK (interaction IN (
    'impression', 'click', 'outbound', 'save',
    'reject', 'dismiss', 'feedback_positive', 'feedback_negative',
    'attendance', 'rating',
    'dwell'
  ));

COMMENT ON COLUMN user_interactions.interaction IS
  'impression | click | outbound | save | reject | dismiss | feedback_positive | feedback_negative | attendance | rating | dwell. attendance+rating are the T0082 post-event feedback signals (dedicated routes); dwell is the S4 details-view time signal (metadata.dwell_ms).';

COMMIT;
