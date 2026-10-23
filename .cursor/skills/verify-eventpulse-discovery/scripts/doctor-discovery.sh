#!/usr/bin/env bash
# doctor-discovery.sh — read-only check att discovery-pipelinen är värd att verifiera.
# Skriver runtime/verification-reports/discovery-doctor-<TS>.json.
# Dödar aldrig processer; startar aldrig nya körningar.

set -u
# Script bor på .cursor/skills/verify-eventpulse-discovery/scripts/
# → 4 nivåer upp når EventPulse-roten.
cd "$(dirname "$0")/../../../.."
PROJECT_ROOT="$(pwd)"

TS=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
OUT="runtime/verification-reports/discovery-doctor-${TS}.json"
mkdir -p runtime/verification-reports

python3 - "$OUT" "$PROJECT_ROOT" <<'PY'
import json, datetime, os, sys, subprocess, pathlib

out_path, root = sys.argv[1], pathlib.Path(sys.argv[2])
status_file = root / "runtime/ingestion-cron.status.json"
chain = root / "runtime/ingestion-cron/chain-overview.log"
watchdog = root / "runtime/ingestion-cron/watchdog.json"

result = {
    "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "checks": {},
}

# 1. Dashboard reachable?
try:
    r = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                        "http://localhost:7777/api/ingestion/status"],
                       capture_output=True, text=True, timeout=3)
    result["checks"]["dashboard_reachable"] = {"ok": r.stdout == "200",
                                                "http_code": r.stdout}
except Exception as e:
    result["checks"]["dashboard_reachable"] = {"ok": False, "error": str(e)}

# 2. Levande discovery-processer
try:
    r = subprocess.run(["ps", "auxww"], capture_output=True, text=True)
    procs = [l for l in r.stdout.splitlines()
             if any(p in l for p in ("scripts/ingest-", "scripts/discover-",
                                      "07-Discovery/src", "discover-subpaths",
                                      "discover-hidden"))
             and "grep" not in l]
    result["checks"]["living_discovery_processes"] = {
        "ok": len(procs) <= 1,
        "count": len(procs),
        "sample": procs[:3],
    }
except Exception as e:
    result["checks"]["living_discovery_processes"] = {"ok": None, "error": str(e)}

# 3. status.json heartbeat age
if status_file.exists():
    try:
        s = json.loads(status_file.read_text())
        h = s.get("lastHeartbeatAt") or s.get("startedAt")
        if h:
            t = datetime.datetime.fromisoformat(h.replace("Z", "+00:00"))
            age = (datetime.datetime.now(datetime.timezone.utc) - t).total_seconds()
            running = bool(s.get("running"))
            # En AVSLUTAD körning har per definition en gammal heartbeat.
            # Åldern är bara ett felsignal när processen påstår köra.
            # Räkna i stället hur många steg som faktiskt avslutade.
            finished = sum(1 for st in s.get("steps", []) if st.get("exitCode") is not None)
            result["checks"]["heartbeat"] = {
                "ok": (age < 7200) if running else True,
                "running": running,
                "age_seconds": round(age),
                "age_matters": running,
                "pid": s.get("pid"),
                "steps": len(s.get("steps", [])),
                "steps_finished": finished,
                "note": None if running else "senaste körningen avslutad — heartbeat-ålder är förväntad",
            }
        else:
            result["checks"]["heartbeat"] = {"ok": False, "reason": "no timestamps"}
    except Exception as e:
        result["checks"]["heartbeat"] = {"ok": False, "error": str(e)}
else:
    result["checks"]["heartbeat"] = {"ok": False, "reason": "status-file-missing"}

# 4. Hung stages (step-start utan step-end, >5 heartbeats)
if chain.exists():
    try:
        events = [json.loads(l) for l in chain.read_text().splitlines() if l.strip()]
        last_end = {}
        last_start = {}
        hb = {}
        for e in events:
            s = e.get("step")
            if not s: continue
            if e["event"] == "step-end": last_end[s] = e["ts"]
            if e["event"] == "step-start": last_start[s] = e["ts"]
            if e["event"] == "heartbeat": hb[s] = hb.get(s, 0) + 1
        hung = [s for s in last_start
                if (not last_end.get(s) or last_start[s] > last_end.get(s, ""))
                and hb.get(s, 0) > 5]
        result["checks"]["hung_stages"] = {
            "ok": len(hung) == 0,
            "hung": hung,
            "heartbeat_counts": {s: c for s, c in hb.items() if c > 3},
        }
    except Exception as e:
        result["checks"]["hung_stages"] = {"ok": None, "error": str(e)}
else:
    result["checks"]["hung_stages"] = {"ok": None, "reason": "chain-log-missing"}

# 5. Watchdog alive?
#    Fältet är `checkedAt` (inte `lastCheck`), och filen innehåller INTE
#    `stalenessMin` — den thrasolden ligger i watchdog-scriptet, inte i state-filen.
if watchdog.exists():
    try:
        w = json.loads(watchdog.read_text())
        last = w.get("checkedAt")
        if last:
            t = datetime.datetime.fromisoformat(last.replace("Z", "+00:00"))
            age = (datetime.datetime.now(datetime.timezone.utc) - t).total_seconds()
            result["checks"]["watchdog"] = {
                "ok": age < 300,
                "age_seconds": round(age),
                "watchdog_ok": w.get("ok"),
                "watchdog_reasons": w.get("reasons"),
                "chain_pid_alive": w.get("chainPidAlive"),
            }
        else:
            result["checks"]["watchdog"] = {"ok": False, "reason": "no checkedAt"}
    except Exception as e:
        result["checks"]["watchdog"] = {"ok": False, "error": str(e)}
else:
    result["checks"]["watchdog"] = {"ok": None, "reason": "watchdog-missing"}

# Overall verdict
all_critical_ok = all(
    v.get("ok") for k, v in result["checks"].items()
    if k in ("dashboard_reachable", "hung_stages")
)
result["overall"] = "ok" if all_critical_ok else "investigate"

with open(out_path, "w") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

print(f"[doctor-discovery] wrote {out_path}")
print(f"[doctor-discovery] overall = {result['overall']}")
for k, v in result["checks"].items():
    ok = v.get("ok")
    flag = "OK " if ok else ("NO " if ok is False else "?? ")
    print(f"  {flag}{k}: {json.dumps(v, ensure_ascii=False)[:120]}")

sys.exit(0 if result["overall"] == "ok" else 1)
PY