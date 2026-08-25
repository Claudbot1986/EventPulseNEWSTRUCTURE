# AUTONOMOUS-QUARANTINE

Temporary isolation of EventPulse Phase 1/2 autonomy (Claude Code wrapper + mobile control + watchdog).

Isolated: **2026-08-22**. Do not start these jobs until this folder is restored.

## What is here

| Original path | Now |
|---|---|
| `scripts/autonomous-loop.sh` | `scripts/autonomous-loop.sh` |
| `scripts/install-autonomous-loop.sh` | `scripts/install-autonomous-loop.sh` |
| `scripts/com.eventpulse.autonomous.plist` | `scripts/com.eventpulse.autonomous.plist` |
| `scripts/run-watchdog.sh` | `scripts/run-watchdog.sh` |
| `scripts/install-watchdog.sh` | `scripts/install-watchdog.sh` |
| `scripts/com.eventpulse.watchdog.plist` | `scripts/com.eventpulse.watchdog.plist` |
| `scripts/start-mobile-control.sh` | `scripts/start-mobile-control.sh` |
| `scripts/stop-mobile-control.sh` | `scripts/stop-mobile-control.sh` |
| `scripts/autonomous-activity-hook.js` | `scripts/autonomous-activity-hook.js` |
| `09-MobileControl/` | `09-MobileControl/` |
| `.claude/commands/resume.md` | `.claude/commands/resume.md` |
| `.claude/commands/start.md` | `.claude/commands/start.md` |
| `docs/AUTONOMOUS-LOOP.md` | `docs/AUTONOMOUS-LOOP.md` |
| `docs/AUTONOMY-IMPLEMENTATION-REPORT.md` | `docs/AUTONOMY-IMPLEMENTATION-REPORT.md` |
| `docs/PHASE1-AUDIT.md` | `docs/PHASE1-AUDIT.md` |
| `CLAUDE.md` § Autonomous Execution Loop | `claude-md/Autonomous-Execution-Loop.md` |
| `~/Library/LaunchAgents/com.eventpulse.autonomous.plist` | `installed-launchagents/` |
| `~/Library/LaunchAgents/com.eventpulse.watchdog.plist` | `installed-launchagents/` |

Original paths in the repo now hold **stubs** that refuse to run (the activity hook stub exits 0 so Claude Code hooks do not fail).

## Left in place (not this system)

- `02-Ingestion/C-htmlGate/123-autonomous-loop*.ts` — C-htmlGate batch loop
- `09-DiscoveryAgent` — daily discovery cron
- `~/.claude/agents/{lead,work,vault-sync}.md` — interactive agent roles
- `runtime/autonomous-loop/` — leftover logs + `STOP` + `QUARANTINED` marker

## Restore

From project root:

```bash
Q=AUTONOMOUS-QUARANTINE

# Remove stubs that occupy original paths, then:
git mv "$Q/scripts/"* scripts/
git mv "$Q/docs/"* docs/
git mv "$Q/.claude/commands/"* .claude/commands/
git mv "$Q/09-MobileControl" 09-MobileControl

# Put CLAUDE.md section back from claude-md/Autonomous-Execution-Loop.md
cp "$Q/installed-launchagents/"*.plist ~/Library/LaunchAgents/
# launchctl load only if you actually want the loop running again
```
