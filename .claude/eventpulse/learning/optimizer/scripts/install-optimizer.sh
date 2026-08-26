#!/usr/bin/env bash
# install-optimizer.sh — Install LaunchAgent to ~/Library/LaunchAgents/
#
# Per master-prompt §46: kopiera plist + launchctl load.
# Per K3: explicit install — användaren måste aktivt köra detta.
#
# Användning:
#   bash install-optimizer.sh
#
# Säkerhets-check:
#   - canonical-path-guard MÅSTE klara innan install (förhindrar peka mot fel recovery-mapp)

set -euo pipefail

REPO_ROOT="${EP_REPO_ROOT:-/Volumes/2TB filer/NEWSTRUCTURE-COPY}"
PLIST_SRC="$REPO_ROOT/scripts/com.eventpulse.optimizer.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.eventpulse.optimizer.plist"
LABEL="com.eventpulse.optimizer"

if [[ ! -f "$PLIST_SRC" ]]; then
  echo "ERROR: plist not found at $PLIST_SRC" >&2
  exit 1
fi

# canonical-path-guard precheck
echo "[install-optimizer] running canonical-path-guard precheck..."
if ! npx --prefix "$REPO_ROOT" tsx "$REPO_ROOT/.claude/eventpulse/learning/optimizer/scripts/canonical-path-guard.ts" 2>&1; then
  echo "ERROR: canonical-path-guard failed — refusing to install" >&2
  exit 1
fi

mkdir -p "$(dirname "$PLIST_DEST")"
cp "$PLIST_SRC" "$PLIST_DEST"
chmod 644 "$PLIST_DEST"

echo "[install-optimizer] copied plist to $PLIST_DEST"

# Try to load (may fail if not in LaunchAgents yet)
if launchctl list 2>/dev/null | grep -q "$LABEL"; then
  echo "[install-optimizer] unloading existing $LABEL"
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

echo "[install-optimizer] launching $LABEL"
launchctl load -w "$PLIST_DEST" 2>&1
echo "[install-optimizer] installed and loaded $LABEL"
echo "[install-optimizer] logs: ~/Library/Logs/eventpulse-optimizer/"
echo "[install-optimizer] status: launchctl list | grep $LABEL"
