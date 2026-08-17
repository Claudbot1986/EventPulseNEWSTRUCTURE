# EventPulse — NEWSTRUCTURE

EventPulse is a **personal event agent**. The Expo app is its interface. The job is *“Vad ska jag faktiskt göra?”* — not a public event aggregator and not a public event-data API.

Canonical plan: [`docs/MASTERPLAN.md`](docs/MASTERPLAN.md)  
Execution order: [`docs/BACKLOG.md`](docs/BACKLOG.md)  
Source-ops only: [`RebuildPlan.md`](RebuildPlan.md)

First city: Stockholm. First magic slice: user describes intent → 3–5 grounded recs → tap to tickets.

Ingestion (A–D), queues, normalizer, and Supabase remain the Event Graph factory. They are not the product.

## Mappstruktur

```
NEWSTRUCTURE/
├── 01-Sources/       → Var events kommer ifrån (källor, testfaser, status)
├── 02-Ingestion/     → Hur rådata blir strukturerade händelser (A–H pipeline)
├── 03-Queue/         → Job-orkestrering (BullMQ, Redis)
├── 04-Normalizer/    → Data-transformation (venue, dedup, category, field-mapping)
├── 05-Supabase/      → Databas-lagring (events, venues, categories)
├── 06-UI/            → Agent interface (Expo). Browse is secondary.
├── 07-Discovery/      → Venue graph substrate (not the product surface)
├── 08-Agent/         → Private agent API + tools (Phase 0 — create next)
├── docs/             → MASTERPLAN.md + BACKLOG.md
├── AI/               → Ingestion/operator AI rules (se AI/AI.md)
├── README.md         ← Du är här
└── CLAUDE.md         → AI-startpunkt
```

## Dataflöde

```
01-Sources → 02-Ingestion A–D → 03-Queue → 04-Normalizer → 05-Supabase Event Graph
                                                                      ↓
User intent → 08-Agent (private tools) → rank 3–5 → 06-UI agent home → deep link
```

07-Discovery venue-graph is substrate for entity resolution, not a consumer feature.

## Var man startar

**För människor:** Läs `docs/MASTERPLAN.md` och `docs/BACKLOG.md`. Denna fil är kartan.

**För AI:** Läs `CLAUDE.md`, sedan `docs/MASTERPLAN.md`. Implementera `docs/BACKLOG.md` NOW — inget från DO NOT BUILD YET.

## Ingestions-pipeline (02-Ingestion)

Path-ordning (alltid testa billigaste först):

```
1. JSON-LD        (schema.org/Event, snabbast)
2. Network Path    (XHR/API-inspektion, endast om bättre än HTML)
3. HTML Path       (DOM-heuristik, fallback)
4. Render Path     (headless/Cloudflare, sista utväg)
5. Manual Review   (endast när allt annat misslyckas)
```

## Testfaser (nya källor)

```
[new källa]
    ↓
Phase 1: Sanity    (1-2 events, --mode=sanity)
    ↓ pass
Phase 2: Breadth   (10-20 events, --mode=breadth)
    ↓ pass
Phase 3: Smoke    (3 events/venue, --mode=smoke)
    ↓ pass
[PROMOTED → produktionskälla]
```

## Verifiering

Varje ändring ska verifieras genom verklig körning, inte antas.

E2E för **produkten** betyder: intention → agent tools → Event Graph → 3–5 recs → action in Expo.

E2E för **ingestion** betyder: källa → 02-Ingestion → 03-Queue → 04-Normalizer → 05-Supabase. Ingestion E2E is necessary but not sufficient.

## Mappansvar

| Mapp | Äger |
|------|------|
| `01-Sources` | Källhantering, candidat-listor, source testing |
| `02-Ingestion` | Fetching, JSON-LD, network, HTML, rendering, extraction |
| `03-Queue` | BullMQ, Redis, job-orkestrering |
| `04-Normalizer` | Venue resolution, deduplication, category mapping |
| `05-Supabase` | Schema, migrationer, queries |
| `06-UI` | Agent interface (Expo). Not a public data browser. |
| `07-Discovery` | Venue graph substrate |
| `08-Agent` | Private agent API, tools, prompts, eval |
| `docs/` | Product masterplan and backlog |
