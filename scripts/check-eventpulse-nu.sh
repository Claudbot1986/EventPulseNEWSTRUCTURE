#!/bin/bash
# check-eventpulse.nu.sh — kör denna för att verifiera att domänen är live.
# Användning: bash scripts/check-eventpulse-nu.sh
#
# Skriptet pollar DNS och HTTPS var 60:e minut tills eventpulse.nu svarar 200,
# eller tills maxtid (24h) går ut. Användbart medan du väntar på Loopia
# nameserver-propagation (NS TTL 86400s).

set -u

DOMAIN="${1:-eventpulse.nu}"
INTERVAL="${INTERVAL:-3600}"   # sekunder mellan checks (default 1h)
MAX_HOURS="${MAX_HOURS:-24}"
MAX_SECONDS=$((MAX_HOURS * 3600))
START=$(date +%s)

echo "=== Polling $DOMAIN every ${INTERVAL}s (max ${MAX_HOURS}h) ==="
echo "    Start: $(date '+%Y-%m-%d %H:%M:%S')"

attempt=0
while true; do
  attempt=$((attempt + 1))
  now=$(date +%s)
  elapsed=$((now - START))
  if [ $elapsed -gt $MAX_SECONDS ]; then
    echo ""
    echo "⏱  Timeout efter ${MAX_HOURS}h — propagering tog för lång tid."
    echo "   Kolla Loopia → namnservrar manuellt."
    exit 1
  fi

  # DNS check via Cloudflare resolver
  ns=$(dig NS "$DOMAIN" +short @1.1.1.1 2>&1 | grep cloudflare | sort | tr '\n' ' ')
  # HTTPS check
  http=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 8 "https://$DOMAIN/" 2>/dev/null)

  printf "[%s] attempt #%d  NS=[%s]  HTTP=%s\n" "$(date '+%H:%M:%S')" "$attempt" "$ns" "$http"

  if [ "$http" = "200" ]; then
    echo ""
    echo "✅  $DOMAIN är LIVE! HTTP 200."
    echo "    SSL-cert: $(curl -sSI --connect-timeout 8 https://$DOMAIN/ | grep -i 'server\|strict-transport\|alt-svc' | head -1)"
    exit 0
  fi

  sleep "$INTERVAL"
done