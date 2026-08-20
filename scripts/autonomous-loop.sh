#!/bin/bash
# autonomous-loop.sh — supervised-restart wrapper for Claude Code.
#
# Chains Claude Code sessions via vault state. Each iteration:
#   1. Invokes `claude --print /resume` (single-shot, budget-bounded).
#   2. The agent reads vault state, picks next P0/P1/P2/P3 task, executes
#      ONE meaningful unit, commits, exits.
#   3. Wrapper restarts after a short delay. State persists in vault —
#      no in-process memory carries over, but progress is durable.
#
# Bypasses the literal "10 hours in one session" limit by replacing it with
# "10 hours × N sessions, each ≤30 min, each ending in a git commit + vault
# sync". The user can start this and walk away for hours.
#
# Safety caps (all env-overridable):
#   MAX_RESTARTS=1000          Max iterations before stopping.
#   MAX_TOTAL_HOURS=24         Max wall-clock runtime.
#   MAX_BUDGET_PER_ITER=5      USD per claude --print call.
#   ITERATION_TIMEOUT_MIN=30   Hard kill if claude hangs.
#   RESTART_DELAY=3            Seconds between iterations.
#
# Logs: $LOG_DIR/loop.log, $LOG_DIR/iter-N.json, $LOG_DIR/iter-N.err.
# State: $LOG_DIR/state.json (JSON, last-iteration summary).
#
# Usage:
#   scripts/autonomous-loop.sh           # run in foreground (Ctrl-C to stop)
#   scripts/autonomous-loop.sh --check   # show current state and exit
#   scripts/autonomous-loop.sh --stop    # signal running wrapper to exit

set -u

PROJECT_ROOT="${PROJECT_ROOT:-/Volumes/2TB filer/NEWSTRUCTURE-COPY}"
LOG_DIR="${LOG_DIR:-$PROJECT_ROOT/runtime/autonomous-loop}"
LOG_FILE="$LOG_DIR/loop.log"
STATE_FILE="$LOG_DIR/state.json"
PID_FILE="$LOG_DIR/wrapper.pid"
STOP_FILE="$LOG_DIR/STOP"

MAX_RESTARTS="${MAX_RESTARTS:-1000}"
MAX_TOTAL_HOURS="${MAX_TOTAL_HOURS:-24}"
MAX_BUDGET_PER_ITER="${MAX_BUDGET_PER_ITER:-5}"
ITERATION_TIMEOUT_MIN="${ITERATION_TIMEOUT_MIN:-30}"
RESTART_DELAY="${RESTART_DELAY:-3}"

mkdir -p "$LOG_DIR"
cd "$PROJECT_ROOT" || { echo "cannot cd to $PROJECT_ROOT" >&2; exit 1; }

# --- subcommands ----------------------------------------------------------

cmd_check() {
  if [ -f "$STATE_FILE" ]; then
    echo "=== autonomous-loop state ==="
    cat "$STATE_FILE"
    echo
    echo "=== last 10 log lines ==="
    tail -10 "$LOG_FILE" 2>/dev/null || echo "(no log)"
    if [ -f "$PID_FILE" ]; then
      pid=$(cat "$PID_FILE")
      if kill -0 "$pid" 2>/dev/null; then
        echo
        echo "=== wrapper is RUNNING (pid=$pid) ==="
      else
        echo
        echo "=== wrapper PID file stale (pid=$pid not alive) ==="
      fi
    else
      echo
      echo "=== wrapper is NOT RUNNING ==="
    fi
  else
    echo "no state yet — wrapper has never been started in $LOG_DIR"
  fi
}

cmd_stop() {
  touch "$STOP_FILE"
  if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid"
      echo "sent SIGTERM to wrapper pid=$pid"
    fi
  fi
  echo "stop flag written at $STOP_FILE — wrapper will exit on next check"
}

case "${1:-}" in
  --check) cmd_check; exit 0 ;;
  --stop)  cmd_stop;  exit 0 ;;
esac

# --- main loop ------------------------------------------------------------

# Refuse to start if another wrapper is already running.
if [ -f "$PID_FILE" ]; then
  existing=$(cat "$PID_FILE")
  if kill -0 "$existing" 2>/dev/null; then
    echo "wrapper already running with pid=$existing — refusing to start"
    echo "use '$0 --check' to inspect or '$0 --stop' to stop"
    exit 1
  fi
  rm -f "$PID_FILE"
fi

# Initialize state.
if [ ! -f "$STATE_FILE" ]; then
  cat > "$STATE_FILE" <<EOF
{
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "iteration": 0,
  "last_status": "starting",
  "max_restarts": $MAX_RESTARTS,
  "max_total_hours": $MAX_TOTAL_HOURS
}
EOF
fi

# Trap signals — clean up and exit.
cleanup() {
  rm -f "$PID_FILE"
  echo "$(date) wrapper exiting (signal)" >> "$LOG_FILE"
  exit 0
}
trap cleanup INT TERM

echo $$ > "$PID_FILE"
START_TS=$(date +%s)
echo "$(date) autonomous-loop start — project=$PROJECT_ROOT max_restarts=$MAX_RESTARTS max_hours=$MAX_TOTAL_HOURS budget_per_iter=\$$MAX_BUDGET_PER_ITER timeout=${ITERATION_TIMEOUT_MIN}m" >> "$LOG_FILE"

for i in $(seq 1 "$MAX_RESTARTS"); do
  # Stop-flag check.
  if [ -f "$STOP_FILE" ]; then
    echo "$(date) STOP file detected — exiting cleanly" >> "$LOG_FILE"
    rm -f "$STOP_FILE" "$PID_FILE"
    exit 0
  fi

  # Total-runtime check.
  NOW_TS=$(date +%s)
  ELAPSED_HOURS=$(( (NOW_TS - START_TS) / 3600 ))
  if [ "$ELAPSED_HOURS" -ge "$MAX_TOTAL_HOURS" ]; then
    echo "$(date) max total runtime ${MAX_TOTAL_HOURS}h reached — stopping" >> "$LOG_FILE"
    break
  fi

  echo "$(date) iter=$i elapsed=${ELAPSED_HOURS}h — invoking claude --print /resume (budget=\$$MAX_BUDGET_PER_ITER timeout=${ITERATION_TIMEOUT_MIN}m)" >> "$LOG_FILE"

  # Single-shot Claude invocation. /resume reads vault state, picks next
  # task, executes one meaningful unit, commits, exits.
  timeout "${ITERATION_TIMEOUT_MIN}m" claude --print \
    --max-budget-usd "$MAX_BUDGET_PER_ITER" \
    --output-format json \
    "/resume" > "$LOG_DIR/iter-$i.json" 2> "$LOG_DIR/iter-$i.err"
  rc=$?

  echo "$(date) iter=$i exit=$rc" >> "$LOG_FILE"

  # Update state atomically. Read prior started_at so it survives across iters.
  PRIOR_STARTED=$(grep -o '"started_at": *"[^"]*"' "$STATE_FILE" 2>/dev/null | head -1 | sed 's/.*: *"//;s/"//')
  [ -z "$PRIOR_STARTED" ] && PRIOR_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  tmp_state="$STATE_FILE.tmp"
  cat > "$tmp_state" <<EOF
{
  "started_at": "$PRIOR_STARTED",
  "iteration": $i,
  "last_status": "$([ $rc -eq 0 ] && echo ok || echo failed)",
  "last_exit_code": $rc,
  "last_iter_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "elapsed_hours": $ELAPSED_HOURS
}
EOF
  mv "$tmp_state" "$STATE_FILE"

  if [ "$rc" -eq 124 ]; then
    echo "$(date) iter=$i timed out — pre-emptive restart" >> "$LOG_FILE"
  elif [ "$rc" -ne 0 ]; then
    echo "$(date) iter=$i failed (rc=$rc) — pausing 30s before retry" >> "$LOG_FILE"
    sleep 30
  fi

  sleep "$RESTART_DELAY"
done

echo "$(date) autonomous-loop end (max_restarts=$MAX_RESTARTS or max_hours=$MAX_TOTAL_HOURS reached)" >> "$LOG_FILE"
rm -f "$PID_FILE"
exit 0
