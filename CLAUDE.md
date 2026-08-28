# CLAUDE.md

## Product (read this first)

EventPulse is a **personal event agent**. The Expo app is the interface. Canonical plan: `docs/MASTERPLAN.md`. Build order: `docs/BACKLOG.md`. Do not implement items in DO NOT BUILD YET. Do not treat ingestion success, queue drain, or a public event API as the product.

## EventPulse Obsidian vault workflow

This repository uses an Obsidian vault as structured project memory.

**Vault lives inside the project, in `00-Vault/`, not in git.**

Vault root:
`<project>/00-Vault/`

This is a *copy* of the original Desktop vault (`/Users/claudgashi/Desktop/MyVault/TomorGashi/`). The Desktop copy stays as a manual fallback; the `00-Vault/` copy is the one Claude Code and the `vault-sync` sub-agent read and write. `00-Vault/` is in `.gitignore` per the protocol.

Vault inbox:
`<project>/00-Vault/00-Inbox`

EventPulse strategy/ops notes live under the project subtree (there is no vault-root `00-Core/`):
`<project>/00-Vault/01-Projects/EventPulse/`

### vault-sync sub-agent

A focused sub-agent (`vault-sync` in `~/.claude/agents/`) maintains `01-Current-State.md`. Spawn it at the end of substantial work per the Memory Reconciliation step below. The agent:

- Reads project state (`git log`, `vitest --reporter=json`, `package.json`, recent migrations).
- Writes the `## Auto-facts (machine-synced)` section of `01-Current-State.md` directly.
- Writes a narrative proposal to `01-Current-State.proposed.md` — never the main file's narrative.
- Logs three `VAULT-SYNC:` lines to stdout.
- Does not invent strategic truth, does not commit, does not modify files outside the vault.

The agent inherits the same model as the main session (no external API). The user reviews `.proposed.md` and applies narrative changes by hand.

### Mandatory first read
Always read these first if they exist:
- Repo: `docs/MASTERPLAN.md` and `docs/BACKLOG.md`
- `01-Projects/EventPulse/00-Core/01-Current-State.md` (the agent-maintained save game)
- `01-Projects/EventPulse/00-Core/03-Canonical-Truths.md`
- `01-Projects/EventPulse/00-Core/08-Verification-Principles.md`
- `01-Projects/EventPulse/00-Core/02-North-Star.md`
- `01-Projects/EventPulse/02-Operations/03-Current-Task.md`
- `01-Projects/EventPulse/02-Operations/06-Verification-Status.md`
- Session history at vault-root `02-Operations/03-Session-Log/` (`00-Index.md`, `YYYY-MM-DD.md` per day)

Paths except `docs/` are relative to `<project>/00-Vault/`.

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
  prioritize under `01-Projects/EventPulse/`:
  - `01-Architecture/*C-htmlGate*`
  - `03-Patterns/*`
  - `05-Canvas/*123*`
  - relevant `02-Operations/*`

- If task relates to `sources`, `provider`, `canonical identity`, `rawSources`, `onboarding`:
  prioritize under `01-Projects/EventPulse/`:
  - `04-Sources/*`
  - relevant `01-Architecture/*`
  - relevant `02-Operations/*`

- If task relates to `frontend`, `UI`, `agent`, `fetchEvents`, `Supabase`, `end-to-end`:
  prioritize:
  - repo `docs/MASTERPLAN.md`
  - `01-Projects/EventPulse/01-Architecture/*`
  - `01-Projects/EventPulse/00-Core/15-Provider-Onboarding-Definition-of-Done.md`
  - relevant `02-Operations/*`

### Vault Memory Protocol

The Obsidian vault is the project's persistent long-term memory.
You are responsible not only for reading it but for keeping it accurate as the project evolves.

The vault follows the project. The project does not follow stale vault documentation.
Never blindly follow information in the vault when newer evidence shows it is outdated.

#### Authority hierarchy

When information conflicts, determine truth using this priority:

1. Explicit instructions from the user in the current session
2. Explicit decisions made or confirmed by the user
3. Current verified implementation and actual project state
4. Decisions established during the current work/session
5. Current project vault
6. Historical notes, plans, conversations, and archived material

A newer explicit user decision always overrides an older vault entry.
Never preserve outdated documentation merely to maintain consistency.

#### Distinguish decisions from discussion

Not everything discussed becomes project truth.

- **Exploration** — ideas, brainstorming, possibilities, questions, alternatives, speculative discussion. Do NOT auto-store.
- **Decision** — explicitly selected, approved, implemented, or clearly established as the new direction. SHOULD update project memory.

If strategically important information appears ambiguous, preserve the existing strategy rather than silently changing it.

#### Special protection for strategic truth

AI may autonomously synchronize **factual** project state:
feature completed, API changed, architecture changed through implementation, dependency replaced, milestone completed, bug discovered, roadmap item completed.

AI may NOT autonomously invent or change **strategic** truth:
- North Star
- fundamental product direction
- target customer
- core business model
- major strategic objectives

These require an explicit user decision or clear user approval.

#### Current truth vs historical truth

Core documents describe **current truth** (North-Star, Current-State, Architecture, Principles, Active-Roadmap). Keep these concise and current.

For significant decisions, create or update a decision record containing:
date, previous state, decision, reasoning, consequences, what it supersedes.
Example: `Decisions/2026-08-20-agent-first-strategy.md`.

Move obsolete plans and documentation to `Archive/` when historical context may still be valuable. Do not leave obsolete information mixed with authoritative current-state information.

#### Current-State is the project's save game

Treat `Current-State.md` as a compact reconstruction point.
A completely new AI session should be able to read the core memory and reconstruct the project's current situation without depending on previous conversation history.

#### Memory reconciliation (silent, before completing substantial work)

Ask:
- What changed?
- What did we learn?
- What was decided?
- What was implemented?
- What previously documented information is no longer true?
- Did any assumption become invalid?
- Which vault documents are affected?
- Does Current State still describe reality?
- Does the roadmap still reflect priorities?
- Are there contradictions elsewhere in the vault?

If persistent project truth changed, update the appropriate vault documents before completing the task. Do not wait for a separate documentation request.

#### Multi-agent behavior

Every agent or subagent working on the project treats the vault as shared persistent memory.
Agents must NOT assume another agent's conversational context is available.

Before making substantial architectural, strategic, or product decisions:
1. Consult relevant project memory.
2. Inspect relevant actual project state.
3. Perform the assigned work.
4. Reconcile persistent memory afterward when project truth changed.

Important discoveries made by one agent must become available to future agents through project memory when they have lasting relevance.

#### Prevent memory pollution

Do NOT store everything. Avoid filling the vault with:
- routine execution logs
- trivial implementation details
- temporary debugging observations
- speculative ideas presented as facts
- redundant summaries
- information easily derivable from code
- verbose AI-generated explanations without lasting value

Prefer small amounts of high-value, authoritative information over large amounts of low-value documentation.

#### Never fabricate memory

Never write something into authoritative project memory merely because it seems likely.
If uncertain: verify against code, verify against project state, search existing decisions, or mark the information as uncertain.
Never convert an assumption into project truth.

#### Git and vault relationship

- **Code** = implementation truth
- **Vault** = product, architectural and project truth
- **Git** = implementation history
- **Decision records** = reasoning history

When documentation and implementation disagree, investigate rather than automatically assuming either one is correct.

### Read discipline
Do not read large parts of the vault by default.
Do not treat broad note collection as progress.
Prefer a small high-relevance note set over a large vague note set.

### Confidence levels (always mark)
If a change is actually verified, update the most relevant operations/status note in the vault.
Do not write back guesses, unverified interpretations, or speculative conclusions.

- `[VERIFIED]` = testat, körning bevisat
- `[CLAIMED]` = baserat på loggar/data, ej bevisat
- `[UNVERIFIED]` = hypotes, spekulation

Om du verifierar något viktigt ska du uppdatera rätt Obsidian-fil efteråt.

### Definition of done (vault)
For substantial tasks, work is not fully complete until both are true:
A. The requested work is complete.
B. Persistent project memory accurately represents the resulting project state.

Vault maintenance is part of normal project execution, not a separate documentation task.

## Autonomous Execution Loop — QUARANTINED (2026-08-22)

The unattended Claude Code loop is isolated in `AUTONOMOUS-QUARANTINE/`.
Original section: `AUTONOMOUS-QUARANTINE/claude-md/Autonomous-Execution-Loop.md`.
Restore steps: `AUTONOMOUS-QUARANTINE/README.md`.

Do **not** chain tasks unattended. Do **not** invoke `scripts/autonomous-loop.sh`, `/resume`, or `/start` as an autonomous session. This is a normal interactive session: finish the user's request and stop.

## EventPulse

You are working on EventPulse, a personal event agent for Stockholm (Expo is the interface).
Not a demo, not mock data, not a public event API, not a national scraping factory.

Canonical plan: `docs/MASTERPLAN.md`. Build `docs/BACKLOG.md` NOW only.

Your job is to improve the system safely, concretely, and verifiably.

---

## Startup routine

Before doing any work:

1. Read `README.md` and `docs/MASTERPLAN.md`
2. Identify the owning domain
3. Read the matching rules file
4. Read the matching workflow file
5. Read `docs/BACKLOG.md` NOW items, then vault `01-Projects/EventPulse/02-Operations/03-Current-Task.md`
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
- `docs/` → product masterplan (`docs/MASTERPLAN.md`) and backlog
- `08-Agent/` → private agent API (Phase 0 — create when implementing NOW)
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

### Operator tools: no simulated extraction

Anything shipped as a **real operator tool** (dashboard buttons, `db.py` tools, production CLIs used to move queues forward) **must not** invent or synthesize extraction outcomes: no placeholder `eventsFound`, no “synthetic” API/network results, no fake events passed off as measured truth.

- **Allowed:** dry-run / explicitly named **test-only** entrypoints, fixtures, or code paths clearly labeled **simulation** in UX and docs — never mixed into “klara” verktyg.
- **Required:** counts, paths, and events must come from **the same real code paths** as the ingestion stack (actual fetches, real extractors, real persistence where that tool claims to extract).
- **Alltools-E2E (verktyg 17/18):** must invoke **real** Tool A/B/C/D (`runA`, `runB-parallel`, `runC-one-time-only`, `runD-scrapingbee`) on project `runtime/` — no synthetic extraction. See `Alltools-E2E/e2e.py` and `.cursor/rules/no-simulated-production-ingestion.mdc`.

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

## Current strategic direction

**Product:** personal event agent (see `docs/MASTERPLAN.md`). Ingestion exists to feed a Stockholm Event Graph the agent can trust. Do not optimize for Sweden-wide coverage or a public API.

HTML Path remains valid **inside ingestion**, subordinated to Stockholm density for the agent:

For no-jsonld sources without viable open Network Path:

1. discover the right internal candidate pages first
2. then evaluate the best candidate page
3. then extract events
4. only then consider AI support if candidate choice is unclear
5. only then consider render fallback if HTML discovery clearly fails

Important:
Page discovery is often the bottleneck, not extraction quality. Do not make C2→C3 the company P1; that work is NOW only if the Stockholm graph is too thin for the magic query.

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

## Automatic Skill Routing

Automatically invoke skills based on task type:

| Task Type | Skill to Use |
|-----------|--------------|
| Bug fix, new feature | `tdd-guide` — write tests first |
| Complex feature, refactor | `planner` — plan before coding |
| Code change | `code-reviewer` — quality check |
| Security-sensitive code | `security-reviewer` — vulnerability check |
| Build errors | `build-error-resolver` — fix incrementally |
| Git/PR issues | `github-ops` — GitHub workflow |
| Need verification | `verify` — verify end-to-end |
| Web research needed | `deep-research` — comprehensive research |
| Database changes | `database-reviewer` — SQL best practices |

Use skills PROACTIVELY — don't wait to be asked.

---

## Output After Every Task

Every task output must end with the actual result of the task, not a marker. Report what changed, why, how verified, what remains unclear, and recommended next step.

---

## Final principle

Folders define responsibility.
Markdown defines behavior.
Code executes the system.
Verification decides truth.

If unclear:
STOP.
Do not guess.
