# C Test Rig and 123 Learning Loop

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

## Definitions of C1, C2, C3

### C1 — Coarse HTML Discovery and Page Typing

C1 is the first non-AI test layer.

Its job is to:

- fetch the root page
- fetch a small set of relevant internal subpages
- inspect general HTML structure
- detect broad page patterns
- estimate what type of source this appears to be

C1 must use **general heuristics only**.

Examples of allowed signals:

- repeated card/list structures
- date/time density
- links containing event/calendar/tickets/program paths
- article vs calendar vs landing-page patterns
- event-like blocks
- venue-program page structures
- Swedish date formats
- recurring title/date/location groupings

C1 may produce:
- extract_success
- route_success
- continue_to_C2
- fail

C1 must not use AI.

---

### C2 — Refined HTML Scan with Deeper Heuristics

C2 is the refined scanning layer between C1 and C3.

Its job is to:

- apply deeper general heuristics to the pages identified by C1
- detect strong reroute signals to A, B or D through structural evidence
- score page quality and event-density signals more precisely
- narrow down which pages are worth passing to C3 for extraction
- reject pages that show clear A/B/D patterns without wasting C3 on them

C2 must remain generic and non-AI.

Allowed:
- refined density scoring (timeTagCount, dateCount, link-depth analysis)
- repeated-block inference across subpages
- reroute-signal detection (API endpoints, JSON-LD fragments, feed links visible in HTML)
- internal link structure analysis within limits
- path-pattern recognition for calendar/event/ticket listings

Forbidden:
- one-off logic for a single site
- hand-tuned rules for one domain
- treating vague signals as confirmed reroutes

C2 may produce:
- route_success (A/B/D signal detected — strong enough to route without C3)
- continue_to_C3 (worth attempting extraction)
- fail (low quality, no signal)

---

### C3 — HTML Event Extraction

C3 is the HTML extraction stage inside the test rig.

Its job is to:

- extract actual event records from HTML using general extraction patterns
- parse date/time/title/location from structured HTML blocks
- produce real extracted events or a clean fail
- NOT to analyze why extraction failed — that is the job of the AI step after C1→C2→C3

C3 is non-AI. It uses rule-based extraction logic only.

C3 may produce:
- extract_success (real events extracted — goes to postTestC-UI)
- route_success (extraction fails but A/B/D signal found — goes to postTestC-A/B/D)
- fail (nothing usable found)

C3 must not:
- use AI to extract
- analyze failure causes (that is for the post-C AI step)
- be described as "AI-assisted extraction"

**Important distinction:**
- C3 = HTML extraction (non-AI)
- AI = used AFTER C3 on the fail set, in the 123 learning loop, to analyze patterns and improve C1/C2/C3

If C3 succeeds, the result must be marked as:
- `winningStage = C3`
- `outcomeType = extract_success`
- test-phase only

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

## The 123 Learning Loop

## Purpose

123 is the controlled learning loop for improving C1, C2 and C3 through analysis of fail cases.

The sequence is always:

`postB-preC → C1 → C2 → C3 → fail set → 123 AI analysis → tool improvements → re-run`

AI is only applied AFTER C1→C2→C3 on the fail set. AI is never part of C1, C2 or C3.

It must operate only on the current fail-round set.

It must not wander across unrelated domains or invent architecture changes.

---

## What 123 Must Do

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

## What 123 Must Never Do

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

Every C test run and every 123 loop must produce a concise report containing:

C1→C2→C3 results:
- input queue and source count
- stage-by-stage success counts (C1, C2, C3 separately)
- stage-by-stage extracted event counts
- winning-stage distribution (C1 vs C2 vs C3)
- route-suggestion distribution (A/B/D/UI)
- fail distribution by stage
- top evidence patterns

AI analysis (after C1→C2→C3 on fail set):
- identified cross-site patterns (or "no pattern found")
- which stage is the main bottleneck (C1, C2, or C3)
- before/after comparison if tools changed
- exact next step recommendation

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
