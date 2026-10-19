# orchestrator-rundaily

`09-ScrapingSupervisor/runDaily.ts` — launchd-vänlig wrapper som kör supervisor + ingestionPipeline + dränerar worker-kön i 15 min. Skriver daglig log + per-run summary till `runtime/ingestion_runs.jsonl`.

## Sub-features

- 3 subprocesses: `supervisor.ts` (source health) → `ingestionPipeline.ts` (data flow) → `startWorker.ts` (drain, tidsbegränsad 15 min)
- `parseRunStats(stdout)` extraherar `sourcesAttempted` (från sista `[N/M]`) och `totalEventsFound` (från `KLAR │ N events till bullmq`)
- `writeIngestionRunSummary` skriver `{runId, triggerSource: 'daily', startTs, endTs, ok, sourcesAttempted, totalEventsFound, totalEventsPersisted, stagesCompleted}` till `runtime/ingestion_runs.jsonl`
- Worker-drain: SIGTERM efter 15 min, hanterar `signal==='SIGTERM'` som exit=0 (förväntad drain-timeout)
- Per-dag log: `runtime/scraping-supervisor/daily-<YYYY-MM-DD>.log`

## How to get to it (user POV)

Användaren ser runDaily som "dagens ingestion-rapport". Dashboard 7777 läser `runtime/ingestion_runs.jsonl` (via `02-Ingestion/tools/runRecorder.ts:readRecentIngestionRuns`) och visar senaste körningen. Tidigare bugg: 0/0-räknare — fixad 2026-10-18 med `parseRunStats`.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. Senaste dagliga körning
tail -1 runtime/ingestion_runs.jsonl | jq -r '"\(.startTs) trigger=\(.triggerSource) ok=\(.ok) attempted=\(.sourcesAttempted) found=\(.totalEventsFound)"'

# 2. Senaste 5 körningar (alla triggers)
tail -5 runtime/ingestion_runs.jsonl | jq -r '"\(.startTs) \(.triggerSource) ok=\(.ok) attempted=\(.sourcesAttempted)"'

# 3. chain-overview step-end för daily-triggern
jq -r 'select(.event=="step-end" and .step=="ingestionPipeline") | .exitCode' \
  runtime/ingestion-cron/chain-overview.log | tail -3
# → exit=0 (pipeline OK även om 0 events)

# 4. Worker-drain timing
jq -r 'select(.event=="step-end" and .step=="startWorker-drain") | "duration=\(.durationMs)ms"' \
  runtime/ingestion-cron/chain-overview.log | tail -3
# → duration ≤ 900000ms (15 min cap)

# 5. log per dag
ls -t runtime/scraping-supervisor/daily-*.log | head -3 | xargs -I {} sh -c 'echo "=== {} ===" && tail -10 {}'
```

Bevis: `runtime/ingestion_runs.jsonl` + `runtime/scraping-supervisor/daily-<DATE>.log` + chain-overview step-end.

## Gotchas

**Trigger-source `daily` ≠ `cron`** — samma pipeline, olika orkestrator. `ingestion_runs.jsonl` har båda; filtrera på `.triggerSource == "daily"` för att se runDaily-resultat.

**parseRunStats är brittle** — matchar `[N/M]`-mönster (sista N är totalen) och `N events till bullmq`. Om `ingestionPipeline.ts` ändrar log-format → siffrorna blir 0 tyst.

**Worker-drain-timeout (15 min) signal-hantering** (rad 115) — `signal === 'SIGTERM' || timedOut → exitCode = 0`. Tidigare maskade INTE signalen → falska FAIL varje natt. Verifierat 2026-09-15.

**Stdout-capture: max 50 KB** (runt `runSubprocess` rad 136-137) — om pipeline skriver mer → bara sista 50 KB syns i summary-extrahering. Långa pipelines kan tappa `[N/M]`-raden om den kommer för tidigt.

**`--limit` läses från CLI** men inte forwarded till subprocesses — de har egna defaultvärden. `runDaily` kör alltid med full default.