# EventPulse backlog

Canonical order. Strategy lives in [`MASTERPLAN.md`](MASTERPLAN.md). Do not pull items from DO NOT BUILD YET into NOW.

Owner after this docs commit: implement Phase 0 in the order listed. One slice at a time.

---

## NOW — Phase 0 (weeks 1–2)

Do in this order. Stop if a step is not verified with real data.

1. **Event Graph + interaction migration**
   - File: `05-Supabase/migrations/20260817-0001-agent-event-graph.sql` (name may vary; date ≥ 2026-08-17)
   - Add columns/tables from MASTERPLAN §13
   - Verify: `\d events` / Supabase table editor shows new columns; RLS blocks anon on `user_*` and `agent_*`

2. **Persist extracted Stockholm events**
   - Run `03-Queue/startWorker.ts` and `03-Queue/importToEventPulse.ts` against real `03-Queue/03-extractedEvents/`
   - Stockholm sources first; no fixtures; no simulated `eventsFound`
   - Verify: count of `events` with `start_time > now()` in Supabase

3. **Private agent API skeleton**
   - New: `08-Agent/server.ts` (Node, same repo, not Next.js)
   - `POST /agent/chat` with `client_user_id`, `session_id`, `message`
   - Service-role only on the server

4. **`search_events` on real DB**
   - New: `08-Agent/tools/search_events.ts`
   - Graph only, future events, Stockholm default
   - Verify: magic-query intent returns real rows or honest zero — never invented events

5. **Expo agent shell**
   - New home: `06-UI/AgentScreen` (or equivalent)
   - Browse list becomes secondary tab
   - Client talks only to `/agent/chat`

6. **Stop anon dump as product path**
   - `06-UI/services/eventServiceClient.js` must not be the product read path
   - Anon RLS must not expose clusters, offers internals, confidence, or user tables

Success for NOW: `search_events` returns real future Stockholm events from DB.

---

## NEXT — Phase 1 (weeks 3–8)

- `parse_intent` with schema validation (`IntentBrief`)
- `get_event_details`
- `rank_events` heuristic (time, price, category, exclude, confidence, freshness)
- 3–5 result cards with `reasons[]` from features, not free-text invention
- Stale / ended filter + confidence copy when score is low
- `record_feedback` for impression, click, save, reject + `reject_reason`, `ticket_outbound`
- Deep link `ticket_url` (Level 1 only)
- Golden eval: `08-Agent/eval/golden-queries.stockholm.json` (~20 queries); hallucination count = 0
- Cold-start: 3 questions or skip
- Metrics: CTR, save, outbound, repeat session

Success for NEXT: dogfood + 5 external users; majority prefer the 3–5 recs over browsing; outbound CTR > 0.

---

## LATER — Phase 2+ (after Phase 1 works)

- Personalization lift from saves/rejects (count-based priors)
- Real auth + export/delete
- Cross-source `canonical_event_id` hardening
- C3 date-in-card extraction **only if** verified on 3+ unrelated Stockholm domains
- Cheap `og:image` / JSON-LD image fallback
- Transaction Level 2 then 3 (prefill → partner API)
- `source_readiness` scanner as internal quality, then human B2B
- Second city (not Sweden-wide scrape)

---

## DO NOT BUILD YET

- Public event API / bulk graph dump
- Next.js consumer app
- Partner portal / self-serve onboarding
- Automated outbound email / sales sequences
- Agentic purchase (Level 4)
- Sweden-wide source import or national coverage campaign
- D-render as default path
- Improvement Orchestrator as the current company task
- Group / social product
- Custom organizer websites (webbyrå)
- Meilisearch as the agent
- Draining all error queues (404 / serverdown / timeout / 117 manual-review) as P1
- Queue `sources_status.jsonl` rewrite as a product phase
- `get_group_profile` implementation
- `create_checkout`
- `search_external_web` in the default Phase 1 path
- Venue-graph `--apply` as growth engine
- Source-candidate auto-promotion
- Training a custom LLM on user chats
