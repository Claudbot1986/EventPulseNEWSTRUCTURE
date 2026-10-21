-- source_candidates.status måste tillåta 'verified'.
--
-- 20261021-0001 försökte bredda CHECK-villkoret, men gjorde det med ett
-- IF NOT EXISTS-skydd på conname. Constrainten från 20260911-0002 heter redan
-- 'source_candidates_status_check' (Postgres autogenererar namnet från inline
-- CHECK), så skyddet slog till och breddningen kördes aldrig. Villkoret stod kvar:
--
--   CHECK (status = ANY (ARRAY['pending','tested','promoted','rejected']))
--
-- Verifierat live 2026-10-21 efter att 0001 applicerats.
--
-- Varför det spelar roll: supabaseRepository.ts:117 skriver
--
--   status: status === 'passed'  ? 'verified'
--          : status === 'failed' ? 'rejected'
--          : status
--
-- Varje promote eller reject av en kandidat avslutas därför med
--
--   ERROR: new row for relation "source_candidates"
--          violates check constraint "source_candidates_status_check"
--
-- och kandidaten stannar fast i 'processing' i kön för alltid. Upptäckt genom att
-- köra P3D-steget: EXIT=1 med just det felet.
--
-- 'manual_review' läggs också till. Det är värdet repository.ts:117 skriver när
-- beslutet är manual_review, och det ligger i 0002-köns status-CHECK
-- (source_candidate_test_queue rad 11) men saknades på kandidattabellen.
--
-- Endast tillåtande värden utvidgas. Inga befintliga rader ändras.

ALTER TABLE source_candidates
  DROP CONSTRAINT IF EXISTS source_candidates_status_check;

ALTER TABLE source_candidates
  ADD CONSTRAINT source_candidates_status_check
  CHECK (status IN ('pending', 'tested', 'verified', 'promoted', 'rejected', 'manual_review'));