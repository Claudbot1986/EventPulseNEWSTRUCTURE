#!/usr/bin/env bash
# verify-metro.sh — Hitta eller starta en Metro som verify-eventpulse-ui kan
# köra mot. Först kollar den om det finns en fungerande Metro-instans på
# localhost (8081, 9090, 9091) som redan har rätt env-vars. Om inte,
# startar den en ny på 9090 med rätt env satta. Använd:
#
#   BASE_URL=$(./scripts/verify-metro.sh --start-if-needed) \
#     npx playwright test e2e/<feature>.test.mjs
#
# Eller bara skriva ut URL:en utan att starta något:
#
#   ./scripts/verify-metro.sh --print  # → http://127.0.0.1:9090
#
# Valfria flaggor:
#   --port=9090          Sök/starta på just denna port (default 9090)
#   --start-if-needed    Starta Metro om ingen kör
#   --print              Skriv bara ut URL
#   --no-banner          Undertryck info-rader
#
# Säkerhetscheck: en Metro räknas som "klar" om svaret på /index.bundle
# innehåller rätt Supabase-URL (och inget "myproject.supabase.co"-fallback
# som betyder att EXPO_PUBLIC_SUPABASE_URL inte blivit inplatad).

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI_DIR="$PROJECT_ROOT/06-UI"

PORT="${VERIFY_METRO_PORT:-9090}"
START_IF_NEEDED=0
PRINT_ONLY=0
VERBOSE=1

for arg in "$@"; do
  case "$arg" in
    --port=*)        PORT="${arg#*=}" ;;
    --start-if-needed) START_IF_NEEDED=1 ;;
    --print)         PRINT_ONLY=1; START_IF_NEEDED=1 ;;
    --no-banner)     VERBOSE=0 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

PORT="${PORT#*:}"  # strip "127.0.0.1:" if present

log() { [[ "$VERBOSE" == "1" ]] && echo "$@" >&2 || true; }

# ─── 1. Hitta befintlig Metro som är klar ───────────────────────────────────

is_metro_ready() {
  local port="$1"
  local body
  body=$(curl -sS --max-time 3 "http://127.0.0.1:${port}/" 2>/dev/null) || return 1

  # Måste vara Metro (banner / script-tag med "expo"-hint eller liknande).
  if ! grep -qE '"/index\.bundle"|expo|Expo' <<<"$body" 2>/dev/null; then
    return 1
  fi

  # Säkerhetskoll: bundle ska ha rätt supabase-URL OCH rätt anon-publishable-nyckel.
  # `myproject.supabase.co` är en placeholder-string i supabase-js default-konfiguration
  # — den FÅR finnas som ett default-fallback, men den får INTE vara den enda Supabase-URL
  # vi hittar i bundle. Vi kräver både rätt URL OCH rätt publishable-nyckel för godkänt.
  local bundle_body
  bundle_body=$(curl -sS --max-time 5 \
    "http://127.0.0.1:${port}/node_modules/expo/AppEntry.bundle?platform=ios&dev=true&hot=false&lazy=true" 2>/dev/null) || return 1

  if ! grep -qE 'bsllkpvkowwndhhxtlln\.supabase\.co' <<<"$bundle_body"; then
    log "  :$port — Metro kör men rätt Supabase-URL (bsllkpvkowwndhhxtlln) saknas i bundle."
    return 1
  fi

  # Plocka ut aktuell publishable-nyckel från rot-`.env` (om läsbar) och jämför.
  local expected_key=""
  if [[ -f "$PROJECT_ROOT/.env" ]]; then
    expected_key=$(grep -E '^SB_PUBLISHABLE_KEY=' "$PROJECT_ROOT/.env" 2>/dev/null | head -1 | sed 's/^SB_PUBLISHABLE_KEY=//')
  fi
  if [[ -n "$expected_key" ]]; then
    if ! grep -qF "$expected_key" <<<"$bundle_body"; then
      log "  :$port — Metro kör men rätt anon-publishable-nyckel (${expected_key:0:14}…) saknas i bundle."
      return 1
    fi
  fi

  # Bonus: bekräfta att onboarding-bypass slår igenom (om env-flaggan sätts).
  if grep -qE '^EXPO_PUBLIC_SKIP_ONBOARDING=1' "$PROJECT_ROOT/.env" 2>/dev/null; then
    # Packas in som inline-sträng "1" i source — inte alltid sökbart i bundle.
    # Vi loggar bara info, vi blockerar inte.
    log "  :$port — EXPO_PUBLIC_SKIP_ONBOARDING=1 är satt i .env (förväntar Hem-direkt)."
  fi

  return 0
}

log "Söker efter Metro klar för verify på localhost:9090..."

for try_port in "$PORT" 8081 9091 9092; do
  if is_metro_ready "$try_port"; then
    log "✓ Metro klar på :$try_port"
    echo "http://127.0.0.1:${try_port}"
    exit 0
  else
    log "  :$try_port — inte klar (eller inte startad)"
  fi
done

# ─── 2. Inget fungerar. Starta ny Metro om tillåtet ─────────────────────────

if [[ "$START_IF_NEEDED" != "1" ]]; then
  cat >&2 <<EOF
Ingen Metro redo. Starta en med:
  ./scripts/verify-metro.sh --start-if-needed
Eller manuellt:
  cd 06-UI
  (kör 06-UI/.env via symlink → ../.env som redan har EXPO_PUBLIC_*-nycklar)
  npx expo start --port $PORT
EOF
  exit 2
fi

log "Startar ny Metro på :$PORT (med .env från rot-`./.env` via 06-UI/.env symlinken)..."

cd "$CLI_DIR"

if [[ ! -L .env || "$(readlink .env)" != "../.env" ]]; then
  log "Varning: 06-UI/.env är inte en symlink till ../.env (readlink='$(readlink 06-UI/.env 2>/dev/null || echo saknas)')"
  log "Verify kräver att EXPO_PUBLIC_*-nycklar finns i 06-UI/.env. Kör:"
  log "  rm 06-UI/.env && ln -s ../.env 06-UI/.env"
fi

nohup npx expo start --host 127.0.0.1 --port "$PORT" \
  > "/tmp/verify-metro-${PORT}.log" 2>&1 &
METRO_PID=$!
disown
log "Metro startad, PID=$METRO_PID, log=/tmp/verify-metro-${PORT}.log"

# ─── 3. Vänta tills Metro svarar med rätt bundle (max 90s) ─────────────────

for i in $(seq 1 90); do
  if is_metro_ready "$PORT"; then
    log "✓ Metro klar på :$PORT (efter ${i}s)"
    echo "http://127.0.0.1:${PORT}"
    exit 0
  fi
  sleep 1
done

log "✗ Metro på :$PORT startades men blev inte klar på 90s. Se log:"
log "  tail -60 /tmp/verify-metro-${PORT}.log"
exit 1
