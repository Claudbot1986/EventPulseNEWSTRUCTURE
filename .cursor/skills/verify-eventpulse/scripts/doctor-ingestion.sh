#!/bin/sh
# Doctor för verify-eventpulse.
# Read-only. Svarar på "är det här värd att driva?" — kör INTE några gates.
# Skriver JSON till runtime/verification-reports/ingestion-doctor-<TS>.json.
#
#   sh .cursor/skills/verify-eventpulse/scripts/doctor-ingestion.sh
set -u

ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$ROOT" || exit 1

TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT_DIR="runtime/verification-reports"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/ingestion-doctor-$TS.json"

# ---- 1. Redo? Ingen cron körning som konkurrerar om köerna ----------------
CRON_RUNNING=false
CRON_PID=""
if [ -f runtime/ingestion-cron.status.json ]; then
  CRON_RUNNING=$(jq -r '.running // false' runtime/ingestion-cron.status.json 2>/dev/null || echo false)
  CRON_PID=$(jq -r '.pid // ""' runtime/ingestion-cron.status.json 2>/dev/null || echo "")
fi

# ---- 2. Env som gaten faktiskt behöver --------------------------------------
ENV_PRESENT=""
ENV_MISSING=""
for v in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY REDIS_URL; do
  val=$(grep -E "^${v}=" .env 2>/dev/null | head -1 | cut -d= -f2-)
  if [ -n "$val" ]; then ENV_PRESENT="$ENV_PRESENT,$v"; else ENV_MISSING="$ENV_MISSING,$v"; fi
done
ENV_PRESENT=${ENV_PRESENT#,}
ENV_MISSING=${ENV_MISSING#,}

# ---- 3. Redis (bara relevant för workern) ----------------------------------
REDIS_UP=false
REDIS_HOST=$(grep -E "^REDIS_URL=" .env 2>/dev/null | head -1 | cut -d= -f2- | sed 's|^redis://||; s|^rediss://||; s|^host.docker.internal|127.0.0.1|; s|[:/?].*||')
if [ -n "$REDIS_HOST" ] && command -v nc >/dev/null 2>&1; then
  if nc -z -G 2 "$REDIS_HOST" 6379 2>/dev/null; then REDIS_UP=true; fi
fi

# ---- 4. Kötillstånd ---------------------------------------------------------
QUEUES="{}"
for f in preA-queue preB-queue postB-queue postB-preC-queue postA-queue; do
  p="runtime/$f.jsonl"
  if [ -f "$p" ]; then
    n=$(wc -l < "$p" | tr -d ' ')
  else
    n=null
  fi
  QUEUES=$(printf '%s' "$QUEUES" | jq --arg k "$f" --argjson v "${n:-null}" '. + {($k): $v}')
done

SRC_TOTAL=0
[ -d sources ] && SRC_TOTAL=$(ls -1 sources/*.jsonl 2>/dev/null | wc -l | tr -d ' ')

STATUS_LINES=0
[ -f runtime/sources_status.jsonl ] && STATUS_LINES=$(wc -l < runtime/sources_status.jsonl | tr -d ' ')

# ---- 5. Dom ---------------------------------------------------------------
OK=true
REASONS="[]"

if [ "$CRON_RUNNING" = "true" ]; then
  OK=false
  REASONS=$(printf '%s' "$REASONS" | jq --arg r "cron kör pågående (pid=$CRON_PID) — konkurrerar om samma köfiler. Vänta eller stoppa via watchdog." '. + [$r]')
fi

if [ -z "$ENV_PRESENT" ] && [ -z "$ENV_MISSING" ]; then
  OK=false
  REASONS=$(printf '%s' "$REASONS" | jq '. + [".env saknas helt — inga gatear kan köra"]')
fi

cat > "$OUT" <<JSON
{
  "ts": "$TS",
  "ok": $OK,
  "reasons": $REASONS,
  "cron": { "running": $CRON_RUNNING, "pid": ${CRON_PID:-null} },
  "env": { "present": "$ENV_PRESENT", "missing": "$ENV_MISSING" },
  "redis": { "up": $REDIS_UP, "host": "${REDIS_HOST:-unknown}" },
  "queues": $QUEUES,
  "sourcesOnDisk": $SRC_TOTAL,
  "sourcesStatusLines": $STATUS_LINES
}
JSON

cat "$OUT"
echo ""
echo "→ $OUT"