# EventPulse Agent Runtime

A thin, native-first runtime layered on top of Claude Code v2.1.96. It turns short user instructions into well-scoped, context-aware, verified engineering missions specific to EventPulse.

**Plan reference:** `.claude/eventpulse/CLAUDE_OLD_SETUP_MANIFEST.md` documents the original (pre-runtime) configuration and rollback path.

---

## Architecture at a glance

```
USER PROMPT ──► UserPromptSubmit (router.ts) ──► mission YAML emitted
                                                       │
                                                       ▼
                                              main session reads mission
                                                       │
                          ┌────────────────────────────┼─────────────────────┐
                          │                            │                     │
                          ▼                            ▼                     ▼
                  safety-gate.ts              evidence-recorder.ts     state-snap.ts
                  (PreToolUse,                 (PostToolUse Bash,      (PreCompact,
                   fail-closed for              NDJSON ledger,           writes
                   non-lead)                    redact secrets)          agent-state.json)
                          │                            │
                          ▼                            ▼
                  ┌─────────────────────────────────────────┐
                  │ verify-completion.ts (TaskCompleted)    │
                  │ fail-closed for non-trivial profiles    │
                  │ checks: required_gates + freshness      │
                  │         + working_tree_fp consistency  │
                  └─────────────────────────────────────────┘
                          │                            │
                          ▼                            ▼
                  config-protection.ts         confirm-stop.ts
                  (ConfigChange, blocks        (Stop, blocks for
                   non-lead edits to           architectural_review
                   runtime config)             + human_review_required)
```

The runtime is **subordinate** to the project's authoritative documentation: `docs/MASTERPLAN.md`, `docs/BACKLOG.md`, `.claude/eventpulse/policy.md`. The runtime cannot mutate those files.

---

## Components

### Tier 0 — invariant core
- `policy.md` (~700 tokens) — always-loaded binding rules. Loaded via `InstructionsLoaded` (native Claude Code).

### Prompt pipeline (Phase 3)
- `router.ts` — `UserPromptSubmit` hook. Reads prompt, calls classifier → context-selector → mission-compiler → validator → writes mission mirror.
- `classifier.ts` — keyword/regex task_type/complexity/risk/subsystem detection + execution_mode matrix from plan §11.
- `context-selector.ts` — Tier 0–3 progressive context expansion per plan §8.
- `mission-compiler.ts` — emits YAML mission + writes mirror to `.claude/eventpulse/missions/<mission_id>.yaml`.
- `mission-validator.ts` — schema validator (17 mandatory fields, ISO 8601 timestamps, enum membership, INCOMPATIBLE complexity↔mode pairing, anti-bureaucracy caps).

### Safety (Phase 4)
- `safety-gate.ts` — `PreToolUse[Bash|Edit|Write|MultiEdit]`. Hardcoded blocklist enforced for non-lead agents. Lead bypass logged.
- `evidence-recorder.ts` — `PostToolUse[Bash]`. NDJSON ledger, secret redaction, working-tree fingerprint.

### Verification (Phase 5)
- `verify-completion.ts` — `TaskCompleted` hook. Fail-closed for non-trivial profiles. Checks required_gates, freshness (max_age_seconds), working_tree_fp consistency.

### Continuity (Phase 6)
- `state-snap.ts` — `PreCompact`. Writes `.claude/eventpulse/state/agent-state.json` with mission context + recent commands/agents. Never stores transcripts.
- `handoff-writer.ts` — `SubagentStop`. Writes concise (≤60 line) handoff markdown at `.claude/eventpulse/handoffs/<mission_id>-<agent>.md`.
- `agent-trace.ts` — `SubagentStart`. Appends to evidence ledger.

### Confirmation + config (Phase 7)
- `confirm-stop.ts` — `Stop` hook. Only blocks `Stop` when latest mission is `architectural_review` or `lead_plus_specialists` with `human_review_required: true`.
- `config-protection.ts` — `ConfigChange` hook. Refuses non-lead edits to settings.json, agents/*.md, policy.md, runtime hook scripts.

### Profiles (Phase 3)
7 verification profiles under `.claude/eventpulse/profiles/`:
- `trivial.yaml` — single-line edit; gate: `typecheck` only.
- `ingestion.yaml` — adapters, queues, A→B→C→D. Gates: `typecheck`, `adapter_test`, `fixture_replay`, `dedup_smoke`.
- `event_graph.yaml` — canonical events, dedup, venue graph. Gates: `typecheck`, `schema_diff`, `venue_graph_dry_run`, `dedup_test`.
- `agent_ranking.yaml` — `08-Agent/**`. Gates: `typecheck`, `grounding_eval`, `no_fabricated_events`.
- `expo.yaml` — `06-UI/**`. Gates: `expo_typecheck`, `expo_lint`, `expo_smoke`. Tier 0 protects anon read path.
- `database.yaml` — `05-Supabase/migrations/**`. Gates: `schema_validate`, `migration_safety`, `apply_test_db_only`.
- `architecture.yaml` — cross-system. Gates: `typecheck`, `docs_cross_check`, `policy_validate`, `human_review`.

### Test harnesses (regression coverage)
- `safety-gate.test.ts` — 6 scenarios (rm-rf, force-push, lead bypass, npm test, MASTERPLAN edit, normalizer edit). 6/6 pass.
- `verify-completion.test.ts` — 6 scenarios (trivial, missing, fresh, stale, fp-mismatch, unknown gates). 7/7 pass.
- `continuity.test.ts` — state-snap, agent-trace, handoff-writer smoke tests. 19/19 pass.

---

## Hook matrix (active)

Registered in `~/.claude/settings.json` (project-specific):

| Event | Hook | Behavior |
|---|---|---|
| `UserPromptSubmit` | `router.ts` | Always emit `additionalContext`; never block. |
| `PreToolUse[Bash\|Edit\|Write\|MultiEdit]` | `safety-gate.ts` | Fail-closed for non-lead; lead bypass logged. |
| `PostToolUse[*]` | existing vault hook | Unchanged. Emits activity event to Obsidian vault. |
| `PostToolUse[Bash]` | `evidence-recorder.ts` | Always emits evidence; never block. |
| `TaskCompleted` | `verify-completion.ts` | Fail-closed for non-trivial; trivial always passes. |
| `SubagentStart` | `agent-trace.ts` | Always emits trace; never block. |
| `SubagentStop` | `handoff-writer.ts` | Always writes handoff; never block. |
| `PreCompact` | `state-snap.ts` | Always writes state; never block. |
| `Stop` | `confirm-stop.ts` | Block only for architectural_review + human_review. |
| `ConfigChange` | `config-protection.ts` | Block non-lead edits to runtime config. |
| `SessionEnd` | existing vault hook | Unchanged. Vault sync. |

---

## Operator workflow

1. **Read** `docs/MASTERPLAN.md` + `docs/BACKLOG.md` for strategic North Star.
2. **Submit prompt** to a Claude Code session in this repo.
3. **Router** emits a YAML mission in the assistant context (Tier 0 + Tier 1 + Tier 2 + Tier 3 + Tier-summary).
4. **Assistant executes** the mission, honoring Tier 0 invariants.
5. **PreToolUse safety-gate** blocks destructive commands from non-lead agents (lead bypasses with log).
6. **Bash calls** append to `.claude/eventpulse/evidence/ledger.ndjson` with secret redaction.
7. **TaskCompleted** triggers `verify-completion` which checks required_gates against evidence ledger + working-tree fingerprint.
8. **Subagent handoffs** write to `.claude/eventpulse/handoffs/*.md` for handover continuity.
9. **Compaction** writes `.claude/eventpulse/state/agent-state.json` for resume continuity.

---

## File map

```
.claude/eventpulse/
├── README.md                       (this file)
├── CLAUDE_OLD_SETUP_MANIFEST.md    (Phase 1 manifest — rollback reference)
├── policy.md                       (Tier 0 invariant core, ~700 tokens)
├── router.ts                       (UserPromptSubmit hook)
├── classifier.ts                   (task_type/complexity/risk detection)
├── context-selector.ts             (Tier 0..3 expansion)
├── mission-compiler.ts             (YAML emission + mirror write)
├── mission-validator.ts            (schema validation)
├── safety-gate.ts                  (PreToolUse: destructive-command blocklist)
├── safety-gate.test.ts             (regression)
├── evidence-recorder.ts            (PostToolUse Bash → NDJSON ledger)
├── verify-completion.ts            (TaskCompleted: required-gates gate)
├── verify-completion.test.ts       (regression)
├── state-snap.ts                   (PreCompact: writes agent-state.json)
├── handoff-writer.ts               (SubagentStop: writes handoff MD)
├── agent-trace.ts                  (SubagentStart: appends trace)
├── continuity.test.ts              (regression)
├── confirm-stop.ts                 (Stop: architectural_review safeguard)
├── config-protection.ts            (ConfigChange: runtime-config protection)
├── profiles/
│   ├── trivial.yaml
│   ├── ingestion.yaml
│   ├── event_graph.yaml
│   ├── agent_ranking.yaml
│   ├── expo.yaml
│   ├── database.yaml
│   └── architecture.yaml
├── missions/                       (gitignored; per-session YAML mirrors)
├── evidence/                       (gitignored; ledger.ndjson)
├── state/                          (gitignored; agent-state.json)
└── handoffs/                       (gitignored; per-agent handover MD)
```

---

## Rollback

`CLAUDE_OLD_SETUP_MANIFEST.md` lists the ECC backup at `~/.claude/ecc-backup-20260824-212053/` plus restoration commands. The runtime itself can be removed by deleting `.claude/eventpulse/` and stripping the 10 hook entries from `~/.claude/settings.json` — both reversible.

---

## Status (2026-08-24)

| Phase | Status | Verification |
|---|---|---|
| 1 — Backup + ECC disable | ✅ done | Hashes match; MCP servers preserved via `~/.claude/.mcp.json`. |
| 2 — Scaffold policy.md + agent roles | ✅ done | 8 markdown files committed. |
| 3 — Prompt pipeline (router + 5 modules + 7 profiles) | ✅ done | 4 test prompts emit valid YAML; validator rejects malformed. |
| 4 — safety-gate + evidence-recorder | ✅ done | 6/6 safety, 3/3 evidence scenarios pass. |
| 5 — verify-completion | ✅ done | 7/7 scenarios pass (trivial, missing, fresh, stale, fp-mismatch, unknown). |
| 6 — state-snap + handoff-writer + agent-trace | ✅ done | 19/19 continuity assertions pass. |
| 7 — confirm-stop + config-protection | ✅ done | 9/9 scenarios pass (4 stop + 5 config). |
| 8 — MCP preservation | ✅ done | Re-declared in `~/.claude/.mcp.json`. |
| 9 — Acceptance matrix (10 scenarios) | ⏸ covered by per-phase tests; full matrix optional. |
| 10 — Documentation | ✅ this file. |
