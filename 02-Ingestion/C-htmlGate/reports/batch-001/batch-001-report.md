# C-htmlGate Batch 001 Rapport

**Batch-ID:** batch-001  
**Datum:** 2026-04-05  
**Status:** pending (körs ej aktivt, reparationsfas)

## Metadata

| Fält | Värde |
|------|-------|
| Vald at | 2026-04-05T20:25:00.000Z |
| Eligibility-regler version | 1.0 |
| Urvalsgrund | C-htmlGate batch-eligible filter (html_candidate + fail/triage_required + no D-renderGate + no A/B-verified path) |
| subpageAwareAbStatus | missing |

**OBS:** subpage-aware A/B-bedömning är **INTE gjord** för dessa sources. De valdes baserat på status-filter i sources_status.jsonl, inte efter förprövning av subpages. Detta betyder att batchens källor är "batch-eligible enligt filter" men INTE nödvändigtvis "subpage-verifyade C-kandidater".

## Översikt

| Metric | Värde |
|--------|-------|
| Sources i batch | 10 |
| Före-events (totalt) | 0 |
| Efter-events (totalt) | Ej körd ännu |
| AI-analys genförbättring | Pågår |

## Validering av batch-urval

**Grund för C-kandidatklassning (enligt nuvarande filter):**
- `triageResult = "html_candidate"` — C1 identifierade HTML-eventstruktur
- `status ∈ {"fail", "triage_required"}` — HTML-path testad men ej bekräftad
- `pendingNextTool = "html_extraction_review"` — väntar på förbättrad C-modell
- `lastEventsFound = 0` — extrahering gav 0 events

**Exkluderade från C-batch (bekräftat):**
- `status = "success"` → A/B-verifierade (22 st): konserthuset, berwaldhallen, abf, aik, etc.
- `preferredPath = "network"` → B-verifierade: berwaldhallen (216 events), kulturhuset
- `pendingNextTool = "D-renderGate"` → D-pending: debaser, cirkus, arkdes, akersberga, etc.
- `triageResult = "manual_review"` → manuell granskning: ~150 st
- `status = "pending_api"` → API-källa: ticketmaster, eventbrite

**Viktigt att notera:** Dessa sources är batch-eligible enligt filter men har EJ genomgått subpage-aware A/B-förprövning. Framtida körning kan behöva justera urvalet efter förprövning.

## Sources i batch 001

| # | Källa | Status | Försök | C1-signaler | Eligibility |
|---|-------|--------|--------|-------------|-------------|
| 1 | hallsberg | triage_required | 5 | 6tt + 6d | batch-eligible |
| 2 | ifk-uppsala | triage_required | 4 | 6tt + 2d + 7h | batch-eligible |
| 3 | karlskoga | triage_required | 5 | 3tt + 10h | batch-eligible |
| 4 | kumla | triage_required | 4 | 4tt + 4d | batch-eligible |
| 5 | kungliga-musikhogskolan | triage_required | 3 | 5tt + 5d | batch-eligible |
| 6 | liljevalchs-konsthall | fail | 2 | 3tt + 6d | batch-eligible |
| 7 | lulea-tekniska-universitet | triage_required | 3 | 11tt + 6d | batch-eligible |
| 8 | moderna-museet | fail | 2 | 8tt + 12h | batch-eligible |
| 9 | naturhistoriska-riksmuseet | triage_required | 3 | 15tt + 4d | batch-eligible |
| 10 | orebro-sk | triage_required | 3 | 10tt + 11h | batch-eligible |

## Rapporthistorik

Denna batch ersätter det tidigare grova batchvalet med rätt C-kandidatklassning.
Källrapporter sparas i: `02-Ingestion/C-htmlGate/reports/batch-001/sources/`

## Nästa steg

- [ ] subpage-aware A/B-förprövning innan körning (ej obligatoriskt men rekommenderat)
- [ ] Förbered för körning när 123 anropas nästa gång
- [ ] Uppdatera batch-state.jsonl efter bekräftelse