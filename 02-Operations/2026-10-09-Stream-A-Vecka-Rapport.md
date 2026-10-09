# Stream A — Veckorapport W41 / 2026-10-09

**Stream:** A (Ingestion kvalitetsloop, Pstack-stil / Lauren Tan-plan 2026-10-09)
**Vecka:** W41 (2026-10-09)
**Scope:** C-testRigg inom `02-Ingestion/C-htmlGate/`. A→B-markeringar refererar endast legacy (utfört av tidigare session utanför C-testRigg-scope).
**Auktoritet:** [VERIFIED] L2 working note — alla siffror reproducerbara via `npx tsx runtime/ingestion/eval/run-eval-c3.ts`.

## K2 — sammanfattning

| Gate | K1 (conversion) | K2 (quality) | N | Wilson 95% CI | Källa |
|---|---|---|---|---|---|
| A→B (legacy) | — | **69.6%** | 46 | 55–81% | `_ground-truth/A-to-B.jsonl` |
| **C→F (C-testRigg)** | 35.6% (187/526) | **27.9%** | 187 | 22–34% | `C-to-F/2026-10-09.jsonl` + `_ground-truth/C-to-F.jsonl` v2 |
| C→F Stockholm-only | — | 55.0% | 20 | 34–74% | samma |

**K2(C→F) = 27.9%** är baseline. Betyder: av 201 källor som nådde C3 (inom C-testRigg-scope), extraherade 56 minst en event. 145 missade trots att C2 sa "lovande" eller bättre.

## Per-C2-verdict (inom C3-scope)

| C2 verdict | Pass / Total | K2 | Wilson 95% CI | Lärdom |
|---|---|---|---|---|
| promising | 71/92 | 77.2% | 68–85% | Stark signal — C3 levererar |
| low_value | 4/46 | 8.7% | 3–20% | Korrekt avrådd |
| unclear | 10/39 | 25.6% | 15–41% | Svag signal — förbättringsutrymme |
| maybe | 4/10 | 40.0% | 17–69% | Litet N — osäkert |

## Hillclimb-rapporter denna vecka

1. **Hillclimb #1 (C2 reject-regel):** REVERT. Skulle ge -0.3% K2 + 4 false-negatives (varav `lokalhelhet-calendar` 224 events). För liten effekt, för hög kostnad. → `Hillclimb-2026-10-09-C-to-F-C2-RejectRule.md`
2. **Hillclimb #2 (EXTRACTION_ZERO):** KEEP som analys, ingen regel. 14/23 hade time/date-signaler → INTE signalfråga, troligen C3-extraktionslucka. → `Hillclimb-2026-10-09-C-to-F-ExtractionZeroPattern.md`
3. **Hillclimb #3 (URL-patterns):** Kandidater identifierade: `/sv`, `/en`, `/festivals`, `/calendar`, `/aktuellt`. Kräver 3+ sajtsverifiering. → `Hillclimb-2026-10-09-C-to-F-UrlPatterns.md`

## A.4 — IngestState migration

- **Typ finns:** `02-Ingestion/ingestState.ts` (152 rader) — diskriminerad union + Zod-schema + `transition()` + `assertNever`.
- **Tester:** `02-Ingestion/ingestState.test.ts` — **12/12 PASS** (alla giltiga + ogiltiga moves + assertNever exhaustiveness).
- **Migrations-guide:** `02-Ingestion/ingestState-MIGRATION.md`.
- **Migration av 123-system.ts:** EJ utförd — för stor (1215 rader) för en W41-session. Rekommenderas i separat framtida session.

## Nya artefakter (alla under `runtime/ingestion/eval/`, gitignored)

| Fil | Roll |
|---|---|
| `C-to-F/2026-10-09.jsonl` | 526 dedupade eval-rader aggregerade från batch-traces |
| `_ground-truth/C-to-F.jsonl` (v2) | 20 Stockholm-samples manuellt klassificerade |
| `_metrics-c-to-f.md` | K2-definition + scope-regler + Wilson CI |
| `run-eval-c3.ts` | K2-uträknare (Wilson CI per C2-verdict + Stockholm-filter) |
| `run-eval-c3.test.ts` | 9 vitest-tester (alla PASS) |
| `vitest.config.ts` | Lokal vitest-konfig för runtime/-tester |
| `Hillclimb-2026-10-09-C-to-F-C2-RejectRule.md` | Hillclimb #1 (REVERT) |
| `Hillclimb-2026-10-09-C-to-F-ExtractionZeroPattern.md` | Hillclimb #2 (analys) |
| `Hillclimb-2026-10-09-C-to-F-UrlPatterns.md` | Hillclimb #3 (kandidater) |
| `_summary.md` (uppdaterad) | Per-gate status-tabell + K2-baseline-sektion |

## Verifiering

```bash
# Kör K2-eval:
npx tsx runtime/ingestion/eval/run-eval-c3.ts
# Förväntat: K2=27.9%, Stockholm=55.0%

# Kör tester:
cd runtime/ingestion/eval && npx vitest run --config ./vitest.config.ts
# Förväntat: 9/9 PASS

npx vitest run 02-Ingestion/ingestState.test.ts
# Förväntat: 12/12 PASS
```

## Nästa vecka (W42) — rekommenderade steg

1. **Skala C→F ground truth 20 → 50** (Wilson CI krymper ±25% → ±8%).
2. **A.3 #4:** Verifiera URL-pattern-kandidater (`/sv/events`, `/festivals`, `/calendar`) på 3+ NO_CANDIDATES-sajter. Om verifierat → testa implementation. Om +3% K2 → committa.
3. **A.3 #5:** Undersök 3 EXTRACTION_ZERO-sajters råa HTML (kräver mänsklig läsning eller AI-assisterad diff) → identifiera C3-extraktionslucka.
4. **A.4 migration:** Migrera `02-Ingestion/C-htmlGate/123-system.ts:72` till IngestState. Stor PR, separat session.

## Risk / oklarheter

- **K2-siffran 27.9% är lägre än jag initialt rapporterade (47.6%).** Felet var scope-definition: 47.6% exkluderade C1_JS_RENDER men inkluderade andra early-fails. Korrekt: räkna alla källor som faktiskt startade C3, exkludera bara infra + routed-to-D.
- **Hillclimb #3 implementation blockerar** på mänsklig HTML-granskning (3+ sajter) — kan inte automatiseras i A.0-C-sessionen.
- **Bredare data (526 källor) är gammal** — senaste batch-traces är 2026-04. Stockholm-coverage-plan (2026-10-04) har nyare siffror vi inte har strukturerad tillgång till.

## På människospråk

Vi mätte: av alla källor som faktiskt kommit fram till vår regelbaserade HTML-extraktion har 28 av 100 hittat events. Resten missar. Vi provade en regel för att skärpa kraven — den gav ingen vinst. Vi tittade på varför 23 källor lovar events men inte levererar — och såg att det INTE är en signalfråga, vår extraktor har en lucka. Vi hittade 4 URL-mönster vi borde testa (svenska `/sv/events`-variant, `/festivals` osv). Vi byggde ett typ-system som gör det omöjligt att råka konstruera ett ogiltigt ingestion-tillstånd. Allt är dokumenterat, mätbart, och redo att förbättras ifrån.
