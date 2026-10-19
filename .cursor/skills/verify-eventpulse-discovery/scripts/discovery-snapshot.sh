#!/usr/bin/env bash
# discovery-snapshot.sh — full evidence capture från discovery-pipeline.
# Kör Doctor + driver alla 5 steg-mönster (latest-stage, tribe-events, p3a-p3c, runDaily).
# Skriver runtime/verification-reports/discovery-snapshot-<TS>.json.
# Dödar aldrig processer; startar aldrig nya körningar.

set -u
# Script bor på .cursor/skills/verify-eventpulse-discovery/scripts/
# → 4 nivåer upp når EventPulse-roten.
cd "$(dirname "$0")/../../../.."
PROJECT_ROOT="$(pwd)"

TS=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
OUT="runtime/verification-reports/discovery-snapshot-${TS}.json"
mkdir -p runtime/verification-reports

python3 - "$OUT" "$PROJECT_ROOT" <<'PY'
import json, datetime, os, sys, glob, pathlib, subprocess

out_path, root = sys.argv[1], pathlib.Path(sys.argv[2])
chain = root / "runtime/ingestion-cron/chain-overview.log"
status_file = root / "runtime/ingestion-cron.status.json"
runs_file = root / "runtime/ingestion_runs.jsonl"

result = {
    "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "sections": {},
}

# Section A: latest stages from chain-overview.log
if chain.exists():
    events = [json.loads(l) for l in chain.read_text().splitlines() if l.strip()]
    starts = [e for e in events if e["event"] == "step-start"]
    ends = [e for e in events if e["event"] == "step-end"]
    hbs = [e for e in events if e["event"] == "heartbeat"]

    # sista 20 steg-start/steg-end
    result["sections"]["latest_25_steps"] = {
        "starts": starts[-25:],
        "ends": ends[-25:],
        "total_starts": len(starts),
        "total_ends": len(ends),
        "total_heartbeats": len(hbs),
    }
else:
    result["sections"]["latest_25_steps"] = {"error": "chain-log-missing"}

# Section B: hung detection (samma logik som doctor)
if chain.exists():
    last_end = {}
    last_start = {}
    hb_count = {}
    for e in events:
        s = e.get("step")
        if not s: continue
        if e["event"] == "step-end": last_end[s] = e["ts"]
        if e["event"] == "step-start": last_start[s] = e["ts"]
        if e["event"] == "heartbeat": hb_count[s] = hb_count.get(s, 0) + 1
    hung = [s for s in last_start
            if (not last_end.get(s) or last_start[s] > last_end.get(s, ""))
            and hb_count.get(s, 0) > 5]
    result["sections"]["hung_stages"] = {
        "hung": hung,
        "heartbeat_counts": {s: c for s, c in hb_count.items() if c > 3},
    }

# Section C: tribe-events senaste log
tribe_logs = sorted(glob.glob(str(root / "runtime/ingestion-cron/steps/tribe-events-*.log")))
if tribe_logs:
    latest = tribe_logs[-1]
    text = pathlib.Path(latest).read_text(errors="replace")
    urls = [l for l in text.splitlines() if "/wp-json/tribe/events/v1/events" in l]
    url_counts = {}
    for l in urls:
        # Plocka URL:en ur raden (före whitespace efter URL)
        u = l.split()[0] if l.split() else ""
        url_counts[u] = url_counts.get(u, 0) + 1
    top = sorted(url_counts.items(), key=lambda x: -x[1])[:5]
    result["sections"]["tribe_latest"] = {
        "log_path": os.path.relpath(latest, root),
        "size_bytes": len(text),
        "top_urls": [{"url": u, "count": c} for u, c in top],
        "hang_suspected": any(c >= 5 for _, c in top),
        "tail": text.splitlines()[-3:] if text else [],
    }
else:
    result["sections"]["tribe_latest"] = {"error": "no-tribe-log"}

# Section D: status.json heartbeat age
if status_file.exists():
    s = json.loads(status_file.read_text())
    h = s.get("lastHeartbeatAt") or s.get("startedAt")
    if h:
        t = datetime.datetime.fromisoformat(h.replace("Z", "+00:00"))
        age = (datetime.datetime.now(datetime.timezone.utc) - t).total_seconds()
        result["sections"]["heartbeat"] = {
            "age_seconds": round(age),
            "stale": age > 7200,
            "running": s.get("running"),
            "pid": s.get("pid"),
            "steps_total": len(s.get("steps", [])),
            "totalEventsExtracted": s.get("totalEventsExtracted"),
        }

# Section E: senaste runDaily summary
if runs_file.exists():
    lines = runs_file.read_text().splitlines()
    daily = []
    for l in lines[-200:]:
        try:
            d = json.loads(l)
            if d.get("triggerSource") == "daily":
                daily.append(d)
        except Exception:
            pass
    if daily:
        last_run = daily[-1]
        result["sections"]["last_daily_run"] = {
            "runId": last_run.get("runId"),
            "startTs": last_run.get("startTs"),
            "ok": last_run.get("ok"),
            "sourcesAttempted": last_run.get("sourcesAttempted"),
            "sourcesSucceeded": last_run.get("sourcesSucceeded"),
            "sourcesFailed": last_run.get("sourcesFailed"),
            "totalEventsFound": last_run.get("totalEventsFound"),
            "totalEventsPersisted": last_run.get("totalEventsPersisted"),
            "durationMs": last_run.get("durationMs"),
        }

# Section F: levande discovery-processer
try:
    r = subprocess.run(["ps", "auxww"], capture_output=True, text=True)
    procs = [l for l in r.stdout.splitlines()
             if any(p in l for p in ("scripts/ingest-", "scripts/discover-",
                                      "07-Discovery/src", "discover-subpaths",
                                      "discover-hidden"))
             and "grep" not in l]
    result["sections"]["living_processes"] = {
        "count": len(procs),
        "sample": procs[:5],
    }
except Exception as e:
    result["sections"]["living_processes"] = {"error": str(e)}

with open(out_path, "w") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

print(f"[discovery-snapshot] wrote {out_path}")
sys.exit(0)
PY