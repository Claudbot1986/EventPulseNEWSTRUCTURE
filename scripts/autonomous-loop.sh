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
#   MAX_TOTAL_HOURS=168        Hard wall-clock cap (default 7 days = 168 h; only thing that stops the loop).
#   MAX_BUDGET_PER_ITER=5      USD per claude --print call.
#   ITERATION_TIMEOUT_MIN=30   Hard kill if claude hangs.
#   RESTART_DELAY=3            Seconds between iterations.
#
# Iteration count is intentionally NOT capped — the loop runs until wall-clock
# limit, STOP file, or signal. The wrapper resets its iter counter on each
# invocation (state.json.started_at anchors the dashboard's "current run"
# view); a wrapper that ran 10k iters across a week is normal.
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
ACTIVITY_LOG="$PROJECT_ROOT/09-MobileControl/runtime/activity.jsonl"

MAX_TOTAL_HOURS="${MAX_TOTAL_HOURS:-168}"
MAX_BUDGET_PER_ITER="${MAX_BUDGET_PER_ITER:-15}"
ITERATION_TIMEOUT_MIN="${ITERATION_TIMEOUT_MIN:-30}"
RESTART_DELAY="${RESTART_DELAY:-3}"

mkdir -p "$LOG_DIR"
cd "$PROJECT_ROOT" || { echo "cannot cd to $PROJECT_ROOT" >&2; exit 1; }

# --- emit_event helper -----------------------------------------------------
# Append a structured JSON line to the mobile dashboard activity stream.
# Uses jq if available for safe JSON encoding; falls back to printf + sed.
# Usage: emit_event <type> <detail> [json_meta_or_empty]
emit_event() {
  local ev_type="$1"
  local ev_detail="$2"
  local ev_meta="${3:-null}"
  local ev_ts
  ev_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "$(dirname "$ACTIVITY_LOG")" 2>/dev/null || true
  if command -v jq >/dev/null 2>&1; then
    jq -nc \
      --arg ts "$ev_ts" \
      --arg type "$ev_type" \
      --arg detail "$ev_detail" \
      --argjson meta "$ev_meta" \
      '{ts:$ts, type:$type, detail:$detail, meta:$meta}' \
      >> "$ACTIVITY_LOG" 2>/dev/null || true
  else
    local safe_detail
    safe_detail=$(printf '%s' "$ev_detail" | tr '\n' ' ' | sed 's/"/\\"/g')
    printf '{"ts":"%s","type":"%s","detail":"%s","meta":%s}\n' \
      "$ev_ts" "$ev_type" "$safe_detail" "$ev_meta" \
      >> "$ACTIVITY_LOG" 2>/dev/null || true
  fi
}

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
  "max_total_hours": $MAX_TOTAL_HOURS
}
EOF
fi

# Trap signals — clean up and exit.
cleanup() {
  rm -f "$PID_FILE"
  echo "$(date) wrapper exiting (signal)" >> "$LOG_FILE"
  emit_event "loop_terminated" "signal received" '{"reason":"signal"}'
  exit 0
}
trap cleanup INT TERM

echo $$ > "$PID_FILE"
START_TS=$(date +%s)

# Mark this shell so any Claude Code PostToolUse hooks in ~/.claude/settings.json
# know to emit activity events. The hooks short-circuit when this is unset, so
# interactive sessions (the lead, the user) don't pollute the stream.
export EP_AUTONOMOUS=1
export EP_AUTONOMOUS_PID=$$
export EP_AUTONOMOUS_ROOT="$PROJECT_ROOT"

emit_event "autonomous_run_started" "wrapper started pid=$$" \
  "{\"pid\":$$,\"max_hours\":$MAX_TOTAL_HOURS,\"budget_usd\":$MAX_BUDGET_PER_ITER}"

echo "$(date) autonomous-loop start — project=$PROJECT_ROOT max_hours=$MAX_TOTAL_HOURS budget_per_iter=\$$MAX_BUDGET_PER_ITER timeout=${ITERATION_TIMEOUT_MIN}m" >> "$LOG_FILE"

# Iteration counter resets each invocation. The loop runs until wall-clock cap,
# STOP file, or signal — never on iter count alone.
i=0
while :; do
  i=$((i + 1))
  # Stop-flag check.
  if [ -f "$STOP_FILE" ]; then
    echo "$(date) STOP file detected — exiting cleanly" >> "$LOG_FILE"
    rm -f "$STOP_FILE" "$PID_FILE"
    emit_event "loop_terminated" "user requested stop" '{"reason":"user_stop"}'
    exit 0
  fi

  # Consume any remote instruction left by mobile-control POST /api/instruct.
  # Atomically: move pending.md → consumed.md so the instruction is preserved
  # for audit, then log an acknowledgment to activity.jsonl. claude --print
  # reads consumed.md via CLAUDE.md "instructions protocol" section — but
  # for now we at least record + expose the instruction in iteration logs.
  INSTRUCTIONS_DIR="$PROJECT_ROOT/runtime/instructions"
  PENDING_FILE="$INSTRUCTIONS_DIR/pending.md"
  CONSUMED_FILE="$INSTRUCTIONS_DIR/consumed-$(date -u +%Y%m%dT%H%M%S)-iter-$i.md"
  if [ -f "$PENDING_FILE" ] && [ -s "$PENDING_FILE" ]; then
    # Atomic move — guarantees exactly-once consumption even if we crash here.
    if mv "$PENDING_FILE" "$CONSUMED_FILE" 2>/dev/null; then
      echo "$(date) iter=$i consumed remote instruction → $CONSUMED_FILE" >> "$LOG_FILE"
      INSTR_PREVIEW=$(head -c 200 "$CONSUMED_FILE" | tr '\n' ' ' | sed 's/"/\\"/g')
      emit_event "instruction_consumed" "iter=$i consumed remote instruction" \
        "$(jq -nc --arg f "$CONSUMED_FILE" --arg p "$INSTR_PREVIEW" '{consumed_file:$f, preview:$p}')"
      # Append instruction file path to the iter-N input so claude sees it.
      ITER_INPUT_FILE="$LOG_DIR/iter-$i.input.md"
      {
        echo "## Remote instruction consumed at iter=$i"
        echo
        echo "Source: $CONSUMED_FILE"
        echo
        cat "$CONSUMED_FILE"
      } > "$ITER_INPUT_FILE"
    fi
  fi

  # Total-runtime check.
  NOW_TS=$(date +%s)
  ELAPSED_HOURS=$(( (NOW_TS - START_TS) / 3600 ))
  if [ "$ELAPSED_HOURS" -ge "$MAX_TOTAL_HOURS" ]; then
    echo "$(date) max total runtime ${MAX_TOTAL_HOURS}h reached — stopping" >> "$LOG_FILE"
    emit_event "loop_terminated" "max total hours reached" "{\"reason\":\"max_hours\",\"elapsed_hours\":$ELAPSED_HOURS}"
    break
  fi

  emit_event "iteration_started" "iter=$i elapsed=${ELAPSED_HOURS}h" \
    "{\"iter\":$i,\"elapsed_hours\":$ELAPSED_HOURS}"
  echo "$(date) iter=$i elapsed=${ELAPSED_HOURS}h — invoking claude --print /resume (budget=\$$MAX_BUDGET_PER_ITER timeout=${ITERATION_TIMEOUT_MIN}m)" >> "$LOG_FILE"

  # Single-shot Claude invocation. /resume reads vault state, picks next
  # task, executes one meaningful unit, commits, exits.
  # Use perl for portable timeout (GNU `timeout` is not on macOS by default).
  # Fork + wait pattern: parent perl holds the alarm so SIGALRM survives
  # the exec boundary (a plain `alarm; exec` discards the signal handler).
  timeout_sec=$((ITERATION_TIMEOUT_MIN * 60))

  # Compose claude prompt. If a remote instruction was consumed this iter,
  # include it in the prompt so the lead sees it.
  ITER_INPUT_FILE="$LOG_DIR/iter-$i.input.md"
  if [ -f "$ITER_INPUT_FILE" ]; then
    CLAUDE_PROMPT="$(cat "$ITER_INPUT_FILE") /resume"
  else
    CLAUDE_PROMPT="/resume"
  fi

  # MVP-gap-analysis mode: when the persistent queue has ≤1 pending task,
  # the system has run out of pre-defined work. Inject an explicit instruction
  # forcing the lead to step back from incremental task work and instead
  # analyse the app's MVP gap against external research (similar apps, NN-g
  # retention studies, Apple HIG). The lead should then generate new tasks
  # with priorities and surface anything that needs user decision.
  #
  # Decided 2026-08-21 — see 02-Operations/19-Decision-Log.md.
  QUEUE_FILE="$PROJECT_ROOT/00-Vault/01-Projects/EventPulse/02-Operations/23-Active-Task-Queue.md"
  TOTAL_PENDING=$(grep -cE '^_T[0-9]+_[[:space:]]+—' "$QUEUE_FILE" 2>/dev/null | head -1)
  TOTAL_PENDING=${TOTAL_PENDING:-0}
  OPEN_COUNT=$(grep -cE '^[[:space:]]*\*Status:\*[[:space:]]*(done|cancelled)' "$QUEUE_FILE" 2>/dev/null | head -1)
  OPEN_COUNT=${OPEN_COUNT:-0}
  REMAINING=$((TOTAL_PENDING - OPEN_COUNT))
  if [ "$REMAINING" -le 1 ]; then
    MVP_FRAGMENT='

---
## MVP-gap-analysis mode (injected by autonomous-loop)

The persistent task queue has **≤1 pending task** remaining. Stop incremental
task-pulling and run an MVP-gap-analysis pass:

1. Read the North Star (`02-North-Star.md`), Current State (`01-Current-State.md`),
   `docs/BACKLOG.md`, and `docs/MASTERPLAN.md` to ground yourself in current truth.
2. Identify the 5–8 apps most similar to EventPulse (Meetup, Eventbrite,
   Resident Advisor, Bandsintown, Kombo, AllEvents, Ticketmaster, etc.) and
   the 3–5 most relevant UX / retention studies (NN-g, Apple HIG, Material 3).
3. Spawn a `work` sub-agent(s) to do the external research in parallel where
   useful; otherwise do it inline.
4. Determine the gap between EventPulse today and a credible MVP. Generate
   5–15 new tasks with priorities. **Maps are explicitly approved** by the
   user.
5. For anything that requires a human decision (manual goals, licensing,
   paid integrations, focus choices), create a `needs_user_decision` task
   in `23-Active-Task-Queue.md` so the user sees it on the next dashboard
   refresh.
6. Foundation your generated tasks on **real evidence** (study citations,
   document references) — not assumptions.
7. Commit + sync vault + continue the loop.

This mode is intended to keep the system driving toward MVP even when the
queue is empty, until the user explicitly disables it.
---'
    CLAUDE_PROMPT="${CLAUDE_PROMPT}${MVP_FRAGMENT}"
    echo "$(date) iter=$i MVP-gap-analysis mode ON (remaining=$REMAINING)" >> "$LOG_FILE"
    emit_event "mvp_gap_analysis_triggered" "iter=$i remaining=$REMAINING" \
      "{\"iter\":$i,\"remaining_pending\":$REMAINING}"
  fi

  emit_event "claude_spawned" "iter=$i budget=\$$MAX_BUDGET_PER_ITER" \
    "{\"iter\":$i,\"budget_usd\":$MAX_BUDGET_PER_ITER,\"timeout_min\":$ITERATION_TIMEOUT_MIN}"

  perl -e '
    $SIG{ALRM} = sub { kill TERM => $pid; sleep 2; kill KILL => $pid; exit 124 };
    alarm shift @ARGV;
    $pid = fork();
    die "fork failed: $!" unless defined $pid;
    if ($pid == 0) {
      exec(@ARGV) or die "exec failed: $!";
    }
    waitpid($pid, 0);
    exit($? >> 8);
  ' "$timeout_sec" claude --print \
    --max-budget-usd "$MAX_BUDGET_PER_ITER" \
    --output-format json \
    "$CLAUDE_PROMPT" > "$LOG_DIR/iter-$i.json" 2> "$LOG_DIR/iter-$i.err"
  rc=$?

  # Parse the JSON output to determine real status. claude --print --output-format
  # json often returns exit=1 even on success; the top-level is_error field is
  # authoritative. Use jq for proper JSON parsing — the previous tail/grep
  # approach broke because is_error lives near the start of the JSON, not the
  # end, so tail -c 200 missed it and every budget-exceeded iter was
  # misclassified as a success (causing the loop to keep spinning).
  iter_json="$LOG_DIR/iter-$i.json"
  json_error=false
  json_subtype=""
  json_num_turns=0
  json_cost_usd=0
  json_result_text=""
  if [ -f "$iter_json" ] && [ -s "$iter_json" ]; then
    if command -v jq >/dev/null 2>&1; then
      json_error=$(jq -r 'if .is_error == true then "true" else "false" end' "$iter_json" 2>/dev/null || echo "false")
      json_subtype=$(jq -r '.subtype // ""' "$iter_json" 2>/dev/null || echo "")
      json_num_turns=$(jq -r '.num_turns // 0' "$iter_json" 2>/dev/null || echo 0)
      json_cost_usd=$(jq -r '.total_cost_usd // .cost_usd // 0' "$iter_json" 2>/dev/null || echo 0)
      # Capture last assistant text for the activity log (truncated)
      json_result_text=$(jq -r '
        if (.result | type) == "string" then .result
        elif (.result | type) == "object" then (.result.content // "" | tostring)
        else "" end
      ' "$iter_json" 2>/dev/null | head -c 280 || echo "")
    else
      # Fallback if jq is missing (should not happen on macOS): read from start
      is_err=$(head -c 2000 "$iter_json" | grep -o '"is_error":[^,}]*' | head -1 | sed 's/.*://')
      case "$is_err" in
        *false*) json_error=false ;;
        *true*)  json_error=true ;;
        *)       json_error=false ;;
      esac
    fi
  fi

  if [ "$rc" -eq 0 ] || [ "$json_error" = false ]; then
    final_rc=0
  else
    final_rc=$rc
  fi

  # Detect budget-exceeded iters: agent was making progress (turns>0) but
  # ran out of money before producing a final result. These are not failures
  # to retry blindly — the next iter will resume the same context and likely
  # burn another full budget. The loop should back off and let the user
  # review whether the budget cap or task scope needs adjustment.
  BUDGET_EXCEEDED=false
  if [ "$json_subtype" = "error_max_budget_usd" ]; then
    BUDGET_EXCEEDED=true
  fi

  echo "$(date) iter=$i exit=$rc json_is_error=$json_error subtype='$json_subtype' turns=$json_num_turns cost=\$$json_cost_usd budget_exceeded=$BUDGET_EXCEEDED final=$final_rc" >> "$LOG_FILE"

  emit_event "claude_completed" "iter=$i rc=$rc json_is_error=$json_error subtype='$json_subtype' turns=$json_num_turns cost=\$$json_cost_usd" \
    "{\"iter\":$i,\"rc\":$rc,\"json_is_error\":$json_error,\"subtype\":\"$json_subtype\",\"turns\":$json_num_turns,\"cost_usd\":$json_cost_usd,\"budget_exceeded\":$BUDGET_EXCEEDED}"

  # Update state atomically. Read prior started_at so it survives across iters.
  PRIOR_STARTED=$(grep -o '"started_at": *"[^"]*"' "$STATE_FILE" 2>/dev/null | head -1 | sed 's/.*: *"//;s/"//')
  [ -z "$PRIOR_STARTED" ] && PRIOR_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  tmp_state="$STATE_FILE.tmp"
  cat > "$tmp_state" <<EOF
{
  "started_at": "$PRIOR_STARTED",
  "iteration": $i,
  "last_status": "$([ $final_rc -eq 0 ] && echo ok || echo failed)",
  "last_exit_code": $rc,
  "last_json_is_error": $json_error,
  "last_iter_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "elapsed_hours": $ELAPSED_HOURS
}
EOF
  mv "$tmp_state" "$STATE_FILE"

  if [ "$rc" -eq 124 ]; then
    echo "$(date) iter=$i timed out — pre-emptive restart" >> "$LOG_FILE"
    emit_event "iteration_timeout" "iter=$i" "{\"iter\":$i,\"timeout_min\":$ITERATION_TIMEOUT_MIN}"
  elif [ "$BUDGET_EXCEEDED" = true ]; then
    # Budget was exhausted mid-iter. Backing off 5 minutes so we don't burn
    # another full budget on the same resumed context. If this keeps happening,
    # the user should raise MAX_BUDGET_PER_ITER or shrink task scope.
    BACKOFF_SEC=300
    echo "$(date) iter=$i budget exhausted (turns=$json_num_turns cost=\$$json_cost_usd subtype='$json_subtype') — backing off ${BACKOFF_SEC}s" >> "$LOG_FILE"
    emit_event "iteration_budget_exhausted" "iter=$i turns=$json_num_turns cost=\$$json_cost_usd" \
      "{\"iter\":$i,\"turns\":$json_num_turns,\"cost_usd\":$json_cost_usd,\"subtype\":\"$json_subtype\",\"backoff_sec\":$BACKOFF_SEC}"
    sleep "$BACKOFF_SEC"
  elif [ "$final_rc" -ne 0 ]; then
    echo "$(date) iter=$i failed (rc=$rc json_is_error=$json_error) — pausing 30s before retry" >> "$LOG_FILE"
    emit_event "iteration_failed" "iter=$i rc=$rc json_is_error=$json_error" "{\"iter\":$i,\"rc\":$rc,\"json_is_error\":$json_error}"
    sleep 30
  fi

  sleep "$RESTART_DELAY"
done

echo "$(date) autonomous-loop end (max_hours=$MAX_TOTAL_HOURS reached)" >> "$LOG_FILE"
emit_event "loop_terminated" "max wall-clock hours reached" '{"reason":"max_hours"}'
rm -f "$PID_FILE"
exit 0
