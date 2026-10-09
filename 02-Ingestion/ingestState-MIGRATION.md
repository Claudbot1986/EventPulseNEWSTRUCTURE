# IngestState — Migrations-guide (Stream A.4)

**Datum:** 2026-10-09
**Stream:** A.4 (Pstack-stil, lager-1-arkitektur)
**Status:** [VERIFIED] Typ + tester finns. Migration av gates är ett separat steg.

## Vad som finns

- **Typ:** `02-Ingestion/ingestState.ts` — diskriminerad union `IngestState` med 4 varianter (raw | validated | failed | archived), alla bär sina egna obligatoriska fält.
- **Zod-schema:** `IngestStateSchema` (validerar runtime-input).
- **Transition-funktion:** `transition(prev, next)` — ENDA godkända vägen att byta state. Kastar `InvalidStateTransitionError` vid ogiltig move.
- **Exhaustiveness helper:** `assertNever(x)` — `switch (s.kind) { ... default: return assertNever(s); }` → kompilerar-fel om ny state-variant inte hanteras.
- **Tester:** `02-Ingestion/ingestState.test.ts` — 12/12 PASS, täcker alla tillåtna + alla förbjudna moves.

## Vad det löser

Tidigare: `status: 'pending_render_gate'` / `'triage_required'` / etc. som lösa strängar. Möjligt att konstruera ogiltiga states. CI kunde inte fånga.

Nu: ogiltiga states är **orepresenterbara** i typerna. `transition()` kastar runtime-error om man försöker. `assertNever` fångar missed cases vid kompilering.

## Migrations-guide för C-testRigg-gates

**Steg 1: identifiera state-platser**

För varje gate-fil, sök efter:
- `status: '...'` (lös sträng)
- `state: '...'` (lös sträng)
- `phase: '...'` (lös sträng)
- `if (status === 'X')` (implicit string-jämförelse)

Exempel: `02-Ingestion/C-htmlGate/123-system.ts:72` har `status: string;` (TODO: migrera).

**Steg 2: byt typ**

```typescript
// FÖRE
type SourceRecord = { sourceId: string; status: string; eventsFound: number };

// EFTER
import type { IngestState } from './ingestState';
type SourceRecord = { sourceId: string; state: IngestState; eventsFound: number };
```

**Steg 3: byt state-ändring**

```typescript
// FÖRE
record.status = 'failed';

// EFTER
import { transition } from './ingestState';
record.state = transition(record.state, {
  kind: 'failed',
  sourceId: record.sourceId,
  failedAt: new Date().toISOString(),
  reason: 'parse_error',
});
```

**Steg 4: använd assertNever i switch**

```typescript
// FÖRE
function describe(s: SourceRecord) {
  switch (s.status) {
    case 'pending': return 'incoming';
    case 'success': return 'ok';
    // glömt 'failed' → runtime-bug
  }
}

// EFTER
function describe(s: IngestState) {
  switch (s.kind) {
    case 'raw': return 'incoming';
    case 'validated': return 'ok';
    case 'failed': return 'rejected';
    case 'archived': return 'purged';
    default: return assertNever(s); // TS-fel om ny kind läggs utan case
  }
}
```

**Steg 5: kör tester + verifiera K2-baseline**

- `npx vitest run 02-Ingestion/ingestState.test.ts` → 12/12 PASS
- `npx tsx runtime/ingestion/eval/run-eval-c3.ts` → K2=27.9% oförändrat

## Gates som bör migreras (i prioritetsordning)

| Fil | status: string? | Prioritet | Anledning |
|---|---|---|---|
| `02-Ingestion/C-htmlGate/123-system.ts` | rad 72 | Hög | Huvudloop i C-testRigg — påverkar eval-rad |
| `02-Ingestion/C-htmlGate/batch-logger.ts` | troligen | Medel | Logger skriver state — schema bör vara stark |
| `02-Ingestion/C-htmlGate/source-logger.ts` | troligen | Medel | |
| `02-Ingestion/A-directAPI-networkGate/` | ? | Låg | UTANFÖR C-testRigg-scope — separat scope-beslut |
| `02-Ingestion/B-JSON-feedGate/` | ? | Låg | UTANFÖR C-testRigg-scope |

## Scope-skydd

Migration av 123-system.ts är **inom C-testRigg-scope** (får göras), men kräver:
1. Migration av alla 1215 rader (stor PR, utanför A.4-delegat).
2. Test-coverage av alla state-ändringar.
3. Verifiering att K2-baseline (27.9%) är oförändrad efter migration.

Rekommendation: **inte i A.4-sessionen** — för stor. Kör A.4 som "typ finns + tester gröna" (KLART), migrera 123-system.ts i en separat framtida session.

## Anti-mönster

- ❌ Migrera bara state-typ utan att använda `transition()` → transition-regler gäller inte.
- ❌ Lägg till ny state-kind utan att uppdatera `assertNever`-cases → tyst miss.
- ❌ Migrera A/B-gate-filer utan scope-beslut → utanför C-testRigg.
- ❌ Skippa tester — utan dem vet vi inte om migrationen bröt något.
