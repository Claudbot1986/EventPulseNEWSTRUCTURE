# C-TestRig och Canonical C-Pipeline — Målmodell

**Document Type: NEW CANONICAL MODEL (TARGET SEMANTICS)**
**Status: PLANERAD — Ej fullt implementerad i kod**

> **DETTA ÄR DEN CANONICAL MÅLMODELLEN.** Beskriver det önskade slutläget.
> Verklig kod matchar inte denna namngivning ännu.
> För faktisk implementation-status, se [C-status-matrix.md](./C-status-matrix.md).
> För rebuild-steg, se [C-rebuild-plan.md](./C-rebuild-plan.md).

---

## ⚠️ DO NOT CONFUSE: Current vs Canonical

**Detta dokument beskriver canonical MÅLMODELL. Den verkliga koden matchar inte denna namngivning ännu.**

| Nuvarande Implementation (current code) | Canonical Målmodell (this doc) | VARNING |
|---------------------------------------|-------------------------------|---------|
| `C0-htmlFrontierDiscovery/` | **C1** (Discovery/Frontier) | C0 gör discovery men heter inte C1 |
| `C1-preHtmlGate/` | **C2** (Grov HTML-screening) | C1 gör screening men heter C1 (vilseledande!) |
| `C2-htmlGate/` | **C2** (Grov HTML-screening) | ✓ Match |
| `extractFromHtml()` | **C3** (HTML-extraktion) | ✓ Match |
| `C3-aiExtractGate.ts` | **C4-AI** (AI-fallback) | ✓ Match |

**KRITISKT ATT FÖRSTÅ:**
- Nuvarande `C1-preHtmlGate/` heter "C1" men gör **screening**, inte discovery
- Canonical `C1` = Discovery/Frontier
- Canonical `C2` = Grov HTML-screening + routing-signal
- **Därför: Nuvarande C1 ≈ Canonical C2**, inte Canonical C1
- Den verkliga discovery-funktionen finns i nuvarande C0, inte C1

**Enkelt att komma ihåg:**
```
Nuvarande C0 = Canonical C1  (discovery/frontier)
Nuvarande C1 = Canonical C2  (screening)  ← NAMNET ÄR VILSELEDANDE!
extractFromHtml() = Canonical C3 (HTML-extraktion)
C3-aiExtractGate = Canonical C4-AI (AI-fallback)
```

---

## CANONICAL TARGET SEMANTICS — C-PIPELINE

> **DETTA ÄR DEN STYRANDE MÅLBILDEN FRÅN OCH MED NU.**
> Verklig kod följer ännu inte nödvändigtvis denna semantik fullt ut.
> Dokumentationen ska reflektera målmodellen, inte nuvarande implementation.

### Canonical C-Pipeline Definitions

| Stage | Name | Role |
|-------|------|------|
| **C1** | Discovery / Frontier | Hitta och prioritera candidate pages. Samla interna links, mät page density, välj bästa kandidat. |
| **C2** | Grov HTML-screening + routing-signal | Screena HTML-struktur, detektera A/B/D-mönster, ge routing-signaler till testköer A, B eller D. Kanroutea vidare till postTestC-A, postTestC-B, postTestC-D. |
| **C3** | HTML-extraktion | Extrahera events från HTML med regelbaserad logik (icke-AI). Är första platsen där verklig HTML-extraktion sker i målmodellen. |
| **C4-AI** | Separat AI-analys och/eller AI-fallback | Kör endast EFTER C1→C2→C3 har körts, och ENBART på fail-fallen. Används för att analysera mönster över fail-fall och föreslå generella förbättringar. **Lätt att koppla bort.** |

### Legacy Naming

- **C0**: Legacy-benämning. Förekommer inte i målmodellen. Om det nämns i gammal kod/dokumentation, avser typiskt det som nu heter C1.
- **C1/C2/C3**: Gällande stagedefinitioner i målmodellen.
- **C4-AI**: Post-C AI-steg, alltid separat från C1/C2/C3.

### Important Clarifications

- **C2 routear till**: `postTestC-A`, `postTestC-B`, `postTestC-D` — detta är test observations, inte canonical truth.
- **C3 är första HTML-extraktionssteget** i målmodellen.
- **C4-AI är lätt att koppla bort** — det är en fristående analysfas, inte inbäddad i C1/C2 eller C3.
- **Testväggen gäller**: testutfall är inte canonical sanning.
- **`postTestC-UI`** är staged test-output.
- **Ingen H-routing** i denna fas.

---

## Purpose

This document defines the controlled **C test phase** for EventPulse.

The purpose of this phase is to:

- process all incoming unresolved sources from `postB-preC`
- test them through a strict manual C pipeline: `C1 -> C2 -> C3`
- measure extraction success and routing signals at each stage
- improve the general HTML extraction system through controlled learning loops
- keep all C-test outputs **inside test boundaries**
- prevent test outputs from silently entering production

This is a **test-lab workflow**, not a production shortcut.

---

## Why This Exists Now

A and B have already filtered the source landscape:

- A handles direct API / network sources
- B handles JSON-LD, RSS, ICS, feeds, static JSON and similar structured data
- unresolved sources now accumulate in `postB-preC`

At this stage, the remaining cases are primarily HTML-facing or unclear cases that require:

- general HTML detection
- general HTML extraction
- controlled rerouting when a source actually behaves like A, B or D
- iterative improvement of C-tools without site-specific hacks

This document exists to make that work **measurable, repeatable and honest**.

---

## Scope

This document applies only to the **C test phase**.

It governs:

- intake from `postB-preC`
- manual test execution through `C1 -> C2 -> C3`
- test-only queues
- test result fields
- round-based fail handling
- 123 learning loops
- promotion rules into the real pipeline

It does **not** redefine:

- canonical source identity
- production queue semantics
- A/B/D production behavior
- H activation
- final production routing

---

## Boundary Against Production

The C test phase is isolated from production.

Important:

- `postTestC-UI` is a **staged test output queue**
- it must **not** auto-forward to normalizer, BullMQ, Supabase or UI
- promotion into the real pipeline must happen **manually**
- route suggestions to A/B/D are **test observations**, not canonical truth

This phase exists to improve C-tools first.
Production integration happens later.

---

## Inflow

### Single incoming queue

The only incoming queue for this phase is:

- `postB-preC`

No other queue may feed directly into this C test rig unless explicitly documented later.

---

## Outflow Queues for Test Phase

Each source processed by the C test rig must end in **exactly one** of these queues:

- `postTestC-UI`
- `postTestC-A`
- `postTestC-B`
- `postTestC-D`
- `postTestC-Fail-round1`
- `postTestC-Fail-round2`
- `postTestC-Fail-round3`
- `postTestC-Fail`

### Meaning of each queue

#### `postTestC-UI`
Source produced real event extraction inside the C test rig.

This means:

- extraction succeeded
- events were extracted by C-stage logic
- source is a staged candidate for later manual promotion into the real pipeline

This queue is **not** an automatic production queue.

#### `postTestC-A`
The C test rig observed strong evidence that this source is better handled by A.

This means:

- route suggestion = A
- source is not auto-promoted
- this is a **test routing observation**

#### `postTestC-B`
The C test rig observed strong evidence that this source is better handled by B.

This means:

- route suggestion = B
- this is a test routing observation only

#### `postTestC-D`
The C test rig observed strong evidence that this source is better handled by D / render.

This means:

- route suggestion = D
- this is a test routing observation only

#### `postTestC-Fail-round1`
Source failed to produce extraction success or route success during the first full C pass.

#### `postTestC-Fail-round2`
Source failed again after round-1 learning improvements.

#### `postTestC-Fail-round3`
Source failed again after round-2 learning improvements.

#### `postTestC-Fail`
Final unresolved set after three controlled rounds.

This is the final fail set for this test phase.
It is not yet H.

---

## Core Principle

The C test rig must separate three things:

1. **Extraction**
2. **Routing suggestion**
3. **Learning**

These must never be merged into one vague "success".

---

## Definitions of Success Types

Every C result must be one of these:

### `extract_success`
The source produced real extracted events in the C test rig.

This is the only success type that can enter `postTestC-UI`.

### `route_success`
The source did not produce acceptable extracted events in C, but the rig found strong evidence that the source should instead be treated as A, B or D.

This may route to:

- `postTestC-A`
- `postTestC-B`
- `postTestC-D`

### `fail`
Neither extraction success nor route success was reached in the current round.

This routes to the relevant fail-round queue.

---

## Canonical Definitions of C1, C2, C3, C4-AI

### C1 — Discovery / Frontier

**[Målmodell:]** C1 är discovery/frontier-lagret. Jobbar är att:
- Hämta root page
- Hämta en liten mängd relevanta interna subpages
- Inspecta allmän HTML-struktur
- Detektera breda page patterns
- Estimera vilken typ av source det verkar vara

**I nuvarande implementation (legacy-gate):** C1 är den första icke-AI testlagen. Coarse HTML discovery.

**Regler:**
- C1 måste använda **generella heuristik only**
- C1 får INTE använda AI
- C1 använder signals som: repeated card/list structures, date/time density, event/calendar/tickets/program paths, Swedish date formats, recurring title/date/location groupings

**Output:**
- `extract_success`
- `route_success`
- `continue_to_C2`
- `fail`

---

### C2 — Grov HTML-Screening + Routing-Signal

**[Målmodell:]** C2 är grov HTML-screening som kan routea till A, B eller D. Jobbet är att:
- Applicera djupare generella heuristik på pages identifierade av C1
- Detektera starka reroute-signaler till A, B eller D genom strukturell evidens
- Score page quality och event-density signals mer precist
- Avgöra vilka pages som är värda att skicka till C3 för extraktion
-Rejecta pages som visar tydliga A/B/D patterns utan att waste C3 på dem

**I nuvarande implementation:** C2 är refined scanning layer.

**Regler:**
- C2 måste förbli generic och icke-AI
- C2 routear till `postTestC-A`, `postTestC-B`, `postTestC-D` — detta är **test observations, inte canonical truth**

**Output:**
- `route_success` (A/B/D signal detected — strong enough to route without C3)
- `continue_to_C3` (worth attempting extraction)
- `fail` (low quality, no signal)

---

### C3 — HTML-Extraktion

**[Målmodell:]** C3 är första platsen där verklig HTML-extraktion sker. Jobbet är att:
- Extrahera actual event records från HTML med generella extraktionspatterns
- Parsa date/time/title/location från strukturerade HTML blocks
- Producera reala extraherade events eller ett clean fail
- **INTE** analysera varför extraktion misslyckades — det är jobbet för C4-AI efter C1→C2→C3

**I nuvarande implementation:** C3 är HTML extraction stage. Rule-based (icke-AI).

**CRITISKT:** C3 är icke-AI. Använd INTE AI för extraktion i detta steg.

**Output:**
- `extract_success` (reala events extraherade — går till postTestC-UI)
- `route_success` (extraktion fails men A/B/D signal hittades — går till postTestC-A/B/D)
- `fail` (inget användbart hittades)

**Om C3 lyckas:** Markeras som:
- `winningStage = C3`
- `outcomeType = extract_success`
- test-phase only

---

### C4-AI — AI-Analys (Post-C Fallback)

**[Målmodell:]** C4-AI är separat AI-analys som körs ENDÅ EFTER C1→C2→C3 har körts, och ENBART på fail-fallen.

**CRITISKT:** C4-AI är INTE en del av C1, C2 eller C3. Det är alltid separat.

**Jobbet är att:**
- Analysera mönster över fail-fall
- Identifiera generella förbättringsmöjligheter för C1/C2/C3
- Föreslå små, generella modellförbättringar

**Regler:**
- C4-AI får endast köras på fail-fall efter C1→C2→C3
- C4-AI är **lätt att koppla bort** — det är en fristående analysfas
- C4-AI får INTE användas för att mask svaga Cverktyg
- C4-AI får INTE fabricera events eller overrides measured evidence

**Workflow:**
`postB-preC → C1 → C2 → C3 → fail set → C4-AI analysis → tool improvements → re-run`

---

## Manual Test-Rig Flow

The C test rig must run in this order:

`postB-preC -> C1 -> C2 -> C3 -> exactly one test output queue`

The rig must be manual and controlled.

### Flow rule

A source must move step-by-step:

1. C1 runs
2. if unresolved, C2 runs
3. if unresolved, C3 runs
4. source lands in exactly one output queue

There must be no silent skipping of stages unless explicitly logged.

---

## Required Queue Entry Fields

Each test queue entry must remain a thin operational record.

Each entry should contain at minimum:

- `sourceId`
- `queueName`
- `queuedAt`
- `priority`
- `attempt`
- `queueReason`
- `workerNotes`

Additional allowed test fields:

- `winningStage`
- `outcomeType`
- `routeSuggestion`
- `roundNumber`

Queue entries must not become a new master source registry.

---

## Required Result Fields

Every source result leaving the C rig must include at minimum:

- `winningStage`
- `outcomeType`
- `routeSuggestion`
- `evidence`
- `roundNumber`

### Meaning of these fields

#### `winningStage`
Which stage determined the final outcome.

Allowed:
- `C1`
- `C2`
- `C3`

#### `outcomeType`
Allowed values:
- `extract_success`
- `route_success`
- `fail`

#### `routeSuggestion`
Allowed values:
- `UI`
- `A`
- `B`
- `D`
- `Fail`

#### `evidence`
Short machine-readable and human-readable explanation for why this outcome was chosen.

Examples:
- `repeated event cards with dates extracted`
- `clear wp-json style endpoint discovered from HTML`
- `content absent in raw HTML, render signal high`
- `no stable event-like structure found`

#### `roundNumber`
Allowed values:
- `1`
- `2`
- `3`

---

## Routing Suggestion Rules

Routing suggestions must be based on evidence, not intuition.

### Suggest `A` only if:
- strong API / XHR / network behavior is indicated
- source appears reproducibly extractable without HTML as primary path

### Suggest `B` only if:
- structured payload / feed / JSON endpoint / JSON-LD-like behavior is strongly indicated
- non-rendered structured extraction appears more appropriate than HTML extraction

### Suggest `D` only if:
- critical content appears absent in raw HTML
- render need is concrete, not speculative

### Suggest `UI` only if:
- real event extraction happened inside C
- extraction quality is acceptable
- result is not only a weak fragment

### Suggest `Fail` only if:
- no extract_success
- no credible route_success
- evidence remains insufficient after full pass

---

## Verification Requirements Per Stage

The C test rig must report stage-specific outcomes.

After each run, the report must include:

### C1 report
- number of sources that succeeded in C1
- number of extracted events from C1
- sourceIds tied to those extracted events
- number of A/B/D route suggestions discovered already in C1

### C2 report
- number of sources that first succeeded in C2
- number of extracted events from C2
- sourceIds tied to those extracted events
- number of A/B/D route suggestions first discovered in C2

### C3 report
- number of sources that first succeeded in C3
- number of extracted events from C3
- sourceIds tied to those extracted events
- number of A/B/D route suggestions first discovered in C3

### Full round report
- total sources processed
- total extract_success
- total route_success by destination (A/B/D)
- total fail
- winning-stage distribution
- most common fail reasons
- most common evidence patterns

---

## Rule for Root Page and Subpages

C analysis must inspect:

- the source root page
- a limited set of relevant internal subpages

This inspection must be:

- coarse
- tool-based
- non-AI in C1/C2

The purpose is not deep semantic interpretation.
The purpose is to detect reusable extraction and routing signals.

Allowed:
- limited internal traversal
- event/calendar/program/tickets paths
- likely listing/detail structures

Not allowed:
- uncontrolled crawling
- deep exploration without purpose
- expensive semantic over-analysis in early stages

---

## Round Logic

### Critical Distinction: batch-state vs fail-round-data

These are two different things that must never be confused:

| Artefakt | Vad det styr | Vad det INTE är |
|----------|-------------|-----------------|
| `batch-state.jsonl` | Vilket batch-nummer som körs, batchens status | Styr INTE förbättringsloopens failmängd |
| `postTestC-Fail-round*.jsonl` | Exakt vilka källor som analyseras i 123-loopen | Är INTE samma sak som batch-state |

**123-loopen arbetar alltid på `postTestC-Fail-round*.jsonl` — aldrig på batch-state som startpunkt för analys.**

**Fail-round-regler:**
- Round 1: batch körs → fail-mängd till `postTestC-Fail-round1` → 123-runda-1
- Round 2: `postTestC-Fail-round1` → 123-runda-2 → re-run samma failmängd → `postTestC-Fail-round2`
- Round 3: `postTestC-Fail-round2` → 123-runda-3 → re-run → `postTestC-Fail-round3`
- Ny batch får ALDRIG blandas in mitt i förbättringsloopen

### Round 1
All sources from `postB-preC` run through `C1 -> C2 -> C3`.

Unresolved sources go to:
- `postTestC-Fail-round1`

### Round 2
Sources in `postTestC-Fail-round1` are analyzed by the 123 learning loop.
Only approved general improvements may be added to C1/C2/C3.
Then the same fail set is re-run.

Unresolved sources go to:
- `postTestC-Fail-round2`

### Round 3
Sources in `postTestC-Fail-round2` are analyzed again by the 123 learning loop.
Only approved general improvements may be added.
Then the same fail set is re-run.

Unresolved sources go to:
- `postTestC-Fail-round3`

### Final unresolved state
Sources in `postTestC-Fail-round3` are re-run one final time if planned.
Remaining unresolved sources go to:
- `postTestC-Fail`

---

## The 123 Learning Loop (Legacy — C4-AI in Target Model)

> **Observera:** "123" är legacy-benämningen för den AI-assisterade förbättringsloopen.
> I målmodellen heter detta **C4-AI**.
> 123-loopen och C4-AI refererar till samma koncept men med olika terminologi.

### Critical: C4-AI vs AI-som-fallback (Hidden Extraction)

**These are two fundamentally different things. They must never be conflated:**

| Aspect | C4-AI (förbättringsloop) | AI-som-fallback (dold extraktion) |
|--------|--------------------------|-----------------------------------|
| **Purpose** | Analysera varför C0/C1/C2/C3 misslyckades, föreslå generella verktygsförbättringar | Extrahera events med AI när C3 misslyckas — för att "rädda" enskilda fail |
| **Runs on** | Alla fail-fall (samlat) | Enskilda fail-fall |
| **Output** | Förbättringsförslag, mönster, verktygsändringar | Events (fabricerade om C3 misslyckas) |
| **Is in C core?** | Nej — utanför pipeline | Ja — inbäddad i C-flödet |
| **Allowed in 123?** | Ja — enda tillåtna AI-användning | Nej — blockerad |
| **Counts as success?** | Ja — om verktygen förbättras | Nej — masking weak tools är förbjudet |

**Rule: C4-AI use in 123 loop is ONLY for tool improvement analysis. AI-as-fallback to "rescue" individual fail cases is FORBIDDEN.**

**AI results without tool improvement do NOT count as genuine general success.**

### Purpose

123/C4-AI är den kontrollerade learningslingan för att förbättra C1, C2 och C3 genom analys av fail-fall.

Sekvensen är alltid:

`postB-preC → C1 → C2 → C3 → fail set → C4-AI analysis → tool improvements → re-run`

AI appliceras ENDÅ efter C1→C2→C3 på fail-fallet. AI är aldrig en del av C1, C2 eller C3.

Det måste operera endast på det aktuella fail-round-setet.
Det får inte wander across unrelated domains eller hitta på architecture changes.

---

## What C4-AI (123) Must Do

> **Observera:** "123" är legacy-benämning. Målmodellen använder "C4-AI".

When the user invokes `123`, the agent must:

1. read the relevant C-test documentation first
2. inspect the current fail-round input only (postTestC-Fail-round1/2/3)
3. use AI analysis on fail cases to identify patterns across C1, C2 and C3 results
4. compare C1/C2/C3 failure distributions to find root causes
5. identify reusable, cross-site patterns from the AI analysis
6. propose only small, general improvements to C1/C2/C3
7. implement only those general improvements that are justified
8. re-run the same fail set through C1→C2→C3
9. report what changed and whether the improvement was real

---

## What C4-AI (123) Must Never Do

> **Observera:** "123" är legacy-benämning. Målmodellen använder "C4-AI".

123 must never:

- create site-specific rules
- hand-code domain-specific selectors as "general"
- auto-promote test outputs into production
- silently reroute sources into canonical truth
- send cases to H in this phase
- rewrite ingestion architecture during loop work
- declare success without re-running the same fail set

---

## AI Rules for 123

AI is allowed only inside the learning loop and only for fail analysis or bounded test extraction.

AI may:
- compare failure cases
- detect repeated cross-site patterns
- suggest generic parser improvements
- suggest better heuristics for page typing
- highlight reroute signals

AI may not:
- fabricate extracted events
- replace the general tools as hidden production logic
- be used as a silent fallback that masks weak C-tools
- create site-specific extraction paths
- treat network errors as automatic routing signals without classification

---

## Network Error Handling in C4-AI

**OBS:** Detta avsnitt är nytt — lades till efter batch-011 erfarenheter.

### Regel: Network Error ≠ Automatic Routing Signal

Ett nätverksfel i fail-mängden får INTE automatiskt behandlas som routing-signal till A, B eller D.
Innan 123 får föreslå routing eller verktygsförbättring måste nätverksfelet först klassificeras.

**Workflow:**
1. C1→C2→C3 körs → fail med nätverksfel observeras
2. C4-AI analyserar nätverksfelet → klassificerar typ
3. Baserat på klassificering → avgör om routing är motiverad eller om det är fetch-miljö/url-problem

### Obligatoriska nätverksfelkategorier

| Kod | Namn | Routing? | Förbättring? |
|-----|------|----------|--------------|
| `url_problem` | Fel canonical URL | Nej — fixas i source-config | Nej — site-specific |
| `dns_problem` | DNS misslyckades | Nej utan klar evidens | Nej — oklart |
| `timeout_problem` | Timeout | Nej — möjligen tillfälligt | Kanske — om 2+ sajter |
| `tls_certificate_problem` | Certifikatfel | Nej — sajten har problem | Nej — inte vårt problem |
| `http_404_problem` | HTTP 404 | Nej — beror oftast på fel URL | Nej — url-problem |
| `http_403_problem` | HTTP 403 | Möjligen D-signal | Kanske — undersök |
| `http_5xx_problem` | Serverfel | Nej — troligen tillfälligt | Nej — avvakta |
| `blocked_or_fetch_environment_problem` | Fetch-miljö | Möjligen D-signal | Kanske — undersök miljö |
| `likely_requires_D` | Sannolikt D-signal | **Ja** — routing till D | Ej aktuellt |
| `likely_requires_A_or_B` | Sannolikt A/B-signal | **Ja** — routing till A/B | Ej aktuellt |
| `unclear_network_failure` | Oklart | Nej — kräver mer diagnostik | Nej — oklart |

### Vad C4-AI måste avgöra för varje nätverksfel

1. **Vad sa felet?** (t.ex. "DNS failure", "ETIMEDOUT", "certificate has expired")
2. **Vilken kategori passar?** (se tabellen ovan)
3. **Varför uppstod felet?** — beror det på:
   - fel URL (url_problem, http_404_problem)
   - tillfälligt driftfel (dns_problem, timeout_problem, http_5xx_problem)
   - problem på sajten (tls_certificate_problem)
   - fetch-miljö (blocked_or_fetch_environment_problem)
   - tydlig D/A/B-signal (likely_requires_D, likely_requires_A_or_B)
4. **Är routing motiverad?** — endast för likely_requires_D och likely_requires_A_or_B
5. **Är verktygsförbättring motiverad?** — endast för timeout_problem/blocked om 2+ sajter

### C4-AI och network error — May and May Not

C4-AI may:
- classify network errors by type
- determine if a network error is a clear D/A/B signal
- identify fetch-environment problems (timeout, block) that affect multiple sites
- conclude that network errors are NOT routing signals and should not trigger routing

C4-AI may not:
- automatically route a source to D/A/B because of a network error
- treat all network errors as the same category
- conclude "this source needs D" based on vague network evidence alone
- skip network error classification and jump to routing suggestions
- hide network errors behind a generic "fail" classification

### Rapporteringskrav

Varje nätverksfel i fail-mängden ska dokumenteras med:
- networkErrorType (kategori)
- networkErrorDiagnosis (C4-AI:s analys)
- networkErrorConfidence (säkerhet)

Se C-testRig-reporting.md för fullständiga fält på källnivå, rundnivå och C4-AI-lärrapportnivå.

---

## Allowed Improvements

Only these categories of improvements are allowed:

- stronger general page-type heuristics
- better generic event-list detection
- better generic date/time/title grouping
- stronger generic internal-page selection
- stronger generic reroute detection for A/B/D
- scoring improvements
- safer rejection of weak extraction

All improvements must:
- be small
- be explainable
- be reusable across many sites
- be verified against the same fail-round set

---

## Forbidden Behaviors

Forbidden in this phase:

- site-specific extraction logic
- one-domain selector tuning
- moving sources directly into production queues
- treating test route suggestions as canonical source truth
- using AI as a silent fallback that masks weak C-tools in production
- sending unresolved cases to H
- broad redesigns unrelated to current fail patterns
- claiming improved success without before/after evidence

---

## Stop Conditions

A round should stop only when:

- all sources in the current input set have been processed
- outputs are fully counted by queue and outcome type
- stage-level reporting is complete
- fail reasons are summarized
- any improvements are re-tested on the same fail set

The broader C-test initiative may pause when:

- C1/C2 performance plateaus and no general improvement patterns are found
- AI analysis repeatedly shows no cross-site pattern in the fail set
- reroute suggestions dominate over true HTML extraction
- the remaining fail set becomes genuinely hard and low-yield

---

## Promotion Rules Into the Real Pipeline

Nothing in the C test rig enters the real pipeline automatically.

Promotion requires manual approval.

### Manual promotion candidates

#### From `postTestC-UI`
May later be promoted into real `preUI` / normalizer flow if:
- extraction is verified
- output quality is acceptable
- test-phase contamination is understood

#### From `postTestC-A`
May later be manually sent to the real A path for proper verification.

#### From `postTestC-B`
May later be manually sent to the real B path for proper verification.

#### From `postTestC-D`
May later be manually sent to the real D path for proper verification.

#### From fail queues
No auto-promotion.

---

## Reporting Standard

**AUKTORITATIV RAPPORTSPECIFIKATION:** [C-testRig-reporting.md](./C-testRig-reporting.md) — definierar de fyra obligatoriska rapportlagren med fullständiga fältlistor.

Every C test run and every 123 loop must produce a report in EXACTLY four layers:

### Layer 1: Batch Report
Complete per-batch summary including all cycles (baseline + improvement rounds).
See: [C-testRig-reporting.md Lag 1](./C-testRig-reporting.md#lag-1-batchrapport)

### Layer 2: Source Reports
Per-source structured records for every source in every round.
See: [C-testRig-reporting.md Lag 2](./C-testRig-reporting.md#lag-2-källrapport)

### Layer 3: Round Report
Per-123-round structured report with hypothesis, change, and before/after comparison.
See: [C-testRig-reporting.md Lag 3](./C-testRig-reporting.md#lag-3-rundrapport-123-runda)

### Layer 4: C4-AI Learnings
Structured mandatory learning record. NOT optional free text. NOT hidden fallback.
See: [C-testRig-reporting.md Lag 4](./C-testRig-reporting.md#lag-4-c4-ai-lärrapport)

### Important rules

- Reports are NOT logs. Reports are building blocks for a future experience bank for general HTML scraping.
- C4-AI Learnings layer is mandatory for every round — "no pattern found" must also be documented
- Before/after comparison is required for every 123 round
- Source-level traceability is required: every source in every round must be traceable
- AI results without tool improvement do NOT count as genuine general success

---

## Final Principle

The C test phase exists to make HTML extraction stronger through truth, discipline and repetition.

It must remain:

- measurable
- honest
- generic
- manually controlled
- separate from production

The goal is not for AI to rescue every site.
The goal is to make the general C tools good enough that most relevant HTML cases can be solved without site-specific hacks.
