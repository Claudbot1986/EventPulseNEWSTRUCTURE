# 07-Discovery

## Purpose

07-Discovery is the intelligence layer that operates on data already stored in 05-Supabase. It builds and expands the venue graph, discovers relationships between venues and promoters, ranks candidates, and feeds back into the system to identify coverage gaps.

Discovery assumes 01–04 have already produced structured event and venue data. Discovery does NOT fetch raw sources — that belongs to 02-Ingestion.

## What belongs here

- Venue graph construction and expansion
- Multi-hop BFS traversal via promoter/attraction connections
- Priority and confidence scoring for candidates
- Discovery expansion queue management
- Ranking and relevance scoring
- Stockholm area prioritization (city variants, area priority)
- Venue quality validation (blacklist filtering, coordinate verification)

## What does NOT belong here

- Raw source fetching (belongs to 02-Ingestion)
- Queue infrastructure (belongs to 03-Queue)
- Normalization logic (belongs to 04-Normalizer)
- Database schema (belongs to 05-Supabase)
- UI rendering (belongs to 06-UI)

## Discovery Pipeline

```
Supabase (venues, events)
    │
    ├──► Build venue graph
    │        ├── Connect events → venues
    │        ├── Connect venues → promoters (via events)
    │        └── Connect venues → attractions (via events)
    │
    ├──► Multi-hop expansion (BFS, max 3 hops)
    │        ├── Hop 1: Direct connections from known venues
    │        ├── Hop 2: Connections from hop-1 venues
    │        └── Hop 3: Further expansion (bounded)
    │
    ├──► Priority scoring
    │        ├── priority_score = base + connections + area_relevance
    │        ├── confidence_score (0-100)
    │        └── Stockholm area variants (norrmalm, södermalm, etc.)
    │
    ├──► Queue candidates
    │        └── discovery_expansion_queue (pending → processing → expanded)
    │
    └──► Expansion worker
             └── Saves results to discovery_expansion_results

Also feeds back:
    └──► Identify coverage gaps → suggest new sources
```

## Venue Graph

Discovery treats the system as a graph, not a list.

**Nodes:**
- Venues
- Promoters
- Events (as connections)

**Edges:**
- event → venue
- event → promoter
- promoter → venue (inferred via events)

**Discovery produces candidates:**
- new venues
- new promoters
- new connections

Each candidate has:
- `confidence_score` (0-100)
- `priority_score`
- `hop_level` (1-3)
- `connection_count`
- traceable origin

## Venue Validation

**Blacklist** — these names are rejected as fake/placeholder:
`tba`, `tbd`, `待定`, `tbc`, `coming soon`, `venue`, `location`, `tbd venue`, `tba venue`, `online`, `virtual`, `online event`, `sweden`, `stockholm, sweden`

**Quality signals:**
- has coordinates (lat/lng)
- has address
- is in Stockholm area
- has valid name (not just numbers/single chars)

## Priority Scoring

Based on:
- `connection_count` — how many connections led to this venue
- `promoter_count` / `attraction_count`
- `city` relevance (Stockholm variants weighted by area)
- `confidence_score`

**Stockholm area priority (higher = more central):**
```
norrmalm: 100, södermalm: 95, östermalm: 90,
kungsholmen: 85, vasastan: 80, gamla stan: 75,
djurgården: 70,ammarby: 65, kista: 50
```

## Relationship to Adjacent Layers

- **05-Supabase** — reads venue/event data, writes discovery results
- **06-UI** — discovery results can feed UI relevance/filtering
- **01-Sources** — discovery identifies coverage gaps → suggests new sources
- **07-Discovery is NOT part of ingestion** — it operates post-storage

## AI Guidance

When debugging discovery:
1. Check `discovery_expansion_queue` — are there pending candidates?
2. Check `discovery_expansion_results` — have expansions completed?
3. Check `venues` table — have new venues been created?
4. Check hop_level distribution — is expansion controlled?

When modifying discovery:
- Never fabricate venues or connections
- Always validate against `VENUE_BLACKLIST`
- Keep hop_level bounded (max 3)
- Track traceability: origin venue, path, confidence

## Current Status

**Status: Venue Graph v0 implementerad, apply-körning ej verifierad**

Discovery code now exists in `07-Discovery/src/venueGraph/`:
- `types.ts` — graph/repository contract for nodes, edges, observations, candidates, runs, expansion tasks
- `graphBuilder.ts` — deterministic dry-run/apply Venue Graph builder from stored `events` and `venues`
- `scoring.ts` — explainable confidence/priority scoring with risk flags
- `expansionRunner.ts` — measured expansion runner that writes no simulated result summaries
- `supabaseRepository.ts` — Supabase adapter for real graph tables
- `runVenueGraph.ts` — CLI entrypoint for dry-run/apply runs

Schema is defined in `05-Supabase/migrations/20260427-0001-venue-graph.sql`:
- `venue_graph_nodes`
- `venue_graph_edges`
- `venue_graph_observations`
- `venue_candidates`
- `source_candidates`
- `venue_graph_expansion_queue`
- `venue_graph_expansion_results`
- `venue_graph_runs`

The old `06-UI/services/ingestion/src/discovery/expansionWorker.ts` now delegates to the measured Venue Graph expansion runner. It no longer writes “Simulated expansion” summaries.

Remaining verification:
- apply the migration to a real Supabase environment
- dry-run beyond the first verified sample
- run a small `npm run venue-graph:apply -- --limit=...` only after schema is applied
- verify persisted `venue_graph_runs`, nodes, edges, observations, candidates, and measured expansion results

## Subfolders

| Subfolder | Purpose |
|-----------|---------|
| `notes/` | Operational notes, known limitations |
| `testResults/` | Discovery test output, expansion results |

## Key Files

| File | Role |
|------|------|
| `07-Discovery/src/venueGraph/graphBuilder.ts` | Venue Graph v0 from stored events/venues |
| `07-Discovery/src/venueGraph/scoring.ts` | Explainable candidate scoring |
| `07-Discovery/src/venueGraph/expansionRunner.ts` | Measured expansion runner |
| `07-Discovery/src/venueGraph/supabaseRepository.ts` | Supabase persistence adapter |
| `07-Discovery/src/venueGraph/runVenueGraph.ts` | CLI entrypoint |
| `06-UI/services/ingestion/src/discovery/expansionWorker.ts` | Legacy ingestion adapter to measured expansion runner |

## AI-regler som gäller här

- Discovery-regler: `AI/rules/discovery.md`
- Workflow: `AI/workflows/discovery-loop.md`

AI-regler sammanfattade: `AI/rules-summary.md`
