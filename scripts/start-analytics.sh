#!/bin/bash
# start-analytics.sh — start the analytics backend on port 7778.
#
# Usage: scripts/start-analytics.sh
# Stops on Ctrl-C. Token is generated and printed on first boot if
# ANALYTICS_TOKEN is not set in the environment.

set -e
cd "$(dirname "$0")/.."

PORT="${PORT:-7778}"
RUNTIME_DIR="${ANALYTICS_RUNTIME_DIR:-./runtime/analytics}"
mkdir -p "$RUNTIME_DIR"

export PORT="$PORT"
export ANALYTICS_RUNTIME_DIR="$RUNTIME_DIR"

echo "[start-analytics] port=$PORT runtime=$RUNTIME_DIR"

cd 10-Analytics

if [ ! -d node_modules ]; then
  echo "[start-analytics] installing dependencies..."
  npm install --silent
fi

exec npx tsx server.ts