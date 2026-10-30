#!/bin/bash
# scripts/followup_after_ingestion.sh
#
# "Check/följ" efter en discovery + ingestion-runda:
#   1. Vänta på att ingestion-kedjan (scripts/ingestion-cron.ts) avslutas.
#   2. Ge de nyimporterade eventsen biblioteksbilder.
#      (Kedjan kör D-images INNAN import-to-eventpulse, så events som
#      importeras under samma körning får ingen bild från den passen.)
#   3. Verifiera att de nya eventsen har giltiga 3:2-bilder.
#   4. Verifiera i riktig app att inga kort visar platshållare.
#
# Kräver: Redis igång, .env med Supabase-nycklar, Expo på :8081.
#
# Kör:
#   bash scripts/followup_after_ingestion.sh [sedan-ISO-tidpunkt]
#   t.ex. bash scripts/followup_after_ingestion.sh 2026-10-29T17:40:00Z
set -u
cd /Users/claudgashi/EventPulse

SINCE="${1:-}"
LOG="runtime/ingestion-round.log"
OUT="runtime/followup-after-ingestion.log"

exec > >(tee -a "$OUT") 2>&1
echo "=== FÖLJDSKONTROLL startar $(date +%H:%M:%S) ==="
echo "sedan: ${SINCE:-okänt}"

# ── 1. Vänta på kedjan ───────────────────────────────────────────────────
echo "--- väntar på ingestion-cron ---"
for i in $(seq 1 360); do
  if ! pgrep -f "scripts/ingestion-cron.ts" > /dev/null; then
    echo "kedjan avslutad efter ${i} kollar"
    break
  fi
  [ $((i % 10)) -eq 0 ] && echo "  …väntar fortfarande ($((i * 20))s)"
  sleep 20
done

echo ""
echo "=== KEDJANS SLUTSTATUS ==="
grep -aoE "\[ingestion-cron\] (▶|✓|✗) [^:]+" "$LOG" | tail -30
grep -aoE "DONE exit=[0-9]+[^\"]*" "$LOG" | tail -1

# ── 2. Bildmatchning för nytillkomna events ──────────────────────────────
echo ""
echo "=== 2. BILDMATCHNING (D-images) ==="
npx tsx --eval "import('./08-Agent/services/imageGen.matchLibraryFirst.ts').then(m => m.matchLibraryFirst({ limit: 500, onlyMissing: true, libraryConcurrency: 5, bflConcurrency: 0, skipBflFallback: true })).then(r => console.log('MLF_RESULT:' + JSON.stringify(r))).catch(e => { console.error(e); process.exit(1); })" | tail -3

# ── 3. Verifiera de nya eventsen ─────────────────────────────────────────
echo ""
echo "=== 3. NYA EVENTS MED BILDER ==="
if [ -n "$SINCE" ]; then
  node --env-file=.env --import tsx -e "
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await db.from('events')
  .select('id, title_sv, source, category_slug, image_url')
  .gte('created_at', '${SINCE}').order('created_at');
const rows = data ?? [];
let ok = 0, saknarKategori = 0, fel = 0;
for (const e of rows) {
  if (!e.category_slug) saknarKategori++;
  if (!e.image_url) { fel++; continue; }
  try {
    const r = await fetch(e.image_url, { signal: AbortSignal.timeout(15000) });
    const buf = Buffer.from(await r.arrayBuffer());
    const m = await sharp(buf).metadata();
    const aspect = m.width / m.height;
    if (r.ok && Math.abs(aspect - 1.5) < 0.01) ok++; else fel++;
  } catch { fel++; }
}
console.log('nya events:', rows.length, '| giltiga 3:2-bilder:', ok, '| fel/saknar bild:', fel, '| saknar kategori:', saknarKategori);
"
else
  echo "(ingen tidsstämpel given — hoppar över steg 3)"
fi

# ── 4. Verifiera i appen ─────────────────────────────────────────────────
echo ""
echo "=== 4. APPVERIFIERING ==="
node scripts/verify_app_event_images.mjs --sample=500 --min=50 --timeout=600 2>&1 | tail -14

# ── 5. Teckenkontroll: kinesiska/asiatiska tecken i events ─────────────────
#
# Körs sist: när allt är klart. Skannar ALLA publicerade events och
# rapporterar fält som innehåller tecken från ett skript som inte hör hemma
# i visningsspråket (svenska). Skillnaden mellan "defekt" (vår egen text) och
# "källinnehåll" (legitim främmande titel) styrs i rapporten.
echo ""
echo "=== 5. TECKENKONTROLL (kinesiska/asiatiska tecken) ==="
npx tsx --env-file=.env scripts/check_asian_chars.ts \
  --json "runtime/text-integrity/asian-chars-$(date +%Y%m%d-%H%M%S).json" 2>&1 | tail -14
TECKEN_EXIT="${PIPESTATUS[0]}"
if [ "$TECKEN_EXIT" != "0" ]; then
  echo "TECKENKONTROLL: fynd (exit ${TECKEN_EXIT}) — se rapporten ovan och runtime/text-integrity/."
  echo "  Reparera med: npx tsx --env-file=.env scripts/repair_asian_text.ts --dry-run"
else
  echo "TECKENKONTROLL: inga fynd."
fi

echo ""
echo "=== FÖLJDSKONTROLL KLAR $(date +%H:%M:%S) ==="
