# AGENTS.md

> **MiniMax Code agent-facing project definition.** Repo-local, machine-readable contract for the EventPulse repository.
>
> Claude Code continues to read `CLAUDE.md` and `.claude/eventpulse/policy.md`. Both files can coexist. The two contracts cross-reference each other but are not identical.
>
> Open standard: <https://agents.md>.

## Project

**EventPulse** — personal event agent for Stockholm. The Expo app is the interface. Canonical plan: `docs/MASTERPLAN.md`. Build order: `docs/BACKLOG.md`. Do not implement items in DO NOT BUILD YET.

The product is **not** ingestion success, **not** queue drain, **not** a public event API, **not** a national scraping factory.

## Setup commands

- Install deps: `npm install` (lockfile: `package-lock.json`; no `packageManager` field — uses npm by default)
- Typecheck: `npm run type-check` (`tsc --noEmit`)
- Tests: `npx vitest run` (vitest 4, config `vitest.config.ts`, includes `**/*.test.ts` / `**/*.spec.ts`, excludes `**/runtime/**`)
- Coverage: `npx vitest run --coverage`
- Source import: `npm run import:sources` (uses `.env` via tsx)
- Worker: `npm run worker`
- Dashboard: `npm run dashboard:live`
- Agent server: `npm run start:agent`
- Env-loading convention for ad-hoc scripts: `npx tsx --env-file=.env <script>`

> `.env` is secrets. `.env.example` is the public template. Never log either.

## Project layout

| Path | Purpose |
|---|---|
| `02-Ingestion/` | Extraction pipeline (A directAPI / B JSON-feed / C-htmlGate / D-renderGate / F eventExtraction) |
| `03-Queue/` | BullMQ queues + worker entrypoint |
| `04-Normalizer/` | Event normalization (LLM-backed) |
| `05-Supabase/` | Postgres schema, migrations, smoke scripts |
| `06-UI/` | Expo client (React Native) — interface only |
| `06-UI-sandbox/` | Expo design sandbox |
| `07-Discovery/` | Discovery service + venue graph |
| `08-Agent/` | Private agent API (LLM-backed recommendation + tools) |
| `09-DiscoveryAgent/`, `09-ScrapingSupervisor/` | Operator tooling |
| `packages/shared/` | Shared TypeScript types |
| `runtime/` | Generated artifacts, NOT committed (see `.gitignore`) |
| `docs/` | MASTERPLAN, BACKLOG, deploy, audit, scraping-supervisor |
| `00-Vault/` | Obsidian project memory — NOT in git, persistent long-term memory |
| `.claude/` | Claude Code config (hooks, agents, skills, rules, policy). **Leave intact.** |
| `scripts/`, `tools/`, `Alltools-E2E/` | Operator utilities |

## Code style

- TypeScript strict mode (`tsconfig.json: strict: true`).
- ESM modules (`"type": "module"`). `tsx` for ad-hoc execution.
- Prefer dedicated tools (`read`, `write`, `edit`, `grep`, `glob`) over `bash` for file operations.
- Never log secrets. The redactor is in `.claude/eventpulse/evidence-recorder.ts` (Claude-side); MiniMax Code must apply equivalent caution by hand.
- Project rules live in `.claude/rules/common/*.md` and `.claude/rules/typescript/*.md` — they are still authoritative for both tools. Read them before making a non-trivial change.

## Testing instructions

- Unit / integration: `npx vitest run` (see `vitest.config.ts`).
- Add a test for every behavior change. Match the existing `*.test.ts` style in the touched package.
- All tests must pass before declaring work done. Report the run command and observed counts.
- E2E operator tool: see `Alltools-E2E/e2e.py` — it MUST invoke real Tool A/B/C/D, never synthetic extraction.
- Mark every claim with confidence: `[VERIFIED]` (proven by real code path), `[CLAIMED]` (from logs/data, not proven), `[UNVERIFIED]` (hypothesis).

## PR & commit conventions

- Current branch: `ui`. Default target: `main`. Never push to `main` without explicit human approval.
- Conventional commits: `feat:` / `fix:` / `docs:` / `refactor:` / `chore:` — match recent `git log --oneline`.
- Before requesting review: `npm run type-check && npx vitest run` green.
- Git history is implementation truth. Vault (`00-Vault/`) is project/strategic truth. Keep them aligned; never let one lie about the other.

## Security

- `.env` is secrets. `.env.example` is the public template.
- `06-UI/scripts/email-templates/auth-config-backup-*.json` is gitignored — it contains SMTP password.
- Never commit Supabase service-role keys, MiniMax / OpenAI / ScrapingBee keys, or any token.
- Any tool that prints a token must redact it first.
- Read `.claude/eventpulse/policy.md` § Secret handling for the redaction regex; MiniMax Code honors the same rule manually.

---

## Autonomous workflow — permanent standard behavior

This is the repo-level contract for MiniMax Code autonomy. It applies to **every non-trivial task** in this repository. Override is forbidden.

### 1. Pre-flight: before any non-trivial implementation

Always complete these in order before writing or changing code:

1. **Understand the task.** Restate the goal, scope, and acceptance criteria in one sentence each.
2. **Inspect the repository.** Read `CLAUDE.md`, `docs/MASTERPLAN.md`, `docs/BACKLOG.md` (NOW only), and `00-Vault/01-Projects/EventPulse/02-Operations/03-Current-Task.md` if it exists.
3. **Investigate existing implementation.** Use `grep` and `glob` for the relevant subsystem; read the top 3–6 hits, not the whole codebase. Prefer files in the touched module.
4. **Research proactively with `web_search` / `web_fetch`** when:
   - current API/library docs are needed,
   - the project depends on unfamiliar external behavior,
   - established patterns or comparisons improve the result.
   Prioritize **official and current** sources. Never guess what can be looked up.
5. **Surface genuine uncertainty.** If user decisions are required to proceed, batch ALL of them into **one** `ask_user` round BEFORE implementation. Never drip-feed questions mid-work.
6. **Plan.** Use `todowrite` for short tasks. For long-running tasks, use a project-native state file (see §4).
7. **Begin work** only after pre-flight is complete.

### 2. Once started: stay autonomous

For the remainder of the task, the loop is:

```
IMPLEMENT  →  TEST  →  VERIFY  →  REVIEW  →  FIND GAPS  →  REPAIR  →  RETEST  →  NEXT INCOMPLETE STEP
```

- Do NOT ask "should I continue?" mid-loop.
- Do NOT stop at a partial milestone, a green build, or a first working solution.
- Do NOT stop just because code has been written.
- Continue until the agreed Definition of Done is met.

### 3. When problems appear

Standard behavior:

```
PROBLEM  →  INVESTIGATE  →  READ CODE / LOGS  →  RESEARCH  →  TRY FIX  →  TEST  →  VERIFY  →  CONTINUE
```

- Try several reasonable fixes before reporting a blocker.
- Ask the user only when the blocker is **genuinely** outside what can be solved by reading, searching, or running the codebase.

### 4. Long-running work (multi-hour, multi-session)

Optimize for tasks that may span multiple MiniMax Code sessions. MiniMax Code does NOT have Claude Code's PreToolUse / PostToolUse / SubagentStop / PreCompact hook runtime, so the safety, evidence, handoff, and state-snap behaviors that Claude enforces via hooks live in this repository as **harness-independent scripts** that the agent MUST call explicitly.

#### 4.1 Persistent state protocol

For any non-trivial task, the agent maintains a state file at `runtime/autonomy/<task-id>.md` via the `scripts/autonomy/state.mjs` CLI. The file has these mandatory sections:

| Section | Purpose |
|---|---|
| `GOAL` | One-sentence task goal |
| `ACCEPTANCE CRITERIA` | Bullet list of gates. Names matching the gate registry (e.g. `typecheck`, `adapter_test`, `venue_graph_dry_run`) are auto-verified by `evidence.mjs gate-check`. Unknown names are warnings, not blockers. |
| `CURRENT PHASE` | Short status line, updated each significant step |
| `COMPLETED` | Bulleted log of finished steps |
| `VERIFIED` | Bulleted log of steps confirmed by real code-path verification |
| `FAILED / PROBLEMS` | Bulleted log of failed attempts and current blockers |
| `IMPORTANT DECISIONS` | Bulleted log of non-obvious decisions worth keeping for future sessions |
| `FILES CHANGED` | Bulleted list of files touched (one per bullet) |
| `REMAINING` | Short prose of what is still left |
| `NEXT ACTION` | **Exactly one** concrete next step. **Must be non-empty while status is IN_PROGRESS.** `state.mjs update` will refuse to empty it. Only `mark --status DONE` or `mark --status BLOCKED` lifts this requirement. |

**State lifecycle:**

```
init  →  update (many)  →  mark --status DONE   (all AC met, NEXT ACTION may be empty)
                          →  mark --status BLOCKED (only when §4.3 conditions hold)
```

**When to initialize:** any task that touches more than one file, has more than one phase, or may need to be resumed. Trivial single-file edits do not need a state file.

**When to update:** after every significant phase, after every verification, after every decision, after every problem encountered. The session handoff rule (below) depends on the file being current.

**Canonical command set:**

```bash
# Initialize
node scripts/autonomy/state.mjs init \
  --id <task-id> \
  --goal "..." \
  --criteria "gate1;gate2;gate3"

# Update as you work
node scripts/autonomy/state.mjs update --id <task-id> \
  --phase "implementing extractor" \
  --next "write unit tests for the new heuristic" \
  --append-completed "Wired extractor into queue" \
  --append-verified "vitest run extractor.test.ts green" \
  --append-problem "First heuristic missed 30% of cases" \
  --append-decision "Switched to regex anchor approach" \
  --append-file src/extractor.ts

# Terminal states
node scripts/autonomy/state.mjs mark --id <task-id> --status DONE
node scripts/autonomy/state.mjs mark --id <task-id> --status BLOCKED --reason "Waiting on Supabase service-role key"

# Quick orientation in a new session
node scripts/autonomy/state.mjs status --id <task-id>
node scripts/autonomy/state.mjs list
```

#### 4.2 Continuation rule

> If the task does not yet meet Definition of Done and `NEXT ACTION` is non-empty, the agent MUST continue working. Returning control to the user for the sole purpose of reporting progress is forbidden.

- Do not stop to ask "should I continue?".
- Do not stop after a green test if other acceptance criteria remain unmet.
- Do not stop after writing code if it has not been verified.
- Continue until `mark --status DONE` or `mark --status BLOCKED` is the truthful state.

#### 4.3 BLOCKED semantics

`BLOCKED` is a terminal state. The agent may ONLY set it when continued work requires one of:

1. Information that only the user has (e.g. a product decision, a credential, a clarifying question whose answer cannot be inferred).
2. A credential or permission that the agent cannot obtain itself.
3. A product decision that cannot be derived from the repository, vault, or web search.
4. An external service or resource that cannot be reached (and the failure is not transient).

**Explicitly NOT BLOCKED** (continue working):

- A failing test (investigate, fix, retest).
- Unknown code (read the code; the repository is the source of truth).
- Need for further research (use `web_search` / `web_fetch`).
- A first solution that did not work (try alternative approaches).
- A flaky network or build (retry; only after repeated failures over a meaningful window is it a BLOCKED).
- The task being long (long-running is the default expectation here).

If unsure whether something is BLOCKED, the default is to continue.

#### 4.4 Evidence ledger

After every meaningful bash command (test runs, type-check, lint, schema diffs, fixture replays, e2e), the agent SHOULD append to `runtime/autonomy/evidence.ndjson` via `scripts/autonomy/evidence.mjs append`. The script redacts secrets before writing. This ledger backs `gate-check`: each gate in the state's `ACCEPTANCE CRITERIA` is verified to have a fresh, exit-0 entry whose command matches a known fingerprint AND whose working-tree fingerprint equals the current one.

```bash
node scripts/autonomy/evidence.mjs append \
  --cmd "npx vitest run 02-Ingestion --reporter=json" \
  --exit 0 \
  --mission-id <task-id>

node scripts/autonomy/evidence.mjs gate-check --state runtime/autonomy/<task-id>.md
```

#### 4.5 Safety blocklist (prose enforcement)

MiniMax Code lacks Claude Code's PreToolUse hook runtime. The same protective rules live as prose here AND as a verifier (`scripts/autonomy/safety.mjs`). The agent MUST NOT execute (or call from bash) any of the following — even if MiniMax's own permission system would allow it:

**Bash blocklist:**
- `rm -rf /`, `rm -rf ~`, `rm -rf .`, `rm -rf node_modules`
- `git push --force`, `git push -f`, `git push --no-verify`
- `git filter-branch`
- Fork-bomb patterns (`:(){ :|:& };:`)
- `curl ... | sh` / `curl ... | bash` / `curl ... | sudo sh`
- `DROP TABLE` without `IF EXISTS`
- `psql ... production ...` (production database targeting)
- Overwrite of `~/.zshrc` or similar shell rc files

**Edit/Write blocklist (Tier 0 + Tier 1 files):**
- `docs/MASTERPLAN.md`
- `docs/BACKLOG.md`
- `.claude/eventpulse/policy.md` (and any `eventpulse/policy.md` matching that path)
- `05-Supabase/migrations/*_prod_*.sql` (prod migrations require explicit human approval; dry-run only)
- All files under `00-Vault/` EXCEPT the three machine-synced allowlist paths: `01-Projects/EventPulse/00-Core/01-Current-State.md`, `01-Projects/EventPulse/00-Core/01-Current-State.proposed.md`, `01-Projects/EventPulse/02-Operations/23-Active-Task-Queue.md`.

Before running any non-trivial bash command, the agent SHOULD validate it: `node scripts/autonomy/safety.mjs check-bash "<cmd>"`. Exit 0 means allowed; exit 2 means blocked, with the matched rule printed to stderr.

#### 4.6 Session handoff

MiniMax Code DOES support `mcode --continue` (resume the latest session in this workspace), `/sessions [query]` (search/resume any session), `/compact [instructions]` (compact a long conversation), `/fork`, `/rewind`. See [MiniMax Agent Docs — Features and configuration](https://agent.minimax.io/docs/cli/features).

When a session ends mid-task — either naturally or because of a context-window/compaction event — the agent MUST update the state file (`.update --next "..."` and `.append-*` to log the just-completed step) before the last response. A future session resumed via `mcode --continue` or `/sessions` then reads the state file first thing and continues from `NEXT ACTION` without re-briefing.

#### 4.7 Sub-agents

Use the `task` tool with `agent_name` from `explore`, `verifier`, `worker`, or `mavis` (built-ins at `~/.minimax/agents/.builtin/`). Delegate parallelizable, well-scoped subtasks only — never the decision-making itself. Each sub-agent inherits the project contract via AGENTS.md when started in this workspace.

For long-horizon multi-agent work, MiniMax Agent Team is the documented multi-agent mechanism (`https://agent.minimax.io/docs/techblog/agent-team`) — it splits a complex task into parallel sub-tasks dispatched to a batch of Agents with adversarial quality gates.

### 5. Decision gates (when to ask the user)

Ask **only** when the blocker is a user decision that materially changes the outcome, and only batch all such questions into **one** round:

- BEFORE implementation begins (during pre-flight).
- At a Tier 0 criticality-`critical` gate (see `.claude/eventpulse/policy.md` § Risk boundaries — never substitute it).

Otherwise: investigate, try, retry, continue.

### 6. Definition of Done

A substantial task is DONE **only** when **all** of these are true:

- The full plan has been executed.
- Every acceptance criterion is met.
- Relevant tests pass (`npm run type-check` + `npx vitest run` for code changes).
- The result is verified via the same real code paths used in production. No synthetic extraction, no fake data, no placeholder counts.
- The implementation has been reviewed (self-review at minimum).
- All agent-solvable defects discovered during verification are fixed.
- No planned step remains.
- Anything that could not be verified is explicitly marked `EJ VERIFIERAT` / `[UNVERIFIED]`.

`IMPLEMENTED` is not the same as `VERIFIED`.

### 7. Permanent stop rules

These override everything else:

- **Tier 0 invariants** in `.claude/eventpulse/policy.md` always apply. Never weaken them.
- Do not edit `docs/MASTERPLAN.md` or `docs/BACKLOG.md` without explicit human approval.
- Do not apply a Supabase prod migration without explicit human approval. Dry-run is fine.
- Do not push to `main` without explicit human approval.
- Confidence tags are mandatory. Never mark unverified work as done.
- Generalization Protection Rule (`.claude/eventpulse/policy.md`): site-specific behavior must never be encoded in shared C-layers. No single-site change to `IGNORE_PATTERNS`, scoring weights, candidate ranking, URL token logic, or negative keyword lists.

## Output standard — after every task

End every non-trivial response with this structure:

1. **What changed** — files + intent.
2. **Why** — motivation.
3. **How verified** — real code paths, not synthetic.
4. **What remains unclear** — honest gaps.
5. **Recommended next step** — one concrete follow-up.
6. **På människospråk** — short plain-Swedish summary for the non-technical reader (see CLAUDE.md § Svarsformat).

## Communication rule — how to present a choice when you actually need one

This rule governs **how** to ask when you ask, **not** whether to ask. Ask only
when the user's decision is genuinely required (e.g. product direction, missing
credentials, irreversible action). Never use this rule as an excuse to ask more
often.

When a choice must be presented to the user, follow this four-part structure:

### 1. Bakgrund på människospråk

Open with a short plain-Swedish explanation of the situation and why the choice
has arisen. The user should understand the context without knowing the code or
the technical machinery behind it.

### 2. Alternativen på människospråk

Describe each alternative in a few proper sentences. For each option, explain:

- what the option actually means
- what happens if we choose it
- the main advantage
- any important drawback
- the practical difference it makes

Avoid alternatives that look like this:

```
A. Atomic state writes
B. Lock-file semantics
C. Single-writer
```

Write them like this instead:

```
A. Låt bara huvudprocessen uppdatera arbetsstatusen

Alla underagenter lämnar sina resultat till huvudprocessen, och bara
den får uppdatera den gemensamma statusfilen. Det minskar risken att
två agenter försöker ändra samma information samtidigt och råkar
skriva över varandra. Nackdelen är att all status måste passera genom
huvudprocessen.

B. Låt flera processer skriva men lås filen under tiden

Flera agenter kan fortfarande uppdatera statusen själva, men systemet
låser filen medan någon skriver i den. Det ger större frihet för
agenterna men gör systemet mer komplicerat och skapar fler saker som
kan gå fel.
```

Technical terms may appear in parentheses after the plain-language explanation,
but the user must never need to understand the technical term in order to make
the decision.

### 3. Praktisk skillnad

After the alternatives, state in one short sentence what the practical
difference is between them — i.e. what the user is actually choosing between in
concrete terms.

### 5. Rekommendation

If you can assess which option is best, write:

> "Jag rekommenderar A eftersom…"

Explain the recommendation in plain Swedish as well. The user is free to ignore
the recommendation; it is not a default to be overridden silently.

### Notes

- This rule does **not** apply to "answer quickly, no choice required" or to
  status updates. Status updates stay concise (see § Output standard).
- This rule does **not** change the anti-shortcut rule: optimize for a correct,
  verified result, not for finishing the task quickly. Asking is allowed only
  when a decision genuinely blocks progress.
- When `supervisor.mjs next-action` (or `runner.mjs run`) reports that work is
  still runnable, **do not** ask. Continue automatically.

## Coexistence with Claude Code

- `.claude/` is **intact**. Claude Code reads `CLAUDE.md`, `.claude/rules/`, `.claude/eventpulse/policy.md`, and the agent / skill / hook / command files there.
- MiniMax Code reads `AGENTS.md` (this file) at the repo root.
- The two contracts cross-reference (this file links to Tier 0; CLAUDE.md can link here for MiniMax-specific autonomy policy).
- Shared state: `00-Vault/` (Obsidian project memory), `runtime/` (generated artifacts), `.scratch/` (debug dumps). Both tools may read/write these by their own conventions.
- `.claude/settings.json` (hooks, permissions) is Claude Code-only.
- `.claude/agents/ep-*.md` are Claude Code-only domain agents. MiniMax Code uses the built-in `explore` / `verifier` / `worker` / `mavis` agents.

## Native MiniMax Code mechanisms in use

| Mechanism | Location | Purpose |
|---|---|---|
| `AGENTS.md` (this file) | repo root | Project definition + autonomy policy |
| Built-in skills | `~/.minimax/.builtin-skills/<name>/SKILL.md` | Loaded on demand by skill name |
| Built-in sub-agents | `~/.minimax/agents/.builtin/<name>/agent.md` | `explore`, `verifier`, `worker`, `mavis` |
| Runtime config | `~/.minimax/config.yaml` | Models, memory, defaults (user-level, NOT touched by this contract) |
| Background tasks | `~/.minimax/background-tasks/` | Tracking long-running delegations |
| `scripts/autonomy/state.mjs` | `scripts/autonomy/` | Manage `runtime/autonomy/<task-id>.md` state files |
| `scripts/autonomy/evidence.mjs` | `scripts/autonomy/` | Redacted bash-evidence ledger + gate-check |
| `scripts/autonomy/safety.mjs` | `scripts/autonomy/` | Blocklist for dangerous bash / edit patterns |
| `runtime/autonomy/` | repo runtime dir | Per-task state files, evidence NDJSON, task lists |

### Official MiniMax Code platform features the agent should know

These are documented at [MiniMax Agent Docs](https://agent.minimax.io/docs/cli/features) and are first-class in the TUI:

- **`/sessions [query]`** — search and resume sessions. Use this in long-running work to recover from a closed session.
- **`/continue`** (CLI: `mcode --continue`) — resume the latest session in the current workspace.
- **`/compact [instructions]`** — compact a long conversation. Use before context pressure becomes blocking.
- **`/fork`**, **`/rewind`**, **`/rename`** — fork the session, rewind to an earlier boundary, rename.
- **`/status`** — shows current model, permissions, account/plan, **5-hour and weekly quota** with reset countdowns (signed-in accounts).
- **`/usage`** — detailed usage breakdown.
- **`/goal <objective>`**, **`/plan [on|off|status|view]`** — start/manage a goal; switch Plan Mode (toggled via `Shift+Tab` or `/plan`).
- **`/permission`** — toggle permission mode (`Alt+M`). Modes are independent of Plan Mode.
- **`/btw [question]`** (alias `/side`) — open a temporary side conversation that inherits the main task's most-recent committed boundary. Side sessions do not appear in `/sessions`; switching to another session cleans them up.

No project-level `.minimax/` is created — there is no convention for it. No user-level files are written by this contract, to keep the autonomy policy scoped to this repository.

---

## Permanent Autonomous Workflow — UNDERSTAND → RESEARCH → DECIDE → BUILD → PROVE → IMPROVE

> **This section supersedes the autonomy phases described in §1–§7 for non-trivial
> tasks in this repository.** The harness-independent scripts below enforce the gates
> that the older prose-only contract could not. Tier 0 invariants in
> `.claude/eventpulse/policy.md` always apply and are unchanged.

### 1. Six phases

| Phase | What happens | Hard gate? |
|-------|--------------|-------------|
| **UNDERSTAND** | restate goal/scope/AC; inspect repo; identify requirements, AC, UX, architecture, risks | prose |
| **RESEARCH** | proactively use `web_search` / `web_fetch` / `gh search` when value > cost; log findings via `research.mjs add` | partial — required for m/l/xl |
| **DECIDE** | compare alternatives; motivated `DECISIONS` rows in state file | partial — required for m/l/xl |
| **BUILD** | implement scope end-to-end (states, errors, edge cases) | prose |
| **PROVE** | deterministic verification — typecheck, vitest, runtime smoke, UI 3-dim | hard via `workflow.mjs check-size` |
| **IMPROVE** | loop with `FINDINGS → FIXES → RE-PROVE`; mandatory for s/l/xl | hard via `workflow.mjs check-size` |

### 2. Task-size classification

Every task is classified at `state.mjs init --task-size xs|s|m|l|xl`. The size
governs which gates are mandatory:

| Size | Examples | Mandatory gates |
|------|----------|-----------------|
| **xs** | typo, env tweak, single-line | NEXT ACTION non-empty |
| **s**  | small bug fix, single-file change | + IMPROVE LOG ≥1 iteration |
| **m**  | medium feature (1–2 modules) | + RESEARCH CITATIONS, DECISIONS, RESEARCH FINDINGS → DECISIONS |
| **l**  | large feature, new UI section | + AC EVIDENCE MAP, UI 3-dim (if UI), IMPROVE LOG re-prove-status |
| **xl** | new architecture, new domain | + PHASE=IMPROVE before mark DONE |

### 3. Workflow scripts (single source of truth for gates)

| Script | Purpose |
|--------|---------|
| `scripts/autonomy/state.mjs` | create/update state files at `runtime/autonomy/<id>.md` |
| `scripts/autonomy/workflow.mjs` | `init`, `check-size`, `start-improve`, `add-improve-iteration` |
| `scripts/autonomy/research.mjs` | `add`, `youtube`, `audit`, `list` |
| `scripts/autonomy/runner.mjs` | autonomous run loop with LOCAL_BLOCKED semantics |
| `scripts/autonomy/evidence.mjs` | NDJSON ledger + `gate-check` |
| `scripts/autonomy/safety.mjs` | bash + edit blocklist |

`state.mjs mark --status DONE` invokes `workflow.mjs check-size` and refuses
with exit 2 if any size-driven gate is unmet.

### 3.1 LOCAL BLOCKER ≠ GLOBAL BLOCKER

A single task failure must NOT stop the entire run as long as other runnable tasks
exist. Use `runner.mjs run` to iterate all IN_PROGRESS tasks with this semantics:

- Success → mark DONE, continue.
- Failure (reparable) → retry, then mark DONE.
- Failure (irreparable this pass) → mark LOCAL_BLOCKED with reason, continue.
- `runner.mjs` only signals GLOBAL_BLOCKED when NO runnable tasks remain AND
  every remaining task carries a GLOBAL_BLOCKER-level reason (credential needed,
  user decision required, etc).

Task statuses: `IN_PROGRESS` → `LOCAL_BLOCKED` → retry → `DONE`,
or → `GLOBAL_BLOCKED` (only when truly outside the agent's reach).

### 4. RESEARCH must lead to DECISION

Every research entry in `runtime/autonomy/research.log` must contain
`finding / implication / decision / applied_in`. Research without
DECISION + APPLIED IN does **not** count as evidence for the research gate
(`research.mjs audit` enforces this).

```
RESEARCH FINDING   → vad forskningen visade
SOURCE            → web | official-docs | exa | github | youtube-learner
IMPLICATION         → vad det innebär för EventPulse
DECISION          → vilket val som gjordes pga forskningen
APPLIED IN        → var i koden/lösningen det syns
```

### 5. Youtube-Learner trigger (multi-factor)

Use **only** when **≥2** of the following apply:

- ui/ux/design-relevans är hög (ny UI-sektion, premium känsla, motion, micro-interactions)
- practical-example value är hög (video-inspo sparar tid och ger bättre resultat)
- uncertainty är hög efter lokal + Exa/GitHub-research
- novelty är hög (första gången området möter EventPulse)

Do **not** use if docs/Exa/GitHub covers the area, it's a bug fix /
env-tweak / typography change, or there's no visual / design component.

Task-size alone is **not** the trigger. An L-sized UI-feature can justify
Youtube-Learner; an XL-sized backend task may not.

### 6. UI verification — three dimensions

For UI tasks, `UI VISUAL VERIFICATION` must cover three dimensions:

- **A. FUNCTIONAL PROOF** — render, navigation, interaction, loading/empty/error states
  (typecheck, vitest, Playwright)
- **B. VISUAL PROOF** — layout, colors, typography, no resizeMode regression
  (`read` on PNG/JPG, `verify_stamp_rendered.py`, `verify_utforska_star.py`)
- **C. UX/DESIGN QUALITY REVIEW** — visual hierarchy, spacing, typography,
  consistency, accessibility, design-system tokens, anti-AI patterns. **Mandatory
  `frontend-design` skill for L/XL UI features.**

A UI feature is NOT done because it renders, Playwright passes, or navigation works.

### 8. Anti-shortcut rule

Optimize for a correct, fully-verified result — not for finishing the task quickly.
Research, implementation, and verification must be proportional to the task size
and risk. Do not invent work for the sake of work.

### 9. Samexistens med Claude Code

Tier 0 (`.claude/eventpulse/policy.md`), `.claude/hooks/`, `.claude/agents/ep-*`,
`.claude/rules/` are read-only from MiniMax Code's perspective. The autonomy
scripts above are harness-independent and work in both tools.
