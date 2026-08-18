# Changelog

All notable changes to EventPulse are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/), but
dates are absolute (YYYY-MM-DD) and entries are grouped by milestone,
not version.

## 2026-08-18 — Agent Foundation (Phase 0)

First concrete cut of the agent-first product pivot described in
`docs/MASTERPLAN.md`.

### Added
- `05-Supabase/migrations/20260818-0001-agent-event-graph.sql` — Event
  Graph schema for the agent API: agent columns on `events`, tables for
  `organizers`, `artists`, `event_artists`, `event_offers`,
  `event_provenance`, `user_profiles`, `user_interactions`,
  `agent_sessions`, `agent_messages`, `source_readiness`, plus the
  `events_public` anon-safe view and full RLS lockdown.
- `05-Supabase/migrations/20260818-0002-confidence-v1.sql` — Confidence
  v1 scorer per MASTERPLAN §181-190. Idempotent: seeds
  `events.freshness_at = NOW()` where NULL, then computes
  `events.confidence_score` as a clamped sum of (venue, future, price,
  image, freshness, structured-source) components.
- `08-Agent/types.ts` — shared TypeScript types for the private agent API.
- `08-Agent/tools/parse_intent.ts` — deterministic sv/en intent parser
  with Zod schema.
- `08-Agent/tools/search_events.ts` — Supabase `events_public` reader.
- `08-Agent/tools/rank_events.ts` — deterministic feature ranker with
  named weights.
- `08-Agent/tools/get_event_details.ts` — single-event lookup with offers
  + provenance.
- `08-Agent/tools/record_feedback.ts` — best-effort interaction writer.
- `08-Agent/tools/get_user_profile.ts` — Phase 0 stub.
- `08-Agent/prompts/system.ts` — strict anti-hallucination system prompt.
- `08-Agent/server.ts` — Express `POST /agent/chat` endpoint with origin
  allowlist and deterministic Phase 0 pipeline.
- `08-Agent/tests/parse_intent.test.ts` — 9 tests.
- `08-Agent/tests/rank_events.test.ts` — 7 tests.
- `08-Agent/tests/search_events.test.ts` — 8 mocked-Supabase tests.
- `08-Agent/tests/golden-eval.json` — 20-query regression fixture.
- `08-Agent/tests/golden-eval.test.ts` — anti-hallucination harness.
- `06-UI/services/agentClient.js` — Expo client for `/agent/chat`.
- `06-UI/app/AgentScreen.js` — minimal chat surface for the agent path.
- `docs/AGENT-FOUNDATION-PHASE0.md` — Phase 0 verification report.

### Changed
- Pre-pivot ingestion working tree captured as `git stash` entry
  `phase0-snapshot-20260818` and restored for ongoing work.

### Verified
- `npx vitest run 08-Agent/tests` → 45/45 passing.
- Migration applied to live Supabase via Management API
  (`POST /v1/projects/.../database/query`).
- End-to-end `POST /agent/chat` against the live `events_public` view:
  - `konsert` → 5 real music cards (Emmylou Harris 2026-08-26, etc.)
  - `vad finns i helgen` → 5 Kulturhuset culture picks
  - `konsert ikväll` → honest 0 with Swedish "nothing tonight" reply
- Confidence v1 applied to all 2394 published rows via Management API
  (`UPDATE events SET freshness_at = NOW() WHERE freshness_at IS NULL`,
  then `UPDATE events SET confidence_score = LEAST(100, GREATEST(0, ...))`
  per MASTERPLAN §181-190). Final distribution: min 15, max 90, avg 46.
  `POST /agent/chat` no longer surfaces the "no confidence_score yet"
  warning.

### Not yet verified
- Expo simulator run of `AgentScreen`.

## 2026-08-18 — Agent Foundation (Phase 1: LLM explainer)

### What changed
- `08-Agent/llmRouter.ts` (NEW) — Claude Haiku 4.5 explainer over the
  Phase 0 deterministic pipeline. Returns `{ reply, highlightedIds,
  usedLlm }`. Model is an EXPLAINER, never a re-ranker: it can only
  phrase the reply and choose which of the already-ranked input cards to
  highlight visually. Anti-hallucination guard filters `highlightedIds`
  against the input card ids before returning.
- `08-Agent/prompts/system.ts` — updated to the Phase 1 contract
  (`{reply, highlightedIds}` JSON; never invents events).
- `08-Agent/server.ts` — wires `composeReply` into the chat pipeline.
  Falls back to the deterministic template if `ANTHROPIC_API_KEY` is
  unset, if the SDK errors/times out (8s), or if the JSON is unparseable.
- `08-Agent/tests/llmRouter.test.ts` (NEW) — 9 tests covering
  deterministic fallback, JSON parsing (plain / fenced / prose-wrapped
  / garbage), wire-format guard, and SDK-failure fallback via `vi.mock`.

### Verified end-to-end (live Supabase + live Anthropic API)
- `konsert ikväll` → 0 cards; LLM-formulerad ärlig noll-svar
  ("Jag hittar inga konserter i kväll (18 augusti 2026) just nu. Kan
  jag få veta mer om vad du är intresserad av…"), `usedLlm=true`.
- `konsert` → 5 cards; LLM-formulerad svenska med numrerad lista och
  notering om ett inställt event ("Här är 5 konsertevenemang jag
  hittade. Notera att ett av dem är inställt:…"), `highlightedIds=3`
  (max), alla highlight-ids är subset av input-kort.
- Vitest: 55/55 gröna (45 Phase 0 + 9 nya llmRouter + 1 helper).

## 2026-08-18 — Cold-start frågor (BACKLOG Phase 1)

### What changed
- `08-Agent/tools/find_gaps.ts` (NEW) — given an `IntentBrief`, returns
  up to 3 short clarifying questions for missing critical slots in
  priority order: category → time_of_day → party. Chip option values
  are regex triggers that `parse_intent` understands, so a chip-tap
  round-trip resolves back into the same intent.
- `08-Agent/types.ts` — new `ClarifyingQuestion` interface and
  `AgentChatResponse.clarifying_questions?: ClarifyingQuestion[]`
  (optional, additive — no existing caller breaks).
- `08-Agent/server.ts` — cold-start gate before search: if
  `findGaps(intent)` is non-empty, the handler returns immediately
  with empty `cards` and the questions, instead of guessing. The
  deterministic pipeline never runs with a thin intent.
- `08-Agent/tools/parse_intent.ts` — extended `SV_STOPWORDS` regex
  with `hej|tack|vad finns|hittar|hjälp` so trivial Swedish greetings
  are no longer misclassified as English.
- `08-Agent/tests/find_gaps.test.ts` (NEW) — 12 tests covering empty
  intent, single-gap, multi-gap, English output, prioritisation, and
  the regex-trigger round-trip guarantee.
- `06-UI/app/AgentScreen.js` — renders `clarifying_questions` as
  quick-tap chips; tapping a chip sends its `value` as a new message.

### Verified end-to-end (live Supabase + live Anthropic API)
- `hej` → 3 svenska frågor (category, time_of_day, party)
- `konsert ikväll` → 1 fråga (party) — category + time är redan ifyllda
- `konsert` → 2 frågor (time_of_day, party) — category är ifylld
- `konsert ikväll solo` → 0 frågor, kör Phase 1 LLM path direkt
- Vitest: 67/67 gröna (55 Phase 0+1 + 12 nya find_gaps).


## Earlier history

See `git log` for the pre-pivot history. Highlights of the prior
direction:
- 2026-04: Source Candidate Testing schema (07-Discovery).
- 2026-04: Venue Graph schema (07-Discovery).
- 2026-03: C-htmlGate loop, batch reporting, sources audit.
- 2026-03: Initial `260330-batch1-10.ts` monsterkörning.

Those efforts are still present in the tree and feed `importToEventPulse.ts`,
but they are no longer the product north star — the agent is.
