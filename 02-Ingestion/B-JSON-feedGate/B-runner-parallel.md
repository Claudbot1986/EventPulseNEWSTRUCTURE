# B-Runner PARALLEL — Dokumentation

## Översikt

`runB-parallel.ts` är den nya högpresterande B-spårs-exekutorn som ersätter sekventiell exekvering med parallell, batchad I/O.

## Förbättringar över `runB.ts`

| Egenskap | runB.ts (gammal) | runB-parallel.ts (ny) |
|----------|-----------------|----------------------|
| Exekvering | Sekventiell (`for + await`) | Parallell (`Promise.all` pool) |
| Default limit | 10 | **100** |
| Default workers | N/A (sekventiell) | **20** |
| Queue-I/O per source | 2-3 filoperationer | **1 filskrivning totalt** |
| preB läsning | Per source | **En gång vid start** |
| postB-preC skrivning | Per source | **Batchad** |
| sources_status skrivning | Per source | **Batchad** |

## Root Cause Fixes

### 1. Parallellisering
**Problem:** `for (const entry of batch) { await runBOnSource(entry) }` — varje source väntade på föregående.

**Lösning:**
```typescript
async function runParallel<BEntry, BOut>(
  items: BEntry[],
  worker: (item: BEntry) => Promise<BOut>,
  concurrency: number
): Promise<BOut[]>
```
Med 20 workers och 100 sources → ~5x snabbare理论.

### 2. Högre default limit
**Problem:** `limit=10` för litet för 424+ sources.

**Lösning:** `limit=100` — 10x mer per körning.

### 3. Batch-I/O
**Problem:** Varje source triggade:
- `readPreBQueue()` → fullständig filläsning
- `removeFromPreBQueue()` → fullständig filläsning + skrivning
- `addToPostBPreCQueue()` → fullständig filläsning + skrivning
- `addToPreUIQueue()` → fullständig filläsning + skrivning
- `updateSourceStatus()` → fullständig filläsning + skrivning

**Lösning:** Läs alla köer EN gång vid start, bygg in-memory state, skriv EN gång vid slut.

### 4. postB-preC konsumtion
**Problem:** `postB-preC` ackumulerades men C-poolen tog bara 10 per refill.

**Lösning:** `finalizeSourceBatch()` skriver ALLA icke-B sources till `postB-preC` i en operation. nästa C-pool refill kommer ta upp till 10 från den.

## Användning

```bash
# Normal körning (100 sources, 20 workers)
npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts

# Med explicita parametrar
npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --limit 50 --workers 10

# Dry run
npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --dry --limit 20

# Status
npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --status

# Hjälp
npx tsx 02-Ingestion/B-JSON-feedGate/runB-parallel.ts --help
```

## Prestandamätning

| Metric | runB.ts | runB-parallel.ts |
|--------|---------|------------------|
| Sources/sek (teoretisk) | ~0.2-0.5 | ~2-5 (10x) |
| File I/O (100 sources) | ~400-500 operationer | ~5 operationer |
| Tid för 100 sources | ~200-300s | ~20-50s |

## Flödesdiagram

```
preB-queue (424 entries)
    │
    ▼ read ONCE at startup
batch (100 sources)
    │
    ▼ runParallel(concurrency=20)
[Worker 1] ──→ source-1 ──→ runBOnSource()
[Worker 2] ──→ source-2 ──→ runBOnSource()
...
[Worker N] ──→ source-N ──→ runBOnSource()
    │
    ▼ all complete
finalizeSourceBatch() ──→ in-memory routing
    │
    ├──→ write preB-queue (remaining 324)
    ├──→ write postB-queue (+2)
    ├──→ write postB-preC (+3)
    └──→ write sources_status (all updated)
```

## Queue-ökningar (exempel)

Före:
```
preB-queue:    424
postB-queue:   0
postB-preC:    0
```

Efter (5 sources körda):
```
preB-queue:    419 (unprocessed)
postB-queue:   2  (+2 B-success)
postB-preC:    3  (+3 ej-B)
```

## Skillnader i routing-logik

Båda har identisk routing-logik:
- `success=true + events>0` → `postB`
- `!success + nextPath=network + inspectorVerdict=promising` → `postB`
- `!success + !(nextPath=network + promising)` → `postB-preC`

## Köad konsumtion i kedjan

1. **B-spår producerar** → `postB-preC`
2. **C-spår (run-dynamic-pool.ts) konsumerar** → `buildInitialPool()` och `refillPool()` läser `postB-preC-queue.jsonl`
3. Varje C-pool refill tar upp till **10 sources** från `postB-preC`
4. De tas bort från `postB-preC` (drain) så samma source inte körs igen

## Filer

- `runB-parallel.ts` — Ny högpresterande runner
- `runB.ts` — Original, uppdaterad limit till 100 (behåller sekventiell logik för kompatibilitet)
- `runB-parallel.test.ts` — Enhetstester (15 tester, alla passerar)
