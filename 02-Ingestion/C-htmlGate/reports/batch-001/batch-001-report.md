# C-htmlGate Batch 001 Rapport

**Batch-ID:** batch-001  
**Datum:** 2026-04-05  
**Status:** pending (körs ej aktivt, reparationsfas)

## Översikt

| Metric | Värde |
|--------|-------|
| Sources i batch | 10 |
| Före-events (totalt) | 0 |
| Efter-events (totalt) | Ej körd ännu |
| AI-analys genförbättring | Pågår |

## Validering av batch-urval

**Grund för C-kandidatklassning:**
- `triageResult = "html_candidate"` — C1 identifierade HTML-eventstruktur
- `status ∈ {"fail", "triage_required"}` — HTML-path testad men ej bekräftad
- `pendingNextTool = "html_extraction_review"` — väntar på förbättrad C-modell
- `lastEventsFound = 0` — extrahering gav 0 events (modellen behöver förbättras)

**Exkluderade från C-batch (bekräftat):**
- `status = "success"` → A/B-verifierade (22 st): konserthuset, berwaldhallen, abf, aik, etc.
- `preferredPath = "network"` → B-verifierade: berwaldhallen (216 events), kulturhuset
- `pendingNextTool = "D-renderGate"` → D-pending: debaser, cirkus, arkdes, akersberga, etc.
- `triageResult = "manual_review"` → manuell granskning: ~150 st
- `status = "pending_api"` → API-källa: ticketmaster, eventbrite

## Sources i batch 001

| # | Källa | Status | Försök | C1-signaler | Varför C-kandidat |
|---|-------|--------|--------|-------------|-------------------|
| 1 | hallsberg | triage_required | 5 | 6tt + 6d | Kommun, html_candidate, väntar C-modell-förbättring |
| 2 | ifk-uppsala | triage_required | 4 | 6tt + 2d + 7h | Fotbollsklubb, html_candidate, extraction=0 |
| 3 | karlskoga | triage_required | 5 | 3tt + 10h | Kommun, html_candidate, extraction=0 |
| 4 | kumla | triage_required | 4 | 4tt + 4d | Kommun, html_candidate, extraction=0 |
| 5 | kungliga-musikhogskolan | triage_required | 3 | 5tt + 5d | Musiklärosäte, html_candidate, extraction=0 |
| 6 | liljevalchs-konsthall | fail | 2 | 3tt + 6d | Konsthall, html_candidate, extraction=0 |
| 7 | lulea-tekniska-universitet | triage_required | 3 | 11tt + 6d | Universitet, html_candidate, extraction=0 |
| 8 | moderna-museet | fail | 2 | 8tt + 12h | Museum, html_candidate, extraction=0 |
| 9 | naturhistoriska-riksmuseet | triage_required | 3 | 15tt + 4d | Museum, html_candidate, extraction=0 |
| 10 | orebro-sk | triage_required | 3 | 10tt + 11h | Fotbollsklubb, html_candidate, extraction=0 |

## Rapporthistorik

Denna batch ersätter det tidigare grova batchvalet med rätt C-kandidatklassning.
Källrapporter sparas i: `02-Ingestion/C-htmlGate/reports/batch-001/sources/`

## Nästa steg

- [ ] Verifiera att batch 001:s 10 källor alla är sanna C-kandidater
- [ ] Förbered för körning när 123 anropas nästa gång
- [ ] Uppdatera batch-state.jsonl efter bekräftelse