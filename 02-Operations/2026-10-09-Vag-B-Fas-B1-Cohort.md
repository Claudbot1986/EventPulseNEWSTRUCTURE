# Väg B Fas B.1 — Cohort-analys C0 winner-density

**Datum:** 2026-10-09
**Datakälla:** `02-Ingestion/C-htmlGate/reports/batch-209/batch-traces.jsonl` (senaste batchen, 41 unika källor)
**Mätverktyg:** `runtime/ingestion/eval/site-discovery-fas1/measure-c0-density-cohort.ts`

## Resultat (rå output nedan)

```
Analyserar batch-209 (senaste batchen) — 199 batchar totalt

Totalt antal källor:    41
Total c0Candidates:     188
Snitt c0Candidates:     4.59

─── c0Candidates-fördelning ───
  0        →  18 (43.9%)
  1        →   5 (12.2%)
  11-30    →   8 (19.5%)
  2-3      →   3 (7.3%)
  4-10     →   7 (17.1%)

─── c0RuleSource-fördelning ───
  sitemap              →  13 (31.7%)
  none                 →  13 (31.7%)
  link-discovery       →  10 (24.4%)
  swedish-patterns     →   5 (12.2%)

─── Winner eventDensity-fördelning ───
  0        →  13 (31.7%)
  1-10     →   4 (9.8%)
  11-50    →   7 (17.1%)
  201+     →  14 (34.1%)
  51-200   →   3 (7.3%)

─── Noll-density med c0Candidates > 0 ───
  Antal: 0

─── Multi-candidate sources (c0Candidates >= 2) ───
  Antal: 18 (43.9%)
  → events hittade: 2/18 (11.1%)

═══ Slutsatser ═══
✓ Teoretisk påverkan ≥ 5% (multi=43.9%, zeroDensity=0.0%)
  → Fas B.2 mini-batch REKOMMENDERAS
```

## Tolkning

| Metric | Värde | Betydelse |
|---|---|---|
| **18/41 multi-candidate** | 43.9% | Steg 4 kan påverka nästan hälften av källorna |
| **13/41 noll-density winners** | 31.7% | Inlänk-räkning är ENDA tiebreaker för dessa |
| **2/18 multi hittade events** | 11.1% | Multi-candidate-sources har låg pass-rate (pga C1_NO_MAIN_ARTICLE, D-render) |

**Beslut:** Fas B.2 mini-batch är motiverad. 43.9% teoretisk påverkan överstiger 5%-gränsen.

## Begränsningar i denna analys

- Endast batch-209 analyserad. Historiska batchar har inte samma c0-fält (troligen).
- Vi vet inte hur många av de 18 multi-candidate-sources som har TVÅ kandidater med SAMMA densityScore — det är det specifika villkoret för Steg 4-effekt.
- 0 noll-density-med-candidates är missvisande — täthetsmåttet är `eventDensityScore` (tröskelvärde?), inte 0-1. Tolkningen behöver verifieras.

## Nästa steg

Kör Fas B.2: 10-15 källor med multi-candidate, jämför Steg 4 på/av.

