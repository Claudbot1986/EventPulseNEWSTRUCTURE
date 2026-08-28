#!/bin/bash
# install.sh — Idempotent loader for com.eventpulse.discovery launchd job.
#
# Usage:
#   bash 09-DiscoveryAgent/install.sh           # install
#   bash 09-DiscoveryAgent/install.sh --uninstall # uninstall
#
# Idempotent: safe to run multiple times. If already loaded, bootouts first.

set -e

PROJECT_ROOT="/Volumes/2TB filer/NEWSTRUCTURE-COPY"
SOURCE_PLIST="$PROJECT_ROOT/09-DiscoveryAgent/cron/com.eventpulse.discovery.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/com.eventpulse.discovery.plist"
LABEL="com.eventpulse.discovery"

UNINSTALL=false
if [[ "${1:-}" == "--uninstall" ]]; then
  UNINSTALL=true
fi

log() {
  echo "[install] $1"
}

# ─── Uninstall ──────────────────────────────────────────────────────────────

if $UNINSTALL; then
  log "uninstall: $LABEL"
  if launchctl list | grep -q "$LABEL"; then
    UID_NUM=$(id -u)
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || launchctl unload "$TARGET_PLIST" 2>/dev/null || true
    log "✓ unloaded"
  else
    log "not loaded (skipping unload)"
  fi
  if [[ -f "$TARGET_PLIST" ]]; then
    rm "$TARGET_PLIST"
    log "✓ removed $TARGET_PLIST"
  fi
  exit 0
fi

# ─── Install ────────────────────────────────────────────────────────────────

if [[ ! -f "$SOURCE_PLIST" ]]; then
  log "✗ source plist missing: $SOURCE_PLIST"
  exit 1
fi

mkdir -p "$TARGET_DIR"

# Copy (overwrite if existing).
cp "$SOURCE_PLIST" "$TARGET_PLIST"
log "✓ copied plist → $TARGET_PLIST"

# If already loaded, bootout first (idempotent).
UID_NUM=$(id -u)
if launchctl list | grep -q "$LABEL"; then
  log "already loaded — booting out first"
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || launchctl unload "$TARGET_PLIST" 2>/dev/null || true
fi

# Bootstrap (modern API, works on macOS 11+); fall back to launchctl load.
if launchctl bootstrap "gui/$UID_NUM" "$TARGET_PLIST" 2>/dev/null; then
  log "✓ bootstrapped via launchctl bootstrap"
elif launchctl load "$TARGET_PLIST" 2>/dev/null; then
  log "✓ loaded via launchctl load (legacy)"
else
  log "✗ both bootstrap and load failed"
  exit 1
fi

# Verify.
if launchctl list | grep -q "$LABEL"; then
  PID=$(launchctl list | grep "$LABEL" | awk '{print $1}')
  log "✓ verified: $LABEL loaded (PID=$PID)"
  log "next run: 04:30 daily"
else
  log "✗ verification failed — $LABEL not in launchctl list"
  exit 1
fi

log "uninstall with: bash $0 --uninstall"
exit 0
