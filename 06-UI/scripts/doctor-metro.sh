#!/usr/bin/env bash
# doctor-metro.sh — hälsocheck före varje drive av verify-eventpulse-ui.
#
#   ./scripts/doctor-metro.sh          # använd PORT/BASE_URL från omgivningen
#
# Exit 0 = instansen är värd att köra. Exit 1 = stoppa, starta om via
# launch-metro.sh. Ett doctor-fel som orsakas av skill-drift är själva driften
# (fixa skillen, starta om, försök en gång till).

set -uo pipefail

UI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-9090}"
BASE_URL="${BASE_URL:-http://localhost:${PORT}}"
fail=0

# 1. Metro svarar?
code=$(curl -s -o /dev/null -w '%{http_code}' -m 60 "${BASE_URL}/" 2>/dev/null || echo 000)
if [ "${code}" = "200" ]; then
  echo "OK   Metro root            HTTP ${code} (${BASE_URL})"
else
  echo "FAIL Metro root            HTTP ${code} (${BASE_URL})"
  fail=1
fi

# 2. Sidan innehåller Expo-mount-point?
if curl -s -m 60 "${BASE_URL}/" 2>/dev/null | grep -qiE 'expo|eventpulse'; then
  echo "OK   Expo mount point      hittad"
else
  echo "FAIL Expo mount point      saknas i HTML"
  fail=1
fi

# 3. Web-bundle byggs utan fel?
bundle_code=$(curl -s -o /dev/null -w '%{http_code}' -m 300 "${BASE_URL}/index.bundle?platform=web&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable" 2>/dev/null || echo 000)
if [ "${bundle_code}" = "200" ]; then
  echo "OK   Web bundle             HTTP ${bundle_code}"
else
  echo "FAIL Web bundle             HTTP ${bundle_code}"
  fail=1
fi

# 4. Agent-API svarar? (från EXPO_PUBLIC_AGENT_URL i .env)
cd "$UI_DIR"
# Ett externt satt EXPO_PUBLIC_AGENT_URL vinner över .env — samma regel som
# launch-metro.sh. Utan detta skulle doktorn rapportera om prod-agenten medan
# appen i verkligheten pratar med den lokala agenten.
AGENT_URL_OVERRIDE="${EXPO_PUBLIC_AGENT_URL:-}"
set -a
# shellcheck disable=SC1091
. ./.env 2>/dev/null || true
set +a
if [ -n "${AGENT_URL_OVERRIDE}" ]; then
  export EXPO_PUBLIC_AGENT_URL="${AGENT_URL_OVERRIDE}"
fi
AGENT_URL="${EXPO_PUBLIC_AGENT_URL:-https://eventpulse-agent.fly.dev}"
agent=$(curl -s -m 15 "${AGENT_URL}/agent/health" 2>/dev/null || echo "")
if echo "${agent}" | grep -q '"ok":true'; then
  echo "OK   Agent API              ${AGENT_URL} -> ${agent}"
else
  echo "FAIL Agent API              ${AGENT_URL} -> ${agent:-<no response>}"
  fail=1
fi

exit "${fail}"
