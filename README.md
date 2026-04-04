# EventPulse — NEWSTRUCTURE

EventPulse är ett verkligt city event discovery-system. Inte en demo, inte mock-data, inte en spekulativ arkitektur.

## Mappstruktur

```
NEWSTRUCTURE/
├── 01-Sources/       → Var events kommer ifrån (källor, testfaser, status)
├── 02-Ingestion/     → Hur rådata blir strukturerade händelser (A–H pipeline)
├── 03-Queue/         → Job-orkestrering (BullMQ, Redis)
├── 04-Normalizer/    → Data-transformation (venue, dedup, category, field-mapping)
├── 05-Supabase/      → Databas-lagring (events, venues, categories)
├── 06-UI/            → Presentation (components, app, services)
├── 07-Discovery/      → Intelliqens-lager (venue graph, expansion, ranking)
├── AI/               → Sammanfattande AI-regler (se AI/AI.md)
├── README.md         ← Du är här
└── CLAUDE.md         → AI-startpunkt
```

## Dataflöde (01 → 07)

```
01-Sources
    ↓ (råa URLs/källor)
02-Ingestion
    ↓ (strukturerade events, A→H pipeline)
03-Queue
    ↓ (BullMQ-jobs)
04-Normalizer
    ↓ (venue resolution, dedup, category)
05-Supabase
    ↓ (persistent lagring)
06-UI ←─────── 07-Discovery
  (display)    (intelligence/graph)
```

## Var man startar

**För människor:** Läs denna fil. Gå sedan vidare till respektive mapp.

**För AI:** Läs `CLAUDE.md` först. Den pekar dig till rätt mapp baserat på uppgift.

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

E2E betyder: källa → 02-Ingestion → 03-Queue → 04-Normalizer → 05-Supabase → 06-UI.

## Mappansvar

| Mapp | Äger |
|------|------|
| `01-Sources` | Källhantering, candidat-listor, source testing |
| `02-Ingestion` | Fetching, JSON-LD, network, HTML, rendering, extraction |
| `03-Queue` | BullMQ, Redis, job-orkestrering |
| `04-Normalizer` | Venue resolution, deduplication, category mapping |
| `05-Supabase` | Schema, migrationer, queries |
| `06-UI` | Components, screens, API client |
| `07-Discovery` | Venue graph, expansion, ranking, enrichment |
