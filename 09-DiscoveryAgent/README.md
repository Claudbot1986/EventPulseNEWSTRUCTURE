# 09 — Discovery Agent

T0095 autonomous discovery agent. Runs daily as the **last step** of
`scripts/cron/runNightly.sh` (~00:16 UTC, after supervisor and ingestion).

> **Heads-up:** the launchd plist `cron/com.eventpulse.discovery.plist` is
> **retired** (since 2026-09-16). Do not `launchctl load` it — the nightly
> chain (`com.eventpulse.ingestion.plist` at 02:00) drives the whole flow.
> `install.sh` is kept for fallback only and starts with the same warning.

## Purpose

Solve the single-point-of-failure: 86% of all events come from a single source
(sthlmlist). The discovery agent finds, heals, and promotes new sources so the
agent has a healthier event graph.

## Three phases

| Phase | When | What it does | Cap |
|---|---|---|---|
| **A. HEAL** | every run | Read failing sources (≥2 consecutiveFailures), pick heal tier, fix | 5 sources/day |
| **B. PROMOTE** | every run | Test unexplored candidates from `discovery-candidates.jsonl`, promote ≥3-event sources via C0+constrainedAgent pipeline | remaining cap slots after HEAL |
| **C. EXPAND** | Mondays only | Exa search for new Stockholm event venues, append to candidates | 5 seeds/week |

## 3-tier heal pipeline

| Tier | Trigger | Action |
|---|---|---|
| **0. Pre-routing skip** (Fas 2.1) | `lastRoutingReason` matches `postB-preC:` or `toolB(preB)` | Return `null` from `pickHealTier` → `healOne` logs `deferred` and skips the daily slot. Pre-routing API failures are not healable; the operator needs to address them upstream. |
| **1. Transport** | `lastRoutingReason` matches `Fetch failed`, `ENOTFOUND`, `ETIMEDOUT`, `ECONNRESET` | `renderPage()` via ScrapingBee → count JSON-LD events → `updateSourceStatus({status: 'success', lastPathUsed: 'render'})` |
| **2. No-jsonld** | `lastRoutingReason` matches `no-jsonld`, `no events`, `empty`, `0 events` | `discoverEventCandidates()` → if winner: `runPipeline({sourceId, url: winner.url})` → save adapter → mark `pendingNextTool: 'D-renderGate'` |
| **3. Retire** | `consecutiveFailures ≥ 5` AND `lastSuccess` > 30 days ago | Append to `retired.jsonl` (audit-only). Never deletes from `sources/`. |

## File map

| File | Purpose |
|---|---|
| `eval.ts` | Self-eval helpers — read failing sources, append audit logs, mark candidates tested |
| `heal.ts` | 3-tier heal pipeline (`healOne(failing, opts)`) |
| `promote.ts` | Promote candidate → source (`promoteOne(candidate, opts)`) |
| `expand.ts` | Weekly Exa seed expansion (`expandSeeds({force, maxNew})`) |
| `agent.ts` | Orchestrator (`runAgent({cap, dryRun, forceExpand})`) |
| `cron/runDaily.sh` | Bash wrapper called by launchd |
| `cron/com.eventpulse.discovery.plist` | launchd job (Hour=4 Minute=30) |
| `install.sh` | Idempotent loader (`launchctl bootstrap`) |
| `tests/agent.test.ts` | Unit tests for tier selection + dedup |

## Audit logs (append-only)

All writes land in `runtime/discovery-agent/`:

| File | Schema |
|---|---|
| `runs.jsonl` | `{ts, phase, sourceId?, candidateUrl?, tier?, durationMs, before, after, error?, dryRun?}` |
| `promoted.jsonl` | `{ts, sourceId, url, eventsFound, candidateOrigin, approvedBy}` |
| `retired.jsonl` | `{ts, sourceId, reason, consecutiveFailures, lastSuccess, movedFrom}` |
| `daily-YYYY-MM-DD.log` | Human-readable cron log |

## CLI usage

```bash
# Dry-run (no side-effects, no audit logs)
npx tsx 09-DiscoveryAgent/agent.ts --dry

# Custom cap
npx tsx 09-DiscoveryAgent/agent.ts --cap=2

# Force expansion (skip Monday gate)
npx tsx 09-DiscoveryAgent/agent.ts --force-expand

# Same via env
MAX=2 DRY_RUN=1 npx tsx 09-DiscoveryAgent/agent.ts
```

## Install / uninstall

> **Retired path.** The launchd plist is no longer the active scheduler. The
> agent is invoked by `scripts/cron/runNightly.sh` after ingestion + supervisor.
> `install.sh` is kept only as a fallback if the nightly chain is disabled.

```bash
# Install (only if you intentionally bypass the nightly chain)
bash 09-DiscoveryAgent/install.sh

# Verify (only meaningful if you bypassed the nightly chain)
launchctl list | grep com.eventpulse.discovery

# Uninstall
bash 09-DiscoveryAgent/install.sh --uninstall
```

## Constraints (enforced)

- **Max 5 actionable sources touched per day** (all phases combined) — Fas 3 (2026-09-24): only `recovered` / `adapter_saved` / `retired` / `promoted` count as a slot. Deferred-results from heal (e.g. tier-0 skip, no winner, validation fail) cost 0 slots, so promote still gets budget when heal is no-op. Hard cap `maxHealAttempts = max(cap × 3, 15)` prevents runaway.
- **60s timeout per source** (render-gate or fetch)
- **No LLM decisions outside `constrainedAgent.runPipeline`** (already deployed)
- **All writes audited** in `runtime/discovery-agent/*.jsonl`
- **Retire is audit-only** — moves entry to `retired.jsonl`, never touches `sources/`
- **No source overwrites** — promote creates new files, slug collisions get `-2`, `-3` suffix
- **Cron-friendly exit** — agent always exits 0; failures logged but not propagated

## Safety vent

If discovery-agent promotes a source that gives 0 events after 3 days, the
retire pipeline picks it up the following week. Self-healing via feedback loop.

## Verification checklist

```bash
# 1. Module loads
npx tsx -e "import('./09-DiscoveryAgent/agent.js').then(m => console.log(Object.keys(m)))"

# 2. Tier selection works
npx tsx -e "
import('./09-DiscoveryAgent/eval.js').then(m => {
  console.log(m.pickHealTier({consecutiveFailures: 5, lastSuccess: null, lastRoutingReason: 'no-jsonld'})); // → 3
  console.log(m.pickHealTier({consecutiveFailures: 3, lastSuccess: null, lastRoutingReason: 'Fetch failed'})); // → 1
});
"

# 3. Dry-run (no FS writes)
MAX=1 DRY_RUN=1 npx tsx 09-DiscoveryAgent/agent.ts

# 4. Live test with small cap
MAX=2 npx tsx 09-DiscoveryAgent/agent.ts

# 5. Check audit logs
tail -f runtime/discovery-agent/runs.jsonl
```
