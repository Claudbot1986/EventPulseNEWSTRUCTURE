---
name: 123
description: Loop-ED workflow for EventPulse C-testRig
tags: []
related_skills: []
---

# 123 — Loop-ED Arbetsflöde

## ⚠️ PROJEKTSPECIFIK LOGIK

**Projektets 123-logik finns i:**
```
02-Ingestion/C-htmlGate/123.md
```

---

## Läs alltid denna fil först innan du kör 123.

**Regler:**
- Läs alltid `02-Ingestion/C-htmlGate/123.md` först
- Om instruktioner skiljer sig åt gäller alltid `02-Ingestion/C-htmlGate/123.md`
- Fortsätt enligt `123.md`:s instruktioner
- Använd aldrig äldre logik från denna SKILL.md
- `123.md` är den enda sanningskällan för detta projekt

---

## För att köra 123:

1. Läs `02-Ingestion/C-htmlGate/123.md` (den auktoritativa logiken)
2. Följ instruktionerna i den filen
3. Använd aldrig denna SKILL.md för att avgöra vad som ska göras

---

## Training Memory System (NYTT sedan 2026-04-15)

123 genererar kompletta training logs i `02-Ingestion/C-htmlGate/testResults/`:

```
testResults/
├── batches/              # Batch-level rapporter
│   └── batch-{id}/
│       ├── batch-report.json
│       ├── feature-vector.json
│       └── training-export.json
│
├── sources/              # Per-source komplett loggning
│   └── {sourceId}/
│       ├── source-record.json
│       ├── events.jsonl
│       └── training-record.json
│
├── memory-bank/          # Global memory
│   ├── batch-index.jsonl
│   ├── source-index.jsonl
│   ├── decisions.jsonl
│   └── decisions/
│
├── ground-truth/         # Ground truth events
├── improvement-candidates/
│   └── attempts.jsonl
├── verification-results/
├── regression-results/
└── training-exports/     # ML-ready training data
    ├── training-records.jsonl
    ├── source-records.jsonl
    ├── c1-discovery-training.json
    ├── c2-screening-training.json
    ├── c3-extraction-training.json
    └── improvement-attribution-training.json
```

### Nyckelfiler

| Fil | Syfte |
|-----|-------|
| `testResults/batch-logger.ts` | BatchLogger — batch-level training features |
| `testResults/source-logger.ts` | SourceLogger — per-source training features |
| `testResults/improvement-gate.ts` | ImprovementGate — 3-iteration gate logic |
| `testResults/training-exporter.ts` | TrainingExporter — ML-ready export |
| `123-autonomous-loop.ts` | Autonomous loop med training logging |

### Iterativ Loop (UPP TILL 3 ITERATIONER)

Förbättringsloopen (Steg 6) kör upp till 3 iterationer per source:

```
ITERATION 1:
→ Gate väljer candidate
→ Verification Batch
→ Regression Batch
→ Gate: keep / refine / rollback
    ↓ (refine)
ITERATION 2:
→ Förfina regeln
→ Verification + Regression
→ Gate: keep / refine / rollback
    ↓ (refine)
ITERATION 3 (final):
→ Gate: keep / rollback
```

### IMPROVEMENT-TYPER (ALLA)

- **IMP-C0:** link_discovery, anchor_analysis, url_token_scoring, nav_classification, candidate_ranking
- **IMP-C1:** js_render_detection, signal_extraction, category_detection, canonical_verification
- **IMP-C2:** scoring_weights, threshold_tuning, pattern_recognition, signal_combination
- **IMP-C3:** selector_addition, date_format_support, time_extraction, venue_extraction, price_extraction
- **IMP-SELECTOR:** new_selector, selector_composition, nested_selector
- **IMP-PATTERN:** date_pattern, time_pattern, venue_pattern, price_pattern
- **IMP-ROUTING:** route_to_A/B/D/manual
- **IMP-STRUCTURAL:** subpage_discovery, depth_limiting, duplicate_handling

### Output Contract (123.md)

Efter varje loop:

```
## Aktiv kontext
## 123-Learning-Memory Status
## Training Memory Status
## Rules Gap Check
## Root-cause
## Ändringar
## Verifiering
## Iterativ Loop Resultat
## Kvarvarande flaskhals
## Tre möjliga nästa steg
## Rekommenderat nästa steg
## Två steg att inte göra nu
## Handoff
## Commit
__KLAR_MED_1_2_3_PROMPTEN__
```