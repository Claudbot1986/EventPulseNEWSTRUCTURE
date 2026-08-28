#!/bin/bash
# stop-mobile-control.sh — stop tmux session + mobile control server.

set -eu

PROJECT_ROOT="${PROJECT_ROOT:-/Volumes/2TB filer/NEWSTRUCTURE-COPY}"

# Kill tmux session if running.
if command -v tmux >/dev/null 2>&1 && tmux has-session -t eventpulse 2>/dev/null; then
  echo "Killing tmux session 'eventpulse'…"
  tmux kill-session -t eventpulse
else
  echo "tmux session 'eventpulse' not running"
fi

# Kill mobile control server if running.
pkill -f "09-MobileControl/server.ts" 2>/dev/null || true
pkill -f "tsx 09-MobileControl/server" 2>/dev/null || true

# Also remove STOP file if present (so a future restart is clean).
rm -f "$PROJECT_ROOT/runtime/autonomous-loop/STOP" 2>/dev/null || true

echo "Done."