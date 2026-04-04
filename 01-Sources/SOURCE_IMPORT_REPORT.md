# Source Import Report
**Generated:** 2026-04-03
**Purpose:** Systematiskt kaosriar av alla källspår i projektet

---

## Scan Results

### Files scanned
- `01-Sources/100testcandidates.md` — 100 källor (testrapport 2026-03-28)
- `01-Sources/candidate-lists/010331-1945-100-candidates.md` — ~100 källor (scouting)
- `01-Sources/active/active.md` — 6 aktiva källor
- `02-Ingestion/sourceRunner.ts` — 8 hardkodade API-källor
- `02-Ingestion/A-Direct-API/adapters/` — 5 API-adapters
- `sources/` — vår nya source truth-mapp
- `runtime/sources_status.jsonl` — **FEL: innehöll source truth istället för status**

### Classification

| Category | Count | Action |
|----------|-------|--------|
| Verified sources | 5 | Importera till sources/ |
| Likely sources | 10+ | Lägg i candidates/ |
| Runtime artifacts | 6 | Ignorera/städa |
| Duplicates | 2 | Rensa |

---

## Verified Sources → sources/

| ID | URL | Typ | Preferred Path | Discovery |
|----|-----|-----|----------------|-----------|
| konserthuset | www.konserthuset.se/program-och-biljetter/kalender/ | konserthus | html | 100testcandidates |
| berwaldhallen | www.berwaldhallen.se | konserthus | jsonld (tixly-api) | 100testcandidates |
| kulturhuset | www.kulturhuset.se | kulturhus | network (ElasticSearch) | active |
| ticketmaster | www.ticketmaster.se | aggregator | api | active |
| eventbrite | www.eventbrite.se | aggregator | jsonld | active |

---

## Likely Sources → candidates/

Dessa behöver test men är potentiella:

| ID | URL | Typ | Anmärkning |
|----|-----|-----|------------|
| debaser | debaser.se | musik | no-jsonld, kan behöva render |
| gso | www.gso.se | konserthus | DNS ok? |
| malmolive | malmolive.se | konserthus | DNS ok? |
| operan | www.operan.se | opera | no-jsonld |
| dramaten | www.dramaten.se | teater | no-jsonld |
| fryshuset | fryshuset.se/kalendarium | arena | JS-rendered, pending D-renderGate |
| stockholm | (stad) | discovery | sourceRunner |
| berwaldhallen-tixly | (API) | konserthus | sourceRunner |

---

## Runtime Artifacts (NOT sources/)

Dessa får INTE blandas in i sources/:

| Fil | Innehåll | Status |
|-----|----------|--------|
| `runtime/sources_status.jsonl` | SourceStatus per källa | ✓ Rättad |
| `runtime/sources_priority_queue.jsonl` | Prioritetskör | Korrekt |
| `runtime/pending_render_queue.jsonl` | D-renderGate väntelista | Korrekt |
| `phase1-triage-batch-*.jsonl` | Körhistorik | Ignorera |
| `phase1-approved-batch-*.jsonl` | Körhistorik | Ignorera |

---

## Corrections Made

1. **runtime/sources_status.jsonl** — Rättat från source truth → korrekt status-format
2. **sources/** — Rensat och återskapat med endast verifierade källor
3. **sources/archive/** — Backup av äldre entries

---

## Schema Separation

### sources/ = Source Truth (One file per source)
```typescript
interface SourceTruth {
  id: string;
  url: string;
  name: string;
  type: string;
  city?: string;
  discoveredAt: string;
  discoveredBy: 'manual' | 'discovery' | 'venue_graph' | '100testcandidates' | 'active';
  preferredPath: 'jsonld' | 'html' | 'network' | 'render' | 'api' | 'unknown';
  lastSystemVersion?: string;
  metadata?: Record<string, unknown>;
}
```

### runtime/sources_status.jsonl = Runtime State (One line per source)
```typescript
interface SourceStatus {
  sourceId: string;
  status: 'never_run' | 'success' | 'partial' | 'fail' | 'pending_render_gate' | 'error';
  lastRun: string | null;
  lastSuccess: string | null;
  consecutiveFailures: number;
  lastEventsFound: number;
  lastError?: string;
  lastPathUsed?: 'jsonld' | 'html' | 'network' | 'render';
  attempts: number;
}
```

---

## Next Steps

1. ~~Rensa sources/~~ ✓
2. ~~Rätta runtime/sources_status.jsonl~~ ✓
3. Köra scheduler --rebuild för att synkronisera prioritetskön
4. Testa nya scheduler med verifierade källor
