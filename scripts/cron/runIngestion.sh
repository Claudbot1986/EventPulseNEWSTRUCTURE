#!/bin/bash
#
# scripts/cron/runIngestion.sh — Wrapper för launchd-jobbet com.eventpulse.ingestion.
#
# Importerar .env till launchd-processen, sedan kör scripts/ingestion-cron.ts
# med full pipeline. Wrappern behövs eftersom launchd INTE läser .env — den
# ärver bara det som finns i plistens EnvironmentVariables.
#
# Skapad 2026-09-10 för att koppla ALLA plansteg (P1A, P2A, P2B, P2C, P2D,
# P3A, P3B, P3C) till 02:30-cronjobbet.
#
# Manuell körning:
#   bash scripts/cron/runIngestion.sh

set -euo pipefail

PROJECT_ROOT="/Users/claudgashi/EventPulse"
cd "$PROJECT_ROOT"

# Ladda .env till shell-miljön
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

# Logga start
echo "[runIngestion] === START $(date -Iseconds) ==="
echo "[runIngestion] PWD=$PROJECT_ROOT"
echo "[runIngestion] ENV loaded: $(wc -l < "$PROJECT_ROOT/.env" 2>/dev/null || echo 0) keys"

# Kör cronjobbet. Exit code propageras.
# (2026-09-15: projektets lokala tsx-bin — ingen npx-upplösning under launchd.)
exec "$PROJECT_ROOT/node_modules/.bin/tsx" scripts/ingestion-cron.ts --limit 50
