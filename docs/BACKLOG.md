# EventPulse backlog (draft 2026-09-20)

**DRAFT for review.** Authoritative backlog remains `docs/BACKLOG.md` until manually adopted. Strategy lives in [`MASTERPLAN.md`](MASTERPLAN.md) (same folder).

Owner: one slice at a time. Stop if a step is not verified with real data.

User decisions baked in (2026-09-20): **guest taste-first är första fokus (100%)**; **Din helg prioriteras**; **gruppomröstning parkerad** (se DO NOT BUILD YET).

---

## NOW — Phase 1.5: pre-launch hardening

Do in this order. All items are launch blockers; nothing else enters NOW.

1. **Guest taste-first, server side**
   - `requireUser`-gated endpoints that write/read *own* data accept `anonymous_user_id` as identity: `/agent/feedback`, `/agent/preferences`, `/agent/saved`, `/agent/recommended`, `/agent/cached-recommendations`
   - Migration: `user_interactions`, `user_preferences`, saved-events tables accept anonymous identity; `user_id` stays nullable/linkable
   - RLS/service-role unchanged — client never gets elevated keys
   - Verify: fresh install (no login) records a save; `buildUserSignal` for that anon UUID returns non-cold priors next session

2. **Guest taste-first, client side**
   - Un-gate HomeScreen sections Rekommenderat/Förslag/Sparade + Senaste sökningar for guests in `AppShell`/`HomeScreen` (reverse the hiding from `34828f4`, keep the guest/logged_in state split)
   - Keep AuthReminderModal; reframe copy toward sync/backup (*"behåll din smak på alla enheter"*), not access
   - Verify: cold guest session shows personalized sections populated after first interactions; 60 UI tests still green

3. **Anon→auth migration**
   - Server endpoint: on first completed login, link all `anonymous_user_id` rows (interactions, preferences, saves) to `user_id`; dedupe; store id mapping so repeat logins are no-ops
   - Client: after login, send stored anon UUID once
   - Verify: guest saves 3 events → logs in → ProfileScreen shows same saved set, no dupes, taste priors intact

4. **LLM keys for prod chat**
   - Fix `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` (401 since 2026-09-12) **or** formally switch prod chat to MiniMax and document
   - Verify: `run-golden-eval.ts` = 0 hallucinations on actual prod model/config

5. **Launch-scope decisions (one meeting, then done)**
   - Web in launch scope? If yes: fix `signInWithOtp` (web blocker). If native-only: document and move on
   - Analytics: set `EXPO_PUBLIC_ANALYTICS_URL` or declare `user_interactions` the sole funnel source (no dead queues)
   - Publish anonymous-tracking retention/deletion note (GDPR) in app

Success for NOW: anonymous install → visibly better recs within one session → taste persists across days → login preserves everything; prod chat verified non-degraded.

### Pre-launch (unchanged from current BACKLOG)

- AI image top-up: BFL credits + run backfill until `image_status='pending'` = 0. Do not flag as blocker before launch point.

---

## NEXT — Phase 2: retention & personalization proof

- **Din helg** (ankare)
  - Weekly personalized weekend selection on existing substrate: `rank_events` + `curated_collections` + `cached-recommendations` + pre-render cron
  - Thursday drop; push via existing notifications infra; opt-in, max 1/week (no spam v1)
  - Verify: returning guest sees a fresh weekend collection without searching

- **Personalization lift experiment**
  - Activate PERSONALIZATION_PRIORS A/B via `experiments.ts` (sticky 50/50, OEC=outbound CTR, MIN_SAMPLE 500/variant)
  - Internal users + first external cohort; write kill/continue after 4 weeks of repeat users

- **Explainability v1**
  - Surface `rank_events` `reasons[]` as "Varför detta?" chips on feed/detail cards; grounded fields only, no invented explanations

- **Conversion at value**
  - Account prompt after Nth save or first Din helg open (not at install); runs anon→auth migration from NOW#3

- **Tracking gaps**
  - Add `event_share` as first-class interaction (shares exist via `/agent/share` but aren't funnel events today)
  - Formalize `search_performed` if needed for funnel metrics

- **Growth docs**
  - Adopt/create `docs/growth/00-current-state.md` from the 2026-09-20 mapping (eventpulse-growth prompts ↔ existing modules)

---

## LATER — Phase 3+

- Transaction Level 2 (prefill) then Level 3 (partner booking API) — only after retention exists
- `source_readiness` scanner as internal quality, then human B2B outreach (Phase 4)
- Cross-source `canonical_event_id` hardening
- C3 date-in-card extraction **only if** verified on 3+ unrelated Stockholm domains (Generalization Gate)
- Stockholm Density Plan layers continue as background maintenance via nightly chain
- Second city (not Sweden-wide scrape)
- **Revisit parked group voting** only if post-launch share→open metrics (`shared_sessions.view_count`) show real sharing behavior

---

## DO NOT BUILD YET

- **Group voting / "Hjälp oss välja" / friend features — PARKED (user decision 2026-09-20).** Requires web surface (currently broken) and an active user base; plain `/s/:hash` sharing already measures funnel top.
- Public event API / bulk graph dump
- Next.js consumer app (web scope decision pending in NOW#5 — decision is not a build mandate)
- Partner portal / self-serve onboarding
- Automated outbound email / sales sequences
- Agentic purchase (Level 4)
- Sweden-wide source import or national coverage campaign
- D-render as default path
- Improvement Orchestrator as the current company task
- Social graph features
- Custom organizer websites (webbyrå)
- Meilisearch as the agent
- Draining all error queues (404 / serverdown / timeout / manual-review) as P1
- Queue `sources_status.jsonl` rewrite as a product phase
- `get_group_profile` implementation
- `create_checkout`
- `search_external_web` in the default path
- Venue-graph `--apply` as growth engine
- Source-candidate auto-promotion
- Training a custom LLM on user chats
- Account-before-value gates (reversed by decision: personalization is available to guests)
