# EventPulse — Masterplan (draft 2026-09-20)

**DRAFT for review.** Authoritative plan remains `docs/MASTERPLAN.md` until this file is manually adopted. Execution order lives in [`BACKLOG.md`](BACKLOG.md) (same folder).

Start date for the 90-day clock: **2026-08-17** (today = day 34).

---

## 0. Where we stand (2026-09-20, verified against HEAD `34828f4`)

The agent-first pivot from 2026-08-17 is **executed, not pending**. Current truth:

**Built and running:**
- Event Graph: 8 600+ future Stockholm events persisted (2026-08-20 count; ~6 900 with images 2026-09-05). `confidence_score` v1, `canonical_event_id`, `event_offers`, `event_provenance` all migrated.
- Private Agent API live on Fly.io (`eventpulse-agent.fly.dev`, 2026-09-12). `eventServiceClient.js` anon REST no longer the product path.
- 27 endpoints in `08-Agent/server.ts`: `/agent/chat`, `/agent/feed`, `/agent/feedback`, `/agent/outbound`, `/agent/preferences`, `/agent/saved`, `/agent/follow`, `/agent/notifications`, `/agent/recommended`, `/agent/cached-recommendations`, `/agent/curated-collections`, `/agent/share` + `/s/:hash`, `/agent/auth/apple`, `/agent/metrics`, `/agent/experiments/personalization`, + more.
- Tools: `parse_intent` + Swedish `temporal_sv`, `search_events` (real venue_name, zero-result broadening), `rank_events` (heuristic, `reasons[]` explainability), `record_feedback` (impression/click/save/reject/outbound + `reject_reason` enum), `personalize` (count-based priors, Laplace + Wilson, 30d decay), `experiments` (sticky 50/50 hash assignment, z-test, OEC=outbound CTR), `diversify` (MMR), `share_session`.
- Crons running: `sync_personalization` (materialized category weights into `user_signal_weights`, 6h), `pre_render_recommendations`, `reminders`, `follow_drops`, `attendance_prompt`. Nightly ingestion chain via `runNightly.sh`.
- Expo: scroll feed as home (Ikväll/Helgen/Rekommenderat sections), chat as secondary affordance in Utforska, onboarding screen, profile, notifications tab, calendar/ical export, follows/reminders/attendance rating UI. Auth: Apple + magic link via Supabase.
- Guest mode (2026-09-19, `34828f4`): app opens anonymously on Hem/Utforska; login asked only on personalized surfaces; AuthReminderModal after 30s; `getOrCreateAnonUserId` persistent UUID in AsyncStorage.
- Golden-query anti-hallucination eval harness exists (`08-Agent/eval/`).
- Account deletion cascade + RLS isolation tests exist.
- AI images: every future event has an image (library reuse; generation paused for cost, pre-launch top-up planned).

**Open blockers (known 2026-09-12…20):**
1. `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` return 401 in prod — production chat runs on fallback. MiniMax/BFL/Ollama OK.
2. Web/iPhone-Chrome Supabase auth broken (`signInWithOtp is not a function`). Native iOS unaffected.
3. `analyticsClient` disabled in prod (`EXPO_PUBLIC_ANALYTICS_URL` unset) — funnel metrics only via `user_interactions`.
4. Growth strategy package (`eventpulse-growth/`) written 2026-09-20 but assumes pre-personalization state; repo is ahead of ~10/15 of its prompts. Mapping done; remainder folded into Phases below.

---

## 1. North star (unchanged)

EventPulse is a **personal event agent** for Stockholm. The Expo app is the interface. The job is *"Vad ska jag faktiskt göra?"* — not *"Vilka events finns?"*. First acceptance surface is the AI-ranked scroll feed; chat is a search affordance, not the front door.

Not: aggregator, public event API, datagrossist, webbyrå, social network, national scraping platform.

**New clarification (2026-09-20, user decision):** "personal" starts **before account**. The agent learns taste from the first anonymous session and keeps it. Account is sold later as *sync + backup of an already-valuable profile* — never as a gate to personalization.

---

## 2. Identity & growth loop (updated)

```text
Install (no account)
   ↓
persistent anonymous_user_id (AsyncStorage UUID, survives restarts)
   ↓
feed + chat accumulate taste: impressions, clicks, saves, rejects, prefs
   ↓
personalized feed improves session by session
   ↓
"Din helg" + follows/reminders create recurring value
   ↓
account offered when there is something worth keeping
   ↓
anonymous_user_id → user_id migration (history preserved, no dupes)
   ↓
share (/s/:hash links) → new anonymous users → loop repeats
```

**Rules:**
- Backend must accept `anonymous_user_id` wherever it accepts `user_id` for *write-own-data* operations (feedback, preferences, saves, recommendations read of own priors). Auth is required only for cross-device, notifications identity, and destructive/account operations.
- RLS: guests must never read other users' rows; anonymous identity is write-and-read-own via the service-role API only (client never holds elevated keys — unchanged).
- Privacy: dataminimering per `eventpulse-growth/02-ARCHITECTURE.md` §8. Tracking is best-effort and must never crash or block UI (already the `record_feedback` contract). Anonymous tracking still requires a documented retention/deletion policy before public launch (GDPR).

---

## 3. Moat (unchanged)

Normalized Event Graph + provenance/confidence/freshness + user behavior loop + non-generic ranking. Now additionally concrete: with guest-first taste, the behavior loop starts compounding from install #1 instead of from conversion.

Do not commoditize: interactions, ranking scores, personalization, canonical clusters, conversion data. No public API.

---

## 4. Phases (replanned against actual state)

### Phase 0 — Foundation ✅ DONE (W1–W2, verified 2026-08-27)

Migrations applied, events persisted, agent API skeleton, `search_events` on real DB, Expo shell, anon REST killed as product path.

### Phase 1 — Useful agent ✅ DONE (W3–W5, verified 2026-09-19)

Feed primacy shipped ahead of chat plan; mixed-initiative (results before questions, max 1 clarifying question); Swedish temporal parsing; real venue names; save/reject/`reject_reason`; deep link + outbound attribution; golden eval; onboarding; cold-start preferences. Deployed to Fly.io.

### Phase 1.5 — Pre-launch hardening (NOW, gate for App Store + guest launch)

Everything else waits. Launch blockers only:

1. **Guest taste-first (the 100% focus).**
   - Open guest access server-side for: `record_feedback`, `preferences POST/GET`, `saved`, `recommended`, `cached-recommendations` — identity = `anonymous_user_id` OR `user_id`.
   - Un-hide personalized home sections (Rekommenderat/Förslag/Sparade) for guests in `AppShell`/`HomeScreen`; keep AuthReminderModal but reframe copy: *"Skapa konto för att behålla din smak på alla enheter"* (sync-framing, not access-framing).
   - `user_interactions` / `user_preferences` / saves accept `anonymous_user_id` (migration; keep `user_id` nullable-linkable).
   - Anon→auth migration endpoint + client hook: on first login, link all guest rows to `user_id`, dedupe, keep both ids mapped for idempotency.
2. **LLM keys:** fix `ANTHROPIC` (or formally switch prod chat to MiniMax and document it). Verify golden eval = 0 hallucinations on the *actual prod model/config*.
3. **Web auth** (`signInWithOtp`) — decide launch scope: native-only launch makes this non-blocking; if Expo web is in scope it is a blocker.
4. **Analytics decision:** either set `EXPO_PUBLIC_ANALYTICS_URL` (10-Analytics) or formally declare `user_interactions` the only funnel source for launch. No silent dead queues.
5. **AI image top-up** at launch (BFL credits + backfill run) — already documented in BACKLOG; not a blocker before that point.
6. Privacy/retention statement for anonymous tracking (GDPR) — one page, linked in app.

**Success for Phase 1.5:** a brand-new anonymous install gets visibly better recommendations within one session; a guest who saves 5 events on day 1 sees the effect on day 2; login preserves everything.

### Phase 2 — Retention: "Din helg" + personalization proof (W9–W16 → now W6+)

- **Din helg:** recurring personalized weekend selection, built on `rank_events` + `curated_collections` + `cached_recommendations` substrate. Weekly rhythm (Thursday drop), push via existing notifications infra — no notification spam in v1 (opt-in, max 1/week).
- **Personalization lift experiment:** `experiments.ts` is ready (assignment, z-test, OEC=outbound CTR) — activate PERSONALIZATION_PRIORS A/B on internal + first external users. Kill rule from old plan stands: lift ≈ 0 after 4 weeks of repeat users → drop priors, keep explicit filters.
- Explainability v1: surface `reasons[]` as user-visible "Varför detta?" chips on cards (grounded fields only).
- Conversion UX: post-value account prompt (after Nth save or first Din helg open), anon→auth migration runs here.
- **Success:** repeat sessions/7d > 0 for first external cohort; measurable lift or honest kill.

### Phase 3 — Transaction (unchanged)

Level 2 prefill → Level 3 partner booking. Only after Phase 2 retention exists.

### Phase 4 — B2B readiness flywheel (unchanged)

`source_readiness` scanner + human outreach + partner feed. Only after consumer conversion.

### Phase 5 — Growth loops (deferred, evidence-gated)

- **Group voting ("Hjälp oss välja"): PARKED (user decision 2026-09-20).** Rationale: acquisition mechanic before retention exists; requires web surface that is currently broken; plain share (`/s/:hash` + view_count) already measures the top of this funnel. Revisit only if post-launch share→open data shows real sharing behavior.
- Other agents as channels, second city, organizer self-serve: unchanged, not now.

### Stockholm Density Plan (status: operating, not a focus)

Four layers remain valid as background maintenance (aggregator listings, AI subpage discovery, venue-graph expansion, new-source auto-detect via nightly chain). Ingestion work is justified only when the graph is too thin for the feed/magic query — never as its own goal. 60–70% target unchanged; 80%+ stays Phase 4.

---

## 5. Metrics

Funnel (growth-plan vocabulary → repo reality):

```text
event_impression   = user_interactions('impression')
event_open         = user_interactions('click')
event_save         = user_interactions('save')
event_share        = NOT YET tracked as interaction (share exists via /agent/share; add type)
event_booking_click = user_interactions('outbound')
recommendation_like/dislike = feedback_positive/negative (legacy aliases kept)
search_performed   = partial (recent-queries); formalize if needed for metrics
```

Weekly: CTR, save rate, reject rate, outbound rate, repeat sessions/7d, personalization lift. Guards: latency, errors, empty-result rate, duplicate-rec rate, dislike rate, tracking failures.

Ignore as north-star: sources processed, queue drains, downloads, account registrations.

---

## 6. Kill criteria (updated)

- **Launch kill:** guest taste-first ships but repeat sessions stay ≈ 0 through first external cohort → thesis wrong, stop building personalization features.
- **Personalization kill:** unchanged (4 weeks, lift ≈ 0).
- **Chat kill:** if prod chat must run degraded fallback at launch, ship feed-first and treat chat repair as the only P1; if fallback quality is unacceptable and keys can't be restored, consider launching with chat feature-flagged off.
- **Voting:** stays parked unless share metrics justify revival (user gate).
- B2B / transaction / scraping kill rules: unchanged from 2026-08-17 plan.

---

## 7. Historical appendix (in `docs/MASTERPLAN.md` only)

The 90-day week-by-week table (§11), architecture-change list (§12), full DB schema (§13), tool contracts (§14), and the MVP Hardening Plan (§18) are kept in the authoritative file as history. This draft supersedes only strategy/roadmap content, not executed-work records.
