#!/bin/sh
# Kör ett kommando med tidsgräns.
#
# macOS har varken `timeout` eller `gtimeout` (om inte coreutils är
# installerat via brew). Perl finns alltid. Denna wrapper ger samma
# beteende på varje plattform.
#
#   sh .cursor/skills/verify-eventpulse/scripts/timed.sh 300 npx tsx \
#     02-Ingestion/A-directAPI-networkGate/runA.ts --limit 1 --workers 1
#
# Argument: <sekunder> <kommando...>
# Exit:     kommandots exit, eller 124 om tidsgränsen nåddes.
#
# Kan användas direkt i feature-flöden:
#   SANDBOX=$(mktemp -d /tmp/ep-ingest-XXXXXX)
#   TIMED="$PWD/.cursor/skills/verify-eventpulse/scripts/timed.sh"
#   sh "$TIMED" 300 npx tsx 02-Ingestion/.../runA.ts --limit 1
set -u

if [ $# -lt 2 ]; then
  echo "usage: timed.sh <seconds> <command...>" >&2
  exit 2
fi

LIMIT="$1"
shift

perl -e 'alarm shift; exec @ARGV' "$LIMIT" "$@"
code=$?

if [ "$code" -eq 142 ]; then
  echo "[timed] timeout efter ${LIMIT}s — processen avbruten (SIGALRM)" >&2
  exit 124
fi

exit $code