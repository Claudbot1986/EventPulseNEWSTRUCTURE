#!/usr/bin/env bash
# optimizer-supervisor.sh — Phase L-F.2 supervisor loop
#
# Per master-prompt §46: bash-supervisor som körs via launchd KeepAlive.
# Per K3: event-/queue-driven, ingen StartInterval polling.
#
# Logik:
#   1. canonical-path-guard — avbryt om project_root fel
#   2. volume-availability check — sleep om volym ej monterad
#   3. recover-optimizer — klassificera state, åtgärda
#   4. läs queue.ndjson — om job finns och state idle → starta worker i tmux
#   5. uppdatera heartbeat
#   6. exit 0 → launchd KeepAlive startar om vid nästa event
#
# Användning:
#   bash optimizer-supervisor.sh

set -euo pipefail

REPO_ROOT="${EP_REPO_ROOT:-/Volumes/2TB filer/NEWSTRUCTURE-COPY}"
OPT_DIR="$REPO_ROOT/.claude/eventpulse/learning/optimizer"
SCRIPT_DIR="$OPT_DIR/scripts"
LOG_DIR="${EP_OPT_LOG_DIR:-/Users/claudgashi/Library/Logs/eventpulse-optimizer}"
TMUX_SESSION="${EP_OPT_TMUX_SESSION:-ep-optimizer}"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [supervisor] $*" >> "$LOG_DIR/supervisor.log"
}

# 1. canonical-path-guard
if ! npx --prefix "$REPO_ROOT" tsx "$SCRIPT_DIR/canonical-path-guard.ts" >> "$LOG_DIR/canonical-path-guard.log" 2>&1; then
  log "ERROR: canonical-path-guard failed — halting"
  exit 0
fi

# 2. project volume availability
if [[ ! -d "$REPO_ROOT" ]]; then
  log "project_root missing: $REPO_ROOT — sleeping"
  exit 0
fi

# 3. recover-optimizer (read-only classification; --apply is supervisor's call)
RECOVERY=$(npx --prefix "$REPO_ROOT" tsx "$SCRIPT_DIR/recover-optimizer.ts" --json 2>/dev/null || echo '{"state":"requires_human","reason":"recovery script crashed"}')
RECOVERY_STATE=$(echo "$RECOVERY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('state','requires_human'))" 2>/dev/null || echo "requires_human")
log "recovery state=$RECOVERY_STATE"

case "$RECOVERY_STATE" in
  requires_human)
    log "halted: requires_human"
    exit 0
    ;;
  needs_cleanup)
    log "applying cleanup"
    npx --prefix "$REPO_ROOT" tsx "$SCRIPT_DIR/recover-optimizer.ts" --apply >> "$LOG_DIR/recovery.log" 2>&1 || log "ERROR: cleanup failed"
    ;;
  retry_safe)
    log "applying retry"
    npx --prefix "$REPO_ROOT" tsx "$SCRIPT_DIR/recover-optimizer.ts" --apply >> "$LOG_DIR/recovery.log" 2>&1 || log "ERROR: retry-apply failed"
    ;;
  resume_safe)
    : # healthy, continue
    ;;
esac

# 4. read queue
QUEUE_FILE="$OPT_DIR/queue.ndjson"
if [[ ! -f "$QUEUE_FILE" ]]; then
  log "no queue file — idle"
  exit 0
fi

# Check if state is busy (active_job_id set)
STATE_FILE="$OPT_DIR/state.json"
if [[ -f "$STATE_FILE" ]]; then
  ACTIVE=$(python3 -c "
import json, sys
try:
  d=json.load(open('$STATE_FILE'))
  print(d.get('active_job_id') or '')
except: print('')
")
  if [[ -n "$ACTIVE" ]]; then
    log "state busy (active=$ACTIVE) — heartbeat update only"
    # heartbeat refresh
    python3 -c "
import json, datetime
p='$STATE_FILE'
d=json.load(open(p))
d['last_heartbeat_at']=datetime.datetime.utcnow().isoformat()+'Z'
d['supervisor_pid']=$(echo $$)
d['last_updated']=datetime.datetime.utcnow().isoformat()+'Z'
tmp=p+'.tmp'
open(tmp,'w').write(json.dumps(d, indent=2))
import os; os.rename(tmp, p)
"
    exit 0
  fi
fi

# Find first queued job
JOB_ID=$(python3 -c "
import json
try:
  with open('$QUEUE_FILE') as f:
    for line in f:
      line=line.strip()
      if not line: continue
      j=json.loads(line)
      if j.get('status')=='queued':
        print(j['job_id']); break
except: pass
")
if [[ -z "$JOB_ID" ]]; then
  log "queue empty — idle"
  exit 0
fi

log "found queued job=$JOB_ID — ensuring tmux + worker"

# 5. ensure tmux session
if ! command -v tmux >/dev/null 2>&1; then
  log "ERROR: tmux not installed"
  exit 0
fi

if ! tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  log "creating tmux session $TMUX_SESSION"
  tmux new-session -d -s "$TMUX_SESSION" -c "$REPO_ROOT" "EP_REPO_ROOT='$REPO_ROOT' EP_OPT_TMUX_SESSION='$TMUX_SESSION' EP_OPT_LOG_DIR='$LOG_DIR' EP_OPT_WORKTREE_DIR='${EP_OPT_WORKTREE_DIR:-/tmp/ep-optimizer-worktree}' bash '$SCRIPT_DIR/optimizer-worker.sh' '$JOB_ID'"
else
  log "tmux session already exists; sending kick to worker for job=$JOB_ID"
  # If session exists with stale worker, send a new kickstart signal
  tmux send-keys -t "$TMUX_SESSION" "EP_REPO_ROOT='$REPO_ROOT' EP_OPT_TMUX_SESSION='$TMUX_SESSION' EP_OPT_LOG_DIR='$LOG_DIR' EP_OPT_WORKTREE_DIR='${EP_OPT_WORKTREE_DIR:-/tmp/ep-optimizer-worktree}' bash '$SCRIPT_DIR/optimizer-worker.sh' '$JOB_ID'" Enter
fi

# 6. mark state busy
python3 -c "
import json, datetime
p='$STATE_FILE'
try: d=json.load(open(p))
except: d={'schema_version':'ep-optimizer-state-1.0','total_jobs_processed':0,'total_jobs_succeeded':0,'total_jobs_failed':0,'total_cost_usd':0}
d['active_job_id']='$JOB_ID'
d['active_started_at']=datetime.datetime.utcnow().isoformat()+'Z'
d['last_heartbeat_at']=datetime.datetime.utcnow().isoformat()+'Z'
d['state']='busy'
d['supervisor_pid']=$(echo $$)
d['last_updated']=datetime.datetime.utcnow().isoformat()+'Z'
tmp=p+'.tmp'
open(tmp,'w').write(json.dumps(d, indent=2))
import os; os.rename(tmp, p)
"

log "supervisor cycle complete (job=$JOB_ID)"
exit 0
