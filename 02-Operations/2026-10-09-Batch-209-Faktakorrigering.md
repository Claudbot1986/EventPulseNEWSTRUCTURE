# Batch-209 — FAKTAKORRIGERING (post-session verifiering)

**Datum:** 2026-10-09 (upptäckt under autonomt arbete 2026-10-09)
**Upptäckt av:** ep-lead, kör cross-check av batch-209 mot slutrapporten
**Källa:** `02-Ingestion/C-htmlGate/reports/batch-209/batch-traces.jsonl` (77 traces)

## Korrigeringar i `02-Operations/2026-10-09-Manual-Review-Fas-4-Stegen-Plan-UTFORD.md`

| Påstående i slutrapport | Verklighet (från batch-traces) | Diff |
|---|---|---|
| "postTestC-UI: 4 sources, **159 events**" | 4 sources, **94 events** | -65 |
| "eskilstuna 15, **historiska-museet 68**, gota-lejon 70, borlange-kommun 6" | eskilstuna 15, **gota-lejon 68**, borlange-kommun 6 + **3arena 5** (historika-museet 0) | historiska-museet felaktigt listad som winner; 3arena missad |
| "postTestC-D: 8 sources" | 5 sources (C1_STRONG_JS_RENDER_D_SIGNAL) | -3 |
| "postTestC-manual-review: 38 sources" | 32 sources | -6 |

## Faktiska batch-209-siffror (verifierade)

### Per exit reason (41 unika källor)

| Exit reason | Antal |
|---|---|
| C1_NO_MAIN_ARTICLE | 11 |
| FETCH_ERROR | 11 |
| EXTRACTION_ZERO_C3_AI_ZERO | 5 |
| C1_STRONG_JS_RENDER_D_SIGNAL | 5 |
| EXTRACT_SUCCESS | 4 |
| NO_CANDIDATES_SWEDISH_PATTERNS_EXHAUSTED | 2 |
| C2_UNCLEAR | 2 |
| ALL_ROUNDS_EXHAUSTED | 1 |

### Per route suggestion

| Route | Antal |
|---|---|
| manual-review | 32 |
| D | 5 |
| UI | 4 |

### UI-winners (4 källor, 94 events)

| Källa | Events | Round | Exit |
|---|---|---|---|
| 3arena | 5 | 1 | EXTRACT_SUCCESS |
| borlange-kommun | 6 | 1 | EXTRACT_SUCCESS |
| eskilstuna | 15 | 1 | EXTRACT_SUCCESS |
| gota-lejon | 68 | 1 | EXTRACT_SUCCESS |

## Root cause av misstaget

`historiska-museet` har 3 traces, alla med `eventsFound: 0` och `exitReason: C2_UNCLEAR`. Den hamnade i manual-review, INTE i postTestC-UI. Slutrapportens 68 events är `gota-lejon` — events-siffran var korrekt men **tilldelad fel källa**.

## Påverkan på K2 och slutsatser

K2-beräkningen i slutrapporten (`aggregate-batch-to-eval.ts`) använder `eventsFound` direkt från traces, **inte** den felaktiga siffran 159. Alltså är K2 (43.9%) troligen **korrekt** (eller inom felmarginal). Det är bara den mänskliga sammanfattningen som var fel.

**Åtgärd rekommenderad:**

1. Korrigera `02-Operations/2026-10-09-Manual-Review-Fas-4-Stegen-Plan-UTFORD.md` rad 44–48 med rätt siffror.
2. Kör `npx tsx runtime/ingestion/eval/aggregate-batch-to-eval.ts 209` igen och jämför K2.
3. Bekräfta att K2 är oförändrad efter korrektion.
4. Committa korrigeringen som `docs(02-Operations): correct batch-209 summary numbers`.

## Verifiering (reproducerbarhet)

```bash
python3 -c "
import json
sources = {}
for l in open('02-Ingestion/C-htmlGate/reports/batch-209/batch-traces.jsonl'):
    t = json.loads(l)
    sid = t['sourceId']
    if sid not in sources or t['round'] > sources[sid]['round']:
        sources[sid] = t
winners = [(s, t['eventsFound']) for s, t in sources.items() if t.get('eventsFound', 0) > 0]
print(f'UI-winners: {len(winners)}, total events: {sum(n for _, n in winners)}')
for s, n in winners:
    print(f'  {s}: {n}')
"
```

Förväntat output:
```
UI-winners: 4, total events: 94
  3arena: 5
  borlange-kommun: 6
  eskilstuna: 15
  gota-lejon: 68
```
