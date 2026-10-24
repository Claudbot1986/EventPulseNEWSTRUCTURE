# Agent health

## Sub-features
- Returns `{"ok": true, "phase": 0|1, ...}`
- Always anonymous (no auth)
- Used by readiness probes and the maintenance cron

## How to get to it (user POV)
Not user-facing. The Fly.io health check probes `/agent/health`; the supervisor dashboard calls it on each refresh.

## Driving it with curl

```bash
AGENT_URL="${AGENT_URL:-https://eventpulse-agent.fly.dev}"

curl -fsS --max-time 10 "$AGENT_URL/agent/health"
# → förväntat: {"ok":true,"phase":0}
```

Doctor-grade check: HTTP 200 + `"ok":true`. Anything else means the agent is degraded and downstream drives should be skipped.

## Gotchas
- **`phase` reflects build state, not runtime.** Phase 1 means auth is wired but still off unless the process was launched with Phase-1 env. Drives must read `/agent/health` to confirm both `ok` and the expected `phase` before running user-scoped routes.
- **Latency budget.** `/agent/health` should answer in <500 ms; >2 s means Supabase cold start or rate-limit pressure.
- **Used by `scripts/doctor.sh` (this skill).** Always run doctor before drive to catch this early.