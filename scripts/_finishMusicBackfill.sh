#!/bin/bash
# _finishMusicBackfill.sh — kör description-backfill + verifiering
# när music-backfill-rerun är klar.
#
# Kör: bash scripts/_finishMusicBackfill.sh

set -e
set -a && source .env && set +a

echo "════════════════════════════════════════════════════════════════════"
echo "  Music description-backfill + verifiering"
echo "════════════════════════════════════════════════════════════════════"
echo ""

# Vänta tills backfill-processen är klar
echo "Väntar på att backfill-rerun ska avslutas..."
while pgrep -f "_backfillEventProfile.ts" > /dev/null; do
  echo "  ... fortfarande igång (sleep 30s)"
  sleep 30
done
echo "  ✓ Backfill klar"
echo ""

# 1. Kör description-backfill på music
echo "════════════════════════════════════════════════════════════════════"
echo "  STEG 1: description-backfill på music"
echo "════════════════════════════════════════════════════════════════════"
date "+%H:%M:%S start description-backfill"
npx --yes tsx 04-Normalizer/editorial/_backfillEditorialDescriptions.ts \
  --category=music --concurrency=2
date "+%H:%M:%S end"
echo ""

# 2. SQL-fix för events med buggy event_type='community' (säkerhets-uppdatering)
echo "════════════════════════════════════════════════════════════════════"
echo "  STEG 2: SQL-fix event_type för music-events"
echo "════════════════════════════════════════════════════════════════════"
SUPABASE_PAT="$SB_ACCESS_TOKEN" node -e "
const sql = require('fs').readFileSync('05-Supabase/migrations/2026-10-13-0001-fix-music-event-type.sql', 'utf-8');
const url = process.env.SUPABASE_URL;
const ref = url.match(/https:\/\/([^.]+)\.supabase.co/)[1];
fetch('https://api.supabase.com/v1/projects/' + ref + '/database/query', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + process.env.SUPABASE_PAT, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql })
}).then(r => r.text()).then(t => console.log('SQL:', t));
"
echo ""

# 3. Verifiering
echo "════════════════════════════════════════════════════════════════════"
echo "  STEG 3: 90%-målet verification (alla kategorier)"
echo "════════════════════════════════════════════════════════════════════"
npx --yes tsx scripts/_verifyDescriptionCoverage.ts 2>&1 | tail -30
echo ""

# 4. Hallucination-mätning
echo "════════════════════════════════════════════════════════════════════"
echo "  STEG 4: Hallucination-mätning på 30 music-events"
echo "════════════════════════════════════════════════════════════════════"
npx --yes tsx scripts/_measureHallucinations.ts --category=music --limit=30 2>&1 | tail -50

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "  PIPELINE KLAR"
echo "════════════════════════════════════════════════════════════════════"
