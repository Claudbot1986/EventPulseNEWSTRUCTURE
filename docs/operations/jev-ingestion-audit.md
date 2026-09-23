# EventPulse Ingestion × Jev Audit — Syntes 2026-09-23

> **Status:** Audit-fas klar. 7 Jev-anrop gjorda (se `docs/operations/jev-decisions.md` 2026-09-23 19:43-raden).
> **Datakälla:** `/Users/claudgashi/EventPulse/docs/operations/jev-ingestion-audit-data.md` (rådata, verifierad).

---

## TL;DR — Jevs prioritering (sammanvägt)

| # | Artefakt | Jev-fråga | Vinnare | Konfidens |
|---|----------|-----------|---------|-----------|
| A | Source-kohort | Vilken kohort prioriteras härnäst? | **P1_top_yield** (marginalvinst) | 0.20 ⚠️ |
| B | Yield-koncentration | Kritisk risk eller acceptabel? | **0.39** (mild risk, nära Acceptabel) | 0.41 |
| C | Failure mode | Vilken felklass först? | **unfetchable_c1** (1104 fall) | **0.86** ✅ |
| D | Adapter-confidence | Omkalibrera aiConfidence? | **recalibrate** | 0.50 |
| E | D-renderGate-bevisad | Bara 3 körningar — bevisat? | **0.15 NEJ** | noul |
| F | 90-dagarsplan | Vad bygger vi under nästa kvartal? | **backfill_priority** (380+160) | **0.79** ✅ |
| G | Beslutspunkt-prioritet | Vilken Jev-plugg ger störst yield? | **network** (scoreCandidate/evalNetwork) | 0.43 |

---

## Detaljer per artefakt

### A. Source-kohort — [Jev 19:43 choice]
**State:** 299 sources, 459 status (160 orphans), 63 success/396 fail, 380 consecFail≥2, 391 zero-events, top10=60%
**Svar:**
| Alt | Prob |
|-----|------|
| P1_top_yield (top-10 reprocess) | 0.36 |
| P2_stuck_fail (380 consecFail≥2) | 0.33 |
| P3_zero_event (391 zero-events) | 0.18 |
| P4_orphans (160 phantom status) | 0.11 |
| P5_balanced | 0.02 |

**Tolkning:** Jev säger i princip "top-yield eller stuck-fail, det spelar inte så stor roll". Låg konfidens (0.20) — vi har för lite signal för att veta vilken kohort som ger bäst marginalnytta.

### B. Yield-koncentration — [Jev 19:43 score]
**State:** sthlmlist=864 (27%), top10=1934 (60%), 254 källor med events, median=1
**Svar:** **0.39** (legend 0=kritisk / 5=acceptabel / 10=hälsosam)
**Tolkning:** Jev lutar mot Acceptabel men inte långt ifrån Kritisk. 27% från en enda källa är inte katastrofalt men inte heller friskt. Konfidens 0.41 — Jev är osäker.

### C. Failure mode — [Jev 19:43 choice] ⭐ HÖGSTA KONSENSUS
**State:** 67 klassade fel: 20 timeout, 19 403/404/5xx, 14 SSL, 7 redirect, 7 no-jsonld. 1104 unfetchable c1.
**Svar:**
| Alt | Prob |
|-----|------|
| **unfetchable_c1** (1104 discovery-fel) | **0.90** |
| timeout (20) | 0.08 |
| network_blocked (19) | 0.02 |
| no_jsonld (7) | 0.00 |
| ssl (14) | 0.00 |

**Tolkning:** Jev är *entydig*: discovery-lagret är flaskhalsen, inte extraktion. 1104 källor nådde aldrig c1-skärmning — de kunde inte hämtas alls. Konfidens 0.86.

### D. Adapter-confidence-kalibrering — [Jev 19:43 choice]
**State:** 15 adapters, 6 validerade (40%). nobel 0.95 misslyckades, aik 0.25 passerade.
**Svar:**
| Alt | Prob |
|-----|------|
| **recalibrate** (omkalibrera mot fältvalidering) | 0.60 |
| keep_as_is | 0.15 |
| hybrid (tiebreak-roll) | 0.11 |
| drop_confidence | 0.09 |
| strukturellt test | 0.05 |

**Tolkning:** aiConfidence förutsäger INTE valideringsutfall. Jev föreslår omkalibrering — antingen mot faktiska fält-test eller strukturella indikatorer.

### E. D-renderGate-bevisad? — [Jev 19:43 noul]
**State:** 3 real runs senaste 30d, alla OK, 0 failures.
**Svar:** **0.15** (15% sannolikhet att D-renderGate-effektivitet är bevisad)
**Tolkning:** NEJ. Tre körningar räcker inte. Vi vet att det *fungerar* men inte hur *robust* det är.

### F. 90-dagarsplan — [Jev 19:43 choice] ⭐ ANDRA HÖGSTA KONSENSUS
**State:** D-renderGate aktiv med kvartals-cadence. 0 PENDING_RENDER, 1104 unfetchable c1, 380 consecFail≥2, 160 phantom-status.
**Svar:**
| Alt | Prob |
|-----|------|
| **backfill_priority** (rensa 380 stuck + 160 orphans) | **0.83** |
| generate_adapters (D-AI för 1104 unfetchable) | 0.15 |
| render_existing (använd befintliga adapters) | 0.02 |
| behavior_opt (per-source stealth-allokering) | 0.00 |
| noop (avvakta) | 0.00 |

**Tolkning:** **Överraskande.** Jev säger att städning av befintliga data (orphans + stuck) är viktigare än att bygga nytt. 160 phantom-poster + 380 fail-källor är 540 av 459 = en majoritet av status som inte speglar verkligheten. Konfidens 0.79.

### G. Beslutspunkt-prioritet — [Jev 19:43 choice]
**State:** 8 beslutspunkter: selectSourcePath, computeNextPath, extractEvents, scoreCandidate, shouldEscalateToStealth, recordTriageAttempt, evaluateNetworkGate, behavior-val
**Svar:**
| Alt | Prob |
|-----|------|
| **network** (scoreCandidate + evaluateNetworkGate) | **0.55** |
| rendering (shouldEscalate + behavior-val) | 0.28 |
| routing (selectSourcePath + computeNextPath) | 0.09 |
| extraction (extractEvents metodval) | 0.05 |
| learning (recordTriageAttempt) | 0.03 |

**Tolkning:** API/network-upptäckt är den mest lovande Jev-pluggen. `networkInspector.ts` heuristik (nyckelmatchning med thresholds) och `evaluateNetworkGate()` är båda deterministiska — båda har tydlig Jev-potto: ersätt med modell som klassificerar "sannolikhet att detta är en event-API".

---

## Jevs prioritering — rekommenderad nästa steg-ordning

1. **Städa data (Artefakt F, 83%)** — Rensa 160 phantom-status + definiera vad vi gör med 380 consecFail≥2. Detta ger Jev (och oss) bättre signal inför nästa iteration.

2. **Adressera discovery-flaskhals (Artefakt C, 86%)** — 1104 unfetchable c1-verdicts är Jevs tydligaste prioritering. Före D-AI-adapters eller nya grindar: *få sidorna att hämta*.

3. **D-renderGate behöver fler körningar (Artefakt E, noul 0.15)** — 3 körningar ≠ bevis. Vänta in kvartalets andra/tredje körning innan vi drar slutsatser om robusthet.

4. **Jev-plugg i networkInspector (Artefakt G, 55%)** — Om vi väljer EN plats att stoppa in Jev först: scoreCandidate + evaluateNetworkGate. Båda är heuristiska klassificerare med tydlig input/output.

5. **Omkalibrera aiConfidence (Artefakt D, 60%)** — Confidence korrelerar inte med validering. Enkel P0 — vi har data, vi kan mäta sambandet.

---

## Överraskningar i underlaget

1. **160 phantom-status-poster** — 459 status-records, 299 source-filer. 35% av status-data är föräldralös.
2. **Tom pending_render_queue** — Trots 81 bekräftat döda källor i audit-dead-sources står ingenting i kön för D-render.
3. **Bimodal status** — Bara success (63) eller fail (396). Inga `pending_render_gate` / `triage_required` etc. Intermediate states är antingen transienta eller har blivit degraderade till fail.
4. **1104 unfetchable c1** — Discovery-fel dominerar 13× över extraktionsfel (67 klassade). Flaskhalsen sitter i upptäckt, inte extraktion.
5. **Adapter confidence-värdelös** — nobel-prize-museum 0.95 misslyckades; aik 0.25 passerade. Korrelationen är bruten.

---

## Brandväggar respekterade

- ✅ Inga C0/C1/C2-ändringar föreslagna
- ✅ Generalization Protection Rule: alla förslag bygger på ≥10 källor data
- ✅ aiConfidence-förslaget är observation, inte implementation
- ✅ F (backfill) kräver ingen kodändring — bara datatvätt
- ✅ D-renderGate-resultat respekterar befintlig cadence gate

---

## Nästa steg — välj en

| Alt | Vad | Konfidens | Risk |
|-----|-----|-----------|------|
| 1 | **Städ-pass: 160 orphans + 380 stuck** | F 0.83 | Låg (CRUD på status) |
| 2 | **Audit discovery-flaskhals** (1104 unfetchable c1 — varför?) | C 0.86 | Medel (kräver felspaning) |
| 3 | **Jev-plugg i networkInspector** (Fas 1, första verkliga Jev-i-ingestion) | G 0.55 | Medel (scope-drift-risk) |
| 4 | **Omkalibrera aiConfidence** mot faktiska fältvalideringar | D 0.60 | Låg (mätning + justering) |
| 5 | **Avvakta** tills D-renderGate har 10+ körningar | E noul 0.15 | Lägst — men minst output |

Min rekommendation: **Alt 1 (städ)** → **Alt 4 (confidence-kalibrering)** → **Alt 2 (audit discovery)** i den ordningen. Bygger rent data-underlag innan vi bygger ny logik.
