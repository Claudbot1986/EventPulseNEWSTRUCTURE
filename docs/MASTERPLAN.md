# EventPulse — Agent-First Masterplan

Canonical product plan. Source-ops details remain in [`../RebuildPlan.md`](../RebuildPlan.md). Execution order lives in [`BACKLOG.md`](BACKLOG.md).

Vault (Desktop, not git): `/Users/claudgashi/Desktop/MyVault/TomorGashi/01-Projects/EventPulse/`

Start date for the 90-day clock: **2026-08-17**.

---

## What changed and why

The old plan treated EventPulse as a **source-to-UI ingestion factory**: more Swedish sources, higher C2→C3 success, persist extracted files, then browse them in Expo.

That strategy has a fatal product risk. If we make a clean open event layer, ChatGPT, Gemini, and Siri become the interface and EventPulse becomes a datagrossist.

**New north star:** EventPulse is a **personal event agent**. The job is *“Vad ska jag faktiskt göra?”* not *“Vilka events finns?”*. The Expo app is the agent’s interface. Ingestion, the Event Graph, and later B2B readiness exist to make *this* agent better than general AI at events — not to publish a public event API.

| Old plan | New plan |
|---|---|
| Product = aggregator + pipeline | Product = agent; app = UI |
| Win = more sources / more Sweden | Win = 3–5 right recs a user acts on |
| Fas 0 = queue/status reconciliation | Phase 0 = persisted Stockholm graph + private agent API |
| P1 = C2→C3 gap | P1 = magic slice (intent → recs → act) |
| Open-ish Supabase REST to the app | Private agent tools; do not commoditize the graph |
| B2B absent / implied later | B2B = readiness + feeds, Phase 4 only, not a webbyrå |
| Personalization = non-goal until data stable | Log signals from day 1; rank from Phase 1; learn from Phase 2 |

**Locked decisions (no further strategy needed for Phase 0–1):**

- First city: **Stockholm**. Not national coverage.
- First surface: **existing Expo app**, agent as home. No Next.js consumer app.
- First transaction level: **deep link only**.
- Auth: **anonymous `client_user_id`** (AsyncStorage) in Phase 1; real auth in Phase 2.
- LLM: **hosted tool-calling model** (Anthropic already used in ingestion). Events, times, prices, venues **only** from tools — never from model memory.
- Ingestion stays. It is subordinated to **Stockholm graph quality + freshness** for the agent.
- No public event API. Direct anon-key REST in `06-UI/services/eventServiceClient.js` is a strategic leak and must be replaced as the product path.
- Vault is on the Desktop: `/Users/claudgashi/Desktop/MyVault/TomorGashi`. EventPulse notes live in `01-Projects/EventPulse/`. Session log stays at vault-root `02-Operations/03-Session-Log/`.

---

## 1. Product thesis

**What EventPulse is:** A Stockholm event agent that takes a user’s intention, searches a proprietary Event Graph, ranks a short list, explains why in grounded language, and lets the user act (save / reject / open tickets). Over time it learns what that person actually does.

**What we are not:**

- Not an event aggregator whose job is complete listings
- Not a public event-data API / datagrossist
- Not “ChatGPT with a calendar plugin”
- Not a webbyrå that rebuilds organizer sites
- Not a social network
- Not a national scraping platform (this cycle)

**Job to be done:** “Hjälp mig välja vad jag ska göra — med bättre eventförståelse än jag (eller en generell agent) orkar samla själv.”

**First magic slice (acceptance experience):**

> User: “Jag är i Stockholm på fredag kväll, sugen på live musik men inte arena, max 400 kr, gärna med en vän.”
>
> Agent: 3–5 verified events, each with why, price/time/venue grounded in graph fields, tap to tickets.

If that loop is not better than browsing Ticketmaster or asking ChatGPT, the product has not started.

---

## 2. Moat

General agents can browse the open web. They struggle to own:

- **Normalized Event Graph** with entity resolution (same concert from Ticketmaster + venue site = one event)
- **Provenance + confidence + freshness** (know when data is stale or wrong)
- **User behavior loop:** impression → click/dwell → save → share → reject → purchase → attendance → rating
- **Ranking that is not generic SEO** (distance, price elasticity, weekday vs weekend, group context)
- **Organizer relationship** (direct feed, inventory, status) — later
- **Conversion data** organizers cannot get from ChatGPT

**Stronger with more users:** personal models, reject/save priors, “people like you did X”, cold-start defaults for Stockholm.

**Stronger with more organizers:** exclusive freshness, availability, correct IDs, fewer scrape failures, higher conversion — which attracts more organizers. **Do not start the B2B flywheel until the consumer loop converts.**

**Weak moat (do not invest as if it were the product):** raw scraped listings, a public REST dump, a pretty browse UI, ingestion operator dashboards.

```mermaid
flowchart TD
  organizer[Organizer] --> betterData[Better data or direct integration]
  betterData --> graph[EventPulse Event Graph]
  graph --> rank[Ranking and recommendation]
  rank --> ux[Better agent UX]
  ux --> behavior[Saves purchases attendance]
  behavior --> profile[Richer personal model]
  profile --> conversion[Higher conversion]
  conversion --> organizerValue[More value for organizer]
  organizerValue --> organizer
```

---

## 3. Agent architecture

```mermaid
flowchart LR
  user[User in Expo] --> ui[Agent UI]
  ui --> api[Private Agent API]
  api --> llm[LLM with tools only]
  llm --> tools[Controlled tools]
  tools --> graph[Event Graph]
  tools --> profile[User profile]
  tools --> feedback[Interaction log]
  graph -.->|miss only| web[search_external_web]
```

**Search:** Parse intent into a structured brief (city, time window, categories, budget, party size, constraints, vibe). Call `search_events` against the graph **first**. Never answer from model weights.

**Event Graph use:** Retrieval is SQL/RPC over canonical events + venues + offers. The model does not get a database URL.

**Rank:** `rank_events` applies deterministic features first (time fit, distance, price, category, confidence, freshness, not-ended). Phase 1: heuristic. Phase 2: add profile weights. The LLM **explains** the ranked list; it does not secretly re-rank against tool output.

**Personalization:** Phase 1 records all signals and uses only the current query + optional 3 cold-start answers. Phase 2 reads `user_profiles` + recent interactions.

**External web:** `search_external_web` only on graph miss, and results are labeled **unverified** until ingested. No mixing unverified web hits into the top 3 as if they were graph events.

**Uncertain data:** If `confidence < threshold` or `freshness` is stale, say so. Never invent price, door time, or “still on sale”. Prefer omit over hallucinate.

**Transactions later:** tools grow from `get_ticket_options` → `create_checkout` → partner booking. Phase 1 ends at `ticket_url` deep link.

**Prompt contract:** System prompt forbids listing events not returned by tools. If tools return 0, say so and offer to widen constraints.

**Code location (Phase 0, after this docs commit):**

- `08-Agent/` — runtime, prompts, tool handlers, JSON contracts
- Private HTTP API in the same repo (Node; not a new Next.js product). Suggested entry: `08-Agent/server.ts`
- Expo talks **only** to that API. Do not give the client a service-role key.

**Phase 0 request shape:**

```http
POST /agent/chat
Content-Type: application/json

{
  "client_user_id": "uuid",
  "session_id": "uuid | null",
  "message": "Jag är i Stockholm på fredag kväll..."
}
```

Response includes `session_id`, assistant text, and `ranked_events[]` already chosen by tools (the client must not re-fetch the graph to “improve” the list).

---

## 4. Event Graph

Reuse `events`, `venues`, and venue-graph tables as **substrate**. The product graph is the **canonical layer the agent queries**.

Schema docs: `05-Supabase/schema/schema.md`. Normalizer: `04-Normalizer/normalizer.ts`. Import: `03-Queue/importToEventPulse.ts`.

**Canonical event schema (add, don’t replace):**

- Identity: `id`, `canonical_event_id` (cross-source cluster), `source`, `source_id`
- What: `title_sv` / `title_en`, `description_*`, `category_slug`, `tags`
- When: `start_time`, `end_time`, `timezone`, `status` (`scheduled` | `cancelled` | `postponed` | `sold_out` | `ended`)
- Where: `venue_id`, `lat` / `lng`
- Who: `organizer_id`, artists via `event_artists`
- Offers: `event_offers` (`price_min`, `price_max`, `currency`, `ticket_url`, `availability`, `inventory_source`)
- Quality: `confidence_score` 0–100, `freshness_at`, `last_seen_at`
- Provenance: `event_provenance` (`source_url`, `extractor`, `raw_hash`, `observed_at`)

**Dedup:** today’s `buildDedupHash(source::source_id)` in `04-Normalizer/normalizer.ts` is a **member id**, not a cluster id. Add cluster key:

```
canonical_key = normalize(title) + "|" + start_day_stockholm + "|" + venue_id
```

Keep `source::source_id` as the per-source member hash. Same concert from Ticketmaster and the venue site must share `canonical_event_id`.

**Entity resolution:** venues already exist (`resolveVenue`). Add `organizers` and `artists` as first-class tables. Do not stuff promoters into venue names.

**Ticket inventory:** Phase 1 = last scraped price + URL. True availability = Phase 3 / partner.

**Confidence v1 (heuristic, not ML).** Start at 0, add:

- +20 structured data / JSON-LD present
- +20 venue_id resolved
- +20 future `start_time`
- +15 price present (or `is_free`)
- +10 image present
- +15 source seen within 7 days

Clamp 0–100. Use for ranking and later for B2B readiness — same underlying gaps.

---

## 5. Personalization / data model

**Store from day 1 (even if unused in rank):**

- Explicit: saves, rejects + `reject_reason`, ratings, stated prefs (genres, venues, max travel km, budget SEK, weekend/weekday, group type)
- Implicit: impressions, clicks, `dwell_ms`, shares, ticket_outbound clicks (purchase proxy until Level 3)

**Do not store yet:** microphone, contacts, full location trails, other users’ chats.

**Cold start:** 3 questions max (area of Stockholm, typical budget, 2–3 categories) **or** skip and use the first query. Never a 20-field onboarding.

**Household/group:** schema may allow `group_id` on a session. **Do not build group UX in Phase 0–1.**

**Privacy:**

- `client_user_id` is a random UUID in AsyncStorage
- Chats retained for product improvement with a documented retention window (default 90 days)
- No selling profiles
- Export/delete in Phase 2 with real auth
- Ranking features stay on our API — not in a public dataset

**Learning:** Phase 2 = count-based profile (category / venue / price / hour priors). Not a custom LLM trained on users. Kill if personalization lift is ~0 after 4 weeks of repeat users.

---

## 6. Transaction roadmap

- **Level 1 (Phase 1):** Deep link `ticket_url`. Required: valid URL, host allowlist already in `06-UI/services/eventServiceClient.js`, outbound click logged as `ticket_outbound`.
- **Level 2 (Phase 3 start):** Prefill checkout (email, ticket type) via partner URL params or webview. Required: partner URL contract, auth.
- **Level 3:** Partner booking API (Ticketmaster / Billetto / Eventbrite or organizer). Required: contracts, inventory, refunds policy, support.
- **Level 4:** Agentic purchase (agent pays). Required: Level 3 + payments + explicit user confirm + liability. **Do not build until Level 3 is real.**

---

## 7. B2B / EventPulse Readiness

**Not a webbyrå.** Offer: “Gör era events EventPulse-ready.”

Readiness score is a **productization of ingestion diagnostics we already collect** (missing price, bad dates, no JSON-LD, JS-only, no availability, bad ticket URL, no canonical id, no status).

Example:

```
Malmö Opera — EventPulse Readiness 74/100
- eventtitel: OK
- datum/tid: OK
- pris: delvis
- venue: OK
- availability: saknas
- canonical ID: dåligt
- ticket URL: OK
- structured data: dåligt
- cancellation/status: saknas
```

**Phase 4 deliverables (not before):** scanner job on existing sources, score stored in `source_readiness`, partner onboarding via **feed / schema / plugin / import** (`organizer_portal` already exists as a source type in `packages/shared/src/types/ingestion.ts`), validation, metadata enrichment, optional ticket integration.

**Do not build:** custom websites, CMS rebuilds, automated cold-email blasts in Phase 0–3.

---

## 8. Outbound sales agent

| Step | Early (Phase 4) | Later |
|---|---|---|
| Detect bad sources | **Automate** from C/D diagnostics | — |
| Identify organizer | Semi-auto from JSON-LD `organizer` / about page | CRM enrich |
| Find contact person | **Human** | Optional enrich APIs |
| Generate report | **Automate** readiness markdown/PDF | — |
| Personalized outreach | **AI draft + human send** | Sequences only after reply rate proven |
| Follow-up | **Human** | Light automation |
| Onboard partner | Human + feed template | Self-serve portal |

Kill automated outbound if reply rate is near zero after a bounded human-supervised batch (e.g. 30). Keep the scanner as an **internal quality tool** regardless.

---

## 9. API strategy

- **Private (Phase 0):** `POST /agent/chat`. Tool endpoints are **not** exposed one-by-one to the client. Mobile uses a session token derived from `client_user_id`, then real auth later.
- **Internal:** ingestion workers, normalizer, operator `db.py`. Unchanged.
- **Partner (Phase 4):** **write-ish** — ingest feed, validate schema, push inventory. Rate-limited. **Not** a bulk dump of the graph + ranking + users.
- **Public API:** **Do not build.** If other agents become channels later, they get a **controlled, inferior slice** (no personalization, no live availability, no user graph), after our agent has retention.

**Never commoditize early:** user interactions, ranking scores, personalization, organizer inventory, canonical clusters, conversion data.

**Fix the leak:** Expo must stop using anon-key `events` select as the product. Public RLS, if any, should be insufficient to replicate the agent (no offers / confidence / clusters, or no public read at all).

---

## 10. Phased roadmap

### Phase 0 — Foundation (weeks 1–2)

- **Goal:** Agent can query real Stockholm events through controlled tools.
- **Deliverables:** this masterplan; persist existing extracted Stockholm events via `03-Queue/importToEventPulse.ts`; Event Graph columns + `user_interactions` / `agent_sessions`; private agent API skeleton; Expo agent shell; lock down product data path.
- **Dependencies:** Redis/BullMQ worker (`03-Queue/startWorker.ts`), Supabase service role, Anthropic key.
- **Success:** `search_events` for live music Friday Stockholm returns real future events from DB, not fixtures.
- **Do not build:** C-report learning loop, Sweden scouting, Next.js, B2B, Meilisearch product search, D-render as default, status-file rebuild as a “phase”.

### Phase 1 — Useful agent (weeks 3–8)

- **Goal:** Magic slice in Expo.
- **Deliverables:** intent parse, `search_events` / `get_event_details` / `rank_events` / `record_feedback`, 3–5 cards with why, stale/confidence handling, save/reject, deep link, golden-query eval set (~20 Stockholm queries).
- **Success:** dogfood + 5 external users: majority say the 3–5 recs beat browsing; 0 hallucinated times/prices in eval; outbound ticket CTR > 0.
- **Do not build:** ML recs, group, purchase, public API, national coverage.

### Phase 2 — Personalization (weeks 9–16, starts inside 90 days)

- **Goal:** Repeat use gets better recs than Phase 1.
- **Deliverables:** real auth optional-but-ready, profile from saves/rejects, personalization lift metric, delete/export.
- **Success:** measurable lift vs unpersonalized rank on repeat sessions.
- **Do not build:** social graph, ads, training a custom LLM.

### Phase 3 — Transaction

Level 2 then 3. Only after Phase 1 retention exists.

### Phase 4 — B2B data flywheel

Readiness scanner + human outreach + partner feed. Only after consumer conversion exists to show organizers.

### Phase 5 — Scale / distribution

Second city, other agents as **channels** (controlled), organizer self-serve. Not now.

### Stockholm Density Plan — within Phase 0–1 (added 2026-08-19)

**Goal:** 60–70% of "fredag kväll i Stockholm" events visible in the Event Graph by end of Phase 1. **80%+** requires Phase 4 organizer relationships and is explicitly **out of scope** for this plan.

**Constraint:** Only Ticketmaster Discovery API is available as a partner API. Billetto, Eventbrite, and similar aggregators have declined API access. The strategy therefore relies on **public listing pages + AI-driven discovery**, not partner integrations.

**Four layers, in priority order:**

1. **Public aggregator listings** — highest yield, lowest risk
   - `sources/billetto-stockholm.jsonl` (type: aggregator-listing)
   - `sources/eventbrite-stockholm.jsonl`
   - `sources/visit-stockholm.jsonl` (already exists)
   - `sources/kulturkalender.jsonl` (if available)
   - Run B-gate where a JSON feed exists; C-gate with strict rate-limit (1 req / 3s, identify as `EventPulse-Bot/1.0`, respect robots.txt) otherwise
   - **Expected yield:** 1 500–3 000 new events / week

2. **AI-driven subpage discovery** — fix the 287 dead `NO_JSONLD` sources
   - `09-ScrapingSupervisor` LLM path proposes `/events`, `/program`, `/kalender`, `/calendar` based on `c0Candidates` + site title
   - URL-variant test for transport errors (www/non-www, http/https, trailing slash)
   - **Expected effect:** drop dead count from 287 to ~50

3. **Venue graph expansion** (`07-Discovery`) — find new venues from existing data
   - BFS from working venues → promoters → unknown venues
   - Human verification before auto-register (anti-bias)

4. **Auto-detect new sources** — handle "new sites appear suddenly"
   - Nightly crawl of the public listings above
   - Diff event URLs against known `sources/` patterns
   - New patterns → push to `runtime/sources_priority_queue.jsonl`
   - `09-ScrapingSupervisor` tests + auto-promotes only when `cf=0` and ≥3 events observed

**Do not:**
- Request API access from aggregators that have declined (Billetto, Eventbrite confirmed)
- Google Events / search scraping (ToS + scope creep)
- Facebook Events (no API since 2019)
- Sweden-wide expansion
- Auto-register venues without verified events

**Out of scope for Stockholm Density Plan:** anything above 70%. The remaining 20–30% lives in Phase 4 (organizer relationships, direct feeds, B2B readiness that earns partner status).

---

## 11. 90-day execution plan

Start: **2026-08-17**. One vertical slice. Ingestion work only if the Stockholm graph is too thin for the magic query.

| Week | Dates | Work |
|---|---|---|
| W1 | 17–23 Aug | This docs commit. Apply Event Graph + interaction migrations. Run real import of extracted events. Verify counts in Supabase. Sketch agent API. |
| W2 | 24–30 Aug | Agent API + `search_events` + Expo chat shell + session logging. Kill product path via anon dump. |
| W3 | 31 Aug–6 Sep | Intent schema + `rank_events` heuristic + 3–5 result cards with why (grounded fields only). |
| W4 | 7–13 Sep | Anti-hallucination eval; filter ended/stale; confidence copy; deep link + outbound log. |
| W5 | 14–20 Sep | Stockholm density gap-fill only: persist remaining extracted; C3 date-in-card **only if** 3+ unrelated Stockholm domains need it (Generalization Gate). No Sweden-wide drain. |
| W6 | 21–27 Sep | Save/reject/`reject_reason`; cold-start 3 questions; browse becomes secondary tab. |
| W7 | 28 Sep–4 Oct | Golden queries, metrics pipeline (CTR, save, outbound, repeat session). |
| W8 | 5–11 Oct | Dogfood polish; freeze Phase 1 scope. |
| W9–10 | 12–25 Oct | Phase 2 start: profile priors from interactions; A/B unpersonalized vs personalized on internal users. |
| W11–12 | 26 Oct–8 Nov | Retention pass; write kill/continue for Phase 2; **no B2B build**. |

---

## 12. Architecture changes

**Keep:** `00-Sources` / `01-Sources` / `02-Ingestion` A–D / `03-Queue` / `04-Normalizer` / `05-Supabase` core / Expo shell / `07-Discovery` venue-graph **code** / `Alltools-E2E` real tools / `db.py` as operator / generalization gate / no simulated extraction.

**Modify:** README, CLAUDE.md, vault north star + non-goals + current task; Expo home → agent; `eventServiceClient.js` → agent API client; `buildDedupHash` → cluster + member; `events` schema + RLS; ingestion priority = Stockholm freshness for agent; `RebuildPlan.md` is **source-ops only**.

**Delete / stop as product:** browse-first north star; Sweden-wide scraping as near-term company goal; current task = “visible C learning loop”; treating anon REST as the app architecture; empty `WeaveMind/`; stale dashboard buttons to missing `run-ollama.ts` / `run-minimax.ts` (fix or hide, don’t extend).

**Defer:** Next.js consumer; D-render default on; H-gate growth; national scouting; venue-graph `--apply` as growth engine; source-candidate auto-promotion; manual-review of 117 as primary work; Improvement Orchestrator; Meilisearch as user search; group/social; Levels 2–4; partner portal; public API; status-file Fas 0.

**New:** this file, `docs/BACKLOG.md`, `08-Agent/` (after this docs commit), private agent API, DB tables below, Expo `AgentScreen`.

---

## 13. Database changes

Phase 0–1 migrations go in `05-Supabase/migrations/` with a date prefix after 2026-08-17. Apply with Supabase CLI or SQL editor. Do not invent events.

### Alter `events`

- `canonical_event_id uuid null`
- `confidence_score int not null default 0 check (confidence_score between 0 and 100)`
- `freshness_at timestamptz null`
- `last_seen_at timestamptz null`
- `organizer_id uuid null`
- expand `status` to `scheduled | cancelled | postponed | sold_out | ended | published` (keep `published` as alias of `scheduled` during migration)

### New tables

```sql
-- organizers
id uuid pk
name text not null
canonical_key text unique
website_url text null
created_at timestamptz default now()

-- artists
id uuid pk
name text not null
canonical_key text unique
created_at timestamptz default now()

-- event_artists
event_id uuid fk events
artist_id uuid fk artists
primary key (event_id, artist_id)

-- event_offers
id uuid pk
event_id uuid fk events
price_min_sek numeric null
price_max_sek numeric null
currency text not null default 'SEK'
is_free boolean not null default false
ticket_url text null
availability text null  -- unknown | available | limited | sold_out
inventory_source text null  -- scrape | partner
observed_at timestamptz not null default now()

-- event_provenance
id uuid pk
event_id uuid fk events
source text not null
source_id text null
source_url text null
extractor text null
raw_hash text null
observed_at timestamptz not null default now()

-- user_profiles
id uuid pk
client_user_id uuid unique not null
prefs jsonb not null default '{}'
-- prefs keys: categories[], venue_ids[], max_travel_km, budget_sek, weekend_bias, group_type
created_at timestamptz default now()
updated_at timestamptz default now()

-- user_interactions
id uuid pk
client_user_id uuid not null
session_id uuid null
event_id uuid null
type text not null
-- impression | click | dwell | save | share | reject | ticket_outbound | rating | attendance
value numeric null
dwell_ms int null
reject_reason text null
created_at timestamptz default now()

-- agent_sessions
id uuid pk
client_user_id uuid not null
group_id uuid null  -- unused in Phase 0–1
started_at timestamptz default now()
ended_at timestamptz null

-- agent_messages
id uuid pk
session_id uuid fk agent_sessions
role text not null  -- user | assistant | tool
content text not null
tool_calls jsonb null
tool_results jsonb null
created_at timestamptz default now()

-- source_readiness  (create unused; no UI/outreach)
id uuid pk
source_id text not null
score int not null check (score between 0 and 100)
fields jsonb not null
-- fields example: {"title":"ok","datetime":"ok","price":"partial","venue":"ok",...}
computed_at timestamptz default now()
```

**Defer tables:** `organizer_integrations`, `transactions`, `groups`, `group_members`.

Pending ops migrations `05-Supabase/migrations/20260427-0001-venue-graph.sql` and `20260427-0002-source-candidate-testing.sql`: apply only if they don’t block agent schema. They are discovery-ops, not Phase 1 product. Do not make venue-graph `--apply` the 90-day goal.

RLS: service role for agent API and workers. Anon key must not read `user_*`, `agent_*`, `event_offers` internals, `canonical_event_id` clusters, or ranking features.

---

## 14. Agent tool design

All tools return JSON. The model cannot `SELECT` arbitrarily. Implement handlers in `08-Agent/tools/`.

### `parse_intent`

Input: `{ "text": string }`

Output `IntentBrief`:

```json
{
  "city": "Stockholm",
  "area": "södermalm | null",
  "date_from": "ISO date",
  "date_to": "ISO date",
  "time_of_day": "evening | afternoon | morning | any",
  "categories": ["music"],
  "exclude": ["arena"],
  "budget_sek": 400,
  "party_size": 2,
  "vibe": "live but not arena",
  "language": "sv"
}
```

May be LLM-structured; **validate against schema** before search. Default city = Stockholm.

### `search_events`

Input: `{ "brief": IntentBrief, "limit": 25 }`

Output: `EventCard[]` from the graph only, `start_time` in the future, Stockholm default. Fields: `id`, `canonical_event_id`, `title`, `start_time`, `venue_name`, `price_min_sek`, `is_free`, `category_slug`, `confidence_score`, `freshness_at`, `ticket_url`.

Zero results is a valid answer. Do not invent rows.

### `get_event_details`

Input: `{ "event_id": "uuid" }`

Output: EventCard plus description, offers, provenance summary (`source`, `last_seen_at`), confidence.

### `rank_events`

Input: `{ "event_ids": uuid[], "brief": IntentBrief, "client_user_id": "uuid" }`

Output: `RankedEvent[]` sorted desc. Each item has `score` and `reasons[]` built from **features**, not free text, e.g. `["time_fit", "under_budget", "not_arena", "high_confidence"]`.

Phase 1 features: time fit, distance (if coords), price vs budget, category match, exclude match, confidence, freshness, not ended. Phase 2 adds profile priors. The LLM must not reorder this list.

### `get_user_profile`

Input: `{ "client_user_id": "uuid" }`

Output: profile JSON or empty object in Phase 1.

### `get_group_profile`

Stub only. **Do not implement.**

### `search_external_web`

Phase 1 **off** (feature flag default false). If ever on: results labeled `unverified`. Never mix into top 3 graph recs.

### `check_availability` / `get_ticket_options`

Phase 1 = return the `event_offers` row. Do not scrape live inventory.

### `create_checkout`

**Do not implement.**

### `record_feedback`

Input: `{ "client_user_id", "session_id", "event_id", "type", "reason?", "dwell_ms?" }`

Writes `user_interactions`. Types: `impression | click | dwell | save | share | reject | ticket_outbound | rating`.

---

## 15. Metrics

**Product (weekly):**

- recommendation CTR (tap on one of top 5 / sessions that showed recs)
- save rate
- reject rate
- event → outbound (purchase proxy)
- successful recommendation rate (user tapped one of top 5)
- repeat agent sessions / 7d
- % recs the user said they didn’t already know (optional lightweight prompt)
- personalization lift (Phase 2)

**Data health (not vanity):**

- source freshness p50 / p90
- % events with price + venue + future time
- duplicate cluster rate
- hallucination count on golden set (**must stay 0**)

**Ignore as north-star:** sources processed, C2 promising %, queue drain counts, Sweden city count.

Golden-query file (Phase 1): `08-Agent/eval/golden-queries.stockholm.json` — ~20 intents including the magic slice. Fail the eval if the model emits a time/price/venue not present in tool results.

---

## 16. Risk analysis

- **ChatGPT/Gemini good enough:** mitigate by graph + behavior + grounding, not by a nicer chat skin. Kill if users still prefer ChatGPT after Phase 1 dogfood.
- **Event data commodity:** don’t ship public API; cluster identity stays private.
- **Scraping cost / blocks:** Stockholm-first; prefer partner feeds later; D-render only for high-value Stockholm sources.
- **Transactions hard:** stay on Level 1 until a real partner exists.
- **Cold start:** query-only first; 3 questions optional.
- **Hallucination / stale / wrong price / dupes:** tools-only events; freshness filter; new dedup; eval harness. These are **launch blockers**, not backlog polish.
- **Scope creep consumer/B2B:** B2B is Phase 4; `source_readiness` may exist unused.

---

## 17. Kill criteria

- **Phase 1 kill (end of 90 days):** cannot beat “ask ChatGPT / open Ticketmaster” on the magic query; or golden-set hallucinations > 0 we cannot stop; or we still have no persisted Stockholm events for the agent.
- **Personalization kill:** 4 weeks of repeat users, lift ≈ 0 → keep explicit filters, drop profile ML.
- **Scraping kill for a source class:** organizer blocks + no feed path → drop source, don’t escalate render spend.
- **B2B kill:** 30 supervised outreaches, ~0 replies → scanner stays internal.
- **Transaction kill:** no partner API in 2 bounded attempts → remain deep-link forever rather than fake checkout.
- **Company-level pivot:** if the agent UI has retention but graph coverage is the block, invest in partners not in more C-gate machinery; if graph is fine but nobody talks to the agent, the thesis is wrong — stop building graph features.

---

## Critique of the old scraping plan

- **Remove as company phases:** Fas 0 status reconciliation; Fas 3 Sweden coverage; draining 404/serverdown/timeout as P1; activating D-render broadly; beta of 117 manual-review; aggregator-first for all Sweden.
- **Simplify:** C2→C3 and date-in-card extraction — only as Stockholm density support, after the agent exists.
- **Reuse:** A–D pipeline, extractors, import/normalizer, Expo, Supabase events/venues, Ticketmaster allowlist, venue-graph **as entity substrate**.
- **Rebuild:** product path (anon REST → private agent API); dedup; north star docs; UI information architecture.
- **Defer:** venue-graph apply, candidate testing promotion, Improvement Orchestrator, image coverage as a program (one og:image fallback is fine in Phase 1 if cheap).

---

## Phase 0 implementation order (for the next agent)

Do this next, in order. Do not start Phase 1 UI polish first.

1. Migration: Event Graph columns + tables in section 13. Verify on live Supabase.
2. Run `03-Queue/importToEventPulse.ts` against real `03-Queue/03-extractedEvents/` (Stockholm sources first). Start `03-Queue/startWorker.ts`. Count rows in `events` where `start_time` is in the future.
3. `08-Agent/tools/search_events.ts` querying those rows. No fixtures.
4. `POST /agent/chat` that can call `search_events` and refuse to invent events.
5. Expo `AgentScreen` as home; browse becomes secondary.
6. Stop shipping product reads through anon-key `events` select.

Success for Phase 0 is step 3 returning real future Stockholm events.

---

## 18. MVP Hardening Plan (2026-08-20)

Rollback point: git tag `pre-mvp-hardening-2026-08-20` @ `01807e0`.

### 18.1 Evidence

Database state is **not** the blocker: 11 308 rows total, ~8 600 future events (source: `localhost:7777/api/status`, dashboard is source of truth). Everything user-facing is.

| # | Defect | Location | Effect |
|---|--------|----------|--------|
| D1 | `isIntentComplete()` requires `party !== 'any'`, and `party` defaults to `'any'` | `08-Agent/tools/find_gaps.ts` | Nearly every query is "incomplete" → agent asks questions instead of searching. Magic query never returns cards. |
| D2 | Swedish temporal parsing missing "på fredag", "imorgon", "i helgen", bare weekdays; uses server-local `new Date()` and UTC `toISOString()` | `08-Agent/tools/parse_intent.ts` | Wrong or empty date windows; off-by-one at Stockholm DST boundaries. |
| D3 | `venue_name: ''` hardcoded; city filter is a no-op stub | `08-Agent/tools/search_events.ts` (≈130, ≈81-85) | Cards have no venue. MMR venue-penalty in `diversify.ts:88` is dead code. |
| D4 | Expo entry points at legacy browse app; anon id regenerates every cold start; agent URL is a home LAN IP | `06-UI/index.js:3`, `06-UI/services/agentClient.js:32-49`, `06-UI/.env.local:3` | Agent screen unreachable; personalization never accumulates; app cannot run off the dev network. |

### 18.2 Design decisions and their basis

1. **Results before questions (mixed initiative).** Show cards first, ask at most one clarifying question alongside them. Basis: Radlinski & Craswell (2017) theoretical framework for conversational search; Aliannejadi et al. (2019, SIGIR/Qulac) and Zamani et al. (2020, WWW) show clarification is valuable but only when it does not replace the result set. Blocking on three questions is the anti-pattern.
2. **One question maximum, chosen by information gain.** Keep the existing active-learning ranking (Settles 2009; Schein 2002) but cap `MAX_QUESTIONS` at 1 and never gate search on it.
3. **Future-biased date resolution.** Bare weekdays and "på fredag" resolve to the next occurrence, matching `dateparser`'s `PREFER_DATES_FROM: future` and Duckling's future grain bias.
4. **All time arithmetic anchored to `Europe/Stockholm`** via `Intl.DateTimeFormat`, as already done correctly in `rank_events.ts:87-98`.
5. **Zero-result broadening instead of empty state.** On zero hits, widen the date window then relax category, and label the relaxation in the response.

### 18.3 Workstreams (exclusive file ownership, no collisions)

| WS | Goal | Owns (exclusive) |
|----|------|------------------|
| A | Swedish temporal + party parsing, Stockholm TZ anchor | `08-Agent/tools/parse_intent.ts`, `08-Agent/tools/temporal_sv.ts` (new), `08-Agent/tests/parse_intent.test.ts`, `08-Agent/tests/temporal_sv.test.ts` (new) |
| B | Real `venue_name`, working city filter, zero-result broadening | `08-Agent/tools/search_events.ts`, `08-Agent/tests/search_events.test.ts` |
| C | Mixed-initiative orchestration (results first) | `08-Agent/tools/find_gaps.ts`, `08-Agent/server.ts`, `08-Agent/types.ts`, `08-Agent/tests/find_gaps.test.ts`, `08-Agent/tests/agent_chat_wire.test.ts` |
| D | Expo entry, durable identity, error/retry UX | `06-UI/index.js`, `06-UI/app/AgentScreen.js`, `06-UI/services/agentClient.js`, `06-UI/services/storage.js` (new), `06-UI/package.json`, `06-UI/app.json` |
| E | Hostable backend + secret hygiene | `Dockerfile`, `.dockerignore`, `fly.toml`, `.env.example`, `docs/DEPLOY.md` (all new) |
| F | Per-organizer outbound attribution | `05-Supabase/migrations/20260820-0001-outbound-attribution.sql` (new), `08-Agent/tools/attribution.ts` (new), `08-Agent/tests/attribution.test.ts` (new) |

A, B, D, E, F run in parallel. C runs after A and B because it integrates their outputs through `server.ts`.

### 18.4 Definition of done

1. The magic query returns ≥3 real cards, each with a non-empty `venue_name`.
2. At most one clarifying question, and never in place of results.
3. "på fredag" / "imorgon" / "i helgen" resolve to correct future Stockholm dates.
4. `npm run type-check` clean; 08-Agent tests green.
5. Expo boots into `AgentScreen`; anon id survives a cold restart.
6. Agent API reachable from a config value, not a hardcoded LAN IP.

### 18.5 Out of scope

Payments, push notifications, App Store submission, Sweden-wide coverage, public event API, C2→C3 discovery work.
