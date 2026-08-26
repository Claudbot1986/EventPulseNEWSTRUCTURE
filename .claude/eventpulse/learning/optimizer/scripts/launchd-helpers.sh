#!/usr/bin/env bash
# launchd-helpers.sh — Operations helpers for com.eventpulse.optimizer
#
# Användning:
#   bash launchd-helpers.sh install    # install + load (calls install-optimizer.sh)
#   bash launchd-helpers.sh uninstall  # unload + remove plist
#   bash launchd-helpers.sh status     # show launchctl state + last log lines
#   bash launchd-helpers.sh restart    # kickstart -k (graceful stop + start)
#   bash launchd-helpers.sh logs       # tail log files
#   bash launchd-helpers.sh verify     # run verify-optimizer-state

set -euo pipefail

REPO_ROOT="${EP_REPO_ROOT:-/Volumes/2TB filer/NEWSTRUCTURE-COPY}"
LABEL="com.eventpulse.optimizer"
PLIST_SRC="$REPO_ROOT/scripts/com.eventpulse.optimizer.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/eventpulse-optimizer"

cmd="${1:-help}"

case "$cmd" in
  install)
    bash "$REPO_ROOT/.claude/eventpulse/learning/optimizer/scripts/install-optimizer.sh"
    ;;
  uninstall)
    if [[ -f "$PLIST_DEST" ]]; then
      launchctl unload "$PLIST_DEST" 2>/dev/null || true
      rm -f "$PLIST_DEST"
      echo "[$LABEL] uninstalled (plist removed from ~/Library/LaunchAgents/)"
    else
      echo "[$LABEL] not installed (no plist in ~/Library/LaunchAgents/)"
    fi
    ;;
  status)
    echo "=== launchctl list ==="
    launchctl list 2>&1 | grep -E "(Label|$LABEL)" || echo "(not loaded)"
    echo ""
    echo "=== plist location ==="
    if [[ -f "$PLIST_DEST" ]]; then
      echo "$PLIST_DEST (installed)"
    else
      echo "$PLIST_DEST (NOT installed)"
    fi
    echo ""
    echo "=== verify-optimizer-state ==="
    EP_REPO_ROOT="$REPO_ROOT" npx --prefix "$REPO_ROOT" tsx "$REPO_ROOT/.claude/eventpulse/learning/optimizer/scripts/verify-optimizer-state.ts" 2>&1 || true
    ;;
  restart)
    if ! launchctl list 2>/dev/null | grep -q "$LABEL"; then
      echo "[$LABEL] not loaded — install first" >&2
      exit 1
    fi
    echo "[$LABEL] kickstart -k (graceful stop + start)"
    launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>&1 || {
      echo "[$LABEL] kickstart failed; trying load after unload" >&2
      launchctl unload "$PLIST_DEST" 2>/dev/null || true
      launchctl load -w "$PLIST_DEST"
    }
    ;;
  logs)
    mkdir -p "$LOG_DIR"
    if [[ -d "$LOG_DIR" ]]; then
      for f in "$LOG_DIR"/*.log; do
        [[ -f "$f" ]] || continue
        echo ""
        echo "===== $f (last 20 lines) ====="
        tail -n 20 "$f" 2>/dev/null || true
      done
    else
      echo "no log dir at $LOG_DIR"
    fi
    ;;
  verify)
    EP_REPO_ROOT="$REPO_ROOT" npx --prefix "$REPO_ROOT" tsx "$REPO_ROOT/.claude/eventpulse/learning/optimizer/scripts/verify-optimizer-state.ts" --json 2>&1
    ;;
  help|*)
    cat <<EOF
eventpulse-optimizer helpers

Usage:
  bash launchd-helpers.sh install     # install + load (calls install-optimizer.sh)
  bash launchd-helpers.sh uninstall   # unload + remove plist
  bash launchd-helpers.sh status      # show launchctl state + last log lines
  bash launchd-helpers.sh restart     # kickstart -k (graceful stop + start)
  bash launchd-helpers.sh logs        # tail log files
  bash launchd-helpers.sh verify      # run verify-optimizer-state --json
EOF
    ;;
esac
