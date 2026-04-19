# CLAUDE.md

## EventPulse Obsidian vault workflow

This repository uses an Obsidian vault as structured project memory.

Vault root:
`/Users/claudgashi/EventPulse-ObsidianVault/EventPulse`

### Mandatory first read
Always read these first if they exist:
- `00-Core/03-Canonical-Truths.md`
- `00-Core/08-Verification-Principles.md`
- `02-Operations/02-Current-Task.md`
- `02-Operations/05-Verification-Status.md`

### Task-driven note discovery
After the mandatory files:

1. Determine the active domain from the user request, current task, touched files, queue names, stage names, and errors.
2. Extract domain keywords.
3. Search the vault for matching `.md` and `.canvas` files.
4. Rank files by:
   - direct filename/domain match
   - same subsystem
   - same failure family
   - same queue/state family
   - direct relevance to current verification work
5. Read the top 3–6 files only.

### EventPulse domain hints
Use these hints for note discovery:

- If task relates to `C-htmlGate`, `C0`, `C1`, `C2`, `C3`, `postB-preC`, `manual-review`, `D-renderGate`, `batch`, `123`, `derived rules`, `swedish patterns`, `extraction`:
  prioritize:
  - `01-Architecture/*C-htmlGate*`
  - `03-Patterns/*`
  - `05-Canvas/*123*`
  - relevant `02-Operations/*`

- If task relates to `sources`, `provider`, `canonical identity`, `rawSources`, `onboarding`:
  prioritize:
  - `04-Sources/*`
  - relevant `01-Architecture/*`
  - relevant `02-Operations/*`

- If task relates to `frontend`, `UI`, `fetchEvents`, `Supabase`, `end-to-end`:
  prioritize:
  - `01-Architecture/*`
  - `00-Core/15-Provider-Onboarding-Definition-of-Done.md`
  - relevant `02-Operations/*`

### Discipline
Do not read large parts of the vault by default.
Do not treat broad note collection as progress.
Prefer a small high-relevance note set over a large vague note set.

### Write-back discipline
If a change is actually verified, update the most relevant operations/status note in the vault.
Do not write back guesses, unverified interpretations, or speculative conclusions.

Om du verifierar något viktigt ska du uppdatera rätt Obsidian-fil efteråt.

## EventPulse

You are working on EventPulse, a real city event discovery system.
Not a demo, not mock data, not speculative architecture.

Your job is to improve the system safely, concretely, and verifiably.

---

## Startup routine

Before doing any work:

1. Read `README.md`
2. Identify the owning domain
3. Read the matching rules file
4. Read the matching workflow file
5. Read `current-task.md`
6. If the task is HTML Path related, also read:
   - `html-discovery.md`
   - `ai-routing.md`

If task, entry point, goal, or workflow is unclear:
STOP. Do not guess.

---

## Domain routing

- `app/` → UI
- `services/ingestion/` → ingestion
- `services/discovery/` → discovery
- `services/api/` → API layer
- `packages/shared/` → shared types/helpers
- `supabase/` → database truth
- `docs/` → verified documentation
- `.ai/` or `AI/` → prompts, rules, workflows, reports

Do not cross domains casually.

---

## Rules files

- default/global → `global.md`
- ingestion → `ingestion.md`
- discovery → `discovery.md`
- UI → `ui.md`
- scraping/source diagnosis → `scraping.md`
- source testing → `source-testing.md`
- handoff → `handoff.md`
- html candidate discovery → `html-discovery.md`
- ai-assisted routing → `ai-routing.md`

---

## Workflows

Use exactly one:
- ingestion → `02-Ingestion/C-htmlGate/123.md` (auktoritativ C-htmlGate-loop)
- discovery → `discovery-loop.md`
- UI → `ui-loop.md`

Always use:
- `verify-end-to-end.md`

---

## Non-negotiable rules

- No fake data as proof
- No silent scope drift
- No unnecessary redesign
- Protect runtime behavior
- Verification beats claims
- One task at a time
- Reports must reflect reality

---

## Execution standard

For each task:

1. Analyze
2. Select ONE problem
3. Make the smallest safe fix
4. Verify
5. Evaluate
6. Report concretely

Do not fix multiple unrelated problems in one loop.

---

## Current strategic direction for HTML Path

For no-jsonld sources without viable open Network Path:

1. discover the right internal candidate pages first
2. then evaluate the best candidate page
3. then extract events
4. only then consider AI support if candidate choice is unclear
5. only then consider render fallback if HTML discovery clearly fails

Important:
The current bottleneck is often page discovery, not extraction quality.

---

## Generalization Protection Rule

Site-specific behavior must never be encoded in C0/C1/C2.

**Core rule:** If a single site motivates a change, that change must first be proven across multiple unrelated domains.

**Classification required for every proposed change:**

| Classification | Definition | Action |
|----------------|------------|--------|
| **General** | Same pattern verified on 2–3+ unrelated domains | Implementation allowed |
| **Provisionally General** | Pattern observed but not yet cross-site verified | Do NOT implement; verify on more domains first |
| **Site-Specific** | Only one domain exhibits the issue | STOP; use source adapter, source-specific config, or manual review |

**Forbidden without multi-site evidence:**
- Adding to or removing from `IGNORE_PATTERNS` — NEVER based on one site
- Changing scoring weights — NEVER based on one site
- Modifying candidate ranking — NEVER based on one site
- Changing URL token logic — NEVER based on one site
- Editing negative keyword lists — NEVER based on one site

**Examples:**
- `removing 'arkiv' globally because of Folkoperan` = forbidden (Site-Specific)
- `adding www canonicalization because multiple domains differ between www and non-www` = allowed (General)
- `removing 'nyheter' because one site uses it for event news` = forbidden (Site-Specific)
- `adding 'kalender' because 3 venues use it in nav` = allowed (General)

**Cross-site verification requirement:**
A discovery heuristic is only considered stable if tested against multiple unrelated domains. A single-site success is not enough.

If only one domain exhibits an issue:
- Do NOT change C0/C1/C2
- Do NOT generalize
- Report: "Site-Specific — do not implement in C-layer"
- Suggest: source adapter, source-specific config, or manual review

---

## Data and AI rules

AI may improve structure and routing decisions.
AI may not invent events, venues, dates, organizers, or system status.

All transformations and decisions must remain traceable to source material.

AI may:
- rank candidate pages
- compare candidate summaries
- help choose which internal page is most likely to be an event/program page

AI may NOT:
- replace link discovery
- replace verification
- act as a free-form crawler
- override measured event-density or extraction results

---

## Verification standard

A change is only valid if verified through real code path, logs, tests, execution, or visible UI.

If relevant, track:
- internal links found
- candidate pages tested
- selected page
- events fetched
- events after normalization
- events persisted

Never claim success without verification.

---

## Output after each task

Always report:
- what changed
- why it changed
- how it was verified
- what remains unclear
- recommended next step

Be concrete. Do not hide uncertainty.

---

## Git

If you changed files:
- list changed files
- keep changes small and focused
- make a clear git commit when task is complete and verified

---

## Output After Every Task

Every task output must end with `__KLAR_MED_1_2_3_PROMPTEN__` as the very last line, alone on its own line, no period, no text after. This applies to ALL exit paths: normal completion, timeout, early stop, interruption, error path, handoff/partial stop.

---

## Final principle

Folders define responsibility.
Markdown defines behavior.
Code executes the system.
Verification decides truth.

If unclear:
STOP.
Do not guess.
