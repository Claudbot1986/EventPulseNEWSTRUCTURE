#!/usr/bin/env bash
# _bfl_all_categories.sh — kör bfl-batch för alla kategorier (skippa music=klart).
#
# Sekventiell körning. Vid fel: stanna och rapportera.
# Använd MOCK_PROMPTS=1 för att skippa M3 (mock-prompt är deterministisk och snabb).
#
# Användning:
#   bash scripts/_bfl_all_categories.sh

set -euo pipefail
cd "$(dirname "$0")/.."

# Parallella arrayer (bash 3.2 saknar declare -A).
# Skippa music (klar), electronic (0 events), rock (0 kluster), theater (2 ev → 10 bilder).
CATS=(
  community
  theatre-drama
  theatre-comedy
  exhibition
  sports
  opera
  dance
  talks-lectures
  musical-theatre
  ovrigt
  food
  kids
  workshop
  nightlife
  barn-familj
  classical
  film
  family
  wine-tasting
  circus
  humor
  musikal
  dans
  flea-market
  standup
  pop
  festival
  sport
  jazz
)
COUNTS=(
  380
  285
  120
  160
   60
   70
   85
  125
   35
  120
  105
   85
   95
  100
  105
   25
  100
  110
  100
   60
   70
   55
   25
   30
   50
   25
   40
   35
   25
)

LOG=/tmp/bfl_all.log
echo "Startar $(date '+%F %T')" > "$LOG"

TOTAL=${#CATS[@]}
for i in "${!CATS[@]}"; do
  CAT="${CATS[$i]}"
  COUNT="${COUNTS[$i]}"
  IDX=$((i + 1))
  echo "" | tee -a "$LOG"
  echo "[$IDX/$TOTAL] === $CAT (count=$COUNT) === $(date '+%T') ===" | tee -a "$LOG"

  if [[ ! -f "BFL-generator/tmp/cluster_${CAT}.json" ]]; then
    echo "  ❌ cluster-fil saknas: BFL-generator/tmp/cluster_${CAT}.json — hoppar" | tee -a "$LOG"
    continue
  fi

  MOCK_PROMPTS=1 node --env-file=.env --import tsx BFL-generator/bin/bfl-batch.ts \
    --category="$CAT" --count="$COUNT" --apply \
    >> "$LOG" 2>&1
  STATUS=$?
  if [[ $STATUS -ne 0 ]]; then
    echo "  ❌ $CAT misslyckades (exit $STATUS) — se $LOG" | tee -a "$LOG"
    exit $STATUS
  fi
  echo "  ✓ $CAT klar $(date '+%T')" | tee -a "$LOG"
done

echo "" | tee -a "$LOG"
echo "ALLT KLART $(date '+%F %T')" | tee -a "$LOG"